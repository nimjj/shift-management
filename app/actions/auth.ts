"use server";

import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth-rules";
import { serverEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function signInWithGoogle(formData: FormData) {
  const next = safeRedirectPath(formData.get("next")?.toString());
  const appUrl = serverEnv().APP_URL.replace(/\/$/, "");

  // `hd` is only a UI hint for Google's account chooser. The real domain check is
  // server-side in /auth/callback (and in the before-user-created hook).
  const service = createServiceClient();
  const { data: settings } = await service
    .from("org_settings")
    .select("allowed_domains")
    .eq("id", 1)
    .maybeSingle();
  const hd = settings?.allowed_domains?.[0];

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account", ...(hd ? { hd } : {}) },
    },
  });

  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
