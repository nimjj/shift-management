import { describe, expect, it } from "vitest";
import {
  buildGenerationRows,
  diffHash,
  diffIsEmpty,
  diffShifts,
  effectiveTimeZone,
  expectedShifts,
  generationRange,
  regenerationPayload,
  regenerationScope,
  type ExistingShift,
  type ExpectedShift,
  type OrgInput,
  type TemplateInput,
} from "./shifts";
import { formatLocalDate, parseLocalDate, formatTimeIn } from "./time";

const org: OrgInput = { client_tz: "America/Chicago", week_start: 1 }; // Monday weeks

const tpl = (
  id: string,
  code: string,
  wd: number,
  start: string,
  end: string,
  extra: Partial<TemplateInput> = {},
): TemplateInput => ({
  id,
  code,
  active: true,
  timezone: null,
  start_weekday: wd,
  start_local_time: start,
  end_weekday: wd,
  end_local_time: end,
  ...extra,
});

// The five seed blocks (Fri=5, Sat=6, Sun=0).
const SEED: TemplateInput[] = [
  tpl("t1", "1", 5, "16:00:00", "22:00:00"),
  tpl("t2a", "2a", 6, "10:00:00", "16:00:00"),
  tpl("t2b", "2b", 6, "16:00:00", "22:00:00"),
  tpl("t3a", "3a", 0, "10:00:00", "16:00:00"),
  tpl("t3b", "3b", 0, "16:00:00", "22:00:00"),
];

const at = (iso: string) => new Date(iso);
const range = (now: Date, weeks: number) => generationRange(now, weeks, org);

describe("generationRange", () => {
  it("starts at the Monday of the current week in the CLIENT zone and spans N weeks", () => {
    // Sun 8 Nov 2026 12:00 UTC = 06:00 Chicago
    const { from, to } = range(at("2026-11-08T12:00:00Z"), 4);
    expect(formatLocalDate(from)).toBe("2026-11-02");
    expect(formatLocalDate(to)).toBe("2026-11-30");
  });

  it("uses the client-zone date, not the UTC date, near midnight", () => {
    // Mon 9 Nov 2026 03:00 UTC is still Sun 8 Nov 21:00 in Chicago -> same week (from 2 Nov)
    expect(formatLocalDate(range(at("2026-11-09T03:00:00Z"), 1).from)).toBe("2026-11-02");
    // Mon 9 Nov 07:00 UTC = Mon 01:00 Chicago -> new week
    expect(formatLocalDate(range(at("2026-11-09T07:00:00Z"), 1).from)).toBe("2026-11-09");
  });

  it("honours a Sunday week_start", () => {
    const { from } = generationRange(at("2026-11-04T12:00:00Z"), 1, { client_tz: "America/Chicago", week_start: 0 });
    expect(formatLocalDate(from)).toBe("2026-11-01");
  });

  it("rejects weeks outside 1..26 or non-integers", () => {
    for (const w of [0, -1, 27, 1.5, Number.NaN]) {
      expect(() => range(at("2026-11-08T12:00:00Z"), w)).toThrow(/1 to 26/);
    }
    expect(() => range(at("2026-11-08T12:00:00Z"), 26)).not.toThrow();
  });
});

describe("effectiveTimeZone", () => {
  it("falls back to the org client zone when the template has none", () => {
    expect(effectiveTimeZone({ timezone: null }, org)).toBe("America/Chicago");
    expect(effectiveTimeZone({ timezone: "Asia/Colombo" }, org)).toBe("Asia/Colombo");
  });
});

