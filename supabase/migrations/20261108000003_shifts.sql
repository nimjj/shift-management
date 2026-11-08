-- M2: shift templates, shifts, atomic supervisor functions, and write-path hardening.
--
-- Conventions (same as 20261108000002):
--   * every supervisor mutation is ONE function: it writes the change and its audit_log row together
--   * returns jsonb { "audit_id": <bigint>, "data": <result> }
--   * user-facing validation errors use errcode 'P0001'; not-a-supervisor uses '42501'
-- NEW in this migration: the mutation functions are SECURITY DEFINER with an explicit supervisor check,
-- and the tables have NO client write policies, so a supervisor cannot change data without the audit row.
-- All time-zone maths is done in the app (lib/time.ts); the database only validates and stores.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.shift_templates (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[A-Za-z0-9]{1,8}$'),
  name               text not null check (length(trim(name)) > 0),
  start_weekday      smallint not null check (start_weekday between 0 and 6), -- 0 = Sunday
  start_local_time   time not null,
  end_weekday        smallint not null check (end_weekday between 0 and 6),
  end_local_time     time not null,
  timezone           text,                                  -- NULL = follow org_settings.client_tz
  required_headcount smallint not null default 1 check (required_headcount between 1 and 10),
  colour             text not null default '#6366f1' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  active             boolean not null default true,         -- false = archived
  created_at         timestamptz not null default now(),
  -- wall-clock length is 1 minute .. 24 hours
  constraint shift_templates_duration check (
    ((end_weekday - start_weekday + 7) % 7) * 1440
      + extract(hour from end_local_time)::int * 60 + extract(minute from end_local_time)::int
      - extract(hour from start_local_time)::int * 60 - extract(minute from start_local_time)::int
    between 1 and 1440
  )
);

create table public.shifts (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid references public.shift_templates (id) on delete restrict,
  occurrence_date date,                       -- local start date in the template's zone; identifies the shift within its template
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status_override text,
  notes           text,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint shifts_ends_after_starts check (ends_at > starts_at),
  -- generated shifts have both; M4 test shifts have neither
  constraint shifts_generated_pair check ((template_id is null) = (occurrence_date is null)),
  constraint shifts_template_occurrence_key unique (template_id, occurrence_date)
);
create index shifts_starts_at_idx on public.shifts (starts_at);

-- ---------------------------------------------------------------------------
-- RLS: read-only for clients; all writes go through the functions below.
-- ---------------------------------------------------------------------------
alter table public.shift_templates enable row level security;
alter table public.shifts enable row level security;

create policy shift_templates_select on public.shift_templates
  for select to authenticated using ((select public.current_employee_id()) is not null);

-- Supervisors only for now. M3 adds "agents see the shifts they are assigned to".
create policy shifts_select on public.shifts
  for select to authenticated using ((select public.is_supervisor()));

-- ---------------------------------------------------------------------------
-- Hardening of M1: no direct client writes to employees / org_settings. Use the audited functions.
-- ---------------------------------------------------------------------------
drop policy employees_insert on public.employees;
drop policy employees_update on public.employees;
drop policy org_settings_update on public.org_settings;

alter function public.create_employee(text, text, public.employee_role, boolean, text) security definer;
alter function public.update_employee(uuid, text, text, public.employee_role, boolean, text) security definer;

