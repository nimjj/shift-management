import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireEmployee } from "@/lib/auth";
import { integrationStatus } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { GroupToggle, PrefsForm, TelegramPanel } from "./notification-forms";

export const metadata = { title: "My notifications · ShiftBoard" };

export default async function NotificationsPage() {
  const employee = await requireEmployee();
  const supabase = await createClient();

  const [orgRes, prefsRes, groupsRes, mineRes] = await Promise.all([
    supabase.from("org_settings").select("default_display_tz").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("*").eq("employee_id", employee.id).maybeSingle(),
    supabase.from("notification_groups").select("id, name").order("name"),
    supabase.from("notification_group_members").select("group_id").eq("employee_id", employee.id),
  ]);
  if (orgRes.error) throw orgRes.error;

  const prefs = prefsRes.data;
  const mine = new Set((mineRes.data ?? []).map((m) => m.group_id));
  const groups = groupsRes.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reminders go to {employee.email}
          {employee.telegram_chat_id ? " and to Telegram." : "."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telegram</CardTitle>
        </CardHeader>
        <CardContent>
          <TelegramPanel linked={employee.telegram_chat_id !== null} available={integrationStatus().telegram} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <PrefsForm
            key={JSON.stringify(prefs ?? {})}
            channels={prefs?.channels ?? ["email", "telegram"]}
            quietStart={prefs?.quiet_hours_start ?? null}
            quietEnd={prefs?.quiet_hours_end ?? null}
            displayTz={prefs?.display_tz ?? null}
            defaultTz={orgRes.data.default_display_tz}
          />
        </CardContent>
      </Card>

      {groups.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Groups</CardTitle>
            <CardDescription>Some alerts are sent to a group. Join the ones you want to hear from.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {groups.map((g) => (
                <GroupToggle key={`${g.id}-${mine.has(g.id)}`} groupId={g.id} name={g.name} subscribed={mine.has(g.id)} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
