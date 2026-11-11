// Points the Telegram bot at this app.  Run:  npm run telegram:set-webhook
//
// Reads APP_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment (.env.local
// is loaded by the npm script). APP_URL must be the public https URL, so run this against the
// deployed app's values, not http://localhost.

const appUrl = process.env.APP_URL?.replace(/\/$/, "");
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

const missing = Object.entries({ APP_URL: appUrl, TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length > 0) {
  console.error(`Missing: ${missing.join(", ")}`);
  process.exit(1);
}
if (!appUrl.startsWith("https://")) {
  console.error(`APP_URL must be a public https URL (got ${appUrl}). Telegram cannot reach localhost.`);
  process.exit(1);
}

const url = `${appUrl}/api/telegram/webhook`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true }),
});
const body = await res.json();
if (!body.ok) {
  console.error("Telegram refused:", body.description);
  process.exit(1);
}
console.log(`Webhook set to ${url}`);
