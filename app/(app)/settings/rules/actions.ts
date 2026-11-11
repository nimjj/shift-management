"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, supervisorAction, type ActionResult } from "@/lib/actions";
import { SENDERS } from "@/lib/alerts";
import { appUrl } from "@/lib/env";
import { sendWithRetry, subjectFor, type AlertRow } from "@/lib/rules/execute";
import { renderTemplate, sampleValues } from "@/lib/rules/template";
import type { Channel } from "@/lib/rules/types";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/database.types";
import { ruleFormToObject, ruleSchema, ruleToPayload } from "./schema";

export type FormState = ActionResult | null;
export type TestState = ActionResult<{ channel: Channel; ok: boolean; detail: string }[]> | null;

const PATH = "/settings/rules";
const idSchema = z.object({ id: z.string().uuid() });
const idOf = (fd: FormData) => ({ id: fd.get("id")?.toString() ?? "" });

/** Create or edit a stage. The checker reads the rules on every tick, so this applies within a minute. */
export async function saveRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(ruleSchema, ruleFormToObject(formData), async ({ input, mutate }) => {
    await mutate("save_notification_rule", { p_id: input.id ?? null, p_rule: ruleToPayload(input) as Json });
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function deleteRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(idSchema, idOf(formData), async ({ input, mutate }) => {
    await mutate("delete_notification_rule", { p_id: input.id });
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

/** Move a stage one place up or down the ladder. */
export async function moveRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await supervisorAction(
    idSchema.extend({ direction: z.enum(["up", "down"]) }),
    { ...idOf(formData), direction: formData.get("direction")?.toString() ?? "" },
    async ({ supabase, input, mutate }) => {
      const { data, error } = await supabase.from("notification_rules").select("id").order("position").order("created_at");
      if (error) throw error;
      const ids = data.map((r) => r.id);
      const from = ids.indexOf(input.id);
      const to = from + (input.direction === "up" ? -1 : 1);
      if (from === -1) throw new ActionError("That stage no longer exists. Reload the page.");
      if (to < 0 || to >= ids.length) return; // already at the end
      [ids[from], ids[to]] = [ids[to], ids[from]];
      await mutate("reorder_notification_rules", { p_ids: ids });
    },
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}

/**
 * "Send test": sends this stage's message, filled with sample values, to the supervisor pressing
 * the button, through each of the stage's channels. Nothing about the stage or any shift changes;
 * the attempts are logged in alerts, marked as tests.
 */
export async function sendTestRule(_prev: TestState, formData: FormData): Promise<TestState> {
  return supervisorAction(idSchema, idOf(formData), async ({ supabase, actor, input }) => {
    const [ruleRes, prefsRes, orgRes] = await Promise.all([
      supabase.from("notification_rules").select("*").eq("id", input.id).maybeSingle(),
      supabase.from("employee_notification_prefs").select("display_tz").eq("employee_id", actor.id).maybeSingle(),
      supabase.from("org_settings").select("default_display_tz").eq("id", 1).single(),
    ]);
    if (ruleRes.error) throw ruleRes.error;
    if (orgRes.error) throw orgRes.error;
    const rule = ruleRes.data;
    if (!rule) throw new ActionError("That stage no longer exists. Reload the page.");

    const tz = prefsRes.data?.display_tz ?? orgRes.data.default_display_tz;
    const message = {
      subject: `[TEST] ${subjectFor(rule.name, "2a")}`,
      text: `[TEST] ${renderTemplate(rule.message_tpl, sampleValues(appUrl(), tz, new Date()))}`,
    };

    const results: { channel: Channel; ok: boolean; detail: string }[] = [];
    const rows: AlertRow[] = [];
    for (const channel of rule.channels.filter((c): c is Channel => c === "email" || c === "telegram")) {
      const address = channel === "email" ? actor.email : actor.telegram_chat_id?.toString();
      if (!address) {
        results.push({ channel, ok: false, detail: "Your Telegram is not connected. Connect it under My notifications." });
        continue;
      }
      const error = await sendWithRetry(() => SENDERS[channel](address, message));
      results.push({ channel, ok: !error, detail: error ?? `Sent to ${channel === "email" ? address : "your Telegram"}.` });
      rows.push({
        rule_id: rule.id,
        rule_name: rule.name,
        shift_id: null,
        assignment_id: null,
        recipient_employee_id: actor.id,
        recipient: address,
        channel,
        status: error ? "failed" : "sent",
        success: !error,
        error,
        payload: message,
        is_test: true,
      });
    }

    if (rows.length > 0) {
      const { error } = await createServiceClient()
        .from("alerts")
        .insert(rows.map((r) => ({ ...r, payload: r.payload as Json })));
      if (error) console.error("could not log test alerts", error);
      revalidatePath(PATH);
    }
    return results;
  });
}
