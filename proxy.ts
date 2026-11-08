import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next 16: "middleware" is now "proxy".
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Run on everything except Next internals and static image files.
// NOTE the double backslashes: this is a JS string, so "\\." is the regex `\.` (a literal dot).
// A single "\." would collapse to "." and match any character.
// Keep this a plain string literal: Next analyses `config` statically.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
