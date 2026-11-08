// Pure shift-generation logic (no I/O). The database functions only validate and store what this
// computes; all time-zone maths is delegated to lib/time.ts.

import { createHash } from "node:crypto";
import {
  addDays,
  compareLocalDates,
  formatLocalDate,
  localDateIn,
  normaliseTime,
  parseLocalDate,
  startOfWeek,
  weeklyOccurrences,
  type BlockSchedule,
  type LocalDate,
} from "@/lib/time";

export const MAX_GENERATE_WEEKS = 26;

export type TemplateInput = {
  id: string;
  code: string;
  active: boolean;
  /** null = follow the org client zone */
  timezone: string | null;
  start_weekday: number;
  start_local_time: string;
  end_weekday: number;
  end_local_time: string;
};

export type OrgInput = { client_tz: string; week_start: number };

/** A shift that should exist, in the shape the database functions take. */
export type ExpectedShift = {
  template_id: string;
  occurrence_date: string; // YYYY-MM-DD
  starts_at: string; // ISO UTC
  ends_at: string; // ISO UTC
};

export type ExistingShift = {
  id: string;
  template_id: string | null;
  occurrence_date: string | null;
  starts_at: string;
  ends_at: string;
};

export function scheduleOf(t: TemplateInput): BlockSchedule {
  return {
    startWeekday: t.start_weekday,
    startTime: normaliseTime(t.start_local_time),
    endWeekday: t.end_weekday,
    endTime: normaliseTime(t.end_local_time),
  };
}

export function effectiveTimeZone(t: Pick<TemplateInput, "timezone">, org: Pick<OrgInput, "client_tz">): string {
  return t.timezone ?? org.client_tz;
}

/**
 * "Next N weeks": the current week (by week_start, in the client zone) plus the following weeks,
 * N in total. Returns the local date range [from, to) of block START dates.
 */
export function generationRange(now: Date, weeks: number, org: OrgInput): { from: LocalDate; to: LocalDate } {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_GENERATE_WEEKS) {
    throw new Error(`Weeks must be a whole number from 1 to ${MAX_GENERATE_WEEKS}.`);
  }
  const from = startOfWeek(localDateIn(now, org.client_tz), org.week_start);
  return { from, to: addDays(from, weeks * 7) };
}

/** Every shift the ACTIVE templates produce in [from, to). Archived templates produce none. */
export function expectedShifts(
  templates: readonly TemplateInput[],
  org: OrgInput,
  from: LocalDate,
  to: LocalDate,
): ExpectedShift[] {
  const out: ExpectedShift[] = [];
  for (const t of templates) {
    if (!t.active) continue;
    for (const o of weeklyOccurrences(scheduleOf(t), effectiveTimeZone(t, org), from, to)) {
      out.push({
        template_id: t.id,
        occurrence_date: formatLocalDate(o.occurrenceDate),
        starts_at: o.startsAt.toISOString(),
        ends_at: o.endsAt.toISOString(),
      });
    }
  }
  return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.template_id.localeCompare(b.template_id));
}

/** Rows for "Generate next N weeks": expected shifts that have not already ended. */
export function buildGenerationRows(
  templates: readonly TemplateInput[],
  org: OrgInput,
  now: Date,
  weeks: number,
): ExpectedShift[] {
  const { from, to } = generationRange(now, weeks, org);
  return expectedShifts(templates, org, from, to).filter((s) => new Date(s.ends_at) > now);
}

// ---------------------------------------------------------------------------
// Regeneration preview
// ---------------------------------------------------------------------------

export type MovedShift = {
  id: string;
  template_id: string;
  occurrence_date: string;
  from: { starts_at: string; ends_at: string };
  to: { starts_at: string; ends_at: string };
};

export type ShiftDiff = {
  moved: MovedShift[];
  added: ExpectedShift[];
  removed: ExistingShift[];
  unchanged: number;
};

