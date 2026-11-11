"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStatus, fieldError } from "@/components/form-status";
import { CALENDAR_PLACEHOLDER_LIST } from "@/lib/calendar-placeholders";
import type { OrgSettings } from "@/lib/database.types";
import { unknownPlaceholders } from "@/lib/rules/template";
import { updateCalendarSettings } from "./actions";

const textarea =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CalendarForm({ settings }: { settings: OrgSettings }) {
  const [state, formAction, pending] = useActionState(updateCalendarSettings, null);
  const [title, setTitle] = useState(settings.calendar_title_tpl);
  const [desc, setDesc] = useState(settings.calendar_desc_tpl);
  const err = (name: string) => fieldError(state, name);
  const unknown = unknownPlaceholders(`${title} ${desc}`, CALENDAR_PLACEHOLDER_LIST);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="enabled" className="size-4" defaultChecked={settings.calendar_enabled} />
        Send a Google Calendar invite for every assignment
      </label>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="calendar_id">Calendar ID</Label>
        <Input
          id="calendar_id"
          name="calendar_id"
          defaultValue={settings.calendar_id ?? ""}
          placeholder="c_abc123…@group.calendar.google.com"
        />
        <p className="text-xs text-muted-foreground">
          Google Calendar › the shared &ldquo;Voicify Shifts&rdquo; calendar › Settings › Integrate calendar › Calendar ID. The
          calendar must belong to (or be writable by) the calendar owner account set on the server.
        </p>
        {err("calendar_id") ? <p className="text-xs text-destructive">{err("calendar_id")}</p> : null}
      </div>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="title_tpl">Event title</Label>
        <Input id="title_tpl" name="title_tpl" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        {err("title_tpl") ? <p className="text-xs text-destructive">{err("title_tpl")}</p> : null}
      </div>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="desc_tpl">Event description</Label>
        <textarea id="desc_tpl" name="desc_tpl" rows={5} maxLength={4000} value={desc} onChange={(e) => setDesc(e.target.value)} className={textarea} />
        <p className="text-xs text-muted-foreground">
          Placeholders: {CALENDAR_PLACEHOLDER_LIST.map((p) => `{${p}}`).join("  ")}. Keep {"{checkin_link}"} in the
          description: it is how agents check in.
        </p>
        {unknown.length > 0 ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Not a placeholder, will appear as written: {unknown.map((p) => `{${p}}`).join(", ")}
          </p>
        ) : null}
        {desc.includes("{checkin_link}") ? null : (
          <p className="text-xs text-amber-700 dark:text-amber-400">The description has no {"{checkin_link}"}.</p>
        )}
        {err("desc_tpl") ? <p className="text-xs text-destructive">{err("desc_tpl")}</p> : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="reminders">Reminders (minutes before)</Label>
        <Input id="reminders" name="reminders" defaultValue={settings.calendar_reminders_min.join(", ")} placeholder="30, 10" />
        <p className="text-xs text-muted-foreground">Comma-separated. Leave empty for none.</p>
        {err("reminders") ? <p className="text-xs text-destructive">{err("reminders")}</p> : null}
      </div>

      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save calendar settings"}
        </Button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