-- ---------------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------------
create function public.assert_valid_timezone(p_tz text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'Unknown time zone: %', p_tz using errcode = 'P0001';
  end if;
end;
$$;

create function public.validate_shift_template_input(
  p_code text, p_name text,
  p_start_weekday int, p_start_time time,
  p_end_weekday int, p_end_time time,
  p_timezone text, p_headcount int, p_colour text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_minutes int;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{1,8}$' then
    raise exception 'Block code must be 1 to 8 letters or digits.' using errcode = 'P0001';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Name is required.' using errcode = 'P0001';
  end if;
  -- NULLs would make the comparisons below evaluate to NULL (not false) and slip through.
  if p_start_weekday is null or p_end_weekday is null or p_start_time is null or p_end_time is null
     or p_headcount is null then
    raise exception 'Start, end and headcount are required.' using errcode = 'P0001';
  end if;
  if p_start_weekday not between 0 and 6 or p_end_weekday not between 0 and 6 then
    raise exception 'Weekday must be 0 (Sunday) to 6 (Saturday).' using errcode = 'P0001';
  end if;

  v_minutes := ((p_end_weekday - p_start_weekday + 7) % 7) * 1440
    + extract(hour from p_end_time)::int * 60 + extract(minute from p_end_time)::int
    - extract(hour from p_start_time)::int * 60 - extract(minute from p_start_time)::int;
  if v_minutes <= 0 then
    raise exception 'The end must be after the start.' using errcode = 'P0001';
  end if;
  if v_minutes > 1440 then
    raise exception 'A block can be at most 24 hours long.' using errcode = 'P0001';
  end if;

  perform public.assert_valid_timezone(p_timezone);

  if p_headcount not between 1 and 10 then
    raise exception 'Required headcount must be 1 to 10.' using errcode = 'P0001';
  end if;
  if p_colour is null or p_colour !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colour must look like #6366f1.' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_shift_template
-- ---------------------------------------------------------------------------
create function public.create_shift_template(
  p_code               text,
  p_name               text,
  p_start_weekday      int,
  p_start_time         time,
  p_end_weekday        int,
  p_end_time           time,
  p_timezone           text default null,
  p_required_headcount int default 1,
  p_colour             text default '#6366f1',
  p_active             boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.shift_templates;
  v_audit bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  perform public.validate_shift_template_input(
    trim(p_code), p_name, p_start_weekday, p_start_time, p_end_weekday, p_end_time,
    p_timezone, p_required_headcount, p_colour);

  -- duplicate code raises unique_violation (23505) and rolls everything back
  insert into public.shift_templates
    (code, name, start_weekday, start_local_time, end_weekday, end_local_time,
     timezone, required_headcount, colour, active)
  values
    (trim(p_code), trim(p_name), p_start_weekday, p_start_time, p_end_weekday, p_end_time,
     p_timezone, p_required_headcount, p_colour, p_active)
  returning * into v_row;

  v_audit := public.write_audit('shift_template.create', 'shift_templates', v_row.id::text, null, to_jsonb(v_row));
  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- update_shift_template (also used to archive / unarchive via p_active)
-- Existing shifts are NOT touched: changes apply to newly generated shifts,
-- and to existing ones only through an explicit regeneration.
-- ---------------------------------------------------------------------------
create function public.update_shift_template(
  p_id                 uuid,
  p_code               text,
  p_name               text,
  p_start_weekday      int,
  p_start_time         time,
  p_end_weekday        int,
  p_end_time           time,
  p_timezone           text default null,
  p_required_headcount int default 1,
  p_colour             text default '#6366f1',
  p_active             boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.shift_templates;
  v_after  public.shift_templates;
  v_audit  bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  select * into v_before from public.shift_templates where id = p_id for update;
  if not found then
    raise exception 'Block not found.' using errcode = 'P0001';
  end if;

  perform public.validate_shift_template_input(
    trim(p_code), p_name, p_start_weekday, p_start_time, p_end_weekday, p_end_time,
    p_timezone, p_required_headcount, p_colour);

  update public.shift_templates set
    code               = trim(p_code),
    name               = trim(p_name),
    start_weekday      = p_start_weekday,
    start_local_time   = p_start_time,
    end_weekday        = p_end_weekday,
    end_local_time     = p_end_time,
    timezone           = p_timezone,
    required_headcount = p_required_headcount,
    colour             = p_colour,
    active             = p_active
  where id = p_id
  returning * into v_after;

  v_audit := public.write_audit('shift_template.update', 'shift_templates', p_id::text,
                                to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- generate_shifts: idempotent. p_rows = [{template_id, occurrence_date, starts_at, ends_at}, ...]
-- computed by the app. Rows that already exist (same template + occurrence date) are skipped.
-- ---------------------------------------------------------------------------
create function public.generate_shifts(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total    int;
  v_inserted int;
  v_first    timestamptz;
  v_last     timestamptz;
  v_audit    bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of shifts.' using errcode = 'P0001';
  end if;

  v_total := jsonb_array_length(p_rows);
  if v_total > 2000 then
    raise exception 'Too many shifts in one request (max 2000).' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_rows)
      as r(template_id uuid, occurrence_date date, starts_at timestamptz, ends_at timestamptz)
    where r.template_id is null or r.occurrence_date is null or r.starts_at is null
       or r.ends_at is null or r.ends_at <= r.starts_at
  ) then
    raise exception 'A shift in the request is incomplete or ends before it starts.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_rows)
      as r(template_id uuid, occurrence_date date, starts_at timestamptz, ends_at timestamptz)
    left join public.shift_templates t on t.id = r.template_id
    where t.id is null or not t.active
  ) then
    raise exception 'The request includes a block that does not exist or is archived.' using errcode = 'P0001';
  end if;

  select min(r.starts_at), max(r.starts_at) into v_first, v_last
  from jsonb_to_recordset(p_rows)
    as r(template_id uuid, occurrence_date date, starts_at timestamptz, ends_at timestamptz);

  with ins as (
    insert into public.shifts (template_id, occurrence_date, starts_at, ends_at)
    select r.template_id, r.occurrence_date, r.starts_at, r.ends_at
    from jsonb_to_recordset(p_rows)
      as r(template_id uuid, occurrence_date date, starts_at timestamptz, ends_at timestamptz)
    on conflict on constraint shifts_template_occurrence_key do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  v_audit := public.write_audit(
    'shifts.generate', 'shifts', null, null,
    jsonb_build_object('requested', v_total, 'inserted', v_inserted, 'skipped', v_total - v_inserted,
                       'first_starts_at', v_first, 'last_starts_at', v_last)
  );

  return jsonb_build_object('audit_id', v_audit, 'data',
    jsonb_build_object('requested', v_total, 'inserted', v_inserted, 'skipped', v_total - v_inserted));
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_shift_regeneration: p_changes = {
--   moved:   [{id, starts_at, ends_at}],
--   added:   [{template_id, occurrence_date, starts_at, ends_at}],
--   removed: [uuid, ...] }
-- All-or-nothing. Only template-generated shifts that have NOT started can be moved or removed.
-- If anything no longer matches (a shift started, vanished, or appeared), the whole call is rolled
-- back and the supervisor is asked to review again.
-- M3 must extend the removal/move checks to protect shifts that have assignments.
-- ---------------------------------------------------------------------------
create function public.apply_shift_regeneration(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved   jsonb := coalesce(p_changes -> 'moved', '[]'::jsonb);
  v_added   jsonb := coalesce(p_changes -> 'added', '[]'::jsonb);
  v_removed jsonb := coalesce(p_changes -> 'removed', '[]'::jsonb);
  v_n_moved int;
  v_n_added int;
  v_n_removed int;
  v_done    int;
  v_before_moved   jsonb;
  v_before_removed jsonb;
  v_after_moved    jsonb;
  v_audit   bigint;
  v_stale   constant text := 'Shifts changed since the preview (one may have started or been edited). Review the preview again.';
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or jsonb_typeof(v_moved) <> 'array' or jsonb_typeof(v_added) <> 'array' or jsonb_typeof(v_removed) <> 'array' then
    raise exception 'Malformed change list.' using errcode = 'P0001';
  end if;

  v_n_moved := jsonb_array_length(v_moved);
  v_n_added := jsonb_array_length(v_added);
  v_n_removed := jsonb_array_length(v_removed);
  if v_n_moved + v_n_added + v_n_removed > 2000 then
    raise exception 'Too many changes in one request (max 2000).' using errcode = 'P0001';
  end if;

  -- moved ---------------------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_before_moved
  from public.shifts s
  where s.id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_moved) e);

  update public.shifts s
  set starts_at = r.starts_at, ends_at = r.ends_at
  from jsonb_to_recordset(v_moved) as r(id uuid, starts_at timestamptz, ends_at timestamptz)
  where s.id = r.id and s.template_id is not null and s.starts_at > now() and r.ends_at > r.starts_at;
  get diagnostics v_done = row_count;
  if v_done <> v_n_moved then raise exception '%', v_stale using errcode = 'P0001'; end if;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_after_moved
  from public.shifts s
  where s.id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_moved) e);

  -- removed -------------------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_before_removed
  from public.shifts s
  where s.id in (select (e #>> '{}')::uuid from jsonb_array_elements(v_removed) e);

  delete from public.shifts s
  where s.id in (select (e #>> '{}')::uuid from jsonb_array_elements(v_removed) e)
    and s.template_id is not null and s.starts_at > now();
  get diagnostics v_done = row_count;
  if v_done <> v_n_removed then raise exception '%', v_stale using errcode = 'P0001'; end if;

  -- added ---------------------------------------------------------------
  if exists (
    select 1 from jsonb_to_recordset(v_added)
      as r(template_id uuid, occurrence_date date, starts_at timestamptz, ends_at timestamptz)
    left join public.shift_templates t on t.id = r.template_id
    where t.id is null or not t.active or r.occurrence_date is null or r.starts_at is null
       or r.ends_at is null or r.ends_at <= r.starts_at or r.starts_at <= now()
  ) then
    raise exception '%', v_stale using errcode = 'P0001';
  end if;

  insert into public.shifts (template_id, occurrence_date, starts_at, ends_at)
  select r.template_id, r.occurrence_date, r.starts_at, r.ends_at
  from jsonb_to_recordset(v_added)
    as r(template_id uuid, occurrence_date date, starts_at timestamptz, ends_at timestamptz)
  on conflict on constraint shifts_template_occurrence_key do nothing;
  get diagnostics v_done = row_count;
  if v_done <> v_n_added then raise exception '%', v_stale using errcode = 'P0001'; end if;

  v_audit := public.write_audit(
    'shifts.regenerate', 'shifts', null,
    jsonb_build_object('moved', v_before_moved, 'removed', v_before_removed),
    jsonb_build_object('moved', v_after_moved, 'added', v_added)
  );

  return jsonb_build_object('audit_id', v_audit, 'data',
    jsonb_build_object('moved', v_n_moved, 'added', v_n_added, 'removed', v_n_removed));
end;
$$;

-- ---------------------------------------------------------------------------
-- update_org_settings (Settings > General)
-- ---------------------------------------------------------------------------
create function public.update_org_settings(
  p_org_name           text,
  p_client_tz          text,
  p_default_display_tz text,
  p_week_start         int,
  p_allowed_domains    text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before  public.org_settings;
  v_after   public.org_settings;
  v_domains text[];
  v_actor_domain text;
  v_audit   bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  if p_org_name is null or length(trim(p_org_name)) = 0 then
    raise exception 'Organisation name is required.' using errcode = 'P0001';
  end if;
  if p_client_tz is null then
    raise exception 'Client time zone is required.' using errcode = 'P0001';
  end if;
  perform public.assert_valid_timezone(p_client_tz);
  if p_default_display_tz is null then
    raise exception 'Default display time zone is required.' using errcode = 'P0001';
  end if;
  perform public.assert_valid_timezone(p_default_display_tz);
  if p_week_start not between 0 and 6 then
    raise exception 'Week start must be 0 (Sunday) to 6 (Saturday).' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct lower(trim(d))), '{}') into v_domains
  from unnest(p_allowed_domains) as d where length(trim(d)) > 0;

  if cardinality(v_domains) = 0 then
    raise exception 'At least one allowed email domain is required.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(v_domains) as d
    where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ) then
    raise exception 'Allowed domains must look like example.com.' using errcode = 'P0001';
  end if;

  -- Lock-out guard: the acting supervisor must still be able to sign in afterwards.
  select lower(split_part(e.email, '@', 2)) into v_actor_domain
  from public.employees e where e.id = public.current_employee_id();
  if not (v_actor_domain = any (v_domains)) then
    raise exception 'You can''t remove your own email domain (%): you would be locked out.', v_actor_domain
      using errcode = 'P0001';
  end if;

  select * into v_before from public.org_settings where id = 1 for update;

  update public.org_settings set
    org_name           = trim(p_org_name),
    client_tz          = p_client_tz,
    default_display_tz = p_default_display_tz,
    week_start         = p_week_start,
    allowed_domains    = v_domains,
    updated_at         = now()
  where id = 1
  returning * into v_after;

  v_audit := public.write_audit('org_settings.update', 'org_settings', '1', to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only signed-in users can call these (each one checks is_supervisor() itself).
-- ---------------------------------------------------------------------------
revoke execute on function public.assert_valid_timezone(text) from public, anon;
revoke execute on function public.validate_shift_template_input(text, text, int, time, int, time, text, int, text) from public, anon;
revoke execute on function public.create_shift_template(text, text, int, time, int, time, text, int, text, boolean) from public, anon;
revoke execute on function public.update_shift_template(uuid, text, text, int, time, int, time, text, int, text, boolean) from public, anon;
revoke execute on function public.generate_shifts(jsonb) from public, anon;
revoke execute on function public.apply_shift_regeneration(jsonb) from public, anon;
revoke execute on function public.update_org_settings(text, text, text, int, text[]) from public, anon;

grant execute on function public.assert_valid_timezone(text) to authenticated;
grant execute on function public.validate_shift_template_input(text, text, int, time, int, time, text, int, text) to authenticated;
grant execute on function public.create_shift_template(text, text, int, time, int, time, text, int, text, boolean) to authenticated;
grant execute on function public.update_shift_template(uuid, text, text, int, time, int, time, text, int, text, boolean) to authenticated;
grant execute on function public.generate_shifts(jsonb) to authenticated;
grant execute on function public.apply_shift_regeneration(jsonb) to authenticated;
grant execute on function public.update_org_settings(text, text, text, int, text[]) to authenticated;
