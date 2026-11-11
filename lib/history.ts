// Pure: the month picker and the per-agent totals on the History page.

import type { CheckinRules } from "@/lib/settings";
import { wasLate } from "@/lib/status";
import { localDateIn, localToUtc, type LocalDate } from "@/lib/time";

export type Month = { y: number; m: number };

/** "2026-11" -> { y: 2026, m: 11 }; anything else -> null. */
export function parseMonth(s: string | undefined): Month | null {
  const match = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? { y, m } : null;
}

export function formatMonth({ y, m }: Month): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function addMonths({ y, m }: Month, n: number): Month {
  const index = y * 12 + (m - 1) + n;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

export function monthOf(instant: Date, tz: string): Month {
  const d = localDateIn(instant, tz);
  return { y: d.y, m: d.m };
}

/** "November 2026" */
export function monthLabel({ y, m }: Month): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** The instants where the month starts and ends in `tz` (a shift belongs to the month it starts in). */
export function monthRange(month: Month, tz: string): { from: Date; to: Date } {
  const first: LocalDate = { y: month.y, m: month.m, d: 1 };
  const next = addMonths(month, 1);
  return { from: localToUtc(first, "00:00", tz), to: localToUtc({ y: next.y, m: next.m, d: 1 }, "00:00", tz) };
}

export type HistoryAssignment = {
  employee_id: string;
  role: "primary" | "backup";
  checked_in_at: string | null;
};

export type HistoryShift = {
  starts_at: string;
  ends_at: string;
  rules: CheckinRules;
  assignments: HistoryAssignment[];
};

export type AgentTotals = {
  employee_id: string;
  /** Shifts as a primary: the old sheet's "Tol. shifts". */
  shifts: number;
  backup: number;
  /** Of the primary shifts that have ended. */
  attended: number;
  late: number;
  missed: number;
  upcoming: number;
};

/**
 * Per-agent totals for a set of shifts. Backup assignments are counted separately and never as
 * late or missed: a backup is not expected to check in.
 */
export function agentTotals(shifts: readonly HistoryShift[], now: Date): AgentTotals[] {
  const map = new Map<string, AgentTotals>();
  const get = (id: string) => {
    let t = map.get(id);
    if (!t) {
      t = { employee_id: id, shifts: 0, backup: 0, attended: 0, late: 0, missed: 0, upcoming: 0 };
      map.set(id, t);
    }
    return t;
  };

  for (const s of shifts) {
    const ended = new Date(s.ends_at).getTime() <= now.getTime();
    for (const a of s.assignments) {
      const t = get(a.employee_id);
      if (a.role === "backup") {
        t.backup += 1;
        continue;
      }
      t.shifts += 1;
      if (a.checked_in_at) {
        t.attended += 1;
        if (wasLate(a.checked_in_at, s, s.rules)) t.late += 1;
      } else if (ended) {
        t.missed += 1;
      } else {
        t.upcoming += 1;
      }
    }
  }
  return [...map.values()];
}
