import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSupervisor } from "@/lib/auth";
import { effectiveTimeZone, scheduleOf } from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  formatRangeIn,
  localDateIn,
  normaliseTime,
  weeklyOccurrences,
  WEEKDAY_SHORT,
  zoneLabelIn,
} from "@/lib/time";
import { createTemplate } from "./actions";
import { TemplateForm } from "./template-form";
import { TemplateRow, type TemplateRowData } from "./template-row";

export const metadata = { title: "Shift templates · ShiftBoard" };

export default async function TemplatesPage() {
  await requireSupervisor();
  const supabase = await createClient();

  const [{ data: org, error: orgError }, { data: templates, error }] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("shift_templates").select("*"),
  ]);
  if (orgError) throw orgError;
  if (error) throw error;

  const now = new Date();
  const today = localDateIn(now, org.client_tz);

  // Order by position in the week (relative to week_start), then start time.
  const ordered = [...(templates ?? [])].sort(
    (a, b) =>
      ((a.start_weekday - org.week_start + 7) % 7) - ((b.start_weekday - org.week_start + 7) % 7) ||
      a.start_local_time.localeCompare(b.start_local_time),
  );

  const rows: TemplateRowData[] = ordered.map((template) => {
    const tz = effectiveTimeZone(template, org);
    const sched = scheduleOf(template);
    const first = weeklyOccurrences(sched, tz, today, addDays(today, 15)).find((o) => o.endsAt > now);
    return {
      template,
      schedule: `${WEEKDAY_SHORT[template.start_weekday]} ${normaliseTime(template.start_local_time)} – ${
        template.end_weekday === template.start_weekday ? "" : `${WEEKDAY_SHORT[template.end_weekday]} `
      }${normaliseTime(template.end_local_time)}`,
      zoneLabel: first ? zoneLabelIn(first.startsAt, tz) : tz,
      nextInDisplayZone: first ? formatRangeIn(first.startsAt, first.endsAt, org.default_display_tz) : null,
    };
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a block</CardTitle>
        </CardHeader>
        <CardContent>
          <TemplateForm action={createTemplate} submitLabel="Add block" clientTz={org.client_tz} />
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Times are in the client zone ({org.client_tz}) unless a block sets its own. The last column shows the next
          occurrence in {org.default_display_tz}, which moves with US daylight saving.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Next, in {org.default_display_tz}</TableHead>
              <TableHead>Headcount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TemplateRow key={r.template.id} row={r} clientTz={org.client_tz} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
