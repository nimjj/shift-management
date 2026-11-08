-- Found by the Supabase security advisor after M3.
--
-- public.write_audit() is SECURITY DEFINER and, like every function in the `public` schema, was
-- reachable straight from PostgREST at /rest/v1/rpc/write_audit by any signed-in user. That let
-- someone forge, back-date or spam audit rows, which undermines the one record of who changed what.
-- The mutation functions call it from inside a SECURITY DEFINER body (so as the owner), so taking
-- EXECUTE away from clients changes nothing for them.
revoke execute on function public.write_audit(text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- Note on the advisor's other warnings:
--   * the remaining SECURITY DEFINER functions are deliberate: each one checks is_supervisor()
--     itself, and they exist precisely so that no write can skip its audit row.
--   * current_employee_id() and is_supervisor() only ever report on the caller.
--   * public.rls_auto_enable() is Supabase's own platform event trigger, not ours. An
--     `event_trigger` function cannot be invoked through PostgREST, so the warning is cosmetic.
--   * "leaked password protection" does not apply: the email/password provider is switched off and
--     the app only accepts Google sign-in.
