import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, describeRules, effectiveRules, rulesByTemplate, type CheckinRules } from "@/lib/settings";
import {
  assignmentStatus,
  canCheckIn,
  checkinDelayMinutes,
  checkinWindow,
  coverTarget,
  shiftStatus,
  wasLate,
} from "@/lib/status";

// A six-hour shift: 10:00-16:00 UTC on 7 Nov 2026.
const shift = { starts_at: "2026-11-07T10:00:00Z", ends_at: "2026-11-07T16:00:00Z" };
const at = (hhmm: string) => new Date(`2026-11-07T${hhmm}:00Z`);
const rules: CheckinRules = { ...DEFAULT_RULES };
const none = { checked_in_at: null };
const inAt = (hhmm: string) => ({ checked_in_at: `2026-11-07T${hhmm}:00Z` });

const org = {
  checkin_open_before_min: 15,
  checkin_close_rule: "shift_end",
  checkin_close_after_min: 30,
  late_after_min: 10,
  covered_rule: "all",
  covered_min: 1,
};

describe("effectiveRules", () => {
  it("uses the org settings when there is no override", () => {
    expect(effectiveRules(org)).toEqual(DEFAULT_RULES);
    expect(effectiveRules(org, null)).toEqual(DEFAULT_RULES);
  });

  it("an override replaces only the fields it sets", () => {
    const r = effectiveRules(org, {
      checkin_open_before_min: 30,
      checkin_close_rule: null,
      checkin_close_after_min: null,
      late_after_min: 5,
      covered_rule: "at_least_n",
      covered_min: null,
    });
    expect(r).toEqual({ ...DEFAULT_RULES, openBeforeMin: 30, lateAfterMin: 5, coveredRule: "at_least_n" });
  });

  it("an override of 0 is a real value, not 'inherit'", () => {
    const r = effectiveRules(org, {
      checkin_open_before_min: 0,
      checkin_close_rule: null,
      checkin_close_after_min: null,
      late_after_min: 0,
      covered_rule: null,
      covered_min: null,
    });
    expect(r.openBeforeMin).toBe(0);
    expect(r.lateAfterMin).toBe(0);
  });

  it("ignores a value the app does not know and keeps the default", () => {
    expect(effectiveRules({ ...org, checkin_close_rule: "whenever", covered_rule: "??" })).toEqual(DEFAULT_RULES);
  });

  it("rulesByTemplate gives each block its own rules and everything else the default", () => {
    const get = rulesByTemplate(org, [
      {
        template_id: "t1",
        checkin_open_before_min: 60,
        checkin_close_rule: null,
        checkin_close_after_min: null,
        late_after_min: null,
        covered_rule: null,
        covered_min: null,
      },
    ]);
    expect(get("t1").openBeforeMin).toBe(60);
    expect(get("t2").openBeforeMin).toBe(15);
    expect(get(null).openBeforeMin).toBe(15); // test shifts have no template
  });

  it("describes the rules in a sentence", () => {
    expect(describeRules(DEFAULT_RULES)).toBe(
      "Opens 15 min before the start, until the shift ends. Late after 10 min. Covered when everyone checks in.",
    );
  });
});

describe("checkinWindow", () => {
  it("opens before the start and closes at the shift end by default", () => {
    const w = checkinWindow(shift, rules);
    expect(w.opensAt.toISOString()).toBe("2026-11-07T09:45:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-07T16:00:00.000Z");
  });

  it("can close a fixed time after the start, never later than the shift end", () => {
    expect(checkinWindow(shift, { ...rules, closeRule: "after_start", closeAfterMin: 30 }).closesAt.toISOString()).toBe(
      "2026-11-07T10:30:00.000Z",
    );
    expect(checkinWindow(shift, { ...rules, closeRule: "after_start", closeAfterMin: 999 }).closesAt.toISOString()).toBe(
      "2026-11-07T16:00:00.000Z",
    );
  });

  it("canCheckIn is true from the opening instant up to (not including) the closing instant", () => {
    expect(canCheckIn(none, shift, rules, at("09:44"))).toBe(false);
    expect(canCheckIn(none, shift, rules, at("09:45"))).toBe(true);
    expect(canCheckIn(none, shift, rules, at("15:59"))).toBe(true);
    expect(canCheckIn(none, shift, rules, at("16:00"))).toBe(false);
    expect(canCheckIn(inAt("10:00"), shift, rules, at("10:05"))).toBe(false); // already in
  });
});