describe("buildGenerationRows", () => {
  it("skips shifts that already ended, keeps the rest of the week, and returns N weeks (Sun 8 Nov 06:00 Chicago)", () => {
    const rows = buildGenerationRows(SEED, org, at("2026-11-08T12:00:00Z"), 4);
    // Week of 2 Nov: Fri 6 / Sat 7 are over, only Sunday 3a + 3b remain (2).
    // Weeks of 9, 16, 23 Nov: all 5 blocks each (15). Total 17.
    expect(rows).toHaveLength(17);
    expect(rows[0]).toMatchObject({ template_id: "t3a", occurrence_date: "2026-11-08" });
    expect(rows.every((r) => new Date(r.ends_at) > at("2026-11-08T12:00:00Z"))).toBe(true);
  });

  it("includes a shift that is running right now and excludes one that just ended", () => {
    // Sun 8 Nov 16:30 Chicago (22:30Z): 3a (10-16) ended, 3b (16-22) is running.
    const rows = buildGenerationRows(SEED, org, at("2026-11-08T22:30:00Z"), 1);
    expect(rows.map((r) => r.template_id)).toEqual(["t3b"]);
  });

  it("is deterministic (so generating twice proposes identical rows)", () => {
    const now = at("2026-11-01T12:00:00Z");
    expect(buildGenerationRows(SEED, org, now, 3)).toEqual(buildGenerationRows(SEED, org, now, 3));
  });

  it("returns rows sorted by start time", () => {
    const rows = buildGenerationRows(SEED, org, at("2026-11-02T12:00:00Z"), 2);
    const starts = rows.map((r) => r.starts_at);
    expect(starts).toEqual([...starts].sort());
  });

  it("gives Block 1 the right instants on both sides of the US clock change", () => {
    const rows = buildGenerationRows([SEED[0]], org, at("2026-10-26T12:00:00Z"), 3);
    expect(rows.map((r) => r.occurrence_date)).toEqual(["2026-10-30", "2026-11-06", "2026-11-13"]);
    expect(rows.map((r) => formatTimeIn(new Date(r.starts_at), "Asia/Colombo"))).toEqual(["02:30", "03:30", "03:30"]);
  });

  it("produces nothing for archived templates", () => {
    const archived = SEED.map((t) => (t.id === "t2a" ? { ...t, active: false } : t));
    const rows = buildGenerationRows(archived, org, at("2026-11-02T12:00:00Z"), 2);
    expect(rows.some((r) => r.template_id === "t2a")).toBe(false);
    expect(rows).toHaveLength(8); // 4 other blocks x 2 weeks
  });

  it("follows the org client zone, and a template's own zone overrides it", () => {
    const now = at("2026-11-02T12:00:00Z");
    const followsOrg = buildGenerationRows([SEED[0]], { client_tz: "America/New_York", week_start: 1 }, now, 1);
    expect(followsOrg[0].starts_at).toBe("2026-11-06T21:00:00.000Z"); // 16:00 EST
    const pinned = buildGenerationRows([{ ...SEED[0], timezone: "Asia/Colombo" }], org, now, 1);
    expect(pinned[0].starts_at).toBe("2026-11-06T10:30:00.000Z"); // 16:00 Colombo
  });
});

// ---------------------------------------------------------------------------

const NOW = at("2026-11-02T12:00:00Z"); // Monday, before any block that week
const asExisting = (rows: ExpectedShift[]): ExistingShift[] =>
  rows.map((r, i) => ({ ...r, id: `s${i}` }) as ExistingShift);

function scenario(weeks = 3) {
  const { from, to } = range(NOW, weeks);
  const base = expectedShifts(SEED, org, from, to);
  return { from, to, base, existing: asExisting(base) };
}

