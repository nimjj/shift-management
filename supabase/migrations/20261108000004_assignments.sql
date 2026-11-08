-- M3: assignments (who works which shift), the agent read path, and the carried-over
-- regeneration guard from M2.
--
-- Same conventions as 20261108000002 / ...003:
--   * every supervisor mutation is ONE SECURITY DEFINER function that writes the change AND its
--     audit_log row in the same transaction, and returns jsonb { "audit_id", "data" }
--   * tables have NO client write policies
--   * user-facing validation uses errcode 'P0001'; not-a-supervisor uses '42501'

create type public.assignment_role as enum ('primary', 'backup');

-- ---------------------------------------------------------------------------
-- Check-in tokens. The token is the whole secret in the calendar invite link, so it is
-- generated in the database and never derived from anything guessable (no ids, no timestamps).
-- Two v4 UUIDs = 244 bits of randomness, with no extension dependency.
-- ---------------------------------------------------------------------------
create function public.new_checkin_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(pg_catalog.gen_random_uuid()::text, '-', '')
      || replace(pg_catalog.gen_random_uuid()::text, '-', '');
$$;

create table public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  shift_id           uuid not null references public.shifts (id) on delete cascade,
  employee_id        uuid not null references public.employees (id) on delete restrict,
  role               public.assignment_role not null default 'primary',
  checkin_token      text not null unique default public.new_checkin_token(),
  checked_in_at      timestamptz,
  -- Calendar bookkeeping is written in M6; the columns exist now so assignments never need a
  -- second migration for the "Retry invite" badge.
  calendar_event_id  text,
  calendar_status    text not null default 'pending'
                       check (calendar_status in ('pending', 'sent', 'failed', 'cancelled', 'disabled')),
  calendar_error     text,
  calendar_attempts  smallint not null default 0,
  created_by         uuid references public.employees (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint assignments_shift_employee_key unique (shift_id, employee_id)
);

create index assignments_shift_idx on public.assignments (shift_id);
create index assignments_employee_idx on public.assignments (employee_id);

-- ---------------------------------------------------------------------------
-- RLS. Read-only for clients; agents see only their own rows.
-- ---------------------------------------------------------------------------
alter table public.assignments enable row level security;

create policy assignments_select on public.assignments
  for select to authenticated
  using (
    (select public.is_supervisor())
    or employee_id = (select public.current_employee_id())
  );

-- Carried over from M2: agents can now read the shifts they are assigned to (and only those).
-- No recursion: the assignments policy above never looks at shifts.
drop policy shifts_select on public.shifts;

create policy shifts_select on public.shifts
  for select to authenticated
  using (
    (select public.is_supervisor())
    or exists (
      select 1 from public.assignments a
      where a.shift_id = shifts.id
        and a.employee_id = (select public.current_employee_id())
    )
  );

-- ---------------------------------------------------------------------------
-- set_shift_assignments: the whole roster of one shift, set in one atomic audited call.
-- Assign, reassign and unassign are all this function: pass the list you want to end up with.
--   p_assignees = [{"employee_id": uuid, "role": "primary"|"backup"}, ...]  ([] clears the shift)
-- ---------------------------------------------------------------------------
create function public.set_shift_assignments(p_shift_id uuid, p_assignees jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift     public.shifts;
  v_actor     uuid;
  v_before    jsonb;
  v_after     jsonb;
  v_n         int;
  v_added     int;
  v_removed   int;
  v_changed   int;
  v_checked   text;
  v_audit     bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_assignees is null or jsonb_typeof(p_assignees) <> 'array' then
    raise exception 'Expected a list of people.' using errcode = 'P0001';
  end if;

  v_actor := public.current_employee_id();

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'That shift no longer exists. Reload the grid.' using errcode = 'P0001';
  end if;
  if v_shift.ends_at <= now() then
    raise exception 'That shift has already finished, so its roster can''t be changed.' using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(p_assignees);
  if v_n > 20 then
    raise exception 'At most 20 people on one shift.' using errcode = 'P0001';
  end if;

  -- Validate the request before touching anything.
  if exists (
    select 1 from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text)
    where r.employee_id is null or r.role is null or r.role not in ('primary', 'backup')
  ) then
    raise exception 'Each person needs an id and a role of primary or backup.' using errcode = 'P0001';
  end if;

  if v_n <> (select count(distinct r.employee_id)
             from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text)) then
    raise exception 'The same person is listed twice.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text)
    left join public.employees e on e.id = r.employee_id and e.active
    where e.id is null
  ) then
    raise exception 'One of the people is not an active employee.' using errcode = 'P0001';
  end if;

  -- Someone who has checked in cannot be dropped: their attendance is a record of what happened.
  select string_agg(e.full_name, ', ' order by e.full_name) into v_checked
  from public.assignments a
  join public.employees e on e.id = a.employee_id
  where a.shift_id = p_shift_id
    and a.checked_in_at is not null
    and a.employee_id not in (
      select r.employee_id from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text)
    );
  if v_checked is not null then
    raise exception '% already checked in to this shift and can''t be removed from it.', v_checked
      using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb) into v_before
  from public.assignments a where a.shift_id = p_shift_id;

  with removed as (
    delete from public.assignments a
    where a.shift_id = p_shift_id
      and a.employee_id not in (
        select r.employee_id from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text)
      )
    returning 1
  )
  select count(*) into v_removed from removed;

  -- Role changes keep the row, so the check-in token and the calendar event survive.
  with changed as (
    update public.assignments a
    set role = r.role::public.assignment_role
    from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text)
    where a.shift_id = p_shift_id
      and a.employee_id = r.employee_id
      and a.role <> r.role::public.assignment_role
    returning 1
  )
  select count(*) into v_changed from changed;

  with added as (
    insert into public.assignments (shift_id, employee_id, role, created_by)
    select p_shift_id, r.employee_id, r.role::public.assignment_role, v_actor
    from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text)
    on conflict on constraint assignments_shift_employee_key do nothing
    returning 1
  )
  select count(*) into v_added from added;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb) into v_after
  from public.assignments a where a.shift_id = p_shift_id;

  v_audit := public.write_audit(
    'assignments.set', 'shifts', p_shift_id::text,
    jsonb_build_object('assignments', v_before),
    jsonb_build_object('assignments', v_after)
  );

  return jsonb_build_object('audit_id', v_audit, 'data', jsonb_build_object(
    'shift_id', p_shift_id, 'added', v_added, 'removed', v_removed,
    'changed', v_changed, 'total', v_n));
