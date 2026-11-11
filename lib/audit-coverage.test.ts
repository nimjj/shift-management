// Guards the rule "every supervisor mutation writes to audit_log" by reading the SQL migrations
// and the server actions as text. It cannot be fooled by a function that forgets its audit row,
// a table that gains a write policy, or a new server action that skips the shared wrapper.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MUTATION_NAMES } from "@/lib/mutate";

const root = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");

const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationsDir, f), "utf8"))
  .join("\n")
  // strip line comments so commented-out SQL is never counted
  .replace(/--.*$/gm, "");

/** name -> the latest definition (header + body), so "create or replace" wins. */
const functions = new Map<string, string>();
for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$/gi)) {
  functions.set(m[1], m[0]);
}
const madeDefiner = new Set([...sql.matchAll(/alter\s+function\s+public\.(\w+)\s*\([^)]*\)\s+security\s+definer/gi)].map((m) => m[1]));

/** Functions a signed-in browser can call, after every grant and revoke is applied in order. */
const callable = new Set<string>();
for (const m of sql.matchAll(/(grant|revoke)\s+execute\s+on\s+function\s+public\.(\w+)\s*\([^)]*\)\s+(?:to|from)\s+([^;]+);/gi)) {
  const roles = m[3].split(",").map((r) => r.trim().toLowerCase());
  if (!roles.includes("authenticated")) continue;
  if (m[1].toLowerCase() === "grant") callable.add(m[2]);
  else callable.delete(m[2]);
}

/** Callable by a signed-in user but NOT a supervisor mutation, each with the reason it is exempt. */
const NOT_MUTATIONS: Record<string, string> = {
  current_employee_id: "read helper: reports on the caller only",
  is_supervisor: "read helper: reports on the caller only",
  assert_allowed_email: "validator: raises or returns, writes nothing",
  assert_valid_timezone: "validator: raises or returns, writes nothing",
  validate_shift_template_input: "validator: raises or returns, writes nothing",
  assert_valid_prefs: "validator: raises or returns, writes nothing",
  check_in: "self-service: an agent records their own attendance",
  update_my_prefs: "self-service: the caller's own notification preferences",
  set_my_group_subscription: "self-service: the caller's own group membership",
  create_telegram_link_token: "self-service: a one-time token for the caller",
  disconnect_my_telegram: "self-service: the caller's own Telegram link",
};
const SELF_SERVICE = ["check_in", "update_my_prefs", "set_my_group_subscription", "create_telegram_link_token", "disconnect_my_telegram"];
const VALIDATORS = ["assert_allowed_email", "assert_valid_timezone", "validate_shift_template_input", "assert_valid_prefs"];