describe("diffShifts", () => {
  it("reports nothing when the templates still produce exactly what exists", () => {
    const { base, existing } = scenario();
    const d = diffShifts(existing, base, NOW);
    expect(diffIsEmpty(d)).toBe(true);
    expect(d.unchanged).toBe(15);
  });

  it("a template time change shows up as MOVED for exactly that template's shifts", () => {
    const { existing } = scenario();
    const changed = SEED.map((t) => (t.id === "t2a" ? { ...t, start_local_time: "11:00:00" } : t));
    const { from, to } = regenerationScope(existing, NOW).range!;
    const d = diffShifts(existing, expectedShifts(changed, org, from, to), NOW);

    expect(d.moved).toHaveLength(3); // one 2a per week
    expect(d.moved.every((m) => m.template_id === "t2a")).toBe(true);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.unchanged).toBe(12);
    // 10:00 -> 11:00 Chicago: both CST on 7 Nov
    expect(d.moved[0].from.starts_at).toBe("2026-11-07T16:00:00.000Z");
    expect(d.moved[0].to.starts_at).toBe("2026-11-07T17:00:00.000Z");
  });

  it("an archived template's future shifts are REMOVED and nothing is added", () => {
    const { existing } = scenario();
    const archived = SEED.map((t) => (t.id === "t3b" ? { ...t, active: false } : t));
    const { from, to } = regenerationScope(existing, NOW).range!;
    const d = diffShifts(existing, expectedShifts(archived, org, from, to), NOW);
    expect(d.removed).toHaveLength(3);
    expect(d.removed.every((r) => r.template_id === "t3b")).toBe(true);
    expect(d.added).toHaveLength(0);
    expect(d.moved).toHaveLength(0);
  });

  it("changing a template's weekday removes the old occurrences and adds the new ones", () => {
    const { existing } = scenario();
    // Block 1 moves from Friday (5) to Thursday (4)
    const changed = SEED.map((t) => (t.id === "t1" ? { ...t, start_weekday: 4, end_weekday: 4 } : t));
    const { from, to } = regenerationScope(existing, NOW).range!;
    const d = diffShifts(existing, expectedShifts(changed, org, from, to), NOW);
    expect(d.removed.map((r) => r.occurrence_date)).toEqual(["2026-11-06", "2026-11-13", "2026-11-20"]);
    expect(d.added.map((a) => a.occurrence_date)).toEqual(["2026-11-12", "2026-11-19"]); // Thu 5 Nov is before the range
    expect(d.moved).toHaveLength(0);
  });

  it("never touches shifts that have started, test shifts, or shifts with no template", () => {
    const now = at("2026-11-07T20:00:00Z"); // Sat 7 Nov 14:00 Chicago: 2a (10-16) is running
    const { base } = scenario();
    const existing: ExistingShift[] = [
      ...asExisting(base),
      { id: "test1", template_id: null, occurrence_date: null, starts_at: "2026-11-20T10:00:00Z", ends_at: "2026-11-20T11:00:00Z" },
    ];
    const changed = SEED.map((t) => ({ ...t, start_local_time: t.start_local_time }));
    const { from, to } = regenerationScope(existing, now).range!;
    const d = diffShifts(existing, expectedShifts(changed, org, from, to), now);
    expect(diffIsEmpty(d)).toBe(true);
    const scope = regenerationScope(existing, now).shifts;
    expect(scope.some((s) => s.id === "test1")).toBe(false);
    // Fri 6 Nov (1) and the running Sat 2a are out of scope
    expect(scope.every((s) => new Date(s.starts_at) > now)).toBe(true);
  });

  it("returns an empty scope when there are no future template shifts", () => {
    expect(regenerationScope([], NOW)).toEqual({ shifts: [], range: null });
  });
});

