import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDayIn,
  formatLocalDate,
  formatRangeIn,
  formatTimeIn,
  isValidTime,
  isValidTimeZone,
  localDateIn,
  localToUtc,
  nominalDurationMinutes,
  normaliseTime,
  occurrenceOn,
  parseLocalDate,
  startOfWeek,
  validateSchedule,
  weekdayOf,
  weeklyOccurrences,
  zoneLabelIn,
  type BlockSchedule,
} from "./time";

const CHI = "America/Chicago";
const CMB = "Asia/Colombo";
const d = parseLocalDate;
const iso = (x: Date) => x.toISOString();

// Seed block 1: Fri 16:00 -> Fri 22:00 (client zone)
const BLOCK_1: BlockSchedule = { startWeekday: 5, startTime: "16:00", endWeekday: 5, endTime: "22:00" };

describe("isValidTimeZone", () => {
  it("accepts IANA zones", () => {
    expect(isValidTimeZone(CHI)).toBe(true);
    expect(isValidTimeZone(CMB)).toBe(true);
  });
  it("rejects junk", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("time strings", () => {
  it("validates HH:MM", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
    expect(isValidTime("12:60")).toBe(false);
  });
  it("trims Postgres HH:MM:SS", () => {
    expect(normaliseTime("16:00:00")).toBe("16:00");
    expect(normaliseTime("16:00")).toBe("16:00");
  });
});

describe("LocalDate arithmetic", () => {
  it("round-trips and adds days across month and year ends", () => {
    expect(formatLocalDate(d("2026-10-30"))).toBe("2026-10-30");
    expect(formatLocalDate(addDays(d("2026-10-30"), 3))).toBe("2026-11-02");
    expect(formatLocalDate(addDays(d("2026-12-30"), 3))).toBe("2027-01-02");
    expect(formatLocalDate(addDays(d("2026-03-01"), -1))).toBe("2026-02-28");
  });
  it("knows weekdays (0 = Sunday)", () => {
    expect(weekdayOf(d("2026-11-01"))).toBe(0); // Sunday
    expect(weekdayOf(d("2026-11-06"))).toBe(5); // Friday
  });
  it("finds the start of the week for any week_start", () => {
    // Sunday 8 Nov 2026
    expect(formatLocalDate(startOfWeek(d("2026-11-08"), 1))).toBe("2026-11-02"); // Monday start
    expect(formatLocalDate(startOfWeek(d("2026-11-08"), 0))).toBe("2026-11-08"); // Sunday start
    expect(formatLocalDate(startOfWeek(d("2026-11-04"), 1))).toBe("2026-11-02");
  });
  it("rejects malformed dates", () => {
    expect(() => parseLocalDate("2026-1-5")).toThrow();
  });
});

describe("localToUtc: Block 1 across the US daylight-saving change (ends Sun 1 Nov 2026)", () => {
  it("Fri 30 Oct 2026 16:00 Chicago (CDT, UTC-5) = 21:00Z = Sat 02:30 Colombo", () => {
    const start = localToUtc(d("2026-10-30"), "16:00", CHI);
    expect(iso(start)).toBe("2026-10-30T21:00:00.000Z");
    expect(formatTimeIn(start, CMB)).toBe("02:30");
    expect(formatDayIn(start, CMB)).toContain("Sat");
  });

  it("Fri 6 Nov 2026 16:00 Chicago (CST, UTC-6) = 22:00Z = Sat 03:30 Colombo", () => {
    const start = localToUtc(d("2026-11-06"), "16:00", CHI);
    expect(iso(start)).toBe("2026-11-06T22:00:00.000Z");
    expect(formatTimeIn(start, CMB)).toBe("03:30");
    expect(formatDayIn(start, CMB)).toContain("Sat");
  });

  it("labels the zones correctly on each side", () => {
    expect(zoneLabelIn(localToUtc(d("2026-10-30"), "16:00", CHI), CHI)).toBe("CDT");
    expect(zoneLabelIn(localToUtc(d("2026-11-06"), "16:00", CHI), CHI)).toBe("CST");
  });

  it("works for a zone with a half-hour offset and no DST (Colombo)", () => {
    expect(iso(localToUtc(d("2026-07-01"), "09:30", CMB))).toBe("2026-07-01T04:00:00.000Z");
    expect(iso(localToUtc(d("2026-12-01"), "09:30", CMB))).toBe("2026-12-01T04:00:00.000Z");
  });
});

describe("localToUtc: DST edge cases (stated rules)", () => {
  it("a time that does not exist (spring forward, 14 Mar 2027 02:30 Chicago) moves FORWARD by the gap to 03:30 CDT", () => {
    const t = localToUtc(d("2027-03-14"), "02:30", CHI);
    expect(iso(t)).toBe("2027-03-14T08:30:00.000Z");
    expect(formatTimeIn(t, CHI)).toBe("03:30");
    expect(zoneLabelIn(t, CHI)).toBe("CDT");
  });

  it("times either side of the gap are unaffected", () => {
    expect(iso(localToUtc(d("2027-03-14"), "01:59", CHI))).toBe("2027-03-14T07:59:00.000Z"); // CST
    expect(iso(localToUtc(d("2027-03-14"), "03:00", CHI))).toBe("2027-03-14T08:00:00.000Z"); // CDT
  });

  it("a time that happens twice (fall back, 1 Nov 2026 01:30 Chicago) takes the FIRST occurrence (CDT)", () => {
    const t = localToUtc(d("2026-11-01"), "01:30", CHI);
    expect(iso(t)).toBe("2026-11-01T06:30:00.000Z");
    expect(zoneLabelIn(t, CHI)).toBe("CDT");
  });

  it("times either side of the overlap are unaffected", () => {
    expect(iso(localToUtc(d("2026-11-01"), "00:59", CHI))).toBe("2026-11-01T05:59:00.000Z"); // CDT
    expect(iso(localToUtc(d("2026-11-01"), "02:00", CHI))).toBe("2026-11-01T08:00:00.000Z"); // CST
  });

  it("rejects a malformed time", () => {
    expect(() => localToUtc(d("2026-11-01"), "25:00", CHI)).toThrow();
  });
});

describe("localDateIn", () => {
  it("returns the calendar date in the given zone, not UTC", () => {
    const instant = new Date("2026-11-07T03:00:00Z"); // Fri 6 Nov 21:00 Chicago, Sat 7 Nov 08:30 Colombo
    expect(formatLocalDate(localDateIn(instant, CHI))).toBe("2026-11-06");
    expect(formatLocalDate(localDateIn(instant, CMB))).toBe("2026-11-07");
  });
});

describe("validateSchedule", () => {
  it("accepts the seed blocks and a block crossing midnight", () => {
    expect(validateSchedule(BLOCK_1)).toBeNull();
    expect(validateSchedule({ startWeekday: 5, startTime: "22:00", endWeekday: 6, endTime: "03:00" })).toBeNull();
  });

  it("measures a block crossing midnight", () => {
    expect(nominalDurationMinutes({ startWeekday: 5, startTime: "22:00", endWeekday: 6, endTime: "03:00" })).toBe(300);
  });

  it("rejects end before or equal to start on the same day", () => {
    expect(validateSchedule({ ...BLOCK_1, endTime: "16:00" })).toMatch(/after the start/);
    expect(validateSchedule({ ...BLOCK_1, endTime: "10:00" })).toMatch(/after the start/);
  });

  it("allows exactly 24 hours, rejects more", () => {
    const base = { startWeekday: 5, startTime: "10:00", endWeekday: 6 };
    expect(validateSchedule({ ...base, endTime: "10:00" })).toBeNull();
    expect(validateSchedule({ ...base, endTime: "10:01" })).toMatch(/24 hours/);
    expect(validateSchedule({ startWeekday: 5, startTime: "10:00", endWeekday: 0, endTime: "10:00" })).toMatch(/24 hours/);
  });

  it("rejects bad weekdays and times", () => {
    expect(validateSchedule({ ...BLOCK_1, startWeekday: 7 })).toMatch(/Weekday/);
    expect(validateSchedule({ ...BLOCK_1, endWeekday: -1 })).toMatch(/Weekday/);
    expect(validateSchedule({ ...BLOCK_1, startTime: "4pm" })).toMatch(/HH:MM/);
  });
});

describe("occurrenceOn", () => {
  it("builds a same-day block", () => {
    const o = occurrenceOn(d("2026-11-06"), BLOCK_1, CHI);
    expect(iso(o.startsAt)).toBe("2026-11-06T22:00:00.000Z");
    expect(iso(o.endsAt)).toBe("2026-11-07T04:00:00.000Z"); // 22:00 CST
    expect(formatLocalDate(o.occurrenceDate)).toBe("2026-11-06");
  });

  it("builds a block that crosses midnight into the next weekday", () => {
    const o = occurrenceOn(d("2026-11-06"), { startWeekday: 5, startTime: "22:00", endWeekday: 6, endTime: "03:00" }, CHI);
    expect(iso(o.startsAt)).toBe("2026-11-07T04:00:00.000Z");
    expect(iso(o.endsAt)).toBe("2026-11-07T09:00:00.000Z");
  });

  it("a block that spans the fall-back change is 7h of real time (6h wall clock + 1)", () => {
    // Sat 31 Oct 22:00 -> Sun 1 Nov 04:00 Chicago crosses 02:00 CDT -> 01:00 CST
    const o = occurrenceOn(d("2026-10-31"), { startWeekday: 6, startTime: "22:00", endWeekday: 0, endTime: "04:00" }, CHI);
    expect((o.endsAt.getTime() - o.startsAt.getTime()) / 3_600_000).toBe(7);
  });

  it("formats a range in Colombo, showing the end day when it differs", () => {
    const o = occurrenceOn(d("2026-11-06"), BLOCK_1, CHI);
    expect(formatRangeIn(o.startsAt, o.endsAt, CMB)).toBe("Sat 7 Nov 03:30–09:30 GMT+5:30");
    expect(formatRangeIn(o.startsAt, o.endsAt, CHI)).toBe("Fri 6 Nov 16:00–22:00 CST");
    const late = occurrenceOn(d("2026-11-06"), { startWeekday: 5, startTime: "22:00", endWeekday: 6, endTime: "03:00" }, CHI);
    expect(formatRangeIn(late.startsAt, late.endsAt, CHI)).toBe("Fri 6 Nov 22:00–Sat 7 Nov 03:00 CST");
  });
});

describe("weeklyOccurrences", () => {
  it("lists 4 weekly Fridays across the DST boundary with the Colombo time moving 02:30 -> 03:30", () => {
    const occ = weeklyOccurrences(BLOCK_1, CHI, d("2026-10-26"), d("2026-11-23")); // Mon 26 Oct .. Sun 22 Nov
    expect(occ.map((o) => formatLocalDate(o.occurrenceDate))).toEqual([
      "2026-10-30",
      "2026-11-06",
      "2026-11-13",
      "2026-11-20",
    ]);
    expect(occ.map((o) => iso(o.startsAt))).toEqual([
      "2026-10-30T21:00:00.000Z",
      "2026-11-06T22:00:00.000Z",
      "2026-11-13T22:00:00.000Z",
      "2026-11-20T22:00:00.000Z",
    ]);
    expect(occ.map((o) => formatTimeIn(o.startsAt, CMB))).toEqual(["02:30", "03:30", "03:30", "03:30"]);
    // Client-zone time never moves.
    expect(occ.map((o) => formatTimeIn(o.startsAt, CHI))).toEqual(["16:00", "16:00", "16:00", "16:00"]);
  });

  it("is end-exclusive and start-inclusive", () => {
    expect(weeklyOccurrences(BLOCK_1, CHI, d("2026-11-06"), d("2026-11-07"))).toHaveLength(1); // start day included
    expect(weeklyOccurrences(BLOCK_1, CHI, d("2026-10-30"), d("2026-11-06"))).toHaveLength(1); // end day excluded
    expect(weeklyOccurrences(BLOCK_1, CHI, d("2026-11-07"), d("2026-11-13"))).toHaveLength(0);
  });

  it("refuses an invalid schedule", () => {
    expect(() => weeklyOccurrences({ ...BLOCK_1, endTime: "10:00" }, CHI, d("2026-11-01"), d("2026-11-30"))).toThrow(
      /after the start/,
    );
  });

  it("works for a Sunday block (weekday 0)", () => {
    const sun: BlockSchedule = { startWeekday: 0, startTime: "10:00", endWeekday: 0, endTime: "16:00" };
    const occ = weeklyOccurrences(sun, CHI, d("2026-10-26"), d("2026-11-09"));
    expect(occ.map((o) => formatLocalDate(o.occurrenceDate))).toEqual(["2026-11-01", "2026-11-08"]);
    expect(iso(occ[0].startsAt)).toBe("2026-11-01T16:00:00.000Z"); // 10:00 CST (the change happens at 02:00 that day)
  });
});
