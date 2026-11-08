-- M1 core: employees, org settings, audit log, notification prefs, RLS, signup domain hook.
-- Postgres 15+ (Supabase default).

create type public.employee_role as enum ('supervisor', 'agent');

-- ---------------------------------------------------------------------------
-- org_settings: single row. Business rules live here, not in env vars.
-- Later milestones add check-in / calendar columns with ALTER TABLE.
-- ---------------------------------------------------------------------------
create table public.org_settings (
  id                 int primary key default 1 check (id = 1),
  org_name           text not null default 'Adept Technologies',
  client_tz          text not null default 'America/Chicago',
  default_display_tz text not null default 'Asia/Colombo',
  week_start         smallint not null default 1 check (week_start between 0 and 6), -- 0 = Sunday
  allowed_domains    text[] not null default array['adept-tech.us'],
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid unique references auth.users (id) on delete set null,
  full_name        text not null check (length(trim(full_name)) > 0),
  email            text not null unique check (email = lower(email)),
  role             public.employee_role not null default 'agent',
  telegram_chat_id bigint,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- employee_notification_prefs (editing UI is Phase 1b; display_tz is used from M1)
-- ---------------------------------------------------------------------------
create table public.employee_notification_prefs (
  employee_id       uuid primary key references public.employees (id) on delete cascade,
  channels          text[] not null default array['email', 'telegram'],
  quiet_hours_start time,
  quiet_hours_end   time,
  display_tz        text
);

-- ---------------------------------------------------------------------------
-- audit_log: append-only (no update/delete policies)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.employees (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so they can read employees under RLS)
-- ---------------------------------------------------------------------------
create function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.employees e
  where e.auth_user_id = (select auth.uid()) and e.active
$$;

create function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = (select auth.uid()) and e.active and e.role = 'supervisor'
  )
$$;

revoke execute on function public.current_employee_id() from public, anon;
revoke execute on function public.is_supervisor() from public, anon;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.is_supervisor() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security on every table
-- ---------------------------------------------------------------------------
alter table public.org_settings enable row level security;
alter table public.employees enable row level security;
alter table public.employee_notification_prefs enable row level security;
alter table public.audit_log enable row level security;

-- org_settings: any active employee can read; supervisors update.
create policy org_settings_select on public.org_settings
  for select to authenticated using ((select public.current_employee_id()) is not null);
create policy org_settings_update on public.org_settings
  for update to authenticated using ((select public.is_supervisor())) with check ((select public.is_supervisor()));

-- employees: supervisors see/manage all; agents see only themselves.
create policy employees_select on public.employees
  for select to authenticated
  using ((select public.is_supervisor()) or id = (select public.current_employee_id()));
create policy employees_insert on public.employees
  for insert to authenticated with check ((select public.is_supervisor()));
create policy employees_update on public.employees
  for update to authenticated
  using ((select public.is_supervisor())) with check ((select public.is_supervisor()));
-- No delete policy: employees are deactivated, never deleted (history stays intact).

-- notification prefs: own row or supervisor.
create policy prefs_select on public.employee_notification_prefs
  for select to authenticated
  using ((select public.is_supervisor()) or employee_id = (select public.current_employee_id()));
create policy prefs_insert on public.employee_notification_prefs
  for insert to authenticated
  with check ((select public.is_supervisor()) or employee_id = (select public.current_employee_id()));
create policy prefs_update on public.employee_notification_prefs
  for update to authenticated
  using ((select public.is_supervisor()) or employee_id = (select public.current_employee_id()))
  with check ((select public.is_supervisor()) or employee_id = (select public.current_employee_id()));

-- audit_log: supervisors read and append (as themselves); nobody updates or deletes.
create policy audit_select on public.audit_log
  for select to authenticated using ((select public.is_supervisor()));
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check ((select public.is_supervisor()) and actor_id = (select public.current_employee_id()));

-- ---------------------------------------------------------------------------
-- Auth hook: before-user-created. Second layer behind the app's own callback check.
-- Rejects any signup whose email domain is not in org_settings.allowed_domains.
-- Enable in Dashboard > Authentication > Hooks (see SETUP.md).
-- ---------------------------------------------------------------------------
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(coalesce(event->'user'->>'email', ''));
  v_domain text := split_part(v_email, '@', 2);
  v_allowed text[];
begin
  select allowed_domains into v_allowed from public.org_settings where id = 1;

  if v_domain <> '' and v_allowed is not null
     and v_domain = any (select lower(d) from unnest(v_allowed) as d) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Sign-in is restricted to company accounts.',
      'http_code', 403
    )
  );
end;
$$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;
