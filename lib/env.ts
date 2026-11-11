import "server-only";
import { z } from "zod";

// Secrets and infrastructure only. Business rules live in the database (Settings screens).
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_URL: z.string().url(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid or missing environment variables: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function appUrl(): string {
  return serverEnv().APP_URL.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Integrations. Every one of these is OPTIONAL: the app runs without them and the feature that
// needs a missing one reports "not configured" instead of crashing.
// ---------------------------------------------------------------------------
export type IntegrationKey =
  | "GOOGLE_SERVICE_ACCOUNT_JSON"
  | "GOOGLE_CALENDAR_OWNER"
  | "ALERT_EMAIL_SENDER"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_BOT_USERNAME"
  | "TELEGRAM_WEBHOOK_SECRET"
  | "CRON_SECRET";

/** The value of an optional integration variable, or undefined when it is unset or blank. */
export function integrationEnv(key: IntegrationKey): string | undefined {
  const v = process.env[key]?.trim();
  return v ? v : undefined;
}

export type IntegrationStatus = {
  /** Gmail alerts: service account + sender mailbox. */
  email: boolean;
  /** Telegram alerts: bot token (+ username for the Connect link). */
  telegram: boolean;
  telegramWebhook: boolean;
  /** Calendar invites: service account + calendar owner. */
  calendar: boolean;
  /** The every-minute checker can be called. */
  cron: boolean;
};

/** Which integrations have their variables set. Booleans only: never expose the values. */
export function integrationStatus(): IntegrationStatus {
  const has = (k: IntegrationKey) => integrationEnv(k) !== undefined;
  return {
    email: has("GOOGLE_SERVICE_ACCOUNT_JSON") && has("ALERT_EMAIL_SENDER"),
    telegram: has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_BOT_USERNAME"),
    telegramWebhook: has("TELEGRAM_WEBHOOK_SECRET"),
    calendar: has("GOOGLE_SERVICE_ACCOUNT_JSON") && has("GOOGLE_CALENDAR_OWNER"),
    cron: has("CRON_SECRET"),
  };
}
