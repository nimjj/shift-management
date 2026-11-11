"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStatus, fieldError } from "@/components/form-status";
import { selectClass } from "@/components/form-styles";
import { Pill } from "@/components/status-chip";
import { PLACEHOLDERS, unknownPlaceholders } from "@/lib/rules/template";
import {
  CHANNELS,
  CONDITION_LABEL,
  RECIPIENT_LABEL,
  RECIPIENT_TYPES,
  RULE_CONDITIONS,
  type RecipientType,
  type RuleCondition,
} from "@/lib/rules/types";
import type { NotificationRule } from "@/lib/database.types";
import { deleteRule, moveRule, saveRule, sendTestRule } from "./actions";

export type RuleOptions = {
  employees: { id: string; full_name: string }[];
  groups: { id: string; name: string }[];
  templates: { id: string; code: string; name: string }[];
};

const BLANK = {
  name: "",
  trigger_minutes: 10,
  condition: "agent_missing",
  condition_n: null as number | null,
  recipient_type: "missing_agents",
  recipient_ids: [] as string[],
  recipient_role: null as string | null,
  channels: ["email", "telegram"],
  message_tpl: "⏰ Block {block} started at {start_local}. Please check in: {checkin_link}",
  template_scope: null as string[] | null,
  enabled: true,
  critical: false,
};

function summary(rule: NotificationRule, options: RuleOptions): string {
  const when = `+${rule.trigger_minutes} min`;
  const condition =
    rule.condition === "fewer_than_n"
      ? `fewer than ${rule.condition_n} have checked in`
      : CONDITION_LABEL[rule.condition as RuleCondition];
  const pick = <T extends { id: string }>(list: T[], label: (x: T) => string) =>
    rule.recipient_ids.map((id) => {
      const hit = list.find((x) => x.id === id);
      return hit ? label(hit) : "(removed)";
    });
  let to = RECIPIENT_LABEL[rule.recipient_type as RecipientType] ?? rule.recipient_type;
  if (rule.recipient_type === "employees") to = pick(options.employees, (e) => e.full_name).join(", ");
  if (rule.recipient_type === "group") to = `group ${pick(options.groups, (g) => g.name).join(", ")}`;
  if (rule.recipient_type === "role") to = `every ${rule.recipient_role}`;
  const scope = rule.template_scope
    ? ` · only ${rule.template_scope.map((id) => options.templates.find((t) => t.id === id)?.code ?? "?").join(", ")}`
    : "";
  return `${when} · if ${condition} · to ${to} · ${rule.channels.join(" + ")}${scope}`;
}

