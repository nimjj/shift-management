import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { telegramApi } from "@/lib/alerts";
import { integrationEnv } from "@/lib/env";
import { secretMatches } from "@/lib/secret-compare";
import { createServiceClient } from "@/lib/supabase/service";

// Telegram calls this for every message sent to the bot. The only thing it does is the Connect
// flow: "/start <one-time token>" links that chat to the employee who created the token.
// Telegram proves it is Telegram with the secret we gave it in setWebhook.

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number(), type: z.string().optional() }),
    })
    .optional(),
});

async function reply(chatId: number, text: string) {
  try {
    await telegramApi("sendMessage", { chat_id: chatId, text });
  } catch (e) {
    console.error("telegram reply failed", e);
  }
}

export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), integrationEnv("TELEGRAM_WEBHOOK_SECRET"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  const message = parsed.success ? parsed.data.message : undefined;
  // Always answer 200 from here on, or Telegram keeps re-sending the same update.
  if (!message?.text) return NextResponse.json({ ok: true });

  const chatId = message.chat.id;
  if (message.chat.type && message.chat.type !== "private") {
    await reply(chatId, "Please message me directly, not in a group.");
    return NextResponse.json({ ok: true });
  }

  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})\s*$/.exec(message.text.trim());
  if (!match) {
    await reply(chatId, "To connect this chat, open ShiftBoard > My notifications and press Connect Telegram.");
    return NextResponse.json({ ok: true });
  }

  const db = createServiceClient();
  const { data: name, error } = await db.rpc("link_telegram", { p_token: match[1], p_chat_id: chatId });
  if (error) {
    console.error("link_telegram failed", error);
    await reply(chatId, "Something went wrong on our side. Please try Connect Telegram again.");
  } else if (!name) {
    await reply(chatId, "That link has expired or was already used. Press Connect Telegram in ShiftBoard to get a new one.");
  } else {
    await reply(chatId, `Connected. Hi ${name}, shift reminders will arrive here.`);
  }
  return NextResponse.json({ ok: true });
}