describe("diffShifts with assignments (M3)", () => {
  it("KEEPS an assigned shift instead of moving it, and says where it would have gone", () => {
    const { existing } = scenario();
    const changed = SEED.map((t) => (t.id === "t2a" ? { ...t, start_local_time: "11:00:00" } : t));
    const { from, to } = regenerationScope(existing, NOW).range!;
    const expected = expectedShifts(changed, org, from, to);

    const wouldMove = diffShifts(existing, expected, NOW).moved;
    expect(wouldMove).toHaveLength(3);

    const assigned = new Set([wouldMove[0].id]);
    const d = diffShifts(existing, expected, NOW, assigned);

    expect(d.moved).toHaveLength(2);
    expect(d.moved.some((m) => m.id === wouldMove[0].id)).toBe(false);
    expect(d.kept).toHaveLength(1);
    expect(d.kept[0].shift.id).toBe(wouldMove[0].id);
    expect(d.kept[0].change).toBe("moved");
    expect(d.kept[0].to).toEqual(wouldMove[0].to);
  });

  it("KEEPS an assigned shift instead of removing it", () => {
    const { existing } = scenario();
    const archived = SEED.map((t) => (t.id === "t3b" ? { ...t, active: false } : t));
    const { from, to } = regenerationScope(existing, NOW).range!;
    const expected = expectedShifts(archived, org, from, to);

    const wouldRemove = diffShifts(existing, expected, NOW).removed;
    const d = diffShifts(existing, expected, NOW, new Set([wouldRemove[0].id]));

    expect(d.removed).toHaveLength(2);
    expect(d.kept).toHaveLength(1);
    expect(d.kept[0].change).toBe("removed");
    expect(d.kept[0].to).toBeNull();
  });

  it("leaves an assigned shift that needs no change counted as unchanged, not kept", () => {
    const { base, existing } = scenario();
    const d = diffShifts(existing, base, NOW, new Set(existing.map((s) => s.id)));
    expect(d.kept).toHaveLength(0);
    expect(d.unchanged).toBe(15);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it("keeps assigned shifts out of the apply payload, and the hash notices them", () => {
    const { existing } = scenario();
    const changed = SEED.map((t) => (t.id === "t2a" ? { ...t, start_local_time: "11:00:00" } : t));
    const { from, to } = regenerationScope(existing, NOW).range!;
    const expected = expectedShifts(changed, org, from, to);

    const plain = diffShifts(existing, expected, NOW);
    const withAssignment = diffShifts(existing, expected, NOW, new Set([plain.moved[0].id]));

    expect(regenerationPayload(withAssignment).moved.map((m) => m.id)).not.toContain(plain.moved[0].id);
    // Assigning someone between the preview and Apply must invalidate the preview.
    expect(diffHash(withAssignment)).not.toBe(diffHash(plain));
  });
});

describe("diffHash / regenerationPayload", () => {
  const moved = () => {
    const { existing } = scenario();
    const changed = SEED.map((t) => (t.id === "t2a" ? { ...t, start_local_time: "11:00:00" } : t));
    const { from, to } = regenerationScope(existing, NOW).range!;
    return diffShifts(existing, expectedShifts(changed, org, from, to), NOW);
  };

  it("is stable for the same changes, regardless of order", () => {
    const a = moved();
    const b = moved();
    b.moved.reverse();
    expect(diffHash(a)).toBe(diffHash(b));
  });

  it("ignores how an instant is spelled", () => {
    const a = moved();
    const b = moved();
    b.moved[0] = { ...b.moved[0], to: { ...b.moved[0].to, starts_at: b.moved[0].to.starts_at.replace("Z", "+00:00") } };
    expect(diffHash(a)).toBe(diffHash(b));
  });

  it("changes when what would be applied changes", () => {
    const a = moved();
    const b = moved();
    b.moved[0] = { ...b.moved[0], to: { ...b.moved[0].to, starts_at: "2026-11-07T18:00:00.000Z" } };
    expect(diffHash(a)).not.toBe(diffHash(b));
    const c = moved();
    c.removed.push({ id: "x", template_id: "t1", occurrence_date: "2026-11-06", starts_at: "2026-11-06T22:00:00Z", ends_at: "2026-11-07T04:00:00Z" });
    expect(diffHash(a)).not.toBe(diffHash(c));
  });

  it("builds the database payload from the diff", () => {
    const d = moved();
    const p = regenerationPayload(d);
    expect(p.moved).toHaveLength(3);
    expect(p.moved[0]).toEqual({ id: d.moved[0].id, starts_at: d.moved[0].to.starts_at, ends_at: d.moved[0].to.ends_at });
    expect(p.added).toEqual([]);
    expect(p.removed).toEqual([]);
  });
});

describe("shared sanity", () => {
  it("parseLocalDate/formatLocalDate round-trip used for occurrence dates", () => {
    expect(formatLocalDate(parseLocalDate("2026-11-06"))).toBe("2026-11-06");
  });
});
