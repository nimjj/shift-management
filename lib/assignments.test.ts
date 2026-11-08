import { describe, expect, it } from "vitest";
import {
  buildCells,
  copyPairs,
  coverageOf,
  diffAssignees,
  gridRange,
  gridWeeks,
  normaliseAssignees,
  templateWeekOrder,
  weekIndexOf,
  type GridShift,
} from "@/lib/assignments";
import { formatLocalDate } from "@/lib/time";

const CHI = "America/Chicago";
const ORG = { client_tz: CHI, week_start: 1 }; // Monday

/** A generated shift, with only the fields the grid cares about. */
function shift(id: string, templateId: string, date: string, startsAt = `${date}T22:00:00.000Z`): GridShift {
  return {
    id,
    template_id: templateId,
    occurrence_date: date,
    starts_at: startsAt,
    ends_at: new Date(new Date(startsAt).getTime() + 6 * 3600_000).toISOString(),
  };
}

describe("gridWeeks", () => {
  it("starts at the week containing today, in the client zone", () => {
    // Friday 13 Nov 2026, 10:00 Chicago -> that week starts Monday 9 Nov.
    const weeks = gridWeeks(new Date("2026-11-13T16:00:00Z"), ORG, 0);
    expect(weeks.map(formatLocalDate)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  });

  it("honours the org week start", () => {
    const sunday = gridWeeks(new Date("2026-11-13T16:00:00Z"), { client_tz: CHI, week_start: 0 }, 0, 2);
    expect(sunday.map(formatLocalDate)).toEqual(["2026-11-08", "2026-11-15"]);
  });

  it("shifts whole weeks for a positive or negative offset", () => {
    const now = new Date("2026-11-13T16:00:00Z");
    expect(formatLocalDate(gridWeeks(now, ORG, 1)[0])).toBe("2026-11-16");
    expect(formatLocalDate(gridWeeks(now, ORG, -2)[0])).toBe("2026-10-26");
  });

  it("uses the client zone, not UTC, to decide which week today is in", () => {
    // 02:00 UTC on Monday 16 Nov is still Sunday 15 Nov in Chicago, so the week starts 9 Nov.
    const weeks = gridWeeks(new Date("2026-11-16T02:00:00Z"), ORG, 0, 1);
    expect(formatLocalDate(weeks[0])).toBe("2026-11-09");
  });

  it("rejects a silly offset or column count", () => {
    const now = new Date("2026-11-13T16:00:00Z");
    expect(() => gridWeeks(now, ORG, 999)).toThrow(/offset/i);
    expect(() => gridWeeks(now, ORG, 1.5)).toThrow(/offset/i);
    expect(() => gridWeeks(now, ORG, 0, 0)).toThrow(/count/i);
    expect(() => gridWeeks(now, ORG, 0, 13)).toThrow(/count/i);
  });
});

describe("gridRange", () => {
  it("spans from the first column to the end of the last", () => {
    const weeks = gridWeeks(new Date("2026-11-13T16:00:00Z"), ORG, 0);
    const { from, to } = gridRange(weeks);
    expect(formatLocalDate(from)).toBe("2026-11-09");
    expect(formatLocalDate(to)).toBe("2026-12-07"); // exclusive
  });
});

describe("weekIndexOf / buildCells", () => {
  const weeks = gridWeeks(new Date("2026-11-13T16:00:00Z"), ORG, 0);

  it("puts a shift in the column whose week contains its occurrence date", () => {
    expect(weekIndexOf(shift("a", "t1", "2026-11-09"), weeks)).toBe(0);
    expect(weekIndexOf(shift("a", "t1", "2026-11-15"), weeks)).toBe(0); // Sunday, still week 0
    expect(weekIndexOf(shift("a", "t1", "2026-11-16"), weeks)).toBe(1);
    expect(weekIndexOf(shift("a", "t1", "2026-12-06"), weeks)).toBe(3);
  });

  it("returns -1 outside the range and for a shift with no occurrence date", () => {
    expect(weekIndexOf(shift("a", "t1", "2026-11-08"), weeks)).toBe(-1);
    expect(weekIndexOf(shift("a", "t1", "2026-12-07"), weeks)).toBe(-1);
    expect(weekIndexOf({ ...shift("a", "t1", "2026-11-09"), occurrence_date: null }, weeks)).toBe(-1);
  });

  it("builds one row per template with one slot per column", () => {
    const cells = buildCells(
      [shift("s1", "t1", "2026-11-13"), shift("s2", "t1", "2026-11-20"), shift("s3", "t2", "2026-11-20")],
      weeks,
    );
    expect(cells.get("t1")?.map((c) => c?.id)).toEqual(["s1", "s2", undefined, undefined]);
    expect(cells.get("t2")?.map((c) => c?.id)).toEqual([undefined, "s3", undefined, undefined]);
  });

  it("ignores test shifts, which have no template", () => {
    const cells = buildCells([{ ...shift("s1", "t1", "2026-11-13"), template_id: null }], weeks);
    expect(cells.size).toBe(0);
  });
});

describe("normaliseAssignees", () => {
  it("deduplicates by person, keeping the last role, and sorts", () => {
    expect(
      normaliseAssignees([
        { employee_id: "b", role: "primary" },
        { employee_id: "a", role: "primary" },
        { employee_id: "a", role: "backup" },
      ]),
    ).toEqual([
      { employee_id: "a", role: "backup" },
      { employee_id: "b", role: "primary" },
    ]);
  });

  it("drops entries with no employee", () => {
    expect(normaliseAssignees([{ employee_id: "", role: "primary" }])).toEqual([]);
  });
});

describe("diffAssignees", () => {
  it("separates added, removed and role changes", () => {
    const d = diffAssignees(
      [
        { employee_id: "a", role: "primary" },
        { employee_id: "b", role: "primary" },
      ],
      [
        { employee_id: "a", role: "backup" },
        { employee_id: "c", role: "primary" },
      ],
    );
    expect(d.added).toEqual([{ employee_id: "c", role: "primary" }]);
    expect(d.changed).toEqual([{ employee_id: "a", role: "backup" }]);
    expect(d.removed).toEqual(["b"]);
  });

  it("sees no change when the roster is the same", () => {
    const same = [{ employee_id: "a", role: "primary" as const }];
    const d = diffAssignees(same, same);
    expect(d).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe("copyPairs", () => {
  const weeks = gridWeeks(new Date("2026-11-13T16:00:00Z"), ORG, 0);

  it("pairs each block's source shift with the same block's target shift", () => {
    const pairs = copyPairs(
      [
        shift("w0-t1", "t1", "2026-11-13"),
        shift("w1-t1", "t1", "2026-11-20"),
        shift("w0-t2", "t2", "2026-11-14"),
        shift("w1-t2", "t2", "2026-11-21"),
      ],
      weeks,
      0,
      1,
    );
    expect(pairs).toEqual(
      [
        { from_shift_id: "w0-t1", to_shift_id: "w1-t1" },
        { from_shift_id: "w0-t2", to_shift_id: "w1-t2" },
      ].sort((a, b) => a.to_shift_id.localeCompare(b.to_shift_id)),
    );
  });

  it("skips a block that has no shift on one side", () => {
    const pairs = copyPairs([shift("w0-t1", "t1", "2026-11-13"), shift("w1-t2", "t2", "2026-11-21")], weeks, 0, 1);
    expect(pairs).toEqual([]);
  });

  it("refuses the same week twice or a week that is off screen", () => {
    expect(() => copyPairs([], weeks, 1, 1)).toThrow(/different weeks/i);
    expect(() => copyPairs([], weeks, 0, 9)).toThrow(/not on screen/i);
  });
});

describe("coverageOf", () => {
  it("names the four states", () => {
    expect(coverageOf(0, 2)).toBe("empty");
    expect(coverageOf(1, 2)).toBe("short");
    expect(coverageOf(2, 2)).toBe("met");
    expect(coverageOf(3, 2)).toBe("over");
  });
});

describe("templateWeekOrder", () => {
  it("orders blocks by their position in the week, not by weekday number", () => {
    const fri = { start_weekday: 5, start_local_time: "16:00" };
    const sat = { start_weekday: 6, start_local_time: "10:00" };
    const sun = { start_weekday: 0, start_local_time: "10:00" };

    // Week starting Monday: Fri, Sat, Sun.
    expect([fri, sat, sun].map((t) => templateWeekOrder(t, 1)[0])).toEqual([4, 5, 6]);
    // Week starting Sunday: Sun first.
    expect([fri, sat, sun].map((t) => templateWeekOrder(t, 0)[0])).toEqual([5, 6, 0]);
  });
});
