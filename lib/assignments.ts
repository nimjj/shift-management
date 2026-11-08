// Pure assignment-grid logic (no I/O). The grid mirrors the old roster sheet: one row per block,
// one column per week.

import {
  addDays,
  formatLocalDate,
  localDateIn,
  startOfWeek,
  type LocalDate,
} from "@/lib/time";

export const GRID_WEEKS = 4;
export const MAX_GRID_OFFSET = 52;
export const ASSIGNMENT_ROLES = ["primary", "backup"] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export type Assignee = { employee_id: string; role: AssignmentRole };

export type GridShift = {
  id: string;
  template_id: string | null;
  occurrence_date: string | null;
  starts_at: string;
  ends_at: string;
};

/**
 * The weeks shown as columns: `offset` weeks from the current week (0 = this week), `count` of them.
 * Week boundaries are the org's week_start in the client zone, like everywhere else.
 */
export function gridWeeks(
  now: Date,
  org: { client_tz: string; week_start: number },
  offset: number,
  count: number = GRID_WEEKS,
): LocalDate[] {
  if (!Number.isInteger(offset) || Math.abs(offset) > MAX_GRID_OFFSET) {
    throw new Error(`Week offset must be a whole number between -${MAX_GRID_OFFSET} and ${MAX_GRID_OFFSET}.`);
  }
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new Error("Column count must be a whole number from 1 to 12.");
  }
  const first = addDays(startOfWeek(localDateIn(now, org.client_tz), org.week_start), offset * 7);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

/** Local date range covered by the columns, as [from, to). */
export function gridRange(weeks: readonly LocalDate[]): { from: LocalDate; to: LocalDate } {
  if (weeks.length === 0) throw new Error("At least one week is required.");
  return { from: weeks[0], to: addDays(weeks[weeks.length - 1], 7) };
}

/**
 * Which column a shift belongs in: the index of the week whose 7 days contain its occurrence date.
 * Returns -1 for a shift outside the range (or a test shift with no occurrence date).
 */
export function weekIndexOf(shift: GridShift, weeks: readonly LocalDate[]): number {
  if (!shift.occurrence_date) return -1;
  const d = shift.occurrence_date;
  for (let i = 0; i < weeks.length; i++) {
    const from = formatLocalDate(weeks[i]);
    const to = formatLocalDate(addDays(weeks[i], 7));
    if (d >= from && d < to) return i;
  }
  return -1;
}

/** `cells[templateId][weekIndex]` = the shift in that cell, or undefined if none was generated. */
export function buildCells(
  shifts: readonly GridShift[],
  weeks: readonly LocalDate[],
): Map<string, (GridShift | undefined)[]> {
  const cells = new Map<string, (GridShift | undefined)[]>();
  for (const s of shifts) {
    if (!s.template_id) continue;
    const i = weekIndexOf(s, weeks);
    if (i < 0) continue;
    const row = cells.get(s.template_id) ?? new Array<GridShift | undefined>(weeks.length).fill(undefined);
    // A template has one shift per week (UNIQUE (template_id, occurrence_date) plus one occurrence
    // per week), but keep the earliest if a week ever held two.
    const current = row[i];
    if (!current || s.starts_at < current.starts_at) row[i] = s;
    cells.set(s.template_id, row);
  }
  return cells;
}

/** Deduplicate and sort, so the same roster always produces the same payload. */
export function normaliseAssignees(raw: readonly Assignee[]): Assignee[] {
  const byId = new Map<string, Assignee>();
  for (const a of raw) {
    if (!a.employee_id) continue;
    byId.set(a.employee_id, { employee_id: a.employee_id, role: a.role });
  }
  return [...byId.values()].sort((x, y) => x.employee_id.localeCompare(y.employee_id));
}

export type AssigneeDiff = { added: Assignee[]; removed: string[]; changed: Assignee[] };

/** What set_shift_assignments will do, for the confirmation text in the UI. */
export function diffAssignees(before: readonly Assignee[], after: readonly Assignee[]): AssigneeDiff {
  const b = new Map(normaliseAssignees(before).map((a) => [a.employee_id, a.role]));
  const diff: AssigneeDiff = { added: [], removed: [], changed: [] };
  for (const a of normaliseAssignees(after)) {
    const was = b.get(a.employee_id);
    if (was === undefined) diff.added.push(a);
    else if (was !== a.role) diff.changed.push(a);
    b.delete(a.employee_id);
  }
  diff.removed = [...b.keys()];
  return diff;
}

export function assigneeDiffIsEmpty(d: AssigneeDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

export type CopyPair = { from_shift_id: string; to_shift_id: string };

/** Why copy_week_assignments left a cell alone. Keep in step with the SQL function. */
export const COPY_SKIP_LABELS = {
  already_assigned: "already had people on it",
  finished: "has already finished",
  missing: "no longer exists",
  source_empty: "had nobody to copy",
} as const;

/**
 * "Copy last week": pair each shift of the source week with the same block's shift in the target
 * week. A block with no shift on one side is simply not paired. The database then fills only the
 * targets that are still empty and have not finished.
 */
export function copyPairs(
  shifts: readonly GridShift[],
  weeks: readonly LocalDate[],
  fromIndex: number,
  toIndex: number,
): CopyPair[] {
  if (fromIndex === toIndex) throw new Error("Pick two different weeks.");
  if (!weeks[fromIndex] || !weeks[toIndex]) throw new Error("That week is not on screen.");

  const cells = buildCells(shifts, weeks);
  const pairs: CopyPair[] = [];
  for (const row of cells.values()) {
    const from = row[fromIndex];
    const to = row[toIndex];
    if (from && to) pairs.push({ from_shift_id: from.id, to_shift_id: to.id });
  }
  return pairs.sort((a, b) => a.to_shift_id.localeCompare(b.to_shift_id));
}

/** Headcount state of a cell, for the badge in the grid. */
export function coverageOf(primaryCount: number, required: number): "empty" | "short" | "met" | "over" {
  if (primaryCount === 0) return "empty";
  if (primaryCount < required) return "short";
  if (primaryCount > required) return "over";
  return "met";
}

/** Sort order for the block rows: by position in the week (relative to week_start), then by time. */
export function templateWeekOrder(
  t: { start_weekday: number; start_local_time: string },
  weekStart: number,
): [number, string] {
  return [(t.start_weekday - weekStart + 7) % 7, t.start_local_time];
}
