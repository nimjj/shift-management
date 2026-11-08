"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { applyRegenerationAction } from "../actions";

export function ApplyForm({ hash, total }: { hash: string; total: number }) {
  const [state, formAction, pending] = useActionState(applyRegenerationAction, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="hash" value={hash} />
      <Button type="submit" disabled={pending || total === 0}>
        {pending ? "Applying…" : `Apply ${total} change${total === 1 ? "" : "s"}`}
      </Button>
      {state?.ok ? (
        <p className="text-sm text-muted-foreground">
          Done: {state.data.moved} moved, {state.data.added} added, {state.data.removed} removed.
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
