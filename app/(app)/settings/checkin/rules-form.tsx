"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStatus, fieldError } from "@/components/form-status";
import { selectClass } from "@/components/form-styles";
import { setTemplateOverride, updateCheckinRules } from "./actions";

export type RuleValues = {
  open_before_min: number | null;
  close_rule: string | null;
  close_after_min: number | null;
  late_after_min: number | null;
  covered_rule: string | null;
  covered_min: number | null;
};

const text = (v: number | null) => (v === null ? "" : String(v));

/**
 * One form for both uses: the org default (every field required) and a block's override
 * (`templateId` set: every field optional, blank = inherit, with the default shown as a hint).
 */
export function RulesForm({
  values,
  templateId,
  defaults,
}: {
  values: RuleValues;
  templateId?: string;
  defaults?: RuleValues;
}) {
  const isOverride = templateId !== undefined;
  const [state, formAction, pending] = useActionState(isOverride ? setTemplateOverride : updateCheckinRules, null);
  const err = (name: string) => fieldError(state, name);
  const id = (name: string) => `${templateId ?? "org"}-${name}`;
  const hint = (v: number | string | null | undefined) => (isOverride && v != null ? `default ${v}` : undefined);

  const number = (name: keyof RuleValues, label: string, min: number, max: number, help: string) => (
    <div className="space-y-1">
      <Label htmlFor={id(name)}>{label}</Label>
      <Input
        id={id(name)}
        name={name}
        type="number"
        min={min}
        max={max}
        required={!isOverride}
        defaultValue={text(values[name] as number | null)}
        placeholder={hint(defaults?.[name])}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
      {err(name) ? <p className="text-xs text-destructive">{err(name)}</p> : null}
    </div>
  );

  const select = (name: "close_rule" | "covered_rule", label: string, options: [string, string][]) => (
    <div className="space-y-1">
      <Label htmlFor={id(name)}>{label}</Label>
      <select id={id(name)} name={name} defaultValue={values[name] ?? ""} className={selectClass}>
        {isOverride ? <option value="">Same as the default</option> : null}
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-3">
      {isOverride ? <input type="hidden" name="template_id" value={templateId} /> : null}

      {number("open_before_min", "Opens (min before start)", 0, 1440, "How early an agent can check in.")}
      {select("close_rule", "Closes", [
        ["shift_end", "When the shift ends"],
        ["after_start", "A set time after the start"],
      ])}
      {number("close_after_min", "Close after (min)", 1, 1440, "Only used with “a set time after the start”.")}
      {number("late_after_min", "Late after (min)", 0, 1440, "Not checked in by then = late.")}
      {select("covered_rule", "A shift is covered when", [
        ["all", "Everyone assigned has checked in"],
        ["at_least_n", "At least N have checked in"],
      ])}
      {number("covered_min", "N", 1, 20, "Only used with “at least N”.")}

      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : isOverride ? "Save override" : "Save default rules"}
        </Button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
