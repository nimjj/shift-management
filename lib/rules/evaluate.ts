// Pure: which rules are due right now, who gets each one, and through which channel.
// No I/O and no clock: "now" is always passed in.

import { formatTimeIn } from "@/lib/time";
import type { Channel, Directory, EngineEmployee, EngineShift, Firing, Rule } from "./types";

const MIN = 60_000;

function inScope(rule: Rule, shift: EngineShift): boolean {
  if (rule.template_scope === null) return true;
  return shift.template_id !== null && rule.template_scope.includes(shift.template_id);
}

/**
 * Every firing that is due at `now`, ignoring whether it has already been sent (the claim in
 * execute.ts takes care of that).
 *  - only shifts that are running (started, not ended)
 *  - only enabled rules, in scope, whose trigger time has passed
 *  - only PRIMARY assignments count
 *  - agent_missing fires once per missing agent; nobody_in / fewer_than_n fire once per shift
 */
export function dueFirings(rules: readonly Rule[], shifts: readonly EngineShift[], now: Date): Firing[] {
  const t = now.getTime();
  const ordered = [...rules].filter((r) => r.enabled).sort((a, b) => a.position - b.position);
  const out: Firing[] = [];

  for (const shift of shifts) {
    const start = new Date(shift.starts_at).getTime();
    const end = new Date(shift.ends_at).getTime();
    if (t < start || t >= end) continue;

    const primaries = shift.assignments.filter((a) => a.role === "primary");
    const checkedIn = primaries.filter((a) => a.checked_in_at).length;

    for (const rule of ordered) {
      if (!inScope(rule, shift)) continue;
      if (t < start + rule.trigger_minutes * MIN) continue;

      if (rule.condition === "agent_missing") {
        for (const a of primaries) if (!a.checked_in_at) out.push({ rule, shift, assignment: a });
      } else if (rule.condition === "nobody_in") {
        if (checkedIn === 0) out.push({ rule, shift, assignment: null });
      } else if (rule.condition === "fewer_than_n") {
        if (checkedIn < (rule.condition_n ?? 1)) out.push({ rule, shift, assignment: null });
      }
    }
  }
  return out;
}

/** The people a firing goes to: active employees only, each once. */
export function resolveRecipients(firing: Firing, dir: Directory): EngineEmployee[] {
  const { rule, shift, assignment } = firing;
  let ids: string[];

  switch (rule.recipient_type) {
    case "missing_agents":
      ids = assignment
        ? [assignment.employee_id]
        : shift.assignments.filter((a) => a.role === "primary" && !a.checked_in_at).map((a) => a.employee_id);
      break;
    case "all_assignees":
      ids = shift.assignments.map((a) => a.employee_id);
      break;
    case "employees":
      ids = rule.recipient_ids;
      break;
    case "role":
      ids = [...dir.employees.values()].filter((e) => e.role === rule.recipient_role).map((e) => e.id);
      break;
    case "group":
      ids = rule.recipient_ids.flatMap((g) => dir.groups.get(g) ?? []);
      break;
  }

  const seen = new Set<string>();
  const out: EngineEmployee[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = dir.employees.get(id);
    if (e?.active) out.push(e);
  }
  return out;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Quiet hours are wall-clock times in the person's own zone and may wrap past midnight (22:00-07:00). */
export function inQuietHours(now: Date, start: string | null, end: string | null, tz: string): boolean {
  if (!start || !end) return false;
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return false;
  const n = minutesOf(formatTimeIn(now, tz));
  return s < e ? n >= s && n < e : n >= s || n < e;
}

export type Delivery = {
  employee: EngineEmployee;
  channel: Channel;
  /** Email address or Telegram chat id. */
  address: string;
  /** Set when the message must not be sent (and is logged as suppressed instead). */
  suppressed: "quiet_hours" | null;
};

/**
 * Channels for each recipient = the rule's channels the person accepts. Telegram needs a linked
 * chat. Quiet hours suppress the send. Critical rules ignore both the person's channel choices and
 * their quiet hours.
 */
export function planDeliveries(rule: Rule, recipients: readonly EngineEmployee[], now: Date): Delivery[] {
  const out: Delivery[] = [];
  for (const employee of recipients) {
    const quiet =
      !rule.critical && inQuietHours(now, employee.quiet_start, employee.quiet_end, employee.display_tz);
    for (const channel of rule.channels) {
      if (!rule.critical && !employee.channels.includes(channel)) continue;
      const address = channel === "email" ? employee.email : employee.telegram_chat_id?.toString();
      if (!address) continue; // Telegram not linked
      out.push({ employee, channel, address, suppressed: quiet ? "quiet_hours" : null });
    }
  }
  return out;
}