const key = (templateId: string, occurrenceDate: string) => `${templateId}|${occurrenceDate}`;
const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

/**
 * Only shifts that have not started are ever regenerated: a running or finished shift is history.
 * `existing` must already be limited to template-generated, not-yet-started shifts.
 */
export function regenerationScope(
  existing: readonly ExistingShift[],
  now: Date,
): { shifts: ExistingShift[]; range: { from: LocalDate; to: LocalDate } | null } {
  const shifts = existing.filter((s) => s.template_id && s.occurrence_date && new Date(s.starts_at) > now);
  if (shifts.length === 0) return { shifts, range: null };
  const dates = shifts.map((s) => parseLocalDate(s.occurrence_date!)).sort(compareLocalDates);
  return { shifts, range: { from: dates[0], to: addDays(dates[dates.length - 1], 1) } };
}

/**
 * Compare the future shifts that exist with the ones the templates would produce today.
 * A shift is matched by (template, occurrence_date), so a template whose time changed shows up as
 * "moved", not as remove + add.
 *  - moved:   same occurrence, different times
 *  - added:   expected but missing (e.g. a template's weekday changed)
 *  - removed: exists but no longer expected (template archived, or its weekday changed)
 */
export function diffShifts(existing: readonly ExistingShift[], expected: readonly ExpectedShift[], now: Date): ShiftDiff {
  const { shifts } = regenerationScope(existing, now);
  const futureExpected = expected.filter((e) => new Date(e.starts_at) > now);

  const expectedByKey = new Map(futureExpected.map((e) => [key(e.template_id, e.occurrence_date), e]));
  const existingKeys = new Set(shifts.map((s) => key(s.template_id!, s.occurrence_date!)));

  const diff: ShiftDiff = { moved: [], added: [], removed: [], unchanged: 0 };

  for (const s of shifts) {
    const e = expectedByKey.get(key(s.template_id!, s.occurrence_date!));
    if (!e) {
      diff.removed.push(s);
    } else if (sameInstant(s.starts_at, e.starts_at) && sameInstant(s.ends_at, e.ends_at)) {
      diff.unchanged += 1;
    } else {
      diff.moved.push({
        id: s.id,
        template_id: s.template_id!,
        occurrence_date: s.occurrence_date!,
        from: { starts_at: s.starts_at, ends_at: s.ends_at },
        to: { starts_at: e.starts_at, ends_at: e.ends_at },
      });
    }
  }
  for (const e of futureExpected) {
    if (!existingKeys.has(key(e.template_id, e.occurrence_date))) diff.added.push(e);
  }

  diff.moved.sort((a, b) => a.to.starts_at.localeCompare(b.to.starts_at));
  diff.added.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  diff.removed.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return diff;
}

export function diffIsEmpty(d: ShiftDiff): boolean {
  return d.moved.length === 0 && d.added.length === 0 && d.removed.length === 0;
}

/**
 * Fingerprint of exactly what Apply would do. The preview page embeds it; Apply recomputes and
 * refuses if it differs, so you never apply something other than what you reviewed.
 * Independent of ordering and of how the instants are spelled.
 */
export function diffHash(d: ShiftDiff): string {
  const t = (iso: string) => new Date(iso).getTime();
  const canonical = {
    moved: d.moved.map((m) => [m.id, t(m.to.starts_at), t(m.to.ends_at)]).sort(),
    added: d.added.map((a) => [a.template_id, a.occurrence_date, t(a.starts_at), t(a.ends_at)]).sort(),
    removed: d.removed.map((r) => r.id).sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Payload for the apply_shift_regeneration database function. */
export function regenerationPayload(d: ShiftDiff) {
  return {
    moved: d.moved.map((m) => ({ id: m.id, starts_at: m.to.starts_at, ends_at: m.to.ends_at })),
    added: d.added,
    removed: d.removed.map((r) => r.id),
  };
}
