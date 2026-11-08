import { connection, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/** Keep-alive + uptime check: runs a trivial query so the Supabase project never pauses. */
export async function GET() {
  // Never prerender: the whole point is to hit the database on every call.
  await connection();
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("org_settings").select("id").eq("id", 1).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("health check failed", e);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
