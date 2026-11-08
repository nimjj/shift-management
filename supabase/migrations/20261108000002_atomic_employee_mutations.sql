-- Atomic supervisor mutations.
--
-- PATTERN (use for every future supervisor mutation):
--   * One Postgres function does the write(s) AND the audit_log row, so they commit or roll back together.
--   * The function is SECURITY INVOKER: it runs as the signed-in user, so table RLS still applies.
--   * It calls public.write_audit(), the ONLY way to add audit rows (direct inserts are no longer allowed).
--   * It returns jsonb { "audit_id": <bigint>, "data": <result> }. The app wrapper (lib/mutate.ts) refuses
--     a result without an audit_id.
--   * User-facing validation errors use `raise exception ... using errcode = 'P0001'`; the app shows the
--     message as-is. Anything else is treated as an unexpected error.

-- ---------------------------------------------------------------------------
-- write_audit: the single entry point for audit rows.
-- SECURITY DEFINER so it can insert even though clients have no INSERT policy on audit_log.
-- The actor is derived from the session; callers cannot spoof it.
-- ---------------------------------------------------------------------------
create function public.write_audit(
  p_action    text,
  p_entity    text,
  p_entity_id text,
  p_before    jsonb,
  p_after     jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_employee_id();
  v_id    bigint;
begin
  if v_actor is null or not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_actor, p_action, p_entity, p_entity_id, p_before, p_after)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.write_audit(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.write_audit(text, text, text, jsonb, jsonb) to authenticated;

-- No more direct audit inserts from the client.
drop policy audit_insert on public.audit_log;

-- ---------------------------------------------------------------------------
-- assert_allowed_email: the email must be on one of org_settings.allowed_domains.
-- ---------------------------------------------------------------------------
create function public.assert_allowed_email(p_email text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_allowed text[];
  v_domain  text := lower(split_part(coalesce(p_email, ''), '@', 2));
begin
  select allowed_domains into v_allowed from public.org_settings where id = 1;

  if v_domain = '' or v_allowed is null
     or not exists (select 1 from unnest(v_allowed) as d where lower(d) = v_domain) then
    raise exception 'Email must be on an allowed domain: %',
      coalesce(array_to_string(v_allowed, ', '), '(none configured)')
      using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.assert_allowed_email(text) from public, anon;
grant execute on function public.assert_allowed_email(text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_employee
-- ---------------------------------------------------------------------------
create function public.create_employee(
  p_full_name  text,
  p_email      text,
  p_role       public.employee_role,
  p_active     boolean,
  p_display_tz text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_row   public.employees;
  v_audit bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  perform public.assert_allowed_email(v_email);

  -- A duplicate email raises unique_violation (23505) and rolls everything back.
  insert into public.employees (full_name, email, role, active)
  values (trim(p_full_name), v_email, p_role, p_active)
  returning * into v_row;

  if p_display_tz is not null then
    insert into public.employee_notification_prefs (employee_id, display_tz)
    values (v_row.id, p_display_tz)
    on conflict (employee_id) do update set display_tz = excluded.display_tz;
  end if;

  v_audit := public.write_audit(
    'employee.create', 'employees', v_row.id::text,
    null,
    to_jsonb(v_row) || jsonb_build_object('display_tz', p_display_tz)
  );

  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_row));
end;
$$;

revoke execute on function public.create_employee(text, text, public.employee_role, boolean, text) from public, anon;
grant execute on function public.create_employee(text, text, public.employee_role, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_employee
-- ---------------------------------------------------------------------------
create function public.update_employee(
  p_id         uuid,
  p_full_name  text,
  p_email      text,
  p_role       public.employee_role,
  p_active     boolean,
  p_display_tz text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_email         text := lower(trim(p_email));
  v_actor         uuid := public.current_employee_id();
  v_before        public.employees;
  v_after         public.employees;
  v_before_tz     text;
  v_email_changed boolean;
  v_audit         bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  -- Lock the row so the before-snapshot in the audit log is exactly what we changed.
  select * into v_before from public.employees where id = p_id for update;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0001';
  end if;

  select display_tz into v_before_tz
  from public.employee_notification_prefs where employee_id = p_id;

  v_email_changed := v_before.email <> v_email;

  if v_before.id = v_actor then
    if not p_active or p_role <> 'supervisor' then
      raise exception 'You can''t deactivate or demote yourself. Ask another supervisor.' using errcode = 'P0001';
    end if;
    if v_email_changed then
      raise exception 'You can''t change your own sign-in email. Ask another supervisor.' using errcode = 'P0001';
    end if;
  end if;

  if v_email_changed then
    perform public.assert_allowed_email(v_email);
  end if;

  update public.employees
  set full_name    = trim(p_full_name),
      email        = v_email,
      role         = p_role,
      active       = p_active,
      -- A new email means a different Google account: unlink so the next sign-in re-links.
      auth_user_id = case when v_email_changed then null else auth_user_id end
  where id = p_id
  returning * into v_after;

  if p_display_tz is distinct from v_before_tz then
    if p_display_tz is null then
      update public.employee_notification_prefs set display_tz = null where employee_id = p_id;
    else
      insert into public.employee_notification_prefs (employee_id, display_tz)
      values (p_id, p_display_tz)
      on conflict (employee_id) do update set display_tz = excluded.display_tz;
    end if;
  end if;

  v_audit := public.write_audit(
    'employee.update', 'employees', p_id::text,
    to_jsonb(v_before) || jsonb_build_object('display_tz', v_before_tz),
    to_jsonb(v_after)  || jsonb_build_object('display_tz', p_display_tz)
  );

  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_after));
end;
$$;

revoke execute on function public.update_employee(uuid, text, text, public.employee_role, boolean, text) from public, anon;
grant execute on function public.update_employee(uuid, text, text, public.employee_role, boolean, text) to authenticated;