end;
$$;

-- ---------------------------------------------------------------------------
-- copy_week_assignments: fills EMPTY shifts only, so it can never overwrite a roster.
--   p_pairs = [{"from_shift_id": uuid, "to_shift_id": uuid}, ...]   (paired by block, in the app)
-- A target that already has anyone on it, or that has finished, is skipped and reported.
-- ---------------------------------------------------------------------------
create function public.copy_week_assignments(p_pairs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid;
  v_filled   int;
  v_copied   int;
  v_skipped  jsonb;
  v_audit    bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'Expected a list of shifts to copy.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_pairs) > 500 then
    raise exception 'Too many shifts in one request (max 500).' using errcode = 'P0001';
  end if;

  v_actor := public.current_employee_id();

  if exists (
    select 1 from jsonb_to_recordset(p_pairs) as r(from_shift_id uuid, to_shift_id uuid)
    where r.from_shift_id is null or r.to_shift_id is null
  ) then
    raise exception 'A shift in the request is missing.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_pairs) as r(from_shift_id uuid, to_shift_id uuid)
    group by r.to_shift_id having count(*) > 1
  ) then
    raise exception 'The same shift is listed as a target twice.' using errcode = 'P0001';
  end if;

  -- Report, per target, why it was skipped. Everything else gets copied.
  select coalesce(jsonb_agg(jsonb_build_object('to_shift_id', p.to_shift_id, 'reason', x.reason)), '[]'::jsonb)
    into v_skipped
  from jsonb_to_recordset(p_pairs) as p(from_shift_id uuid, to_shift_id uuid)
  cross join lateral (
    select case
      when not exists (select 1 from public.shifts s where s.id = p.to_shift_id) then 'missing'
      when (select s.ends_at from public.shifts s where s.id = p.to_shift_id) <= now() then 'finished'
      when exists (select 1 from public.assignments a where a.shift_id = p.to_shift_id) then 'already_assigned'
      when not exists (select 1 from public.assignments a where a.shift_id = p.from_shift_id) then 'source_empty'
      else null
    end as reason
  ) x
  where x.reason is not null;

  with ins as (
    insert into public.assignments (shift_id, employee_id, role, created_by)
    select p.to_shift_id, a.employee_id, a.role, v_actor
    from jsonb_to_recordset(p_pairs) as p(from_shift_id uuid, to_shift_id uuid)
    join public.assignments a on a.shift_id = p.from_shift_id
    join public.shifts t on t.id = p.to_shift_id and t.ends_at > now()
    join public.employees e on e.id = a.employee_id and e.active
    where not exists (select 1 from public.assignments x where x.shift_id = p.to_shift_id)
    on conflict on constraint assignments_shift_employee_key do nothing
    returning shift_id
  )
  select count(*), count(distinct shift_id) into v_copied, v_filled from ins;

  v_audit := public.write_audit(
    'assignments.copy_week', 'shifts', null, null,
    jsonb_build_object('pairs', p_pairs, 'shifts_filled', v_filled,
                       'assignments_created', v_copied, 'skipped', v_skipped)
  );

  return jsonb_build_object('audit_id', v_audit, 'data', jsonb_build_object(
    'shifts_filled', v_filled, 'assignments_created', v_copied, 'skipped', v_skipped));
end;
$$;

-- ---------------------------------------------------------------------------
-- Carried over from M2: regeneration must never move or remove a shift that has assignments.
-- The preview excludes them (and lists them as "kept"); this is the guard that makes it true even
-- if someone assigns an agent between the preview and Apply.
-- Only the two new blocks marked "M3" differ from 20261108000003.
-- ---------------------------------------------------------------------------
create or replace function public.apply_shift_regeneration(p_changes jsonb)
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
  v_assigned constant text := 'A shift in this change now has people assigned to it. Review the preview again: assigned shifts are left alone.';
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

  -- M3: a shift with people on it is never moved or removed by regeneration.
  if exists (
    select 1 from public.assignments a
    where a.shift_id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_moved) e)
       or a.shift_id in (select (e #>> '{}')::uuid from jsonb_array_elements(v_removed) e)
  ) then
    raise exception '%', v_assigned using errcode = 'P0001';
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
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.new_checkin_token() from public, anon, authenticated;
revoke execute on function public.set_shift_assignments(uuid, jsonb) from public, anon;
revoke execute on function public.copy_week_assignments(jsonb) from public, anon;

grant execute on function public.set_shift_assignments(uuid, jsonb) to authenticated;
grant execute on function public.copy_week_assignments(jsonb) to authenticated;