/** Add or edit a stage. `rule` undefined = a new one. */
export function RuleForm({ rule, options, onDone }: { rule?: NotificationRule; options: RuleOptions; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState(saveRule, null);
  const initial = rule ?? BLANK;
  const [condition, setCondition] = useState(initial.condition);
  const [recipientType, setRecipientType] = useState(initial.recipient_type);
  const [message, setMessage] = useState(initial.message_tpl);
  const err = (name: string) => fieldError(state, name);
  const uid = rule?.id ?? "new";
  const unknown = unknownPlaceholders(message);

  useEffect(() => {
    if (state?.ok) onDone?.();
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${uid}-name`}>Name</Label>
          <Input id={`${uid}-name`} name="name" defaultValue={initial.name} maxLength={80} required />
          {err("name") ? <p className="text-xs text-destructive">{err("name")}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${uid}-trigger`}>Minutes after the start</Label>
          <Input id={`${uid}-trigger`} name="trigger_minutes" type="number" min={0} max={1440} defaultValue={initial.trigger_minutes} required />
          {err("trigger_minutes") ? <p className="text-xs text-destructive">{err("trigger_minutes")}</p> : null}
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${uid}-condition`}>Fire if</Label>
          <select id={`${uid}-condition`} name="condition" className={selectClass} value={condition} onChange={(e) => setCondition(e.target.value)}>
            {RULE_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {condition === "agent_missing"
              ? "Checked per agent: fires once for each one who has not checked in."
              : "Checked per shift: fires once for the shift. Only primary agents count."}
          </p>
        </div>
        {condition === "fewer_than_n" ? (
          <div className="space-y-1">
            <Label htmlFor={`${uid}-n`}>N</Label>
            <Input id={`${uid}-n`} name="condition_n" type="number" min={1} max={20} defaultValue={initial.condition_n ?? 1} required />
            {err("condition_n") ? <p className="text-xs text-destructive">{err("condition_n")}</p> : null}
          </div>
        ) : null}

        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor={`${uid}-rtype`}>Send to</Label>
          <select id={`${uid}-rtype`} name="recipient_type" className={`${selectClass} sm:w-72`} value={recipientType} onChange={(e) => setRecipientType(e.target.value)}>
            {RECIPIENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {RECIPIENT_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        {recipientType === "employees" ? (
          <fieldset className="space-y-1 sm:col-span-3">
            <legend className="text-sm font-medium">People</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {options.employees.map((e) => (
                <label key={e.id} className="flex items-center gap-2">
                  <input type="checkbox" name="employee_ids" value={e.id} className="size-4" defaultChecked={initial.recipient_type === "employees" && initial.recipient_ids.includes(e.id)} />
                  {e.full_name}
                </label>
              ))}
            </div>
            {err("employee_ids") ? <p className="text-xs text-destructive">{err("employee_ids")}</p> : null}
          </fieldset>
        ) : null}

        {recipientType === "group" ? (
          <fieldset className="space-y-1 sm:col-span-3">
            <legend className="text-sm font-medium">Groups</legend>
            {options.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups yet. Create one under Settings › Groups.</p>
            ) : (
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {options.groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2">
                    <input type="checkbox" name="group_ids" value={g.id} className="size-4" defaultChecked={initial.recipient_type === "group" && initial.recipient_ids.includes(g.id)} />
                    {g.name}
                  </label>
                ))}
              </div>
            )}
            {err("group_ids") ? <p className="text-xs text-destructive">{err("group_ids")}</p> : null}
          </fieldset>
        ) : null}

        {recipientType === "role" ? (
          <div className="space-y-1">
            <Label htmlFor={`${uid}-role`}>Role</Label>
            <select id={`${uid}-role`} name="recipient_role" className={selectClass} defaultValue={initial.recipient_role ?? "supervisor"}>
              <option value="supervisor">Supervisors</option>
              <option value="agent">Agents</option>
            </select>
          </div>
        ) : null}

        <fieldset className="space-y-1 sm:col-span-3">
          <legend className="text-sm font-medium">Channels</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input type="checkbox" name="channels" value={c} className="size-4" defaultChecked={initial.channels.includes(c)} />
                {c === "email" ? "Email" : "Telegram"}
              </label>
            ))}
          </div>
          {err("channels") ? <p className="text-xs text-destructive">{err("channels")}</p> : null}
        </fieldset>

        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor={`${uid}-tpl`}>Message</Label>
          <textarea
            id={`${uid}-tpl`}
            name="message_tpl"
            rows={3}
            maxLength={2000}
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">Placeholders: {PLACEHOLDERS.map((p) => `{${p}}`).join("  ")}</p>
          {unknown.length > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Not a placeholder, will be sent as written: {unknown.map((p) => `{${p}}`).join(", ")}
            </p>
          ) : null}
          {err("message_tpl") ? <p className="text-xs text-destructive">{err("message_tpl")}</p> : null}
        </div>

        <fieldset className="space-y-1 sm:col-span-3">
          <legend className="text-sm font-medium">Blocks</legend>
          <p className="text-xs text-muted-foreground">Tick none to apply to every block (and test shifts).</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {options.templates.map((t) => (
              <label key={t.id} className="flex items-center gap-2">
                <input type="checkbox" name="template_scope" value={t.id} className="size-4" defaultChecked={initial.template_scope?.includes(t.id) ?? false} />
                {t.code}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm sm:col-span-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="enabled" className="size-4" defaultChecked={initial.enabled} />
            Enabled
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="critical" className="size-4" defaultChecked={initial.critical} />
            Critical (ignores quiet hours and people&apos;s channel choices)
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : rule ? "Save stage" : "Add stage"}
        </Button>
        {onDone ? (
          <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        ) : null}
        <FormStatus state={state} />
      </div>
    </form>
  );
}

function SmallAction({
  action,
  id,
  label,
  pendingLabel,
  extra,
  disabled,
}: {
  action: typeof deleteRule;
  id: string;
  label: string;
  pendingLabel: string;
  extra?: Record<string, string>;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" size="xs" variant="outline" disabled={pending || disabled} aria-label={label}>
        {pending ? pendingLabel : label}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function RuleCard({
  rule,
  options,
  index,
  count,
}: {
  rule: NotificationRule;
  options: RuleOptions;
  index: number;
  count: number;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [test, testAction, testing] = useActionState(sendTestRule, null);

  return (
    <Card className={rule.enabled ? "" : "opacity-70"}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="text-muted-foreground">{index + 1}.</span>
          {rule.name}
          {rule.enabled ? null : <Pill>disabled</Pill>}
          {rule.critical ? <Pill tone="red">critical</Pill> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{summary(rule, options)}</p>
        <p className="rounded-lg bg-muted/50 p-2 text-sm whitespace-pre-wrap">{rule.message_tpl}</p>

        <div className="flex flex-wrap items-center gap-2">
          <SmallAction action={moveRule} id={rule.id} label="↑ Earlier" pendingLabel="…" extra={{ direction: "up" }} disabled={index === 0} />
          <SmallAction action={moveRule} id={rule.id} label="↓ Later" pendingLabel="…" extra={{ direction: "down" }} disabled={index === count - 1} />
          <Button size="xs" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
          <form action={testAction} className="inline-flex">
            <input type="hidden" name="id" value={rule.id} />
            <Button type="submit" size="xs" variant="outline" disabled={testing}>
              {testing ? "Sending…" : "Send test to me"}
            </Button>
          </form>
          {confirming ? (
            <>
              <SmallAction action={deleteRule} id={rule.id} label="Yes, delete" pendingLabel="Deleting…" />
              <Button size="xs" variant="outline" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button size="xs" variant="outline" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>

        {test?.ok ? (
          <ul className="text-sm" role="status">
            {test.data.length === 0 ? <li>This stage has no channels.</li> : null}
            {test.data.map((r) => (
              <li key={r.channel} className={r.ok ? "text-muted-foreground" : "text-destructive"}>
                {r.channel === "email" ? "Email" : "Telegram"}: {r.detail}
              </li>
            ))}
          </ul>
        ) : null}
        {test && !test.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {test.error}
          </p>
        ) : null}

        {editing ? (
          <div className="border-t pt-4">
            <RuleForm key={rule.updated_at} rule={rule} options={options} onDone={() => setEditing(false)} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
