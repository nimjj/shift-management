import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { rulesByTemplate } from "@/lib/settings";
import { effectiveTimeZone } from "@/lib/shifts";
import { createClient } from "@/lib/supabase/server";
import { formatRangeIn } from "@/lib/time";
import { DashboardLive, type DashShift } from "./dashboard/dashboard-live";

export const metadata = { title: "Dashboard · ShiftBoard" };

const UPCOMING_LIMIT = 30;

/** Home. Supervisors get the live dashboard; agents go straight to their own shifts. */
export default async function HomePage() {
  const employee = await requireEmployee();
  if (employee.role !== "supervisor") redirect("/my-shifts");

  const supabase = await createClient();
  const now = new Date();

  const [orgRes, prefsRes, overridesRes, shiftsRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", employee.id).maybeSingle(),
    supabase.from("template_overrides").select("*"),
    supabase
      .from("shifts")
      .select(
        "id, template_id, starts_at, ends_at, is_test, shift_templates(code, name, colour, timezone, required_headcount), assignments(id, role, checked_in_at, employees!assignments_employee_id_fkey(full_name))",
      )
      .gt("ends_at", now.toISOString())
      .order("starts_at")
      .limit(UPCOMING_LIMIT),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (shiftsRes.error) throw shiftsRes.error;

  const org = orgRes.data;
  const tz = prefsRes.data?.display_tz ?? org.default_display_tz;
  const rulesFor = rulesByTemplate(org, overridesRes.data ?? []);

  const shifts: DashShift[] = shiftsRes.data.map((s) => {
    const tpl = s.shift_templates;
    const start = new Date(s.starts_at);
    const end = new Date(s.ends_at);
    return {
      id: s.id,
      block: tpl?.code ?? "test",
      name: tpl?.name ?? "Test shift",
      colour: tpl?.colour ?? "#64748b",
      isTest: s.is_test,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      displayRange: formatRangeIn(start, end, tz),
      clientRange: formatRangeIn(start, end, tpl ? effectiveTimeZone(tpl, org) : org.client_tz),
      required: tpl?.required_headcount ?? 1,
      rules: rulesFor(s.template_id),
      assignees: s.assignments
        .map((a) => ({
          id: a.id,
          name: a.employees?.full_name ?? "Unknown",
          role: a.role,
          checked_in_at: a.checked_in_at,
        }))
        .sort((x, y) => x.role.localeCompare(y.role) * -1 || x.name.localeCompare(y.name)),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who is on, who has checked in, and what is coming up.</p>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href="/grid" className="underline underline-offset-4">
            Assignment grid
          </Link>
          <Link href="/history" className="underline underline-offset-4">
            History
          </Link>
        </nav>
      </div>

      <DashboardLive shifts={shifts} tz={tz} serverNow={now.toISOString()} />
    </div>
  );
}
