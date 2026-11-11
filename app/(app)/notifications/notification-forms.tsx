"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStatus, fieldError } from "@/components/form-status";
import { TimeZoneInput } from "@/components/timezone-input";
import { CHANNELS } from "@/lib/rules/types";
import {
  connectTelegram,
  disconnectTelegram,
  sendTelegramTest,
  setGroupSubscription,
  updateMyPrefs,
} from "./actions";

export function TelegramPanel({ linked, available }: { linked: boolean; available: boolean }) {
  const router = useRouter();
  const [connect, connectAction, connecting] = useActionState(connectTelegram, null);
  const [disconnect, disconnectAction, disconnecting] = useActionState(disconnectTelegram, null);
  const [test, testAction, testing] = useActionState(sendTelegramTest, null);
  const waiting = !linked && connect?.ok === true;

  // After the link is shown, look for the connection every few seconds (it happens in Telegram).
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  if (linked) {
    return (
      <div className="space-y-3">
        <p className="text-sm">✓ Telegram is connected. Shift reminders arrive there as well as by email.</p>
        <div className="flex flex-wrap items-center gap-3">
          <form action={testAction}>
            <Button type="submit" size="sm" variant="outline" disabled={testing}>
              {testing ? "Sending…" : "Send test message"}
            </Button>
          </form>
          <form action={disconnectAction}>
            <Button type="submit" size="sm" variant="outline" disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </form>
          <FormStatus state={test} saved="Sent. Check Telegram." />
          {disconnect && !disconnect.ok ? <FormStatus state={disconnect} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Get shift reminders on your phone. Press the button, then tap <strong>Start</strong> in Telegram.
      </p>
      {available ? (
        <form action={connectAction}>
          <Button type="submit" size="sm" disabled={connecting}>
            {connecting ? "Preparing…" : waiting ? "Get a new link" : "Connect Telegram"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Telegram is not set up on the server yet.</p>
      )}
      {connect?.ok ? (
        <div className="space-y-2 text-sm" role="status">
          <a href={connect.data.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open Telegram
          </a>
          <p className="text-muted-foreground">
            The link works once and expires in 15 minutes. This page updates by itself when you are connected.
          </p>
        </div>
      ) : null}
      {connect && !connect.ok ? <FormStatus state={connect} /> : null}
    </div>
  );
}

export function PrefsForm({
  channels,
  quietStart,
  quietEnd,
  displayTz,
  defaultTz,
}: {
  channels: string[];
  quietStart: string | null;
  quietEnd: string | null;
  displayTz: string | null;
  defaultTz: string;
}) {
  const [state, formAction, pending] = useActionState(updateMyPrefs, null);
  const err = (name: string) => fieldError(state, name);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <fieldset className="space-y-1 sm:col-span-2">
        <legend className="text-sm font-medium">Send my reminders by</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input type="checkbox" name="channels" value={c} className="size-4" defaultChecked={channels.includes(c)} />
              {c === "email" ? "Email" : "Telegram"}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Critical alerts are always sent, whatever you choose here.</p>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="quiet_start">Quiet hours from</Label>
        <Input id="quiet_start" name="quiet_start" type="time" defaultValue={quietStart?.slice(0, 5) ?? ""} className="w-32" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="quiet_end">until</Label>
        <Input id="quiet_end" name="quiet_end" type="time" defaultValue={quietEnd?.slice(0, 5) ?? ""} className="w-32" />
        {err("quiet_end") ? <p className="text-xs text-destructive">{err("quiet_end")}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        In your own time zone. Leave both empty for none. Reminders that fall in your quiet hours are not sent, so
        do not cover a time you are on shift.
      </p>

      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="display_tz">My time zone</Label>
        <TimeZoneInput id="display_tz" name="display_tz" listId="tz-mine" defaultValue={displayTz ?? ""} />
        <p className="text-xs text-muted-foreground">Leave empty to use the default ({defaultTz}).</p>
        {err("display_tz") ? <p className="text-xs text-destructive">{err("display_tz")}</p> : null}
      </div>

      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}

export function GroupToggle({ groupId, name, subscribed }: { groupId: string; name: string; subscribed: boolean }) {
  const [state, formAction, pending] = useActionState(setGroupSubscription, null);
  return (
    <li className="flex flex-wrap items-center gap-3 text-sm">
      <span className="min-w-40">{name}</span>
      <form action={formAction}>
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="subscribed" value={subscribed ? "false" : "true"} />
        <Button type="submit" size="xs" variant="outline" disabled={pending}>
          {pending ? "…" : subscribed ? "Leave" : "Join"}
        </Button>
      </form>
      <span className="text-xs text-muted-foreground">{subscribed ? "You are in this group" : "Not subscribed"}</span>
      {state && !state.ok ? <FormStatus state={state} /> : null}
    </li>
  );
}
