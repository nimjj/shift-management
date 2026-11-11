import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignmentChip } from "@/components/status-chip";
import { requireEmployee } from "@/lib/auth";
import { formatInstant } from "@/lib/rules/template";
import { rulesByTemplate } from "@/lib/settings";
import { effectiveTimeZone } from "@/lib/shifts";
import { assignmentStatus, canCheckIn, checkinWindow } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatRangeIn } from "@/lib/time";
import { CheckInButton } from "../checkin/check-in-button";

export const metadata = { title: "My shifts · ShiftBoard" };

/**
 * An agent's own shifts, with a big Check in button while a check-in window is open (the backup
 * path when the calendar link is not to hand). RLS does the filtering: the assignments policy only
 * returns their own rows, and the shifts policy only returns shifts they are assigned to.
 */
export default async function MyShiftsPage() {
  const employee = await requireEmployee();
  const supabase = await createClient();
  const now = new Date();

  const [orgRes, prefsRes, overridesRes, rowsRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", employee.id).maybeSingle(),
    supabase.from("template_overrides").select("*"),
    supabase
      .from("assignments")
      .select(
        "id, role, checked_in_at, checkin_token, shifts!inner(id, template_id, starts_at, ends_at, shift_templates(code, name, colour, timezone))",
      )
      .eq("employee_id", employee.id)
      .gt("shifts.ends_at", now.toISOString())
      .order("starts_at", { referencedTable: "shifts" })
      .limit(100),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (rowsRes.error) throw rowsRes.error;

  const org = orgRes.data;
  const displayTz = prefsRes.data?.display_tz ?? org.default_display_tz;
  const rulesFor = rulesByTemplate(org, overridesRes.data ?? []);
  // PostgREST orders the embedded resource, not the parent rows, so sort here.
  const rows = (rowsRes.data ?? []).sort((a, b) => a.shifts.starts_at.localeCompare(b.shifts.starts_at));

  const open = rows.filter((a) => canCheckIn(a, a.shifts, rulesFor(a.shifts.template_id), now));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My shifts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your upcoming shifts, in {displayTz} and in the client&apos;s time zone.
        </p>
      </div>

      {open.map((a) => (
        <Card key={a.id} className="border-sky-300 dark:border-sky-800">
          <CardHeader>
            <CardTitle className="text-base">
              Block {a.shifts.shift_templates?.code ?? "test"} · check-in is open
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {formatRangeIn(new Date(a.shifts.starts_at), new Date(a.shifts.ends_at), displayTz)}
            </p>
            <CheckInButton token={a.checkin_token} tz={displayTz} big />
          </CardContent>
        </Card>
      ))}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no upcoming shifts.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Block</TableHead>
              <TableHead>{displayTz}</TableHead>
              <TableHead>Client time</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const shift = a.shifts;
              const tpl = shift.shift_templates;
              const start = new Date(shift.starts_at);
              const end = new Date(shift.ends_at);
              const clientTz = tpl ? effectiveTimeZone(tpl, org) : org.client_tz;
              const rules = rulesFor(shift.template_id);
              const status = assignmentStatus(a, shift, rules, now);
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <span
                        className="inline-block size-3 rounded-full"
                        style={{ backgroundColor: tpl?.colour ?? "#64748b" }}
                      />
                      {tpl?.code ?? "test"}
                    </span>
                    <div className="text-xs text-muted-foreground">{tpl?.name ?? "Test shift"}</div>
                  </TableCell>
                  <TableCell>{formatRangeIn(start, end, displayTz)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatRangeIn(start, end, clientTz)}</TableCell>
                  <TableCell>
                    {a.role === "backup" ? <Badge variant="outline">backup</Badge> : <Badge variant="secondary">primary</Badge>}
                  </TableCell>
                  <TableCell>
                    <AssignmentChip status={status} />
                    <div className="mt-1 text-xs text-muted-foreground">
                      {a.checked_in_at
                        ? formatInstant(new Date(a.checked_in_at), displayTz)
                        : status === "upcoming"
                          ? `Check-in opens ${formatInstant(checkinWindow(shift, rules).opensAt, displayTz)}`
                          : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
