import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSupervisor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmployeePrefsRow, GroupForm, type PrefsRow } from "./group-forms";

export const metadata = { title: "Groups & subscriptions · ShiftBoard" };

export default async function GroupsPage() {
  await requireSupervisor();
  const supabase = await createClient();

  const [groupsRes, membersRes, employeesRes] = await Promise.all([
    supabase.from("notification_groups").select("id, name").order("name"),
    supabase.from("notification_group_members").select("group_id, employee_id"),
    supabase
      .from("employees")
      .select("id, full_name, role, telegram_chat_id, employee_notification_prefs(channels, quiet_hours_start, quiet_hours_end)")
      .eq("active", true)
      .order("full_name"),
  ]);
  if (groupsRes.error) throw groupsRes.error;
  if (membersRes.error) throw membersRes.error;
  if (employeesRes.error) throw employeesRes.error;

  const people = employeesRes.data.map((e) => ({ id: e.id, full_name: e.full_name }));
  const membersOf = (groupId: string) => membersRes.data.filter((m) => m.group_id === groupId).map((m) => m.employee_id);

  const prefs: PrefsRow[] = employeesRes.data.map((e) => ({
    id: e.id,
    full_name: e.full_name,
    role: e.role,
    telegramLinked: e.telegram_chat_id !== null,
    channels: e.employee_notification_prefs?.channels ?? ["email", "telegram"],
    quietStart: e.employee_notification_prefs?.quiet_hours_start ?? null,
    quietEnd: e.employee_notification_prefs?.quiet_hours_end ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Notification groups</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A named list of people a notification stage can send to, for example &ldquo;Weekend supervisors&rdquo;. People
          can also join or leave a group themselves under My notifications.
        </p>
      </div>

      {groupsRes.data.map((g) => {
        const memberIds = membersOf(g.id);
        return (
          <Card key={g.id}>
            <CardHeader>
              <CardTitle className="text-base">{g.name}</CardTitle>
              <CardDescription>
                {memberIds.length} member{memberIds.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GroupForm key={`${g.id}-${g.name}-${memberIds.join(",")}`} group={{ ...g, memberIds }} people={people} />
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a group</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupForm key={`new-${groupsRes.data.length}`} people={people} />
        </CardContent>
      </Card>

      <div>
        <h2 className="text-base font-medium">Channels and quiet hours</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each person sets these under My notifications; you can override them here. During quiet hours (in the
          person&apos;s own time zone) only stages marked critical get through.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Connected</TableHead>
            <TableHead>Accepts</TableHead>
            <TableHead>Quiet hours</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {prefs.map((row) => (
            <EmployeePrefsRow key={`${row.id}-${row.channels.join()}-${row.quietStart}-${row.quietEnd}`} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
