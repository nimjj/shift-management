-- M4 + M6 schema: check-in rules, per-template overrides, check-in, test shifts, calendar settings.
--
-- Same conventions as before: every supervisor mutation is ONE SECURITY DEFINER function that checks
-- is_supervisor(), does the write and calls write_audit() in the same transaction, and returns
-- jsonb { audit_id, data }. Tables have no client write policies.
--
-- Two kinds of function here are NOT supervisor mutations and therefore write no audit row:
--   * check_in(): an agent recording their own attendance. checked_in_at is itself the record.
--   * the calendar bookkeeping the server does with the service role (invite sent / failed).

-- ---------------------------------------------------------------------------
-- org_settings: check-in rules (Settings screen 3) and calendar settings (screen 6)
-- ---------------------------------------------------------------------------
alter table public.org_settings
  add column checkin_open_before_min  int  not null default 15
    check (checkin_open_before_min between 0 and 1440),
  add column checkin_close_rule       text not null default 'shift_end'
    check (checkin_close_rule in ('shift_end', 'after_start')),
  add column checkin_close_after_min  int  not null default 30
    check (checkin_close_after_min between 1 and 1440),
  add column late_after_min           int  not null default 10
    check (late_after_min between 0 and 1440),
  add column covered_rule             text not null default 'all'
    check (covered_rule in ('all', 'at_least_n')),
  add column covered_min              int  not null default 1
    check (covered_min between 1 and 20),
  add column calendar_enabled         boolean not null default false,
  add column calendar_id              text,
  add column calendar_title_tpl       text not null default 'Voicify Monitoring — Block {block}',
  add column calendar_desc_tpl        text not null default
    E'Your shift: {start_local} to {end_local}.\n\nCheck in when you start:\n{checkin_link}',
  add column calendar_reminders_min   int[] not null default '{30,10}';

-- ---------------------------------------------------------------------------
-- template_overrides: NULL in a column = inherit the org default.
-- ---------------------------------------------------------------------------
create table public.template_overrides (
  template_id             uuid primary key references public.shift_templates (id) on delete cascade,
  checkin_open_before_min int  check (checkin_open_before_min between 0 and 1440),
  checkin_close_rule      text check (checkin_close_rule in ('shift_end', 'after_start')),
  checkin_close_after_min int  check (checkin_close_after_min between 1 and 1440),
  late_after_min          int  check (late_after_min between 0 and 1440),
  covered_rule            text check (covered_rule in ('all', 'at_least_n')),
  covered_min             int  check (covered_min between 1 and 20),
  updated_at              timestamptz not null default now()
);

alter table public.template_overrides enable row level security;
-- Agents read these too: My shifts shows when their check-in window opens.
create policy template_overrides_select on public.template_overrides
  for select to authenticated using ((select public.current_employee_id()) is not null);

