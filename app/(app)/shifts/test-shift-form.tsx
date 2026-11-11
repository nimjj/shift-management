"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStatus, fieldError } from "@/components/form-status";
import { createTestShiftAction, deleteTestShiftAction } from "./actions";

export function TestShiftForm({ employees, selfId }: { employees: { id: string; full_name: string }[]; selfId: string }) {
  const [state, formAction, pending] = useActionState(createTestShiftAction, null);
  const err = (name: string) => fieldError(state, name);

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="space-y-1">
          <Label htmlFor="starts_in_min">Starts in (minutes)</Label>
          <Input id="starts_in_min" name="starts_in_min" type="number" min={-720} max={10080} defaultValue={-9} className="w-32" required />
          <p className="text-xs text-muted-foreground">Negative = already started.</p>
          {err("starts_in_min") ? <p className="text-xs text-destructive">{err("starts_in_min")}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="duration_min">Lasts (minutes)</Label>
          <Input id="duration_min" name="duration_min" type="number" min={5} max={1440} defaultValue={60} className="w-32" required />
          {err("duration_min") ? <p className="text-xs text-destructive">{err("duration_min")}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">Note (optional)</Label>
          <Input id="notes" name="notes" maxLength={200} className="w-56" />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who is on it</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {employees.map((e) => (
            <label key={e.id} className="flex items-center gap-2">
              <input type="checkbox" name="employee_id" value={e.id} defaultChecked={e.id === selfId} className="size-4" />
              {e.full_name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create test shift"}
        </Button>
        <FormStatus state={state} saved="Test shift created. It is on the dashboard and on each person's My shifts." />
      </div>
    </form>
  );
}

export function DeleteTestShiftButton({ shiftId }: { shiftId: string }) {
  const [state, formAction, pending] = useActionState(deleteTestShiftAction, null);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="shift_id" value={shiftId} />
      <Button type="submit" size="xs" variant="outline" disabled={pending}>
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
