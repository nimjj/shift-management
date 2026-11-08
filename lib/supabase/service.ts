import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client: BYPASSES RLS. Server routes only (auth callback, health, cron).
 * Never import this from a client component or use it for ordinary supervisor mutations.
 */
export function createServiceClient() {
  const env = serverEnv();
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
