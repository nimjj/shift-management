// Pure: turns the org's check-in settings plus a block's overrides into the rules that apply.
// The database does the same merge in effective_checkin_rules() (it is the authority for whether a
// check-in is accepted); this copy is for display and for derived statuses.

export const CLOSE_RULES = ["shift_end", "after_start"] as const;
export type CloseRule = (typeof CLOSE_RULES)[number];

export const COVERED_RULES = ["all", "at_least_n"] as const;
export type CoveredRule = (typeof COVERED_RULES)[number];

export type CheckinRules = {
  /** Check-in opens this many minutes before the shift starts. */
  openBeforeMin: number;
  /** "shift_end": open until the shift ends. "after_start": closes closeAfterMin after the start. */
  closeRule: CloseRule;
  closeAfterMin: number;
  /** Not checked in this many minutes after the start = late. */
  lateAfterMin: number;
  /** "all": every primary must check in. "at_least_n": coveredMin of them is enough. */
  coveredRule: CoveredRule;
  coveredMin: number;
};

export type OrgCheckinSettings = {
  checkin_open_before_min: number;
  checkin_close_rule: string;
  checkin_close_after_min: number;
  late_after_min: number;
  covered_rule: string;
  covered_min: number;
};

/** A template_overrides row. NULL = inherit the org default. */
export type TemplateOverride = {
  checkin_open_before_min: number | null;
  checkin_close_rule: string | null;
  checkin_close_after_min: number | null;
  late_after_min: number | null;
  covered_rule: string | null;
  covered_min: number | null;
};

export const DEFAULT_RULES: CheckinRules = {
  openBeforeMin: 15,
  closeRule: "shift_end",
  closeAfterMin: 30,
  lateAfterMin: 10,
  coveredRule: "all",
  coveredMin: 1,
};

function closeRule(v: string | null | undefined, fallback: CloseRule): CloseRule {
  return v === "shift_end" || v === "after_start" ? v : fallback;
}

function coveredRule(v: string | null | undefined, fallback: CoveredRule): CoveredRule {
  return v === "all" || v === "at_least_n" ? v : fallback;
}

export function effectiveRules(org: OrgCheckinSettings, override?: TemplateOverride | null): CheckinRules {
  const base: CheckinRules = {
    openBeforeMin: org.checkin_open_before_min,
    closeRule: closeRule(org.checkin_close_rule, DEFAULT_RULES.closeRule),
    closeAfterMin: org.checkin_close_after_min,
    lateAfterMin: org.late_after_min,
    coveredRule: coveredRule(org.covered_rule, DEFAULT_RULES.coveredRule),
    coveredMin: org.covered_min,
  };
  if (!override) return base;
  return {
    openBeforeMin: override.checkin_open_before_min ?? base.openBeforeMin,
    closeRule: closeRule(override.checkin_close_rule, base.closeRule),
    closeAfterMin: override.checkin_close_after_min ?? base.closeAfterMin,
    lateAfterMin: override.late_after_min ?? base.lateAfterMin,
    coveredRule: coveredRule(override.covered_rule, base.coveredRule),
    coveredMin: override.covered_min ?? base.coveredMin,
  };
}

/** Rules for each template id, given every override row. Templates without a row get the default. */
export function rulesByTemplate(
  org: OrgCheckinSettings,
  overrides: readonly (TemplateOverride & { template_id: string })[],
): (templateId: string | null) => CheckinRules {
  const base = effectiveRules(org);
  const map = new Map(overrides.map((o) => [o.template_id, effectiveRules(org, o)]));
  return (templateId) => (templateId ? (map.get(templateId) ?? base) : base);
}

/** One line describing the rules, for Settings and the check-in page. */
export function describeRules(r: CheckinRules): string {
  const close =
    r.closeRule === "shift_end" ? "until the shift ends" : `until ${r.closeAfterMin} min after the start`;
  const covered = r.coveredRule === "all" ? "everyone checks in" : `at least ${r.coveredMin} check in`;
  return `Opens ${r.openBeforeMin} min before the start, ${close}. Late after ${r.lateAfterMin} min. Covered when ${covered}.`;
}
