import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { effectiveTimeZone } from "@/lib/shifts";
import { formatRangeIn } from "@/lib/time";

export const metadata = { title: "My shifts · ShiftBoard" };

/**
 * An agent's own shifts. RLS does the filtering: the assignments policy only returns their own
 * rows, and the shifts policy only returns shifts they are assigned to. The check-in button
 * arrives in M4.
 */
export default async function MyShiftsPage() {
  const employee = await requireEmployee();
  const supabase = await createClient();
  const now = new Date();

  const [orgRes, prefsRes, rowsRes] = await Promise.all([
    supabase.from("org_settings").select("client_tz, default_display_tz").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", employee.id).maybeSingle(),
    supabase
      .from("assignments")
      .select(
        "id, role, checked_in_at, shifts!inner(id, starts_at, ends_at, shift_templates(code, name, colour, timezone))",
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
  const rows = rowsRes.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My shifts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your upcoming shifts, in {displayTz} and in the client&apos;s time zone.
        </p>
      </div>

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
              <TableHead>Checked in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const shift = a.shifts;
              const tpl = shift.shift_templates;
              const start = new Date(shift.starts_at);
              const end = new Date(shift.ends_at);
              const clientTz = tpl ? effectiveTimeZone(tpl, org) : org.client_tz;
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
                    <div className="text-xs text-muted-foreground">{tpl?.name}</div>
                  </TableCell>
                  <TableCell>{formatRangeIn(start, end, displayTz)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatRangeIn(start, end, clientTz)}</TableCell>
                  <TableCell>
                    {a.role === "backup" ? <Badge variant="outline">backup</Badge> : <Badge variant="secondary">primary</Badge>}
                  </TableCell>
                  <TableCell>{a.checked_in_at ? "Yes" : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
