// Calls an atomic mutation function (see supabase/migrations/*_atomic_employee_mutations.sql).
//
// THE PATTERN for every supervisor mutation:
//   1. A Postgres function does the write(s) and calls public.write_audit() in the SAME transaction.
//   2. It returns jsonb { audit_id, data }.
//   3. Add its name + result type below, and its Args/Returns to lib/database.types.ts.
//   4. Call it from a supervisorAction handler via ctx.mutate(...).
// There is intentionally no app-side audit insert: that would not be atomic with the write.

import type { Database, Employee, OrgSettings, ShiftTemplate } from "@/lib/database.types";
import { isPgErrorLike, mapPostgresError, type PgErrorLike } from "@/lib/db-errors";

/** Result type of each mutation's `data`. Add new mutations here. */
export type MutationData = {
  create_employee: Employee;
  update_employee: Employee;
  create_shift_template: ShiftTemplate;
  update_shift_template: ShiftTemplate;
  generate_shifts: { requested: number; inserted: number; skipped: number };
  apply_shift_regeneration: { moved: number; added: number; removed: number };
  update_org_settings: OrgSettings;
};

export type MutationName = keyof MutationData;
export type MutationArgs<F extends MutationName> = Database["public"]["Functions"][F]["Args"];

export type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PgErrorLike | null }>;

export async function callMutation<F extends MutationName>(
  rpc: RpcFn,
  fn: F,
  args: MutationArgs<F>,
): Promise<MutationData[F]> {
  const { data, error } = await rpc(fn, args as Record<string, unknown>);

  if (error) {
    throw mapPostgresError(error) ?? (isPgErrorLike(error) ? new Error(error.message) : error);
  }

  const result = data as { audit_id?: unknown; data?: unknown } | null;
  if (!result || typeof result.audit_id !== "number") {
    // The write already committed inside the function; this is a bug in the function. Fail loudly.
    throw new Error(`Mutation "${fn}" returned no audit_id. Mutation functions must call write_audit().`);
  }
  return result.data as MutationData[F];
}
