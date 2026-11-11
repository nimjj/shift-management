import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IntegrationNotice } from "@/components/integration-notice";
import { requireSupervisor } from "@/lib/auth";
import { integrationStatus } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { CalendarForm } from "./calendar-form";

export const metadata = { title: "Calendar · ShiftBoard" };

export default async function CalendarSettingsPage() {
  await requireSupervisor();
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [orgRes, failedRes, pendingRes] = await Promise.all([
    supabase.from("org_settings").select("*").eq("id", 1).single(),
    supabase
      .from("assignments")
      .select("id, shifts!inner(ends_at)", { count: "exact", head: true })
      .eq("calendar_status", "failed")
      .gt("shifts.ends_at", nowIso),
    supabase
      .from("assignments")
      .select("id, shifts!inner(ends_at)", { count: "exact", head: true })
      .eq("calendar_status", "pending")
      .gt("shifts.ends_at", nowIso),
  ]);
  if (orgRes.error) throw orgRes.error;
  const settings = orgRes.data;

  return (
    <div className="space-y-6">
      <IntegrationNotice
        items={[
          {
            ok: integrationStatus().calendar,
            label: "Google Calendar",
            missing: "GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_OWNER",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar invites</CardTitle>
          <CardDescription>
            Each assignment becomes an event on the shared calendar with the agent as a guest. Unassigning cancels it.
            The roster is always saved first: if Google is unreachable the assignment shows &ldquo;invite failed&rdquo; on
            the grid with a Retry button, and the app keeps retrying in the background.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.calendar_enabled ? (
            <p className="text-sm text-muted-foreground">
              Upcoming shifts: {failedRes.count ?? 0} invite{failedRes.count === 1 ? "" : "s"} failed,{" "}
              {pendingRes.count ?? 0} waiting to be sent.
            </p>
          ) : null}
          <CalendarForm key={settings.updated_at} settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
