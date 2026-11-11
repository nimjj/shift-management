import { describe, expect, it } from "vitest";
import { buildMime, encodeHeader, isPlaceholderEmail, toBase64Url } from "@/lib/alerts/mime";
import { buildEvent, eventIdFor } from "@/lib/google/calendar";
import { parseServiceAccount } from "@/lib/google/auth";
import { addMonths, agentTotals, formatMonth, monthLabel, monthOf, monthRange, parseMonth } from "@/lib/history";
import { employeePrefsSchema, myPrefsSchema } from "@/lib/prefs-schema";
import { secretMatches } from "@/lib/secret-compare";
import { DEFAULT_RULES } from "@/lib/settings";
import { calendarSchema, parseReminders } from "@/app/(app)/settings/calendar/schema";
import { checkinRulesSchema, overrideSchema } from "@/app/(app)/settings/checkin/schema";
import { ruleSchema, ruleToPayload } from "@/app/(app)/settings/rules/schema";

const UUID = "3f2b8c1e-7a4d-4e2b-9c1a-5d6e7f8a9b0c";

describe("email (MIME)", () => {
  it("encodes non-ASCII headers and leaves plain ones alone", () => {
    expect(encodeHeader("Plain subject")).toBe("Plain subject");
    expect(encodeHeader("⏰ Block 2a")).toBe(`=?UTF-8?B?${Buffer.from("⏰ Block 2a").toString("base64")}?=`);
  });

  it("builds a message whose body round-trips", () => {
    const mime = buildMime({ from: "alerts@adept-tech.us", fromName: "ShiftBoard", to: "a@adept-tech.us", subject: "Hi", text: "⚠️ Uncovered\nline two" });
    const [head, body] = mime.split("\r\n\r\n");
    expect(head).toContain("From: ShiftBoard <alerts@adept-tech.us>");
    expect(head).toContain("To: a@adept-tech.us");
    expect(head).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("⚠️ Uncovered\nline two");
    expect(Buffer.from(toBase64Url(mime), "base64url").toString("utf8")).toBe(mime);
  });

  it("cannot be tricked into adding headers", () => {
    const mime = buildMime({ from: "a@x.us", to: "b@x.us\r\nBcc: evil@x.us", subject: "s\r\nBcc: evil@x.us", text: "t" });
    const head = mime.split("\r\n\r\n")[0];
    expect(head.split("\r\n").filter((l) => l.startsWith("Bcc:"))).toEqual([]);
  });

  it("recognises the seed placeholder addresses", () => {
    expect(isPlaceholderEmail("pooja@placeholder.invalid")).toBe(true);
    expect(isPlaceholderEmail("pooja@adept-tech.us")).toBe(false);
  });
});

describe("calendar events", () => {
  it("derives a stable, valid event id from the assignment id", () => {
    const id = eventIdFor("3F2B8C1E-7a4d-4e2b-9c1a-5d6e7f8a9b0c");
    expect(id).toBe("sb3f2b8c1e7a4d4e2b9c1a5d6e7f8a9b0c");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/); // Google's rule for custom event ids
    expect(eventIdFor(UUID)).toBe(id); // same assignment, same event: retries cannot duplicate
  });

  it("builds the event with the attendee, the check-in link and the reminders", () => {
    const e = buildEvent({
      assignmentId: UUID,
      attendeeEmail: "pooja@adept-tech.us",
      startsAt: "2026-11-07T16:00:00Z",
      endsAt: "2026-11-07T22:00:00Z",
      titleTpl: "Voicify Monitoring — Block {block}",
      descTpl: "Hi {agent}. {start_local}. Check in: {checkin_link} {unknown}",
      remindersMin: [30, 10],
      values: { block: "2a", start_local: "Sat 21:30", end_local: "Sun 03:30", checkin_link: "https://x/checkin/t", agent: "Pooja" },
    });
    expect(e.summary).toBe("Voicify Monitoring — Block 2a");
    expect(e.description).toBe("Hi Pooja. Sat 21:30. Check in: https://x/checkin/t {unknown}");
    expect(e.start).toEqual({ dateTime: "2026-11-07T16:00:00.000Z", timeZone: "UTC" });
    expect(e.attendees).toEqual([{ email: "pooja@adept-tech.us" }]);
    expect(e.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "popup", minutes: 10 }] });
  });

  it("reads the service account as JSON or base64, and repairs escaped newlines", () => {
    const key = { client_email: "sa@p.iam.gserviceaccount.com", private_key: "-----BEGIN-----\\nabc\\n-----END-----\\n" };
    const fromJson = parseServiceAccount(JSON.stringify(key));
    expect(fromJson.client_email).toBe(key.client_email);
    expect(fromJson.token_uri).toBe("https://oauth2.googleapis.com/token");
    expect(parseServiceAccount(Buffer.from(JSON.stringify(key)).toString("base64")).client_email).toBe(key.client_email);
    expect(parseServiceAccount(JSON.stringify({ ...key, private_key: "a\\nb" })).private_key).toBe("a\nb");
    expect(() => parseServiceAccount("not json")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount("{}")).toThrow(/missing/);
  });
});

