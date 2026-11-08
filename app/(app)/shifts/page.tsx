import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSupervisor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatDayIn,
  formatLocalDate,
  formatRangeIn,
  localDateIn,
  startOfWeek,
} from "@/lib/time";
import { GenerateForm } from "./generate-form";

export const metadata = { title: "Shifts · ShiftBoard" };

export default async function ShiftsPage() {
  const actor = await requireSupervisor();
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [orgRes, prefsRes, shiftsRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", actor.id).maybeSingle(),
    supabase
      .from("shifts")
      .select("id, starts_at, ends_at, occurrence_date, shift_templates(code, name, colour, timezone)")
      .gt("ends_at", nowIso)
      .order("starts_at")
      .limit(300),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (shiftsRes.error) throw shiftsRes.error;

  const org = orgRes.data;
  const displayTz = prefsRes.data?.display_tz ?? org.default_display_tz;
  const shifts = shiftsRes.data ?? [];

  // Group by week (week_start, in the client zone).
  const weeks = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const tz = s.shift_templates?.timezone ?? org.client_tz;
    const weekStart = formatLocalDate(startOfWeek(localDateIn(new Date(s.starts_at), tz), org.week_start));
    weeks.set(weekStart, [...(weeks.get(weekStart) ?? []), s]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Shifts</h1>
        <Link href="/shifts/regenerate" className="text-sm underline underline-offset-4">
          Review &amp; regenerate future shifts
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate shifts from your blocks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <GenerateForm />
          <p className="text-xs text-muted-foreground">
            Starts from the current week. Shifts that have already ended are skipped, and shifts that already exist are
            left alone, so it&apos;s safe to run again.
          </p>
        </CardContent>
      </Card>

      {shifts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming shifts yet. Generate some above.</p>
      ) : (
        [...weeks.entries()].map(([weekStart, rows]) => (
          <section key={weekStart} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Week of {formatDayIn(new Date(`${weekStart}T12:00:00Z`), "UTC")}
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Block</TableHead>
                  <TableHead>Client time ({org.client_tz})</TableHead>
                  <TableHead>{displayTz}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const start = new Date(s.starts_at);
                  const end = new Date(s.ends_at);
                  const tpl = s.shift_templates;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <span
                            className="inline-block size-3 rounded-full"
                            style={{ backgroundColor: tpl?.colour ?? "#64748b" }}
                          />
                          {tpl?.code ?? "test"}
                        </span>
                      </TableCell>
                      <TableCell>{formatRangeIn(start, end, tpl?.timezone ?? org.client_tz)}</TableCell>
                      <TableCell>{formatRangeIn(start, end, displayTz)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        ))
      )}
    </div>
  );
}
