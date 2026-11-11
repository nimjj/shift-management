"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableRow } from "@/components/ui/table";
import { FormStatus, fieldError } from "@/components/form-status";
import { Pill } from "@/components/status-chip";
import { CHANNELS } from "@/lib/rules/types";
import { deleteGroup, saveGroup, updateEmployeePrefs } from "./actions";

type Person = { id: string; full_name: string };

export function GroupForm({
  group,
  people,
}: {
  group?: { id: string; name: string; memberIds: string[] };
  people: Person[];
}) {
  const [state, formAction, pending] = useActionState(saveGroup, null);
  const [del, deleteAction, deleting] = useActionState(deleteGroup, null);
  const [confirming, setConfirming] = useState(false);
  const uid = group?.id ?? "new";

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3">
        {group ? <input type="hidden" name="id" value={group.id} /> : null}
        <div className="space-y-1">
          <Label htmlFor={`${uid}-name`}>Group name</Label>
          <Input id={`${uid}-name`} name="name" defaultValue={group?.name ?? ""} maxLength={80} className="sm:w-80" required />
          {fieldError(state, "name") ? <p className="text-xs text-destructive">{fieldError(state, "name")}</p> : null}
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Members</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <input type="checkbox" name="member_ids" value={p.id} className="size-4" defaultChecked={group?.memberIds.includes(p.id) ?? false} />
                {p.full_name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : group ? "Save group" : "Add group"}
          </Button>
          <FormStatus state={state} />
        </div>
      </form>

      {group ? (
        <form action={deleteAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={group.id} />
          {confirming ? (
            <>
              <Button type="submit" size="xs" variant="outline" disabled={deleting}>
                {deleting ? "Deleting…" : "Yes, delete this group"}
              </Button>
              <Button type="button" size="xs" variant="outline" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button type="button" size="xs" variant="outline" onClick={() => setConfirming(true)}>
              Delete group
            </Button>
          )}
          {del && !del.ok ? (
            <span role="alert" className="text-xs text-destructive">
              {del.error}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export type PrefsRow = {
  id: string;
  full_name: string;
  role: string;
  telegramLinked: boolean;
  channels: string[];
  quietStart: string | null;
  quietEnd: string | null;
};

/** One employee's channels and quiet hours, editable by a supervisor. */
export function EmployeePrefsRow({ row }: { row: PrefsRow }) {
  const [state, formAction, pending] = useActionState(updateEmployeePrefs, null);
  const formId = `prefs-${row.id}`;

  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.full_name}
        <div className="text-xs font-normal text-muted-foreground">{row.role}</div>
      </TableCell>
      <TableCell>{row.telegramLinked ? <Pill tone="green">Telegram linked</Pill> : <Pill>Telegram not linked</Pill>}</TableCell>
      <TableCell>
        <form id={formId} action={formAction} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <input type="hidden" name="employee_id" value={row.id} />
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" name="channels" value={c} className="size-4" defaultChecked={row.channels.includes(c)} />
              {c === "email" ? "Email" : "Telegram"}
            </label>
          ))}
        </form>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Input form={formId} name="quiet_start" type="time" defaultValue={row.quietStart?.slice(0, 5) ?? ""} className="w-28" aria-label={`${row.full_name}: quiet hours start`} />
          <span className="text-muted-foreground">to</span>
          <Input form={formId} name="quiet_end" type="time" defaultValue={row.quietEnd?.slice(0, 5) ?? ""} className="w-28" aria-label={`${row.full_name}: quiet hours end`} />
        </div>
        {fieldError(state, "quiet_end") ? <p className="mt-1 text-xs text-destructive">{fieldError(state, "quiet_end")}</p> : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <FormStatus state={state} />
          <Button form={formId} type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
