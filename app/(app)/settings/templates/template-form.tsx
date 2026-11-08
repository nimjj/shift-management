"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeZoneInput } from "@/components/timezone-input";
import { BLOCK_COLOURS, selectClass } from "@/components/form-styles";
import type { ShiftTemplate } from "@/lib/database.types";
import { normaliseTime, WEEKDAY_NAMES } from "@/lib/time";
import type { FormState } from "./actions";

export function TemplateForm({
  template,
  action,
  submitLabel,
  clientTz,
  onDone,
}: {
  template?: ShiftTemplate;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  clientTz: string;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const uid = template?.id ?? "new";

  useEffect(() => {
    if (state?.ok) onDone?.();
  }, [state, onDone]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];
  const colour = template?.colour ?? BLOCK_COLOURS[0];

  const weekdaySelect = (name: string, value: number) => (
    <select id={`${name}-${uid}`} name={name} defaultValue={String(value)} className={selectClass}>
      {WEEKDAY_NAMES.map((n, i) => (
        <option key={n} value={i}>
          {n}
        </option>
      ))}
    </select>
  );

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-6">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}

      <div className="space-y-1 sm:col-span-1">
        <Label htmlFor={`code-${uid}`}>Code</Label>
        <Input id={`code-${uid}`} name="code" defaultValue={template?.code} placeholder="2a" maxLength={8} required />
        {err("code") ? <p className="text-xs text-destructive">{err("code")}</p> : null}
      </div>

      <div className="space-y-1 sm:col-span-3">
        <Label htmlFor={`name-${uid}`}>Name</Label>
        <Input id={`name-${uid}`} name="name" defaultValue={template?.name} placeholder="Block 2a · Sat AM" required />
        {err("name") ? <p className="text-xs text-destructive">{err("name")}</p> : null}
      </div>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`headcount-${uid}`}>Required headcount</Label>
        <Input
          id={`headcount-${uid}`}
          name="required_headcount"
          type="number"
          min={1}
          max={10}
          defaultValue={template?.required_headcount ?? 1}
          required
        />
        {err("required_headcount") ? <p className="text-xs text-destructive">{err("required_headcount")}</p> : null}
      </div>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`start_weekday-${uid}`}>Starts on</Label>
        {weekdaySelect("start_weekday", template?.start_weekday ?? 5)}
      </div>
      <div className="space-y-1 sm:col-span-1">
        <Label htmlFor={`start_time-${uid}`}>at</Label>
        <Input
          id={`start_time-${uid}`}
          name="start_time"
          type="time"
          defaultValue={template ? normaliseTime(template.start_local_time) : "16:00"}
          required
        />
        {err("start_time") ? <p className="text-xs text-destructive">{err("start_time")}</p> : null}
      </div>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`end_weekday-${uid}`}>Ends on</Label>
        {weekdaySelect("end_weekday", template?.end_weekday ?? 5)}
      </div>
      <div className="space-y-1 sm:col-span-1">
        <Label htmlFor={`end_time-${uid}`}>at</Label>
        <Input
          id={`end_time-${uid}`}
          name="end_time"
          type="time"
          defaultValue={template ? normaliseTime(template.end_local_time) : "22:00"}
          required
        />
        {err("end_time") ? <p className="text-xs text-destructive">{err("end_time")}</p> : null}
      </div>

      <div className="space-y-1 sm:col-span-3">
        <Label htmlFor={`timezone-${uid}`}>Time zone (optional)</Label>
        <TimeZoneInput
          id={`timezone-${uid}`}
          name="timezone"
          listId={`tz-${uid}`}
          defaultValue={template?.timezone ?? ""}
          placeholder={`Blank = follow client zone (${clientTz})`}
        />
        {err("timezone") ? <p className="text-xs text-destructive">{err("timezone")}</p> : null}
      </div>

      <fieldset className="space-y-1 sm:col-span-3">
        <legend className="text-sm font-medium">Colour</legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {BLOCK_COLOURS.map((c) => (
            <label key={c} className="cursor-pointer">
              <input type="radio" name="colour" value={c} defaultChecked={c === colour} className="peer sr-only" />
              <span
                className="block size-6 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2"
                style={{ backgroundColor: c }}
                title={c}
              />
            </label>
          ))}
        </div>
        {err("colour") ? <p className="text-xs text-destructive">{err("colour")}</p> : null}
      </fieldset>

      <label className="flex items-center gap-2 text-sm sm:col-span-6">
        <input type="checkbox" name="active" defaultChecked={template?.active ?? true} />
        Active (untick to archive: no new shifts are generated for an archived block)
      </label>

      <div className="flex items-center gap-3 sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {state && !state.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
