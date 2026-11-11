// Pure: derived statuses. Nothing here is stored; it is all computed from checked_in_at, the shift
// times, the check-in rules and "now". Only PRIMARY assignments count towards a shift's status.

import type { CheckinRules } from "@/lib/settings";

const MIN = 60_000;

export type ShiftTimes = { starts_at: string | Date; ends_at: string | Date };

export type AssignmentStatus = "upcoming" | "checkin_open" | "checked_in" | "late" | "missed";
export type ShiftStatus = "upcoming" | "covered" | "partial" | "uncovered";

const ms = (d: string | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Check-in is accepted when  opensAt <= now < closesAt  (same rule as the check_in() function). */
export function checkinWindow(shift: ShiftTimes, rules: CheckinRules): { opensAt: Date; closesAt: Date } {
  const start = ms(shift.starts_at);
  const end = ms(shift.ends_at);
  const closes = rules.closeRule === "after_start" ? Math.min(end, start + rules.closeAfterMin * MIN) : end;
  return { opensAt: new Date(start - rules.openBeforeMin * MIN), closesAt: new Date(closes) };
}

export function canCheckIn(
  a: { checked_in_at: string | null },
  shift: ShiftTimes,
  rules: CheckinRules,
  now: Date,
): boolean {
  if (a.checked_in_at) return false;
  const { opensAt, closesAt } = checkinWindow(shift, rules);
  return now >= opensAt && now < closesAt;
}

/**
 *  upcoming      the check-in window has not opened yet
 *  checkin_open  not checked in, and not yet late
 *  checked_in    checked_in_at is set (whenever it happened)
 *  late          not checked in, past the late threshold, shift still running
 *  missed        not checked in and the shift has ended
 */
export function assignmentStatus(
  a: { checked_in_at: string | null },
  shift: ShiftTimes,
  rules: CheckinRules,
  now: Date,
): AssignmentStatus {
  if (a.checked_in_at) return "checked_in";
  const t = now.getTime();
  if (t >= ms(shift.ends_at)) return "missed";
  const { opensAt } = checkinWindow(shift, rules);
  if (t < opensAt.getTime()) return "upcoming";
  if (t > ms(shift.starts_at) + rules.lateAfterMin * MIN) return "late";
  return "checkin_open";
}

/** How many primaries must be checked in for the shift to count as covered. */
export function coverTarget(primaryCount: number, rules: CheckinRules): number {
  if (primaryCount === 0) return 1; // an unstaffed shift can never be covered
  return rules.coveredRule === "all" ? primaryCount : Math.min(rules.coveredMin, primaryCount);
}

/**
 *  covered    enough primaries have checked in (all of them, or the rule's N)
 *  upcoming   not covered and the shift has not started
 *  partial    started, someone is in but not enough
 *  uncovered  started and nobody is in (also a shift with no primaries at all)
 */
export function shiftStatus(
  primaries: readonly { checked_in_at: string | null }[],
  shift: ShiftTimes,
  rules: CheckinRules,
  now: Date,
): ShiftStatus {
  const checkedIn = primaries.filter((p) => p.checked_in_at).length;
  if (primaries.length > 0 && checkedIn >= coverTarget(primaries.length, rules)) return "covered";
  if (now.getTime() < ms(shift.starts_at)) return "upcoming";
  return checkedIn > 0 ? "partial" : "uncovered";
}

/** Minutes between the shift start and the check-in (negative = early). */
export function checkinDelayMinutes(checkedInAt: string, shift: ShiftTimes): number {
  return Math.round((ms(checkedInAt) - ms(shift.starts_at)) / MIN);
}

/** Checked in, but after the late threshold. Used by History. */
export function wasLate(checkedInAt: string | null, shift: ShiftTimes, rules: CheckinRules): boolean {
  if (!checkedInAt) return false;
  return ms(checkedInAt) > ms(shift.starts_at) + rules.lateAfterMin * MIN;
}

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  upcoming: "Upcoming",
  checkin_open: "Check-in open",
  checked_in: "Checked in",
  late: "Late",
  missed: "Missed",
};

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  upcoming: "Upcoming",
  covered: "Covered",
  partial: "Partial",
  uncovered: "Uncovered",
};
