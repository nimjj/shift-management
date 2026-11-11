// Calls an atomic mutation function (see supabase/migrations/*_atomic_employee_mutations.sql).
//
// THE PATTERN for every supervisor mutation:
//   1. A Postgres function does the write(s) and calls public.write_audit() in the SAME transaction.
//   2. It returns jsonb { audit_id, data }.
//   3. Add its name + result type below, and its Args/Returns to lib/database.types.ts.
//   4. Call it from a supervisorAction handler via ctx.mutate(...).
// There is intentionally no app-side audit insert: that would not be atomic with the write.

import type {
  Database,
  Employee,
  NotificationRule,
  OrgSettings,
  ShiftTemplate,
  TemplateOverrideRow,
} from "@/lib/database.types";
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
  set_shift_assignments: {
    shift_id: string;
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
  copy_week_assignments: {
    shifts_filled: number;
    assignments_created: number;
    skipped: { to_shift_id: string; reason: CopySkipReason }[];
  };
  update_checkin_rules: OrgSettings;
  set_template_override: TemplateOverrideRow | null;
  create_test_shift: { shift_id: string; starts_at: string; ends_at: string; assignments: number };
  delete_test_shift: { shift_id: string };
  update_calendar_settings: OrgSettings;
  retry_calendar_invite: { assignment_id: string };
  save_notification_rule: NotificationRule;
  delete_notification_rule: { id: string };
  reorder_notification_rules: { count: number };
  save_notification_group: { id: string; name: string; members: number };
  delete_notification_group: { id: string };
  update_employee_prefs: Database["public"]["Tables"]["employee_notification_prefs"]["Row"];
};

/**
 * Every audited supervisor mutation, by name. lib/audit-coverage.test.ts checks that each of these
 * (and every other function a signed-in user may call) writes its audit row in SQL.
 */
export const MUTATION_NAMES = [
  "create_employee",
  "update_employee",
  "create_shift_template",
  "update_shift_template",
  "generate_shifts",
  "apply_shift_regeneration",
  "update_org_settings",
  "set_shift_assignments",
  "copy_week_assignments",
  "update_checkin_rules",
  "set_template_override",
  "create_test_shift",
  "delete_test_shift",
  "update_calendar_settings",
  "retry_calendar_invite",
  "save_notification_rule",
  "delete_notification_rule",
  "reorder_notification_rules",
  "save_notification_group",
  "delete_notification_group",
  "update_employee_prefs",
] as const satisfies readonly (keyof MutationData)[];

// Compile-time check that the list above is complete.
type Missing = Exclude<keyof MutationData, (typeof MUTATION_NAMES)[number]>;
const _complete: Missing extends never ? true : never = true;
void _complete;

export type CopySkipReason = "missing" | "finished" | "already_assigned" | "source_empty";

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