-- ---------------------------------------------------------------------------
-- Cancelled calendar events. When an assignment row disappears (unassign, test shift deleted) its
-- invite must be cancelled, but the row that knew the event id is gone. A trigger parks the id
-- here; the server drains the queue right after the change and again on every cron tick.
-- ---------------------------------------------------------------------------
create table public.calendar_cancellations (
  event_id   text primary key,
  attempts   smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.calendar_cancellations enable row level security;
-- No policies: service role only.

create function public.queue_calendar_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.calendar_event_id is not null then
    insert into public.calendar_cancellations (event_id) values (old.calendar_event_id)
    on conflict (event_id) do nothing;
  end if;
  return old;
end;
$$;

create trigger assignments_queue_cancellation
  after delete on public.assignments
  for each row execute function public.queue_calendar_cancellation();

-- ---------------------------------------------------------------------------
-- effective_checkin_rules: org defaults merged with a template's overrides. Internal helper; the
-- same merge is lib/settings.ts effectiveRules() (unit tested) for display.
-- ---------------------------------------------------------------------------
create function public.effective_checkin_rules(p_template_id uuid)
returns table (
  open_before_min int, close_rule text, close_after_min int,
  late_after_min int, covered_rule text, covered_min int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(o.checkin_open_before_min, s.checkin_open_before_min),
    coalesce(o.checkin_close_rule,      s.checkin_close_rule),
    coalesce(o.checkin_close_after_min, s.checkin_close_after_min),
    coalesce(o.late_after_min,          s.late_after_min),
    coalesce(o.covered_rule,            s.covered_rule),
    coalesce(o.covered_min,             s.covered_min)
  from public.org_settings s
  left join public.template_overrides o on o.template_id = p_template_id
  where s.id = 1
$$;

-- ---------------------------------------------------------------------------
-- check_in: an agent checks in to their own assignment with its token.
-- Returns { status, checked_in_at, opens_at, closes_at }; status is one of
--   ok | already | too_early | closed | not_yours | not_found
-- Idempotent: a second call returns 'already' with the original timestamp.
-- The window is  starts_at - open_before  <=  now  <  closes_at, where closes_at is the shift end,
-- or (rule 'after_start') starts_at + close_after capped at the shift end.
-- ---------------------------------------------------------------------------
create function public.check_in(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := public.current_employee_id();
  v_a      public.assignments;
  v_s      public.shifts;
  v_r      record;
  v_opens  timestamptz;
  v_closes timestamptz;
  v_now    timestamptz := now();
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_a from public.assignments where checkin_token = p_token for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_a.employee_id <> v_me then
    return jsonb_build_object('status', 'not_yours');
  end if;

  select * into v_s from public.shifts where id = v_a.shift_id;
  select * into v_r from public.effective_checkin_rules(v_s.template_id);

  v_opens := v_s.starts_at - make_interval(mins => v_r.open_before_min);
  v_closes := case
    when v_r.close_rule = 'after_start'
      then least(v_s.ends_at, v_s.starts_at + make_interval(mins => v_r.close_after_min))
    else v_s.ends_at
  end;

  if v_a.checked_in_at is not null then
    return jsonb_build_object('status', 'already', 'checked_in_at', v_a.checked_in_at,
                              'opens_at', v_opens, 'closes_at', v_closes);
  end if;
  if v_now < v_opens then
    return jsonb_build_object('status', 'too_early', 'opens_at', v_opens, 'closes_at', v_closes);
  end if;
  if v_now >= v_closes then
    return jsonb_build_object('status', 'closed', 'opens_at', v_opens, 'closes_at', v_closes);
  end if;

  update public.assignments set checked_in_at = v_now
  where id = v_a.id and checked_in_at is null;

  return jsonb_build_object('status', 'ok', 'checked_in_at', v_now,
                            'opens_at', v_opens, 'closes_at', v_closes);
end;
$$;

-- ---------------------------------------------------------------------------
-- update_checkin_rules (Settings > Check-in rules, the org default)
-- ---------------------------------------------------------------------------
create function public.update_checkin_rules(
  p_open_before_min int,
  p_close_rule      text,
  p_close_after_min int,
  p_late_after_min  int,
  p_covered_rule    text,
  p_covered_min     int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.org_settings;
  v_after  public.org_settings;
  v_audit  bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_open_before_min is null or p_open_before_min not between 0 and 1440 then
    raise exception 'Check-in can open 0 to 1440 minutes before the start.' using errcode = 'P0001';
  end if;
  if p_close_rule is null or p_close_rule not in ('shift_end', 'after_start') then
    raise exception 'Pick when check-in closes.' using errcode = 'P0001';
  end if;
  if p_close_after_min is null or p_close_after_min not between 1 and 1440 then
    raise exception 'Check-in can close 1 to 1440 minutes after the start.' using errcode = 'P0001';
  end if;
  if p_late_after_min is null or p_late_after_min not between 0 and 1440 then
    raise exception 'Late can be 0 to 1440 minutes after the start.' using errcode = 'P0001';
  end if;
  if p_covered_rule is null or p_covered_rule not in ('all', 'at_least_n') then
    raise exception 'Pick what counts as covered.' using errcode = 'P0001';
  end if;
  if p_covered_min is null or p_covered_min not between 1 and 20 then
    raise exception 'The covered headcount must be 1 to 20.' using errcode = 'P0001';
  end if;

  select * into v_before from public.org_settings where id = 1 for update;

  update public.org_settings set
    checkin_open_before_min = p_open_before_min,
    checkin_close_rule      = p_close_rule,
    checkin_close_after_min = p_close_after_min,
    late_after_min          = p_late_after_min,
    covered_rule            = p_covered_rule,
    covered_min             = p_covered_min,
    updated_at              = now()
  where id = 1
  returning * into v_after;

  v_audit := public.write_audit('org_settings.update_checkin', 'org_settings', '1',
                                to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- set_template_override: NULL = inherit. All NULL removes the override row.
-- ---------------------------------------------------------------------------
create function public.set_template_override(
  p_template_id     uuid,
  p_open_before_min int default null,
  p_close_rule      text default null,
  p_close_after_min int default null,
  p_late_after_min  int default null,
  p_covered_rule    text default null,
  p_covered_min     int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_audit  bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.shift_templates where id = p_template_id) then
    raise exception 'That block no longer exists.' using errcode = 'P0001';
  end if;
  if p_open_before_min is not null and p_open_before_min not between 0 and 1440 then
    raise exception 'Check-in can open 0 to 1440 minutes before the start.' using errcode = 'P0001';
  end if;
  if p_close_rule is not null and p_close_rule not in ('shift_end', 'after_start') then
    raise exception 'Unknown close rule.' using errcode = 'P0001';
  end if;
  if p_close_after_min is not null and p_close_after_min not between 1 and 1440 then
    raise exception 'Check-in can close 1 to 1440 minutes after the start.' using errcode = 'P0001';
  end if;
  if p_late_after_min is not null and p_late_after_min not between 0 and 1440 then
    raise exception 'Late can be 0 to 1440 minutes after the start.' using errcode = 'P0001';
  end if;
  if p_covered_rule is not null and p_covered_rule not in ('all', 'at_least_n') then
    raise exception 'Unknown covered rule.' using errcode = 'P0001';
  end if;
  if p_covered_min is not null and p_covered_min not between 1 and 20 then
    raise exception 'The covered headcount must be 1 to 20.' using errcode = 'P0001';
  end if;

  select to_jsonb(o) into v_before from public.template_overrides o where o.template_id = p_template_id;

  if coalesce(p_open_before_min, p_close_after_min, p_late_after_min, p_covered_min) is null
     and p_close_rule is null and p_covered_rule is null then
    delete from public.template_overrides where template_id = p_template_id;
    v_after := null;
  else
    insert into public.template_overrides as o (
      template_id, checkin_open_before_min, checkin_close_rule, checkin_close_after_min,
      late_after_min, covered_rule, covered_min
    ) values (
      p_template_id, p_open_before_min, p_close_rule, p_close_after_min,
      p_late_after_min, p_covered_rule, p_covered_min
    )
    on conflict (template_id) do update set
      checkin_open_before_min = excluded.checkin_open_before_min,
      checkin_close_rule      = excluded.checkin_close_rule,
      checkin_close_after_min = excluded.checkin_close_after_min,
      late_after_min          = excluded.late_after_min,
      covered_rule            = excluded.covered_rule,
      covered_min             = excluded.covered_min,
      updated_at              = now();
    select to_jsonb(o) into v_after from public.template_overrides o where o.template_id = p_template_id;
  end if;

  v_audit := public.write_audit('template_overrides.set', 'shift_templates', p_template_id::text,
                                v_before, v_after);
  return jsonb_build_object('audit_id', v_audit, 'data', coalesce(v_after, 'null'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Test shifts: a shift with no template that starts N minutes from now (N may be negative), so
-- check-in and alerts can be tried without waiting for a weekend.
--   p_assignees = [{"employee_id": uuid, "role": "primary"|"backup"}, ...]
-- ---------------------------------------------------------------------------
create function public.create_test_shift(
  p_starts_in_min int,
  p_duration_min  int,
  p_assignees     jsonb,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_n     int;
  v_audit bigint;
  v_rows  jsonb;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_starts_in_min is null or p_starts_in_min not between -720 and 10080 then
    raise exception 'A test shift can start from 12 hours ago to 7 days from now.' using errcode = 'P0001';
  end if;
  if p_duration_min is null or p_duration_min not between 5 and 1440 then
    raise exception 'A test shift lasts 5 minutes to 24 hours.' using errcode = 'P0001';
  end if;
  if p_starts_in_min + p_duration_min <= 0 then
    raise exception 'That test shift would already be over. Make it longer or start it later.'
      using errcode = 'P0001';
  end if;
  if p_assignees is null or jsonb_typeof(p_assignees) <> 'array' then
    raise exception 'Expected a list of people.' using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(p_assignees);
  if v_n > 20 then
    raise exception 'At most 20 people on one shift.' using errcode = 'P0001';
  end if;
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

  insert into public.shifts (template_id, occurrence_date, starts_at, ends_at, is_test, notes)
  values (
    null, null,
    now() + make_interval(mins => p_starts_in_min),
    now() + make_interval(mins => p_starts_in_min + p_duration_min),
    true, nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into v_shift;

  insert into public.assignments (shift_id, employee_id, role, created_by)
  select v_shift.id, r.employee_id, r.role::public.assignment_role, public.current_employee_id()
  from jsonb_to_recordset(p_assignees) as r(employee_id uuid, role text);

  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb) into v_rows
  from public.assignments a where a.shift_id = v_shift.id;

  v_audit := public.write_audit('shifts.create_test', 'shifts', v_shift.id::text, null,
                                jsonb_build_object('shift', to_jsonb(v_shift), 'assignments', v_rows));
  return jsonb_build_object('audit_id', v_audit, 'data',
    jsonb_build_object('shift_id', v_shift.id, 'starts_at', v_shift.starts_at,
                       'ends_at', v_shift.ends_at, 'assignments', v_n));
end;
$$;

create function public.delete_test_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_rows  jsonb;
  v_audit bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'That shift no longer exists.' using errcode = 'P0001';
  end if;
  if not v_shift.is_test then
    raise exception 'Only test shifts can be deleted here.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.employee_id), '[]'::jsonb) into v_rows
  from public.assignments a where a.shift_id = p_shift_id;

  delete from public.shifts where id = p_shift_id;  -- assignments cascade; invites are queued for cancellation

  v_audit := public.write_audit('shifts.delete_test', 'shifts', p_shift_id::text,
                                jsonb_build_object('shift', to_jsonb(v_shift), 'assignments', v_rows), null);
  return jsonb_build_object('audit_id', v_audit, 'data', jsonb_build_object('shift_id', p_shift_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- update_calendar_settings (Settings > Calendar)
-- Turning the calendar on re-queues every invite for a shift that has not ended.
-- ---------------------------------------------------------------------------
create function public.update_calendar_settings(
  p_enabled       boolean,
  p_calendar_id   text,
  p_title_tpl     text,
  p_desc_tpl      text,
  p_reminders_min int[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before    public.org_settings;
  v_after     public.org_settings;
  v_id        text := nullif(trim(coalesce(p_calendar_id, '')), '');
  v_reminders int[];
  v_audit     bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Say whether calendar invites are on or off.' using errcode = 'P0001';
  end if;
  if p_enabled and v_id is null then
    raise exception 'Enter the calendar ID before switching invites on.' using errcode = 'P0001';
  end if;
  if v_id is not null and length(v_id) > 300 then
    raise exception 'That calendar ID is too long.' using errcode = 'P0001';
  end if;
  if p_title_tpl is null or length(trim(p_title_tpl)) = 0 or length(p_title_tpl) > 200 then
    raise exception 'The event title is required (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_desc_tpl is null or length(p_desc_tpl) > 4000 then
    raise exception 'The event description can be up to 4000 characters.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct m order by m desc), '{}') into v_reminders
  from unnest(coalesce(p_reminders_min, '{}'::int[])) as m;
  if cardinality(v_reminders) > 5 then
    raise exception 'At most 5 reminders.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_reminders) as m where m is null or m not between 0 and 40320) then
    raise exception 'Reminders are 0 to 40320 minutes before the shift.' using errcode = 'P0001';
  end if;

  select * into v_before from public.org_settings where id = 1 for update;

  update public.org_settings set
    calendar_enabled       = p_enabled,
    calendar_id            = v_id,
    calendar_title_tpl     = trim(p_title_tpl),
    calendar_desc_tpl      = p_desc_tpl,
    calendar_reminders_min = v_reminders,
    updated_at             = now()
  where id = 1
  returning * into v_after;

  if p_enabled then
    update public.assignments a
    set calendar_status = 'pending', calendar_attempts = 0, calendar_error = null
    from public.shifts s
    where s.id = a.shift_id and s.ends_at > now()
      and a.calendar_status in ('disabled', 'failed');
  end if;

  v_audit := public.write_audit('org_settings.update_calendar', 'org_settings', '1',
                                to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- retry_calendar_invite: the "Retry invite" button. Resets the attempt counter; the server then
-- sends the invite straight away.
-- ---------------------------------------------------------------------------
create function public.retry_calendar_invite(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.assignments;
  v_after  public.assignments;
  v_audit  bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  select * into v_before from public.assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'That assignment no longer exists. Reload the page.' using errcode = 'P0001';
  end if;

  update public.assignments
  set calendar_status = 'pending', calendar_attempts = 0, calendar_error = null
  where id = p_assignment_id
  returning * into v_after;

  v_audit := public.write_audit('assignments.retry_invite', 'assignments', p_assignment_id::text,
                                to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('audit_id', v_audit, 'data',
    jsonb_build_object('assignment_id', p_assignment_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.queue_calendar_cancellation() from public, anon, authenticated;
revoke execute on function public.effective_checkin_rules(uuid) from public, anon, authenticated;

revoke execute on function public.check_in(text) from public, anon;
revoke execute on function public.update_checkin_rules(int, text, int, int, text, int) from public, anon;
revoke execute on function public.set_template_override(uuid, int, text, int, int, text, int) from public, anon;
revoke execute on function public.create_test_shift(int, int, jsonb, text) from public, anon;
revoke execute on function public.delete_test_shift(uuid) from public, anon;
revoke execute on function public.update_calendar_settings(boolean, text, text, text, int[]) from public, anon;
revoke execute on function public.retry_calendar_invite(uuid) from public, anon;

grant execute on function public.check_in(text) to authenticated;
grant execute on function public.update_checkin_rules(int, text, int, int, text, int) to authenticated;
grant execute on function public.set_template_override(uuid, int, text, int, int, text, int) to authenticated;
grant execute on function public.create_test_shift(int, int, jsonb, text) to authenticated;
grant execute on function public.delete_test_shift(uuid) to authenticated;
grant execute on function public.update_calendar_settings(boolean, text, text, text, int[]) to authenticated;
grant execute on function public.retry_calendar_invite(uuid) to authenticated;
