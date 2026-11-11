import { NextResponse, type NextRequest } from "next/server";
import { integrationEnv } from "@/lib/env";
import { secretMatches } from "@/lib/secret-compare";
import { checkShifts } from "@/lib/tick";

// The no-show checker. Called every minute by Supabase pg_cron + pg_net (see
// supabase/migrations/*_rules_alerts_cron.sql) with the shared secret in a header.
// It is safe to call as often as you like: every firing is claimed once in the database.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const expected = integrationEnv("CRON_SECRET");
  if (!expected) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not set on the server." }, { status: 503 });
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const presented = request.headers.get("x-cron-secret") ?? bearer;
  if (!secretMatches(presented, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorised." }, { status: 401 });
  }

  try {
    const result = await checkShifts();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("check-shifts failed", e);
    return NextResponse.json({ ok: false, error: "The check failed. See the server logs." }, { status: 500 });
  }
}
