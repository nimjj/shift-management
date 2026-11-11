// One tick of the checker. Pure logic over injected I/O:
//   1. work out the due firings                        (evaluate.ts)
//   2. CLAIM them: the store inserts into rule_firings with ON CONFLICT DO NOTHING and returns only
//      the rows this call inserted, so overlapping cron runs can never both send the same thing
//   3. send each claimed firing to its recipients, retrying a failed send once
//   4. log every attempt (sent / failed / suppressed) to alerts
//
// Delivery is at-most-once: a firing is claimed before it is sent, so a send that fails twice is
// logged and NOT retried on later ticks. That is deliberate: a flapping channel must not spam people.

import { dueFirings, planDeliveries, resolveRecipients } from "./evaluate";
import { messageValues, renderTemplate } from "./template";
import {
  firingKey,
  refOf,
  type Channel,
  type Directory,
  type EngineShift,
  type Firing,
  type FiringRef,
  type Rule,
} from "./types";

export type OutboundMessage = { subject: string; text: string };

/** Sends one message. Must throw on failure. */
export type Sender = (address: string, message: OutboundMessage) => Promise<void>;

export type AlertRow = {
  rule_id: string | null;
  rule_name: string;
  shift_id: string | null;
  assignment_id: string | null;
  recipient_employee_id: string | null;
  recipient: string;
  channel: Channel;
  status: "sent" | "failed" | "suppressed";
  success: boolean;
  error: string | null;
  payload: { subject: string; text: string; reason?: string };
  is_test: boolean;
};

export type EngineStore = {
  /** Insert the firings; return only the ones that were not there already. */
  claim(rows: FiringRef[]): Promise<FiringRef[]>;
  logAlerts(rows: AlertRow[]): Promise<void>;
};

export type TickInput = {
  rules: readonly Rule[];
  shifts: readonly EngineShift[];
  directory: Directory;
  now: Date;
  appUrl: string;
  store: EngineStore;
  senders: Record<Channel, Sender>;
  /** Keys (firingKey) known to have fired already. Only an optimisation: the claim is the guard. */
  alreadyFired?: ReadonlySet<string>;
};

export type TickSummary = { due: number; claimed: number; sent: number; failed: number; suppressed: number };

export function subjectFor(ruleName: string, block: string): string {
  return `ShiftBoard: ${ruleName} (Block ${block})`;
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

/** Try once, retry once, then give up. Returns null on success or the last error message. */
export async function sendWithRetry(send: () => Promise<void>): Promise<string | null> {
  try {
    await send();
    return null;
  } catch {
    try {
      await send();
      return null;
    } catch (e) {
      return errorText(e);
    }
  }
}

/** Sends one firing to everyone it should reach and returns the alert rows to log. */
export async function deliverFiring(
  firing: Firing,
  input: Pick<TickInput, "directory" | "now" | "appUrl" | "senders">,
): Promise<AlertRow[]> {
  const { rule, shift, assignment } = firing;
  const recipients = resolveRecipients(firing, input.directory);
  const rows: AlertRow[] = [];

  for (const d of planDeliveries(rule, recipients, input.now)) {
    const message: OutboundMessage = {
      subject: subjectFor(rule.name, shift.block),
      text: renderTemplate(rule.message_tpl, messageValues(firing, d.employee, input.directory, input.appUrl)),
    };
    const row: AlertRow = {
      rule_id: rule.id,
      rule_name: rule.name,
      shift_id: shift.id,
      assignment_id: assignment?.id ?? null,
      recipient_employee_id: d.employee.id,
      recipient: d.address,
      channel: d.channel,
      status: "sent",
      success: true,
      error: null,
      payload: message,
      is_test: false,
    };

    if (d.suppressed) {
      rows.push({ ...row, status: "suppressed", success: false, payload: { ...message, reason: d.suppressed } });
      continue;
    }
    const error = await sendWithRetry(() => input.senders[d.channel](d.address, message));
    rows.push(error ? { ...row, status: "failed", success: false, error } : row);
  }
  return rows;
}

export async function runTick(input: TickInput): Promise<TickSummary> {
  const due = dueFirings(input.rules, input.shifts, input.now);
  const fired = input.alreadyFired;
  const fresh = fired ? due.filter((f) => !fired.has(firingKey(refOf(f)))) : due;
  const summary: TickSummary = { due: due.length, claimed: 0, sent: 0, failed: 0, suppressed: 0 };
  if (fresh.length === 0) return summary;

  const claimed = new Set((await input.store.claim(fresh.map(refOf))).map(firingKey));
  summary.claimed = claimed.size;

  const rows: AlertRow[] = [];
  for (const firing of fresh) {
    if (!claimed.has(firingKey(refOf(firing)))) continue;
    rows.push(...(await deliverFiring(firing, input)));
  }

  for (const r of rows) summary[r.status] += 1;
  if (rows.length > 0) await input.store.logAlerts(rows);
  return summary;
}
