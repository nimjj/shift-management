import { connection, NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, safeRedirectPath } from "@/lib/auth-rules";
import { serverEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type DenyReason = "oauth" | "domain" | "roster" | "linked";

export async function GET(request: NextRequest) {
  await connection();
  const appUrl = serverEnv().APP_URL.replace(/\/$/, "");
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));

  const supabase = await createClient();

  const deny = async (reason: DenyReason) => {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${appUrl}/not-authorised?reason=${reason}`);
  };

  if (!code) return deny("oauth");

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return deny("oauth");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email) return deny("oauth");

  // Service role is needed here: the employee row is not linked to this auth user yet,
  // so RLS would hide it from them.
  const service = createServiceClient();

  const { data: settings } = await service
    .from("org_settings")
    .select("allowed_domains")
    .eq("id", 1)
    .maybeSingle();
  if (!settings || !isAllowedEmail(email, settings.allowed_domains)) return deny("domain");

  const { data: employee } = await service
    .from("employees")
    .select("id, active, auth_user_id")
    .eq("email", email)
    .maybeSingle();

  if (!employee) {
    // Valid company account but not on the roster. Remove the stray auth user we just created.
    await service.auth.admin.deleteUser(user.id);
    return deny("roster");
  }
  if (!employee.active) return deny("roster");
  if (employee.auth_user_id && employee.auth_user_id !== user.id) return deny("linked");

  if (!employee.auth_user_id) {
    const { error: linkError } = await service
      .from("employees")
      .update({ auth_user_id: user.id })
      .eq("id", employee.id)
      .is("auth_user_id", null);
    if (linkError) {
      console.error("Failed to link employee to auth user", linkError);
      return deny("oauth");
    }
  }

  return NextResponse.redirect(`${appUrl}${next}`);
}
