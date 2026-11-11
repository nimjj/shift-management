"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, employeeAction, type ActionResult } from "@/lib/actions";
import { SENDERS } from "@/lib/alerts";
import { integrationEnv } from "@/lib/env";
import { myPrefsSchema, prefsFormToObject } from "@/lib/prefs-schema";
import { sendWithRetry } from "@/lib/rules/execute";

export type FormState = ActionResult | null;
export type ConnectState = ActionResult<{ url: string }> | null;

const PATH = "/notifications";
const none = z.object({});

/** The signed-in employee's own channels, quiet hours and display time zone. */
export async function updateMyPrefs(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await employeeAction(myPrefsSchema, prefsFormToObject(formData), async ({ supabase, input }) => {
    const { error } = await supabase.rpc("update_my_prefs", {
      p_channels: input.channels,
      p_quiet_start: input.quiet_start,
      p_quiet_end: input.quiet_end,
      p_display_tz: input.display_tz,
    });
    if (error) throw error;
  });
  if (result.ok) revalidatePath("/", "layout"); // the display time zone is used on every page
  return result;
}

/**
 * "Connect Telegram": makes a one-time token (valid 15 minutes) and returns the bot link that
 * carries it. Tapping Start in Telegram sends the token to our webhook, which links the chat.
 */
export async function connectTelegram(): Promise<ConnectState> {
  return employeeAction(none, {}, async ({ supabase }) => {
    const bot = integrationEnv("TELEGRAM_BOT_USERNAME")?.replace(/^@/, "");
    if (!bot || !integrationEnv("TELEGRAM_BOT_TOKEN")) {
      throw new ActionError("Telegram is not set up on the server yet. Ask your supervisor.");
    }
    const { data: token, error } = await supabase.rpc("create_telegram_link_token");
    if (error) throw error;
    return { url: `https://t.me/${bot}?start=${token}` };
  });
}

export async function disconnectTelegram(): Promise<FormState> {
  const result = await employeeAction(none, {}, async ({ supabase }) => {
    const { error } = await supabase.rpc("disconnect_my_telegram");
    if (error) throw error;
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function sendTelegramTest(): Promise<FormState> {
  return employeeAction(none, {}, async ({ actor }) => {
    if (!actor.telegram_chat_id) throw new ActionError("Telegram is not connected yet.");
    const error = await sendWithRetry(() =>
      SENDERS.telegram(String(actor.telegram_chat_id), {
        subject: "ShiftBoard test",
        text: `✅ Test message from ShiftBoard. Hi ${actor.full_name}, your shift reminders will arrive here.`,
      }),
    );
    if (error) throw new ActionError(error);
  });
}

/** Join or leave a notification group. */
export async function setGroupSubscription(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await employeeAction(
    z.object({ group_id: z.string().uuid(), subscribed: z.boolean() }),
    { group_id: formData.get("group_id")?.toString() ?? "", subscribed: formData.get("subscribed") === "true" },
    async ({ supabase, input }) => {
      const { error } = await supabase.rpc("set_my_group_subscription", {
        p_group_id: input.group_id,
        p_subscribed: input.subscribed,
      });
      if (error) throw error;
    },
  );
  if (result.ok) {
    revalidatePath(PATH);
    revalidatePath("/settings/groups");
  }
  return result;
}
