import "server-only";
import { integrationEnv } from "@/lib/env";
import { googleAccessToken, googleError } from "@/lib/google/auth";
import type { OutboundMessage, Sender } from "@/lib/rules/execute";
import type { Channel } from "@/lib/rules/types";
import { buildMime, isPlaceholderEmail, toBase64Url } from "./mime";

// Channel senders. Each is one function `send(recipient, message)` that throws on failure, so a new
// channel (WhatsApp, push) plugs in here without touching the rule engine.

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** Email through the Gmail API, as the ALERT_EMAIL_SENDER mailbox (service account, delegated). */
export const sendEmail: Sender = async (to, message) => {
  const sender = integrationEnv("ALERT_EMAIL_SENDER");
  if (!sender || !integrationEnv("GOOGLE_SERVICE_ACCOUNT_JSON")) {
    throw new Error("Email is not configured (GOOGLE_SERVICE_ACCOUNT_JSON and ALERT_EMAIL_SENDER).");
  }
  if (isPlaceholderEmail(to)) {
    throw new Error(`${to} is a placeholder address. Enter the real email under Settings > Employees.`);
  }

  const token = await googleAccessToken(sender, GMAIL_SCOPE);
  const raw = toBase64Url(
    buildMime({ from: sender, fromName: "ShiftBoard", to, subject: message.subject, text: message.text }),
  );
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    cache: "no-store",
  });
  if (!res.ok) throw await googleError(res);
};

/** Calls a Telegram Bot API method. Throws with Telegram's own description on failure. */
export async function telegramApi<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = integrationEnv("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram is not configured (TELEGRAM_BOT_TOKEN).");

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: T } | null;
  if (!res.ok || !body?.ok) throw new Error(`Telegram ${res.status}: ${body?.description ?? res.statusText}`);
  return body.result as T;
}

/** Telegram through the Bot API. `chatId` is the employee's linked telegram_chat_id. */
export const sendTelegram: Sender = async (chatId, message: OutboundMessage) => {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: message.text,
    link_preview_options: { is_disabled: true },
  });
};

export const SENDERS: Record<Channel, Sender> = { email: sendEmail, telegram: sendTelegram };
