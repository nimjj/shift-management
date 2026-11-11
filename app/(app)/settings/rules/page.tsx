import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IntegrationNotice } from "@/components/integration-notice";
import { Pill } from "@/components/status-chip";
import { requireSupervisor } from "@/lib/auth";
import { integrationStatus } from "@/lib/env";
import { formatInstant } from "@/lib/rules/template";
import { createClient } from "@/lib/supabase/server";
import { RuleCard, RuleForm, type RuleOptions } from "./rule-card";

export const metadata = { title: "Notification rules · ShiftBoard" };

const STATUS_TONE = { sent: "green", failed: "red", suppressed: "grey" } as const;

export default async function NotificationRulesPage() {
  const actor = await requireSupervisor();
  const supabase = await createClient();
  const status = integrationStatus();

  const [rulesRes, employeesRes, groupsRes, templatesRes, alertsRes, orgRes, prefsRes] = await Promise.all([
    supabase.from("notification_rules").select("*").order("position").order("created_at"),
    supabase.from("employees").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("notification_groups").select("id, name").order("name"),
    supabase.from("shift_templates").select("id, code, name").order("code"),
    supabase
      .from("alerts")
      .select("id, rule_name, recipient, channel, status, error, is_test, sent_at, employees(full_name)")
      .order("sent_at", { ascending: false })
      .limit(25),
    supabase.from("org_settings").select("default_display_tz").eq("id", 1).single(),
    supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", actor.id).maybeSingle(),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (employeesRes.error) throw employeesRes.error;
  if (groupsRes.error) throw groupsRes.error;
  if (templatesRes.error) throw templatesRes.error;
  if (orgRes.error) throw orgRes.error;

  const options: RuleOptions = {
    employees: employeesRes.data,
    groups: groupsRes.data,
    templates: templatesRes.data,
  };
  const rules = rulesRes.data;
  const tz = prefsRes.data?.display_tz ?? orgRes.data.default_display_tz;
  const alerts = alertsRes.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Escalation ladder</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Checked every minute while a shift is running. Each stage fires once per shift (or once per agent for
          &ldquo;this agent has not checked in&rdquo;). Changes apply from the next minute.
        </p>
      </div>

      <IntegrationNotice
        items={[
          { ok: status.cron, label: "The every-minute checker", missing: "CRON_SECRET" },
          { ok: status.email, label: "Email", missing: "GOOGLE_SERVICE_ACCOUNT_JSON, ALERT_EMAIL_SENDER" },
          { ok: status.telegram, label: "Telegram", missing: "TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME" },
        ]}
      />

      {rules.length === 0 ? <p className="text-sm text-muted-foreground">No stages yet. Add one below.</p> : null}
      {rules.map((rule, index) => (
        <RuleCard key={rule.id} rule={rule} options={options} index={index} count={rules.length} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a stage</CardTitle>
          <CardDescription>It is added at the end of the ladder; move it with the arrows.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* key: a fresh blank form after each stage is added */}
          <RuleForm key={`new-${rules.length}`} options={options} />
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-base font-medium">Recent alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When ({tz})</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap">{formatInstant(new Date(a.sent_at), tz)}</TableCell>
                  <TableCell>
                    {a.rule_name} {a.is_test ? <Pill tone="blue">test</Pill> : null}
                  </TableCell>
                  <TableCell>{a.employees?.full_name ?? a.recipient}</TableCell>
                  <TableCell>{a.channel}</TableCell>
                  <TableCell>
                    <Pill tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "grey"}>{a.status}</Pill>
                    {a.error ? <div className="mt-1 max-w-md text-xs text-muted-foreground">{a.error}</div> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
