import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { requireEmployee, requireSupervisor } from "@/lib/auth";
import { ActionError, isPgErrorLike, mapPostgresError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import type { Database, Employee } from "@/lib/database.types";
import { callMutation, type MutationArgs, type MutationData, type MutationName } from "@/lib/mutate";

export { ActionError };

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

type Ctx<S extends z.ZodTypeAny> = {
  /** Acts as the signed-in supervisor (RLS applies). Use for READS before a mutation. */
  supabase: SupabaseClient<Database>;
  actor: Employee;
  input: z.infer<S>;
  /**
   * Run an atomic mutation: a Postgres function that does the write AND its audit_log row in one
   * transaction (see lib/mutate.ts). This is the only way to write data from a supervisorAction.
   */
  mutate: <F extends MutationName>(fn: F, args: MutationArgs<F>) => Promise<MutationData[F]>;
};

/**
 * The one way supervisor mutations are written:
 *   requireSupervisor() -> Zod parse -> handler -> ctx.mutate(<atomic Postgres function>).
 * Auditing happens inside the database function, in the same transaction as the change, so a
 * mutation can never be saved without its audit row (or the reverse).
 * Throw ActionError(message) from a handler to return a friendly error.
 */
export async function supervisorAction<S extends z.ZodTypeAny, T = void>(
  schema: S,
  raw: unknown,
  handler: (ctx: Ctx<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  const actor = await requireSupervisor();

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    };
  }

  const supabase = await createClient();
  const mutate: Ctx<S>["mutate"] = (fn, args) =>
    callMutation((name, a) => supabase.rpc(name as never, a as never), fn, args);

  try {
    const data = await handler({ supabase, actor, input: parsed.data, mutate });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    // Errors from direct reads inside the handler (PostgrestError) get the same friendly mapping.
    const mapped = isPgErrorLike(e) ? mapPostgresError(e) : null;
    if (mapped) return { ok: false, error: mapped.message };
    console.error("supervisorAction failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/**
 * For things an employee does to their OWN data (check in, notification preferences, linking
 * Telegram). These are not supervisor mutations, so there is no audit row; each one is a Postgres
 * function that only ever touches the caller (current_employee_id()).
 */
export async function employeeAction<S extends z.ZodTypeAny, T = void>(
  schema: S,
  raw: unknown,
  handler: (ctx: { supabase: SupabaseClient<Database>; actor: Employee; input: z.infer<S> }) => Promise<T>,
): Promise<ActionResult<T>> {
  const actor = await requireEmployee();

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    };
  }

  try {
    const data = await handler({ supabase: await createClient(), actor, input: parsed.data });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    const mapped = isPgErrorLike(e) ? mapPostgresError(e) : null;
    if (mapped) return { ok: false, error: mapped.message };
    console.error("employeeAction failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
