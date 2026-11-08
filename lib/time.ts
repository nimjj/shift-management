// ALL time-zone maths lives here. Everything is built on Intl, so it follows the IANA tz database
// (including US daylight-saving changes) with no extra dependency.
//
// Terms:
//   LocalDate    a calendar date with no zone ({ y, m: 1-12, d })
//   "HH:MM"      a wall-clock time
//   weekday      0 = Sunday .. 6 = Saturday (same as JS getDay() and org_settings.week_start)
//
// DST rules for converting a local wall-clock time to an instant (localToUtc):
//   * time does not exist (spring-forward gap, e.g. 02:30 on 14 Mar 2027 in Chicago):
//       move FORWARD by the length of the gap (02:30 -> 03:30 CDT)
//   * time happens twice (fall-back overlap, e.g. 01:30 on 1 Nov 2026 in Chicago):
//       take the FIRST occurrence (the earlier instant, still on daylight time)

export const MAX_SHIFT_MINUTES = 24 * 60;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type LocalDate = { y: number; m: number; d: number };

export type BlockSchedule = {
  startWeekday: number;
  startTime: string; // "HH:MM"
  endWeekday: number;
  endTime: string; // "HH:MM"
};

const MS_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** Accepts "HH:MM" or Postgres "HH:MM:SS" and returns "HH:MM". */
export function normaliseTime(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function minutesOfDay(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// LocalDate helpers (pure calendar arithmetic, no zones)
// ---------------------------------------------------------------------------

export function parseLocalDate(s: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Bad date "${s}", expected YYYY-MM-DD`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function formatLocalDate(ld: LocalDate): string {
  return `${String(ld.y).padStart(4, "0")}-${String(ld.m).padStart(2, "0")}-${String(ld.d).padStart(2, "0")}`;
}

export function addDays(ld: LocalDate, n: number): LocalDate {
  const dt = new Date(Date.UTC(ld.y, ld.m - 1, ld.d) + n * MS_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function weekdayOf(ld: LocalDate): number {
  return new Date(Date.UTC(ld.y, ld.m - 1, ld.d)).getUTCDay();
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
}

/** First day of the week containing `ld`, for a week that starts on `weekStart`. */
export function startOfWeek(ld: LocalDate, weekStart: number): LocalDate {
  return addDays(ld, -((weekdayOf(ld) - weekStart + 7) % 7));
}

// ---------------------------------------------------------------------------
// Instants <-> zones
// ---------------------------------------------------------------------------

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** The wall-clock fields of `instant` in `tz`. */
function wallParts(instant: Date, tz: string) {
  const out: Record<string, number> = {};
  for (const p of wallFormatter(tz).formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour, mi: out.minute, s: out.second };
}

/** UTC offset (ms, positive east of UTC) that `tz` has at the given instant. */
function offsetMsAt(utcMs: number, tz: string): number {
  const p = wallParts(new Date(utcMs), tz);
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a local date + "HH:MM" in `tz` to the UTC instant. See the DST rules at the top. */
export function localToUtc(date: LocalDate, time: string, tz: string): Date {
  if (!isValidTime(time)) throw new Error(`Bad time "${time}", expected HH:MM`);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(date.y, date.m - 1, date.d, h, mi);

  // Offsets just before and just after any transition near this wall time.
  const before = offsetMsAt(wall - MS_DAY, tz);
  const after = offsetMsAt(wall + MS_DAY, tz);

  const candidates = new Set<number>();
  for (const offset of new Set([before, after])) {
    const utc = wall - offset;
    if (offsetMsAt(utc, tz) === offset) candidates.add(utc);
  }

  if (candidates.size > 0) return new Date(Math.min(...candidates)); // ambiguous -> earlier
  return new Date(wall - before); // in the gap -> forward by the gap
}

/** The calendar date in `tz` at `instant`. */
export function localDateIn(instant: Date, tz: string): LocalDate {
  const p = wallParts(instant, tz);
  return { y: p.y, m: p.m, d: p.d };
}

/** Weekday (0=Sun) in `tz` at `instant`. */
export function weekdayIn(instant: Date, tz: string): number {
  return weekdayOf(localDateIn(instant, tz));
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** "03:30" */
export function formatTimeIn(instant: Date, tz: string): string {
  const p = wallParts(instant, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** "Sat 7 Nov" */
export function formatDayIn(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(
    instant,
  );
}

/** Short zone label at that instant: "CST", "CDT", "GMT+5:30". */
export function zoneLabelIn(instant: Date, tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

/** "Sat 7 Nov 03:30–09:30 GMT+5:30" (end day shown too if it differs). */
export function formatRangeIn(startsAt: Date, endsAt: Date, tz: string): string {
  const sameDay = formatDayIn(startsAt, tz) === formatDayIn(endsAt, tz);
  const end = `${sameDay ? "" : `${formatDayIn(endsAt, tz)} `}${formatTimeIn(endsAt, tz)}`;
  return `${formatDayIn(startsAt, tz)} ${formatTimeIn(startsAt, tz)}–${end} ${zoneLabelIn(startsAt, tz)}`;
}

// ---------------------------------------------------------------------------
// Block schedules (templates)
// ---------------------------------------------------------------------------

/** Days from the start weekday to the end weekday (0..6). */
function endDayOffset(s: BlockSchedule): number {
  return (s.endWeekday - s.startWeekday + 7) % 7;
}

/** Wall-clock length in minutes (ignores DST; used for validation). */
export function nominalDurationMinutes(s: BlockSchedule): number {
  return endDayOffset(s) * 24 * 60 + minutesOfDay(s.endTime) - minutesOfDay(s.startTime);
}

/** Returns an error message, or null if the schedule is valid. */
export function validateSchedule(s: BlockSchedule): string | null {
  for (const w of [s.startWeekday, s.endWeekday]) {
    if (!Number.isInteger(w) || w < 0 || w > 6) return "Weekday must be 0 (Sunday) to 6 (Saturday).";
  }
  if (!isValidTime(s.startTime) || !isValidTime(s.endTime)) return "Times must be HH:MM.";
  const minutes = nominalDurationMinutes(s);
  if (minutes <= 0) return "The end must be after the start.";
  if (minutes > MAX_SHIFT_MINUTES) return "A block can be at most 24 hours long.";
  return null;
}

export type Occurrence = {
  /** Local start date in the schedule's zone. Identifies the shift within its template. */
  occurrenceDate: LocalDate;
  startsAt: Date;
  endsAt: Date;
};

/** The start and end instants of the block that starts on `startDate`. */
export function occurrenceOn(startDate: LocalDate, s: BlockSchedule, tz: string): Occurrence {
  const endDate = addDays(startDate, endDayOffset(s));
  return {
    occurrenceDate: startDate,
    startsAt: localToUtc(startDate, s.startTime, tz),
    endsAt: localToUtc(endDate, s.endTime, tz),
  };
}

/** Every occurrence whose local start date is in [from, to) (to exclusive). */
export function weeklyOccurrences(s: BlockSchedule, tz: string, from: LocalDate, to: LocalDate): Occurrence[] {
  const error = validateSchedule(s);
  if (error) throw new Error(error);

  const out: Occurrence[] = [];
  // First date >= from whose weekday is the start weekday.
  let date = addDays(from, (s.startWeekday - weekdayOf(from) + 7) % 7);
  while (compareLocalDates(date, to) < 0) {
    out.push(occurrenceOn(date, s, tz));
    date = addDays(date, 7);
  }
  return out;
}
