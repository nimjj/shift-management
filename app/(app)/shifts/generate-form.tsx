"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateShiftsAction } from "./actions";

export function GenerateForm() {
  const [state, formAction, pending] = useActionState(generateShiftsAction, null);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="weeks">Weeks to generate</Label>
        <Input id="weeks" name="weeks" type="number" min={1} max={26} defaultValue={4} className="w-28" required />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Generating…" : "Generate shifts"}
      </Button>
      {state?.ok ? (
        <p className="text-sm text-muted-foreground">
          Created {state.data.inserted} new shift{state.data.inserted === 1 ? "" : "s"}
          {state.data.skipped > 0 ? ` (${state.data.skipped} already existed)` : ""}.
        </p>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
