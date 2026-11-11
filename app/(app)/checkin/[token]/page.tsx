import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireEmployee } from "@/lib/auth";
import { formatInstant } from "@/lib/rules/template";
import { effectiveRules } from "@/lib/settings";
import { effectiveTimeZone } from "@/lib/shifts";
import { checkinWindow } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatRangeIn } from "@/lib/time";
import { CheckInButton } from "../check-in-button";

export const metadata = { title: "Check in · ShiftBoard" };

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}

/**
 * The link in the calendar invite. Signed-out visitors are sent to Google sign-in by the proxy and
 * come back here. Row Level Security only returns the assignment to its own agent (or a
 * supervisor), and the check_in() function re-checks ownership and the window when it runs.
 */
export default async function CheckInPage({ params }: PageProps<"/checkin/[token]">) {
  const employee = await requireEmployee();
  const { token } = await params;
  const supabase = await createClient();
  const now = new Date();

  const valid = /^[0-9a-f]{32,128}$/.test(token);
  const [orgRes, prefsRes, rowRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", employee.id).maybeSingle(),
    valid
      ? supabase
          .from("assignments")
          .select(
            "id, employee_id, checked_in_at, role, employees!assignments_employee_id_fkey(full_name), shifts!inner(id, template_id, starts_at, ends_at, shift_templates(code, name, timezone))",
          )
          .eq("checkin_token", token)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (orgRes.error) throw orgRes.error;
  if (rowRes.error) throw rowRes.error;

  const row = rowRes.data;
  if (!row) {
    return (
      <Shell title="Check-in link not found">
        <p className="text-sm">
          This link is not for your account, or the shift was changed. Your current shifts are on{" "}
          <Link href="/my-shifts" className="underline underline-offset-4">
            My shifts
          </Link>
          .
        </p>
      </Shell>
    );
  }

  const org = orgRes.data;
  const tz = prefsRes.data?.display_tz ?? org.default_display_tz;
  const shift = row.shifts;
  const tpl = shift.shift_templates;
  const start = new Date(shift.starts_at);
  const end = new Date(shift.ends_at);

  const overrideRes = shift.template_id
    ? await supabase.from("template_overrides").select("*").eq("template_id", shift.template_id).maybeSingle()
    : { data: null };
  const rules = effectiveRules(org, overrideRes.data);
  const { opensAt, closesAt } = checkinWindow(shift, rules);

  const details = (
    <CardDescription className="space-y-1">
      <span className="block text-base font-medium text-foreground">
        Block {tpl?.code ?? "test"}
        {tpl?.name ? ` · ${tpl.name}` : ""}
      </span>
      <span className="block">{formatRangeIn(start, end, tz)}</span>
      <span className="block">{formatRangeIn(start, end, tpl ? effectiveTimeZone(tpl, org) : org.client_tz)} (client time)</span>
    </CardDescription>
  );

  if (row.employee_id !== employee.id) {
    return (
      <Shell title="Someone else's check-in link">
        {details}
        <p className="text-sm">
          This link checks in {row.employees?.full_name ?? "another agent"}. Only they can use it.
          {row.checked_in_at ? ` They checked in at ${formatInstant(new Date(row.checked_in_at), tz)}.` : " They have not checked in yet."}
        </p>
      </Shell>
    );
  }

  if (row.checked_in_at) {
    return (
      <Shell title="You are checked in">
        {details}
        <p className="text-base font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Checked in at {formatInstant(new Date(row.checked_in_at), tz)}.
        </p>
      </Shell>
    );
  }

  if (now < opensAt) {
    return (
      <Shell title="Check-in is not open yet">
        {details}
        <p className="text-sm">
          It opens at <strong>{formatInstant(opensAt, tz)}</strong>, {rules.openBeforeMin} minutes before your shift
          starts. Come back then and this link will check you in.
        </p>
      </Shell>
    );
  }

  if (now >= closesAt) {
    return (
      <Shell title="Check-in has closed">
        {details}
        <p className="text-sm text-destructive">
          Check-in for this shift closed at {formatInstant(closesAt, tz)}. Tell your supervisor if you worked it.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Check in to your shift">
      {details}
      <CheckInButton token={token} tz={tz} auto big />
    </Shell>
  );
}
