import { describe, expect, it } from "vitest";
import { dueFirings, inQuietHours, planDeliveries, resolveRecipients } from "./evaluate";
import { runTick, sendWithRetry, type AlertRow, type EngineStore, type OutboundMessage } from "./execute";
import { messageValues, renderTemplate, unknownPlaceholders } from "./template";
import {
  firingKey,
  type Channel,
  type Directory,
  type EngineAssignment,
  type EngineEmployee,
  type EngineShift,
  type FiringRef,
  type Rule,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures: a shift that starts at 10:00 UTC, the default 10 / 15 / 17 ladder, three people.
// ---------------------------------------------------------------------------
const START = "2026-11-07T10:00:00Z";
const END = "2026-11-07T16:00:00Z";
const plus = (min: number) => new Date(new Date(START).getTime() + min * 60_000);
const APP = "https://shifts.example";

function rule(over: Partial<Rule> & Pick<Rule, "id">): Rule {
  return {
    position: 1,
    name: over.id,
    trigger_minutes: 10,
    condition: "agent_missing",
    condition_n: null,
    recipient_type: "missing_agents",
    recipient_ids: [],
    recipient_role: null,
    channels: ["email", "telegram"],
    message_tpl: "Block {block}: {checkin_link}",
    template_scope: null,
    enabled: true,
    critical: false,
    ...over,
  };
}

const R1 = rule({ id: "r1", position: 1, name: "Agent reminder 1", trigger_minutes: 10 });
const R2 = rule({ id: "r2", position: 2, name: "Agent reminder 2", trigger_minutes: 15, condition: "nobody_in" });
const R3 = rule({
  id: "r3",
  position: 3,
  name: "Supervisor alert",
  trigger_minutes: 17,
  condition: "nobody_in",
  recipient_type: "role",
  recipient_role: "supervisor",
  critical: true,
  message_tpl: "Block {block} UNCOVERED. Assigned: {agents}. {dashboard_link}",
});
const LADDER = [R1, R2, R3];

function employee(id: string, over: Partial<EngineEmployee> = {}): EngineEmployee {
  return {
    id,
    full_name: id[0].toUpperCase() + id.slice(1),
    email: `${id}@adept-tech.us`,
    role: "agent",
    active: true,
    telegram_chat_id: null,
    channels: ["email", "telegram"],
    quiet_start: null,
    quiet_end: null,
    display_tz: "Asia/Colombo",
    ...over,
  };
}

function directory(people: EngineEmployee[], groups: Record<string, string[]> = {}): Directory {
  return { employees: new Map(people.map((p) => [p.id, p])), groups: new Map(Object.entries(groups)) };
}

const pooja = employee("pooja");
const thejan = employee("thejan");
const nimithra = employee("nimithra", { role: "supervisor", telegram_chat_id: 42 });
const DIR = directory([pooja, thejan, nimithra]);

function assignment(employeeId: string, over: Partial<EngineAssignment> = {}): EngineAssignment {
  return {
    id: `a-${employeeId}`,
    employee_id: employeeId,
    role: "primary",
    checked_in_at: null,
    checkin_token: `tok-${employeeId}`,
    ...over,
  };
}

function shiftOf(assignments: EngineAssignment[], over: Partial<EngineShift> = {}): EngineShift {
  return { id: "s1", template_id: "t-2a", block: "2a", starts_at: START, ends_at: END, assignments, ...over };
}

/** An in-memory rule_firings table plus a record of everything "sent". */
function harness() {
  const fired = new Set<string>();
  const alerts: AlertRow[] = [];
  const sent: { channel: Channel; address: string; message: OutboundMessage }[] = [];
  const store: EngineStore = {
    async claim(rows: FiringRef[]) {
      const fresh = rows.filter((r) => !fired.has(firingKey(r)));
      fresh.forEach((r) => fired.add(firingKey(r)));
      return fresh;
    },
    async logAlerts(rows) {
      alerts.push(...rows);
    },
  };
  const senders = {
    email: async (address: string, message: OutboundMessage) => void sent.push({ channel: "email", address, message }),
    telegram: async (address: string, message: OutboundMessage) =>
      void sent.push({ channel: "telegram", address, message }),
  };
  const tick = (shifts: EngineShift[], now: Date, rules: Rule[] = LADDER, dir: Directory = DIR) =>
    runTick({ rules, shifts, directory: dir, now, appUrl: APP, store, senders });
  return { fired, alerts, sent, store, senders, tick };
}

const to = (h: ReturnType<typeof harness>) => h.sent.map((s) => `${s.channel}:${s.address}`);

// ---------------------------------------------------------------------------
// The default escalation ladder (the four cases in CLAUDE.md)
// ---------------------------------------------------------------------------
describe("default escalation ladder", () => {
  it("solo shift, no-show: reminder at +10, second reminder at +15, supervisor alert at +17", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja")])];

    await h.tick(shifts, plus(9));
    expect(h.sent).toHaveLength(0);

    await h.tick(shifts, plus(10));
    expect(to(h)).toEqual(["email:pooja@adept-tech.us"]);

    await h.tick(shifts, plus(15));
    expect(to(h)).toEqual(["email:pooja@adept-tech.us", "email:pooja@adept-tech.us"]);

    await h.tick(shifts, plus(17));
    // the supervisor has Telegram linked, so they get both channels
    expect(to(h).slice(2)).toEqual(["email:nimithra@adept-tech.us", "telegram:42"]);
    expect(h.alerts.map((a) => a.rule_name)).toEqual([
      "Agent reminder 1",
      "Agent reminder 2",
      "Supervisor alert",
      "Supervisor alert",
    ]);
  });

  it("pair with nobody in: both agents get both reminders, then the supervisor is alerted", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja"), assignment("thejan")])];

    await h.tick(shifts, plus(10));
    await h.tick(shifts, plus(15));
    await h.tick(shifts, plus(17));

    const byRule = (name: string) => h.alerts.filter((a) => a.rule_name === name).map((a) => a.recipient);
    expect(byRule("Agent reminder 1").sort()).toEqual(["pooja@adept-tech.us", "thejan@adept-tech.us"]);
    expect(byRule("Agent reminder 2").sort()).toEqual(["pooja@adept-tech.us", "thejan@adept-tech.us"]);
    expect(byRule("Supervisor alert").sort()).toEqual(["42", "nimithra@adept-tech.us"]);
  });

  it("pair with one in: the missing agent gets reminder 1 only; no reminder 2, no supervisor alert", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja", { checked_in_at: "2026-11-07T10:02:00Z" }), assignment("thejan")])];

    for (const m of [10, 15, 17, 60]) await h.tick(shifts, plus(m));

    expect(to(h)).toEqual(["email:thejan@adept-tech.us"]);
    expect(h.alerts.map((a) => a.rule_name)).toEqual(["Agent reminder 1"]);
  });

  it("agent checks in between +10 and +15: nothing further is sent", async () => {
    const h = harness();
    await h.tick([shiftOf([assignment("pooja")])], plus(10));
    expect(h.sent).toHaveLength(1);

    const checkedIn = [shiftOf([assignment("pooja", { checked_in_at: "2026-11-07T10:12:00Z" })])];
    for (const m of [15, 17, 30]) await h.tick(checkedIn, plus(m));
    expect(h.sent).toHaveLength(1);
  });

  it("backups do not count: a backup who is in does not cover the shift", async () => {
    const h = harness();
    const shifts = [
      shiftOf([assignment("pooja"), assignment("thejan", { role: "backup", checked_in_at: "2026-11-07T10:01:00Z" })]),
    ];
    for (const m of [10, 15, 17]) await h.tick(shifts, plus(m));
    expect(h.alerts.map((a) => a.rule_name)).toContain("Supervisor alert");
    expect(h.alerts.filter((a) => a.recipient === "thejan@adept-tech.us")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
describe("checker idempotency", () => {
  it("running the same tick again sends nothing new", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja")])];
    const first = await h.tick(shifts, plus(20));
    const second = await h.tick(shifts, plus(20));
    expect(first.claimed).toBe(3);
    expect(second).toMatchObject({ due: 3, claimed: 0, sent: 0 });
    expect(h.sent).toHaveLength(4);
  });

  it("two overlapping runs send each firing once between them", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja"), assignment("thejan")])];
    const [a, b] = await Promise.all([h.tick(shifts, plus(20)), h.tick(shifts, plus(20))]);
    expect(a.claimed + b.claimed).toBe(4); // r1 x2 agents, r2, r3
    expect(h.sent).toHaveLength(6); // 2 + 2 + supervisor on 2 channels
  });

  it("alreadyFired skips known firings without asking the store", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja")])];
    const summary = await runTick({
      rules: [R1],
      shifts,
      directory: DIR,
      now: plus(20),
      appUrl: APP,
      store: {
        claim: async () => {
          throw new Error("should not be called");
        },
        logAlerts: async () => {},
      },
      senders: h.senders,
      alreadyFired: new Set([firingKey({ rule_id: "r1", shift_id: "s1", assignment_id: "a-pooja" })]),
    });
    expect(summary).toMatchObject({ due: 1, claimed: 0 });
  });

  it("a send that fails twice is logged as failed and not retried on the next tick", async () => {
    const h = harness();
    let calls = 0;
    const failing = {
      ...h.senders,
      email: async () => {
        calls += 1;
        throw new Error("smtp down");
      },
    };
    const shifts = [shiftOf([assignment("pooja")])];
    const run = () =>
      runTick({ rules: [R1], shifts, directory: DIR, now: plus(11), appUrl: APP, store: h.store, senders: failing });

    expect(await run()).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(calls).toBe(2); // first try + one retry
    expect(h.alerts[0]).toMatchObject({ status: "failed", success: false, error: "smtp down" });

    expect(await run()).toMatchObject({ claimed: 0 });
    expect(calls).toBe(2);
  });

  it("sendWithRetry succeeds when the second attempt works", async () => {
    let n = 0;
    const error = await sendWithRetry(async () => {
      n += 1;
      if (n === 1) throw new Error("blip");
    });
    expect(error).toBeNull();
    expect(n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Rules are read fresh on every tick
// ---------------------------------------------------------------------------
describe("rule edits and switches", () => {
  it("a rule edited mid-shift takes effect on the next tick", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja")])];
    const late = rule({ id: "r9", trigger_minutes: 30 });

    await h.tick(shifts, plus(12), [late]);
    expect(h.sent).toHaveLength(0);

    // The supervisor changes it to 5 minutes and rewrites the message.
    await h.tick(shifts, plus(13), [{ ...late, trigger_minutes: 5, message_tpl: "NEW {block}" }]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].message.text).toBe("NEW 2a");
  });

  it("an edit does not re-send a rule that already fired for the shift", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja")])];
    await h.tick(shifts, plus(12), [R1]);
    await h.tick(shifts, plus(13), [{ ...R1, message_tpl: "changed" }]);
    expect(h.sent).toHaveLength(1);
  });

  it("disabled rules never fire", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja")])];
    await h.tick(shifts, plus(60), LADDER.map((r) => ({ ...r, enabled: false })));
    expect(h.sent).toHaveLength(0);
    expect(h.fired.size).toBe(0);
  });

  it("disabling one stage mid-shift stops only that stage", async () => {
    const h = harness();
    const shifts = [shiftOf([assignment("pooja")])];
    await h.tick(shifts, plus(10));
    await h.tick(shifts, plus(20), [R1, { ...R2, enabled: false }, R3]);
    expect(h.alerts.map((a) => a.rule_name)).toEqual(["Agent reminder 1", "Supervisor alert", "Supervisor alert"]);
  });

  it("a scoped rule fires only for its blocks, and never for a test shift", () => {
    const scoped = rule({ id: "rs", template_scope: ["t-2a"] });
    const fire = (s: EngineShift) => dueFirings([scoped], [s], plus(20)).length;
    expect(fire(shiftOf([assignment("pooja")]))).toBe(1);
    expect(fire(shiftOf([assignment("pooja")], { template_id: "t-3b" }))).toBe(0);
    expect(fire(shiftOf([assignment("pooja")], { template_id: null, block: "test" }))).toBe(0);
    // an unscoped rule covers test shifts
    expect(dueFirings([R1], [shiftOf([assignment("pooja")], { template_id: null })], plus(20))).toHaveLength(1);
  });

  it("rules never fire before the shift starts or once it has ended", () => {
    const shifts = [shiftOf([assignment("pooja")])];
    const zero = rule({ id: "r0", trigger_minutes: 0 });
    expect(dueFirings([zero], shifts, plus(-1))).toHaveLength(0);
    expect(dueFirings([zero], shifts, plus(0))).toHaveLength(1);
    expect(dueFirings([zero], shifts, new Date(END))).toHaveLength(0);
  });

  it("fewer_than_n fires while fewer than N primaries are in", () => {
    const r = rule({ id: "rn", condition: "fewer_than_n", condition_n: 2, recipient_type: "all_assignees" });
    const one = shiftOf([assignment("pooja", { checked_in_at: START }), assignment("thejan")]);
    const two = shiftOf([assignment("pooja", { checked_in_at: START }), assignment("thejan", { checked_in_at: START })]);
    expect(dueFirings([r], [one], plus(20))).toHaveLength(1);
    expect(dueFirings([r], [two], plus(20))).toHaveLength(0);
  });

  it("an unstaffed shift that has started alerts the supervisors", async () => {
    const h = harness();
    await h.tick([shiftOf([])], plus(20));
    expect(h.alerts.map((a) => a.rule_name)).toEqual(["Supervisor alert", "Supervisor alert"]);
    expect(h.sent[0].message.text).toContain("Assigned: nobody.");
  });
});

// ---------------------------------------------------------------------------
// Recipients, channels, quiet hours
// ---------------------------------------------------------------------------
describe("recipients and channels", () => {
  const firing = (r: Rule, s: EngineShift) => dueFirings([r], [s], plus(30))[0];

  it("resolves each recipient type, active people only, each once", () => {
    const s = shiftOf([assignment("pooja"), assignment("thejan", { role: "backup" })]);
    const dir = directory([pooja, thejan, nimithra, employee("gone", { active: false })], {
      g1: ["thejan", "nimithra", "gone"],
      g2: ["nimithra"],
    });
    const ids = (r: Rule) => resolveRecipients(firing(r, s), dir).map((e) => e.id);

    expect(ids(rule({ id: "a", condition: "nobody_in", recipient_type: "missing_agents" }))).toEqual(["pooja"]);
    expect(ids(rule({ id: "b", condition: "nobody_in", recipient_type: "all_assignees" }))).toEqual(["pooja", "thejan"]);
    expect(
      ids(rule({ id: "c", condition: "nobody_in", recipient_type: "employees", recipient_ids: ["nimithra", "gone"] })),
    ).toEqual(["nimithra"]);
    expect(ids(rule({ id: "d", condition: "nobody_in", recipient_type: "role", recipient_role: "supervisor" }))).toEqual([
      "nimithra",
    ]);
    expect(
      ids(rule({ id: "e", condition: "nobody_in", recipient_type: "group", recipient_ids: ["g1", "g2", "nope"] })),
    ).toEqual(["thejan", "nimithra"]);
  });

  it("uses only the channels a person accepts, and Telegram only when linked", () => {
    const emailOnly = employee("e1", { channels: ["email"], telegram_chat_id: 7 });
    const telegramOnly = employee("e2", { channels: ["telegram"], telegram_chat_id: 8 });
    const unlinked = employee("e3", { channels: ["telegram"] });
    const plan = planDeliveries(R1, [emailOnly, telegramOnly, unlinked], plus(10));
    expect(plan.map((d) => `${d.employee.id}:${d.channel}:${d.address}`)).toEqual([
      "e1:email:e1@adept-tech.us",
      "e2:telegram:8",
    ]);
  });

  it("respects quiet hours, except for critical rules", async () => {
    // 10:20 UTC is 15:50 in Colombo.
    const quiet = employee("quiet", { quiet_start: "15:00", quiet_end: "17:00", role: "supervisor" });
    const dir = directory([quiet]);
    const s = [shiftOf([assignment("quiet")])];

    const h = harness();
    await h.tick(s, plus(20), [R1], dir);
    expect(h.sent).toHaveLength(0);
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toMatchObject({ status: "suppressed", success: false });
    expect(h.alerts[0].payload.reason).toBe("quiet_hours");

    await h.tick(s, plus(20), [R3], dir); // critical
    expect(h.sent).toHaveLength(1);
  });

  it("a critical rule ignores a person's channel choices", () => {
    const noEmail = employee("ne", { channels: [], telegram_chat_id: 9 });
    expect(planDeliveries(R3, [noEmail], plus(20)).map((d) => d.channel)).toEqual(["email", "telegram"]);
    expect(planDeliveries(R1, [noEmail], plus(20))).toHaveLength(0);
  });

  it("quiet hours can wrap past midnight and are read in the person's own zone", () => {
    const at = (iso: string) => new Date(iso);
    // 22:00-07:00 Colombo. 18:00 UTC = 23:30 Colombo (quiet); 03:00 UTC = 08:30 Colombo (not quiet).
    expect(inQuietHours(at("2026-11-07T18:00:00Z"), "22:00", "07:00", "Asia/Colombo")).toBe(true);
    expect(inQuietHours(at("2026-11-07T03:00:00Z"), "22:00", "07:00", "Asia/Colombo")).toBe(false);
    expect(inQuietHours(at("2026-11-07T01:00:00Z"), "22:00:00", "07:00:00", "Asia/Colombo")).toBe(true); // 06:30
    expect(inQuietHours(at("2026-11-07T18:00:00Z"), "22:00", "07:00", "UTC")).toBe(false);
    expect(inQuietHours(at("2026-11-07T18:00:00Z"), null, null, "UTC")).toBe(false);
    expect(inQuietHours(at("2026-11-07T18:00:00Z"), "09:00", "09:00", "UTC")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------
describe("message templates", () => {
  it("fills in known placeholders and leaves unknown ones alone", () => {
    expect(renderTemplate("Block {block} {nope} {block}", { block: "2a" })).toBe("Block 2a {nope} 2a");
    expect(unknownPlaceholders("{block} {nope} {agents} {other}")).toEqual(["nope", "other"]);
  });

  it("gives each recipient their own check-in link and their own time zone", () => {
    const s = shiftOf([assignment("pooja"), assignment("thejan", { checked_in_at: START })]);
    const firing = { rule: R2, shift: s, assignment: null };

    const forPooja = messageValues(firing, pooja, DIR, `${APP}/`);
    expect(forPooja.checkin_link).toBe(`${APP}/checkin/tok-pooja`);
    expect(forPooja.start_local).toBe("Sat 7 Nov 15:30 GMT+5:30");
    expect(forPooja.agents).toBe("Pooja, Thejan");
    expect(forPooja.missing_agents).toBe("Pooja");
    expect(forPooja.dashboard_link).toBe(`${APP}/`);

    const forSupervisor = messageValues(firing, { id: "nimithra", display_tz: "America/Chicago" }, DIR, APP);
    expect(forSupervisor.checkin_link).toBe(`${APP}/my-shifts`); // not on the shift
    expect(forSupervisor.start_local).toBe("Sat 7 Nov 04:00 CST");
  });

  it("a per-agent firing links a supervisor to that agent's check-in page", () => {
    const s = shiftOf([assignment("pooja")]);
    const v = messageValues({ rule: R1, shift: s, assignment: s.assignments[0] }, nimithra, DIR, APP);
    expect(v.checkin_link).toBe(`${APP}/checkin/tok-pooja`);
  });
});
