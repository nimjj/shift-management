"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeZoneInput } from "@/components/timezone-input";
import { selectClass } from "@/components/form-styles";
import type { OrgSettings } from "@/lib/database.types";
import { WEEKDAY_NAMES } from "@/lib/time";
import { updateGeneral } from "./actions";

export function GeneralForm({ settings }: { settings: OrgSettings }) {
  const [state, formAction, pending] = useActionState(updateGeneral, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="org_name">Organisation name</Label>
        <Input id="org_name" name="org_name" defaultValue={settings.org_name} required />
        {err("org_name") ? <p className="text-xs text-destructive">{err("org_name")}</p> : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="client_tz">Client time zone</Label>
        <TimeZoneInput id="client_tz" name="client_tz" listId="tz-client" defaultValue={settings.client_tz} required />
        <p className="text-xs text-muted-foreground">
          Shift blocks are defined in this zone. Changing it affects shifts generated from now on; existing shifts keep
          their times until you regenerate them.
        </p>
        {err("client_tz") ? <p className="text-xs text-destructive">{err("client_tz")}</p> : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="default_display_tz">Default display time zone</Label>
        <TimeZoneInput
          id="default_display_tz"
          name="default_display_tz"
          listId="tz-display"
          defaultValue={settings.default_display_tz}
          required
        />
        <p className="text-xs text-muted-foreground">What agents see, unless they set their own in Employees.</p>
        {err("default_display_tz") ? <p className="text-xs text-destructive">{err("default_display_tz")}</p> : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="week_start">Week starts on</Label>
        <select id="week_start" name="week_start" defaultValue={String(settings.week_start)} className={selectClass}>
          {WEEKDAY_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="allowed_domains">Allowed email domains</Label>
        <Input id="allowed_domains" name="allowed_domains" defaultValue={settings.allowed_domains.join(", ")} required />
        <p className="text-xs text-muted-foreground">
          Comma-separated. Only these domains can sign in (and be added as employees). You can&apos;t remove your own
          domain.
        </p>
        {err("allowed_domains") ? <p className="text-xs text-destructive">{err("allowed_domains")}</p> : null}
      </div>

      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {state?.ok ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
        {state && !state.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