describe("audit coverage (SQL)", () => {
  it("found the migrations", () => {
    expect(functions.size).toBeGreaterThan(25);
    expect(callable.size).toBeGreaterThan(20);
  });

  it("every function a signed-in user can call is a registered mutation or an explained exception", () => {
    const expected = [...MUTATION_NAMES, ...Object.keys(NOT_MUTATIONS)].sort();
    expect([...callable].sort()).toEqual(expected);
  });

  it.each(MUTATION_NAMES)("%s checks the supervisor, writes its audit row, and is pinned down", (name) => {
    const def = functions.get(name);
    expect(def, `no definition found for ${name}`).toBeDefined();
    expect(def).toMatch(/public\.write_audit\s*\(/);
    expect(def).toMatch(/public\.is_supervisor\(\)/);
    expect(def).toMatch(/set\s+search_path\s*=\s*''/);
    expect(/security\s+definer/i.test(def!) || madeDefiner.has(name)).toBe(true);
    // The app refuses a result without audit_id, so the function must return one.
    expect(def).toMatch(/'audit_id'/);
  });

  it("nobody but the mutation functions can write an audit row", () => {
    expect(callable.has("write_audit")).toBe(false);
    for (const role of ["anon", "public"]) {
      expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.write_audit\\([^)]*\\)\\s+from[^;]*\\b${role}\\b`, "i"));
    }
  });

  it.each(SELF_SERVICE)("%s acts on the caller only", (name) => {
    const def = functions.get(name)!;
    expect(def).toMatch(/public\.current_employee_id\(\)/);
    expect(def).not.toMatch(/p_employee_id/); // no way to name someone else
    expect(def).toMatch(/security\s+definer/i);
    expect(def).toMatch(/set\s+search_path\s*=\s*''/);
  });

  it.each(VALIDATORS)("%s writes nothing", (name) => {
    expect(functions.get(name)).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from)\b/i);
  });

  it("service-only functions are not callable from a browser", () => {
    for (const name of ["claim_rule_firings", "link_telegram", "invoke_check_shifts", "new_checkin_token", "effective_checkin_rules"]) {
      expect(functions.has(name), name).toBe(true);
      expect(callable.has(name), name).toBe(false);
    }
  });

  it("every table has Row Level Security and no client write policy", () => {
    const tables = [...sql.matchAll(/create\s+table\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThanOrEqual(15);
    for (const t of tables) {
      expect(sql, `RLS missing on ${t}`).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i"));
    }

    const policies = new Map<string, string>(); // "table.policy" -> command
    const events = [
      ...[...sql.matchAll(/create\s+policy\s+(\w+)\s+on\s+public\.(\w+)\s+for\s+(\w+)/gi)].map((m) => ({ at: m.index, key: `${m[2]}.${m[1]}`, cmd: m[3].toLowerCase() })),
      ...[...sql.matchAll(/drop\s+policy\s+(\w+)\s+on\s+public\.(\w+)/gi)].map((m) => ({ at: m.index, key: `${m[2]}.${m[1]}`, cmd: null })),
    ].sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.cmd) policies.set(e.key, e.cmd);
      else policies.delete(e.key);
    }

    expect(policies.size).toBeGreaterThan(8);
    const writers = [...policies].filter(([, cmd]) => cmd !== "select").map(([key]) => key);
    expect(writers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The app side: server actions
// ---------------------------------------------------------------------------
function actionFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) actionFiles(full, out);
    else if (name === "actions.ts" || name === "auth.ts") out.push(full);
  }
  return out;
}

/** Each exported server action with its source text. */
function exportedActions(file: string): { name: string; body: string }[] {
  const text = readFileSync(file, "utf8");
  const parts = text.split(/^export async function /m).slice(1);
  return parts.map((p) => ({ name: /^(\w+)/.exec(p)![1], body: p }));
}

/** Actions that are not supervisor mutations: sign-in/out and an agent's own check-in. */
const PLAIN_ACTIONS = new Set(["signInWithGoogle", "signOut", "checkInAction"]);
/** Supervisor actions that change no business data (they send a test message and log it in alerts). */
const NO_MUTATION = new Set(["sendTestRule"]);

describe("audit coverage (server actions)", () => {
  const files = actionFiles(path.join(root, "app"));
  const actions = files.flatMap((f) => exportedActions(f).map((a) => ({ ...a, file: path.relative(root, f) })));

  it("found the server actions", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(actions.length).toBeGreaterThanOrEqual(25);
  });

  it.each(actions.filter((a) => !PLAIN_ACTIONS.has(a.name)).map((a) => [a.name, a] as const))(
    "%s goes through supervisorAction or employeeAction",
    (_name, action) => {
      expect(action.body).toMatch(/\b(supervisorAction|employeeAction)\(/);
    },
  );

  it("every supervisor action writes through an audited mutation", () => {
    const supervisor = actions.filter((a) => /\bsupervisorAction\(/.test(a.body) && !NO_MUTATION.has(a.name));
    expect(supervisor.length).toBeGreaterThanOrEqual(18);
    for (const a of supervisor) {
      expect(a.body, `${a.file}: ${a.name} never calls mutate()`).toMatch(/\bmutate\(\s*"(\w+)"/);
      for (const m of a.body.matchAll(/\bmutate\(\s*"(\w+)"/g)) {
        expect(MUTATION_NAMES as readonly string[], `${a.name} calls unknown mutation ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it("every registered mutation is used by some action", () => {
    const used = new Set(actions.flatMap((a) => [...a.body.matchAll(/\bmutate\(\s*"(\w+)"/g)].map((m) => m[1])));
    expect([...MUTATION_NAMES].filter((n) => !used.has(n))).toEqual([]);
  });

  it("no supervisor action writes to a table directly", () => {
    for (const a of actions.filter((x) => /\bsupervisorAction\(/.test(x.body) && !NO_MUTATION.has(x.name))) {
      expect(a.body, `${a.file}: ${a.name}`).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });
});
