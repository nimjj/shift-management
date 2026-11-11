// Types shared by the rule engine. Everything in lib/rules is pure except execute.ts, which takes
// its I/O (the firing store and the channel senders) as arguments so it can be unit tested.

export const RULE_CONDITIONS = ["agent_missing", "nobody_in", "fewer_than_n"] as const;
export type RuleCondition = (typeof RULE_CONDITIONS)[number];

export const RECIPIENT_TYPES = ["missing_agents", "all_assignees", "employees", "role", "group"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const CHANNELS = ["email", "telegram"] as const;
export type Channel = (typeof CHANNELS)[number];

export type Rule = {
  id: string;
  position: number;
  name: string;
  trigger_minutes: number;
  condition: RuleCondition;
  condition_n: number | null;
  recipient_type: RecipientType;
  recipient_ids: string[];
  recipient_role: "supervisor" | "agent" | null;
  channels: Channel[];
  message_tpl: string;
  /** null = every block, and test shifts. */
  template_scope: string[] | null;
  enabled: boolean;
  /** Critical rules ignore quiet hours and people's channel choices. */
  critical: boolean;
};

export type EngineAssignment = {
  id: string;
  employee_id: string;
  role: "primary" | "backup";
  checked_in_at: string | null;
  checkin_token: string;
};

export type EngineShift = {
  id: string;
  template_id: string | null;
  /** Block code shown in messages ("2a", or "test"). */
  block: string;
  starts_at: string;
  ends_at: string;
  assignments: EngineAssignment[];
};

export type EngineEmployee = {
  id: string;
  full_name: string;
  email: string;
  role: "supervisor" | "agent";
  active: boolean;
  telegram_chat_id: number | null;
  /** The channels this person accepts (their notification preferences). */
  channels: Channel[];
  /** "HH:MM" or "HH:MM:SS", in display_tz. Both null = no quiet hours. */
  quiet_start: string | null;
  quiet_end: string | null;
  display_tz: string;
};

export type Directory = {
  employees: Map<string, EngineEmployee>;
  /** group id -> employee ids */
  groups: Map<string, string[]>;
};

/** One thing to send about: a rule that is due for a shift (and, for per-agent rules, an assignment). */
export type Firing = { rule: Rule; shift: EngineShift; assignment: EngineAssignment | null };

export type FiringRef = { rule_id: string; shift_id: string; assignment_id: string | null };

export function firingKey(f: FiringRef): string {
  return `${f.rule_id}|${f.shift_id}|${f.assignment_id ?? ""}`;
}

export function refOf(f: Firing): FiringRef {
  return { rule_id: f.rule.id, shift_id: f.shift.id, assignment_id: f.assignment?.id ?? null };
}

export const CONDITION_LABEL: Record<RuleCondition, string> = {
  agent_missing: "this agent has not checked in",
  nobody_in: "nobody has checked in",
  fewer_than_n: "fewer than N have checked in",
};

export const RECIPIENT_LABEL: Record<RecipientType, string> = {
  missing_agents: "the missing agents",
  all_assignees: "everyone on the shift",
  employees: "specific people",
  role: "everyone with a role",
  group: "a notification group",
};