describe("shared secrets", () => {
  it("matches only the exact secret, and never when none is configured", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches("", "s3cret")).toBe(false);
    expect(secretMatches(null, "s3cret")).toBe(false);
    expect(secretMatches("anything", undefined)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});

describe("history", () => {
  it("parses, formats and steps months", () => {
    expect(parseMonth("2026-11")).toEqual({ y: 2026, m: 11 });
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("nope")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
    expect(formatMonth({ y: 2026, m: 3 })).toBe("2026-03");
    expect(addMonths({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(monthLabel({ y: 2026, m: 11 })).toBe("November 2026");
  });

  it("month boundaries are local midnights in the display zone", () => {
    const { from, to } = monthRange({ y: 2026, m: 11 }, "Asia/Colombo");
    expect(from.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    // 20:00 UTC on 31 Oct is already 1 Nov in Colombo
    expect(monthOf(new Date("2026-10-31T20:00:00Z"), "Asia/Colombo")).toEqual({ y: 2026, m: 11 });
    expect(monthOf(new Date("2026-10-31T20:00:00Z"), "America/Chicago")).toEqual({ y: 2026, m: 10 });
  });

  it("counts shifts, check-ins, late, missed and backups per agent", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const shift = (day: string, assignments: { employee_id: string; role: "primary" | "backup"; checked_in_at: string | null }[]) => ({
      starts_at: `2026-11-${day}T10:00:00Z`,
      ends_at: `2026-11-${day}T16:00:00Z`,
      rules: DEFAULT_RULES,
      assignments,
    });
    const totals = agentTotals(
      [
        shift("07", [
          { employee_id: "pooja", role: "primary", checked_in_at: "2026-11-07T10:02:00Z" },
          { employee_id: "thejan", role: "primary", checked_in_at: "2026-11-07T10:25:00Z" }, // late
        ]),
        shift("08", [
          { employee_id: "pooja", role: "primary", checked_in_at: null }, // missed
          { employee_id: "thejan", role: "backup", checked_in_at: null },
        ]),
        shift("28", [{ employee_id: "pooja", role: "primary", checked_in_at: null }]), // still to come
      ],
      now,
    );
    const by = Object.fromEntries(totals.map((t) => [t.employee_id, t]));
    expect(by.pooja).toMatchObject({ shifts: 3, attended: 1, late: 0, missed: 1, upcoming: 1, backup: 0 });
    expect(by.thejan).toMatchObject({ shifts: 1, attended: 1, late: 1, missed: 0, upcoming: 0, backup: 1 });
  });
});

describe("settings schemas", () => {
  it("check-in rules: numbers in range, known choices", () => {
    const ok = { open_before_min: "15", close_rule: "shift_end", close_after_min: "30", late_after_min: "10", covered_rule: "all", covered_min: "1" };
    expect(checkinRulesSchema.parse(ok)).toMatchObject({ open_before_min: 15, covered_min: 1 });
    expect(checkinRulesSchema.safeParse({ ...ok, open_before_min: "-1" }).success).toBe(false);
    expect(checkinRulesSchema.safeParse({ ...ok, open_before_min: "1.5" }).success).toBe(false);
    expect(checkinRulesSchema.safeParse({ ...ok, close_rule: "never" }).success).toBe(false);
    expect(checkinRulesSchema.safeParse({ ...ok, covered_min: "0" }).success).toBe(false);
  });

  it("overrides: blank inherits, 0 is a real value", () => {
    const parsed = overrideSchema.parse({
      template_id: UUID, open_before_min: "0", close_rule: "", close_after_min: "", late_after_min: "5", covered_rule: "", covered_min: "",
    });
    expect(parsed).toEqual({
      template_id: UUID, open_before_min: 0, close_rule: null, close_after_min: null, late_after_min: 5, covered_rule: null, covered_min: null,
    });
    expect(overrideSchema.safeParse({ template_id: "x", open_before_min: "" }).success).toBe(false);
  });

  it("calendar: reminders parse, and switching on needs a calendar id", () => {
    expect(parseReminders("10, 30 10")).toEqual([30, 10]);
    expect(parseReminders("")).toEqual([]);
    expect(parseReminders("ten")).toBeNull();
    const base = { enabled: true, calendar_id: "c_123@group.calendar.google.com", title_tpl: "T {block}", desc_tpl: "{checkin_link}", reminders: "30,10" };
    expect(calendarSchema.parse(base).reminders).toEqual([30, 10]);
    expect(calendarSchema.safeParse({ ...base, calendar_id: " " }).success).toBe(false);
    expect(calendarSchema.safeParse({ ...base, enabled: false, calendar_id: "" }).success).toBe(true);
    expect(calendarSchema.safeParse({ ...base, reminders: "1,2,3,4,5,6" }).success).toBe(false);
    expect(calendarSchema.safeParse({ ...base, title_tpl: "  " }).success).toBe(false);
  });

  it("notification rule: dependent fields are required only when they apply", () => {
    const base = {
      id: "", name: "Stage", trigger_minutes: "10", condition: "agent_missing", condition_n: "", recipient_type: "missing_agents",
      employee_ids: [], group_ids: [], recipient_role: "", channels: ["email"], message_tpl: "Hi {block}", template_scope: [], enabled: true, critical: false,
    };
    const parsed = ruleSchema.parse(base);
    expect(parsed.id).toBeUndefined();
    expect(ruleToPayload(parsed)).toEqual({
      name: "Stage", trigger_minutes: 10, condition: "agent_missing", condition_n: null, recipient_type: "missing_agents",
      recipient_ids: [], recipient_role: null, channels: ["email"], message_tpl: "Hi {block}", template_scope: null, enabled: true, critical: false,
    });

    expect(ruleSchema.safeParse({ ...base, channels: [] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, channels: ["sms"] }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, condition: "fewer_than_n" }).success).toBe(false); // needs N
    expect(ruleSchema.safeParse({ ...base, recipient_type: "employees" }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, recipient_type: "group" }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, recipient_type: "role" }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, trigger_minutes: "1441" }).success).toBe(false);

    const role = ruleSchema.parse({ ...base, recipient_type: "role", recipient_role: "supervisor", employee_ids: [UUID] });
    expect(ruleToPayload(role)).toMatchObject({ recipient_role: "supervisor", recipient_ids: [] }); // stray ids dropped
    const n = ruleSchema.parse({ ...base, condition: "fewer_than_n", condition_n: "2", template_scope: [UUID] });
    expect(ruleToPayload(n)).toMatchObject({ condition_n: 2, template_scope: [UUID] });
  });

  it("preferences: quiet hours come as a pair, and the time zone must be real", () => {
    const base = { channels: ["email"], quiet_start: "22:00", quiet_end: "07:00", display_tz: "" };
    expect(myPrefsSchema.parse(base)).toEqual({ channels: ["email"], quiet_start: "22:00", quiet_end: "07:00", display_tz: null });
    expect(myPrefsSchema.parse({ ...base, quiet_start: "22:00:00", quiet_end: "07:00:00" }).quiet_start).toBe("22:00");
    expect(myPrefsSchema.parse({ ...base, quiet_start: "", quiet_end: "" })).toMatchObject({ quiet_start: null, quiet_end: null });
    expect(myPrefsSchema.safeParse({ ...base, quiet_end: "" }).success).toBe(false);
    expect(myPrefsSchema.safeParse({ ...base, quiet_end: "22:00" }).success).toBe(false);
    expect(myPrefsSchema.safeParse({ ...base, display_tz: "Mars/Olympus" }).success).toBe(false);
    expect(myPrefsSchema.parse({ ...base, display_tz: "Asia/Colombo" }).display_tz).toBe("Asia/Colombo");
    expect(myPrefsSchema.parse({ ...base, channels: [] }).channels).toEqual([]); // opting out of everything is allowed
    expect(employeePrefsSchema.safeParse({ ...base, employee_id: "nope" }).success).toBe(false);
    expect(employeePrefsSchema.safeParse({ ...base, employee_id: UUID }).success).toBe(true);
  });
});
