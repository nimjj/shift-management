import "server-only";
import { createSign } from "node:crypto";
import { integrationEnv } from "@/lib/env";

// Google service account with domain-wide delegation: we sign a short-lived JWT saying "I am the
// service account, acting as <subject>" and exchange it for an access token. No SDK needed.
//
// GOOGLE_SERVICE_ACCOUNT_JSON holds the downloaded key file, either as raw JSON or base64 of it
// (base64 is easier to paste into a hosting dashboard).

type ServiceAccount = { client_email: string; private_key: string; token_uri: string };

export class GoogleNotConfiguredError extends Error {}

let account: ServiceAccount | undefined;

export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let json: Partial<ServiceAccount>;
  try {
    json = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    throw new GoogleNotConfiguredError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64 of JSON).");
  }
  if (!json.client_email || !json.private_key) {
    throw new GoogleNotConfiguredError("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return {
    client_email: json.client_email,
    // Some dashboards turn real newlines into the two characters "\n".
    private_key: json.private_key.replace(/\\n/g, "\n"),
    token_uri: json.token_uri ?? "https://oauth2.googleapis.com/token",
  };
}

function serviceAccount(): ServiceAccount {
  if (!account) {
    const raw = integrationEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!raw) throw new GoogleNotConfiguredError("The Google service account is not configured.");
    account = parseServiceAccount(raw);
  }
  return account;
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** An access token for `scope`, acting as the Workspace user `subject`. Cached until it nears expiry. */
export async function googleAccessToken(subject: string, scope: string): Promise<string> {
  const key = `${subject}|${scope}`;
  const hit = tokens.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const sa = serviceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, sub: subject, scope, aud: sa.token_uri, iat, exp: iat + 3600 }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    const why = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    throw new Error(
      `Google would not let the service account act as ${subject}: ${why}. ` +
        "Check domain-wide delegation in the Workspace admin console (client ID and scopes).",
    );
  }

  tokens.set(key, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

/** A Google API error turned into one readable line. */
export async function googleError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new Error(`Google API ${res.status}: ${body?.error?.message ?? res.statusText}`);
}
