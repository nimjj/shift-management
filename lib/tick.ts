import "server-only";
import { SENDERS } from "@/lib/alerts";
import { syncCalendar, type SyncSummary } from "@/lib/calendar-sync";
import { appUrl } from "@/lib/env";
import { runTick, type AlertRow, type EngineStore, type TickSummary } from "@/lib/rules/execute";
import {
  firingKey,
  type Channel,
  type Directory,
  type EngineEmployee,
  type EngineShift,
  type FiringRef,
  type Rule,
} from "@/lib/rules/types";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json, NotificationRule } from "@/lib/database.types";

// The every-minute checker (POST /api/cron/check-shifts). Reads the rules and settings fresh on
// every run, so a change in Settings takes effect on the next tick with no redeploy.

type Db = ReturnType<typeof createServiceClient>;

const isChannel = (c: string): c is Channel => c === "email" || c === "telegram";

export function toRule(r: NotificationRule): Rule {
  return {
    id: r.id,
    position: r.position,
    name: r.name,
    trigger_minutes: r.trigger_minutes,
    condition: r.condition as Rule["condition"],
    condition_n: r.condition_n,
    recipient_type: r.recipient_type as Rule["recipient_type"],
    recipient_ids: r.recipient_ids,
    recipient_role: r.recipient_role,
    channels: r.channels.filter(isChannel),
    message_tpl: r.message_tpl,
    template_scope: r.template_scope,
    enabled: r.enabled,
    critical: r.critical,
  };
}

/** Everyone who could receive a message, with their preferences, plus group membership. */
export async function loadDirectory(db: Db): Promise<Directory> {
  const [orgRes, employeesRes, membersRes] = await Promise.all([
    db.from("org_settings").select("default_display_tz").eq("id", 1).single(),
    db
      .from("employees")
      .select(
        "id, full_name, email, role, active, telegram_chat_id, employee_notification_prefs(channels, quiet_hours_start, quiet_hours_end, display_tz)",
      )
      .eq("active", true),
    db.from("notification_group_members").select("group_id, employee_id"),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (employeesRes.error) throw employeesRes.error;
  if (membersRes.error) throw membersRes.error;

  const employees = new Map<string, EngineEmployee>();
  for (const e of employeesRes.data) {
    const prefs = e.employee_notification_prefs;
    employees.set(e.id, {
      id: e.id,
      full_name: e.full_name,
      email: e.email,
      role: e.role,
      active: e.active,
      telegram_chat_id: e.telegram_chat_id,
      channels: (prefs?.channels ?? ["email", "telegram"]).filter(isChannel),
      quiet_start: prefs?.quiet_hours_start ?? null,
      quiet_end: prefs?.quiet_hours_end ?? null,
      display_tz: prefs?.display_tz ?? orgRes.data.default_display_tz,
    });
  }

  const groups = new Map<string, string[]>();
  for (const m of membersRes.data) groups.set(m.group_id, [...(groups.get(m.group_id) ?? []), m.employee_id]);

  return { employees, groups };
}

export function alertStore(db: Db): EngineStore {
  return {
    async claim(rows: FiringRef[]) {
      const { data, error } = await db.rpc("claim_rule_firings", { p_rows: rows as unknown as Json });
      if (error) throw error;
      return (data ?? []).map((r) => ({ rule_id: r.rule_id, shift_id: r.shift_id, assignment_id: r.assignment_id }));
    },
    async logAlerts(rows: AlertRow[]) {
      const { error } = await db.from("alerts").insert(rows.map((r) => ({ ...r, payload: r.payload as Json })));
      if (error) console.error("could not log alerts", error);
    },
  };
}

export type CheckShiftsResult = { rules: TickSummary; calendar: SyncSummary | { error: string }; running: number };

export async function checkShifts(now = new Date()): Promise<CheckShiftsResult> {
  const db = createServiceClient();
  const nowIso = now.toISOString();
  let rules: TickSummary = { due: 0, claimed: 0, sent: 0, failed: 0, suppressed: 0 };

  const shiftsRes = await db
    .from("shifts")
    .select(
      "id, template_id, starts_at, ends_at, shift_templates(code), assignments(id, employee_id, role, checked_in_at, checkin_token)",
    )
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .limit(200);
  if (shiftsRes.error) throw shiftsRes.error;

  const shifts: EngineShift[] = shiftsRes.data.map((s) => ({
    id: s.id,
    template_id: s.template_id,
    block: s.shift_templates?.code ?? "test",
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    assignments: s.assignments,
  }));

  if (shifts.length > 0) {
    const [rulesRes, firedRes, directory] = await Promise.all([
      db.from("notification_rules").select("*").eq("enabled", true).order("position"),
      db
        .from("rule_firings")
        .select("rule_id, shift_id, assignment_id")
        .in(
          "shift_id",
          shifts.map((s) => s.id),
        )
        .limit(5000),
      loadDirectory(db),
    ]);
    if (rulesRes.error) throw rulesRes.error;
    if (firedRes.error) throw firedRes.error;

    rules = await runTick({
      rules: rulesRes.data.map(toRule),
      shifts,
      directory,
      now,
      appUrl: appUrl(),
      store: alertStore(db),
      senders: SENDERS,
      alreadyFired: new Set(firedRes.data.map(firingKey)),
    });
  }

  // Calendar: send anything still pending, retry failures, cancel removed invites.
  let calendar: CheckShiftsResult["calendar"];
  try {
    calendar = await syncCalendar();
  } catch (e) {
    console.error("calendar sync failed", e);
    calendar = { error: e instanceof Error ? e.message : "calendar sync failed" };
  }

  return { rules, calendar, running: shifts.length };
}
