import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignmentChip, Pill, ShiftChip } from "@/components/status-chip";
import { requireSupervisor } from "@/lib/auth";
import { addMonths, agentTotals, formatMonth, monthLabel, monthOf, monthRange, parseMonth } from "@/lib/history";
import { formatInstant } from "@/lib/rules/template";
import { rulesByTemplate } from "@/lib/settings";
import { assignmentStatus, checkinDelayMinutes, shiftStatus, wasLate } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatRangeIn } from "@/lib/time";

export const metadata = { title: "History · ShiftBoard" };

const navLink = buttonVariants({ variant: "outline", size: "sm" });

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const actor = await requireSupervisor();
  const supabase = await createClient();
  const now = new Date();
  const params = await searchParams;

  const [orgRes, prefsRes, overridesRes, employeesRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", actor.id).maybeSingle(),
    supabase.from("template_overrides").select("*"),
    supabase.from("employees").select("id, full_name, active").order("full_name"),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (employeesRes.error) throw employeesRes.error;

  const org = orgRes.data;
  const tz = prefsRes.data?.display_tz ?? org.default_display_tz;
  const month = parseMonth(typeof params.m === "string" ? params.m : undefined) ?? monthOf(now, tz);
  const { from, to } = monthRange(month, tz);
  const showTests = params.tests === "1";

  let query = supabase
    .from("shifts")
    .select(
      "id, template_id, starts_at, ends_at, is_test, shift_templates(code, colour), assignments(id, employee_id, role, checked_in_at)",
    )
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: false })
    .limit(500);
  if (!showTests) query = query.eq("is_test", false);
  const shiftsRes = await query;
  if (shiftsRes.error) throw shiftsRes.error;

  const rulesFor = rulesByTemplate(org, overridesRes.data ?? []);
  const names = new Map(employeesRes.data.map((e) => [e.id, e.full_name]));
  const shifts = shiftsRes.data.map((s) => ({ ...s, rules: rulesFor(s.template_id) }));
  const past = shifts.filter((s) => new Date(s.ends_at) <= now);

  const totals = agentTotals(shifts, now).sort((a, b) =>
    (names.get(a.employee_id) ?? "").localeCompare(names.get(b.employee_id) ?? ""),
  );

  const link = (m: typeof month, tests = showTests) => `/history?m=${formatMonth(m)}${tests ? "&tests=1" : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">History · {monthLabel(month)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shifts that started in this month ({tz}).{" "}
            <Link href={link(month, !showTests)} className="underline underline-offset-4">
              {showTests ? "Hide test shifts" : "Include test shifts"}
            </Link>
          </p>
        </div>
        <nav className="flex items-center gap-2">
          <Link href={link(addMonths(month, -1))} className={navLink}>
            ‹ {monthLabel(addMonths(month, -1))}
          </Link>
          <Link href={link(addMonths(month, 1))} className={navLink}>
            {monthLabel(addMonths(month, 1))} ›
          </Link>
        </nav>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Totals per agent</h2>
        {totals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody was assigned to a shift this month.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Shifts</TableHead>
                <TableHead className="text-right">Checked in</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Missed</TableHead>
                <TableHead className="text-right">Still to come</TableHead>
                <TableHead className="text-right">As backup</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.map((t) => (
                <TableRow key={t.employee_id}>
                  <TableCell className="font-medium">{names.get(t.employee_id) ?? "Unknown"}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.shifts}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.attended}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.late}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.missed}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.upcoming}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.backup}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Past shifts</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts have finished in this month yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Block</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Check-ins</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {past.map((s) => {
                const primaries = s.assignments.filter((a) => a.role === "primary");
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <span
                          className="inline-block size-3 rounded-full"
                          style={{ backgroundColor: s.shift_templates?.colour ?? "#64748b" }}
                        />
                        {s.shift_templates?.code ?? "test"}
                      </span>
                    </TableCell>
                    <TableCell>{formatRangeIn(new Date(s.starts_at), new Date(s.ends_at), tz)}</TableCell>
                    <TableCell>
                      <ShiftChip status={shiftStatus(primaries, s, s.rules, now)} />
                    </TableCell>
                    <TableCell>
                      {s.assignments.length === 0 ? (
                        <span className="text-muted-foreground">Nobody was assigned</span>
                      ) : (
                        <ul className="space-y-1">
                          {s.assignments.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center gap-2">
                              <span className="min-w-24">{names.get(a.employee_id) ?? "Unknown"}</span>
                              {a.role === "backup" ? <Badge variant="outline">backup</Badge> : null}
                              {a.role === "backup" && !a.checked_in_at ? null : (
                                <AssignmentChip status={assignmentStatus(a, s, s.rules, now)} />
                              )}
                              {a.checked_in_at ? (
                                <span className="text-xs text-muted-foreground">
                                  {formatInstant(new Date(a.checked_in_at), tz)} ·{" "}
                                  {checkinDelayMinutes(a.checked_in_at, s) <= 0
                                    ? "on time"
                                    : `${checkinDelayMinutes(a.checked_in_at, s)} min after start`}
                                </span>
                              ) : null}
                              {wasLate(a.checked_in_at, s, s.rules) ? <Pill tone="amber">late</Pill> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