describe("assignmentStatus", () => {
  it("walks upcoming -> checkin_open -> late -> missed for someone who never checks in", () => {
    expect(assignmentStatus(none, shift, rules, at("09:44"))).toBe("upcoming");
    expect(assignmentStatus(none, shift, rules, at("09:45"))).toBe("checkin_open");
    expect(assignmentStatus(none, shift, rules, at("10:10"))).toBe("checkin_open"); // exactly +10 is not late yet
    expect(assignmentStatus(none, shift, rules, at("10:11"))).toBe("late");
    expect(assignmentStatus(none, shift, rules, at("15:59"))).toBe("late");
    expect(assignmentStatus(none, shift, rules, at("16:00"))).toBe("missed");
  });

  it("is checked_in whenever checked_in_at is set, even after the shift", () => {
    expect(assignmentStatus(inAt("10:02"), shift, rules, at("10:03"))).toBe("checked_in");
    expect(assignmentStatus(inAt("10:02"), shift, rules, at("18:00"))).toBe("checked_in");
  });

  it("follows the late threshold from settings", () => {
    expect(assignmentStatus(none, shift, { ...rules, lateAfterMin: 2 }, at("10:03"))).toBe("late");
    expect(assignmentStatus(none, shift, { ...rules, lateAfterMin: 30 }, at("10:25"))).toBe("checkin_open");
  });
});

describe("shiftStatus", () => {
  it("is upcoming before the start and uncovered once it starts with nobody in", () => {
    expect(shiftStatus([none, none], shift, rules, at("09:50"))).toBe("upcoming");
    expect(shiftStatus([none, none], shift, rules, at("10:00"))).toBe("uncovered");
  });

  it("is partial with one of two in, covered with both", () => {
    expect(shiftStatus([inAt("10:01"), none], shift, rules, at("10:05"))).toBe("partial");
    expect(shiftStatus([inAt("10:01"), inAt("10:04")], shift, rules, at("10:05"))).toBe("covered");
  });

  it("is covered as soon as everyone is in, even before the start", () => {
    expect(shiftStatus([inAt("09:50")], shift, rules, at("09:55"))).toBe("covered");
  });

  it("'at least N' needs only N check-ins", () => {
    const atLeastOne: CheckinRules = { ...rules, coveredRule: "at_least_n", coveredMin: 1 };
    expect(shiftStatus([inAt("10:01"), none], shift, atLeastOne, at("10:05"))).toBe("covered");
    const atLeastTwo: CheckinRules = { ...rules, coveredRule: "at_least_n", coveredMin: 2 };
    expect(shiftStatus([inAt("10:01"), none, none], shift, atLeastTwo, at("10:05"))).toBe("partial");
    // N larger than the roster is capped at the roster
    expect(coverTarget(1, { ...rules, coveredRule: "at_least_n", coveredMin: 5 })).toBe(1);
  });

  it("a shift with no primaries is never covered", () => {
    expect(shiftStatus([], shift, rules, at("09:00"))).toBe("upcoming");
    expect(shiftStatus([], shift, rules, at("11:00"))).toBe("uncovered");
  });

  it("a missed shift stays uncovered afterwards", () => {
    expect(shiftStatus([none], shift, rules, at("20:00"))).toBe("uncovered");
  });
});

describe("history helpers", () => {
  it("measures the delay from the start, negative when early", () => {
    expect(checkinDelayMinutes("2026-11-07T10:07:00Z", shift)).toBe(7);
    expect(checkinDelayMinutes("2026-11-07T09:50:00Z", shift)).toBe(-10);
  });

  it("wasLate is true only past the threshold", () => {
    expect(wasLate("2026-11-07T10:10:00Z", shift, rules)).toBe(false);
    expect(wasLate("2026-11-07T10:11:00Z", shift, rules)).toBe(true);
    expect(wasLate(null, shift, rules)).toBe(false);
  });
});
