import { requireSupervisor } from "@/lib/auth";
import {
  buildCells,
  gridRange,
  gridWeeks,
  templateWeekOrder,
  type AssignmentRole,
  type GridShift,
} from "@/lib/assignments";
import { rulesByTemplate } from "@/lib/settings";
import { assignmentStatus, shiftStatus } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { effectiveTimeZone } from "@/lib/shifts";
import { formatLocalDate, formatRangeIn, formatDayIn } from "@/lib/time";
import { GridView, type GridModel } from "./grid-view";

export const metadata = { title: "Assignment grid · ShiftBoard" };

export default async function GridPage({ searchParams }: PageProps<"/grid">) {
  const actor = await requireSupervisor();
  const supabase = await createClient();

  const raw = Number((await searchParams).w ?? 0);
  const offset = Number.isFinite(raw) ? Math.max(-52, Math.min(52, Math.trunc(raw))) : 0;
  const now = new Date();

  const [orgRes, prefsRes, templatesRes, employeesRes, overridesRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", actor.id).maybeSingle(),
    supabase.from("shift_templates").select("*").order("code"),
    supabase.from("employees").select("id, full_name, role").eq("active", true).order("full_name"),
    supabase.from("template_overrides").select("*"),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (templatesRes.error) throw templatesRes.error;
  if (employeesRes.error) throw employeesRes.error;

  const org = orgRes.data;
  const displayTz = prefsRes.data?.display_tz ?? org.default_display_tz;
  const rulesFor = rulesByTemplate(org, overridesRes.data ?? []);
  const weeks = gridWeeks(now, org, offset);
  const { from, to } = gridRange(weeks);

  const shiftsRes = await supabase
    .from("shifts")
    .select("id, template_id, occurrence_date, starts_at, ends_at, assignments(id, employee_id, role, checked_in_at, calendar_status, calendar_error)")
    .not("template_id", "is", null)
    .gte("occurrence_date", formatLocalDate(from))
    .lt("occurrence_date", formatLocalDate(to))
    .limit(2000);
  if (shiftsRes.error) throw shiftsRes.error;

  const shifts = shiftsRes.data ?? [];
  const cells = buildCells(shifts as GridShift[], weeks);

  // Only blocks that are active or that still have a shift on screen are worth a row.
  const onScreen = new Set(cells.keys());
  const templates = templatesRes.data
    .filter((t) => t.active || onScreen.has(t.id))
    .sort((a, b) => {
      const [aw, at] = templateWeekOrder(a, org.week_start);
      const [bw, bt] = templateWeekOrder(b, org.week_start);
      return aw - bw || at.localeCompare(bt) || a.code.localeCompare(b.code);
    });

  const byId = new Map(shifts.map((s) => [s.id, s]));

  const model: GridModel = {
    offset,
    clientTz: org.client_tz,
    displayTz,
    calendarEnabled: org.calendar_enabled,
    employees: employeesRes.data,
    weeks: weeks.map((w) => ({
      key: formatLocalDate(w),
      label: formatDayIn(new Date(`${formatLocalDate(w)}T12:00:00Z`), "UTC"),
    })),
    rows: templates.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      colour: t.colour,
      active: t.active,
      requiredHeadcount: t.required_headcount,
      cells: (cells.get(t.id) ?? new Array(weeks.length).fill(undefined)).map((shift) => {
        if (!shift) return null;
        const full = byId.get(shift.id)!;
        const start = new Date(full.starts_at);
        const end = new Date(full.ends_at);
        const rules = rulesFor(t.id);
        const all = full.assignments ?? [];
        return {
          shiftId: full.id,
          clientTime: formatRangeIn(start, end, effectiveTimeZone(t, org)),
          displayTime: formatRangeIn(start, end, displayTz),
          startsAt: full.starts_at,
          finished: end <= now,
          started: start <= now,
          status: shiftStatus(
            all.filter((a) => a.role === "primary"),
            full,
            rules,
            now,
          ),
          assignees: all
            .map((a) => ({
              assignmentId: a.id,
              employeeId: a.employee_id,
              role: a.role as AssignmentRole,
              checkedIn: a.checked_in_at !== null,
              status: assignmentStatus(a, full, rules, now),
              calendar: a.calendar_status,
              calendarError: a.calendar_error,
            }))
            .sort((x, y) => x.role.localeCompare(y.role) || x.employeeId.localeCompare(y.employeeId)),
        };
      }),
    })),
  };

  return <GridView model={model} />;
}
