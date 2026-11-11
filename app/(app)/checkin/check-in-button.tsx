"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatInstant } from "@/lib/rules/template";
import { checkInAction, type CheckInState } from "./actions";

function Message({ state, tz }: { state: NonNullable<CheckInState>; tz: string }) {
  const at = (iso?: string) => (iso ? formatInstant(new Date(iso), tz) : "");
  switch (state.status) {
    case "ok":
      return <p className="text-base font-medium text-emerald-700 dark:text-emerald-400">✓ You are checked in ({at(state.checkedInAt)}).</p>;
    case "already":
      return <p className="text-base font-medium text-emerald-700 dark:text-emerald-400">✓ You already checked in at {at(state.checkedInAt)}.</p>;
    case "too_early":
      return <p className="text-sm">Check-in is not open yet. It opens at {at(state.opensAt)}.</p>;
    case "closed":
      return <p className="text-sm text-destructive">Check-in closed at {at(state.closesAt)}. Tell your supervisor.</p>;
    case "not_yours":
      return <p className="text-sm text-destructive">This check-in link belongs to someone else.</p>;
    case "not_found":
      return <p className="text-sm text-destructive">This check-in link is no longer valid. Open My shifts instead.</p>;
    default:
      return <p className="text-sm text-destructive">Something went wrong. Please try again.</p>;
  }
}

/**
 * The Check in button. With `auto`, it checks in as soon as the page opens, so the link in the
 * calendar invite is one click; the button stays as the fallback (and for My shifts).
 */
export function CheckInButton({ token, tz, auto = false, big = false }: { token: string; tz: string; auto?: boolean; big?: boolean }) {
  const [state, formAction, pending] = useActionState(checkInAction, null);
  const started = useRef(false);

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    const fd = new FormData();
    fd.set("token", token);
    startTransition(() => formAction(fd));
  }, [auto, token, formAction]);

  const done = state?.status === "ok" || state?.status === "already";

  return (
    <div className="space-y-3">
      {state ? (
        <div role="status" aria-live="polite">
          <Message state={state} tz={tz} />
        </div>
      ) : null}
      {done ? null : (
        <form action={formAction}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" disabled={pending} size={big ? "lg" : "default"} className={big ? "h-14 w-full text-lg sm:w-auto sm:px-10" : ""}>
            {pending ? "Checking in…" : "Check in"}
          </Button>
        </form>
      )}
    </div>
  );
}
