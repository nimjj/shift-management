-- M5 + M7 schema: notification rules, groups, firings, alerts, Telegram linking, the cron tick,
-- and Realtime for the dashboard.
--
-- Three kinds of function live here:
--   1. supervisor mutations  - SECURITY DEFINER, is_supervisor() check, write_audit(), return
--                              jsonb { audit_id, data }  (same pattern as every earlier migration)
--   2. self-service          - an employee changing only their OWN notification settings. Not a
--                              supervisor mutation, so no audit row.
--   3. service-role only     - called by the cron route / Telegram webhook, never by a browser.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.notification_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.notification_group_members (
  group_id    uuid not null references public.notification_groups (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  primary key (group_id, employee_id)
);
create index notification_group_members_employee_idx on public.notification_group_members (employee_id);

create table public.notification_rules (
  id              uuid primary key default gen_random_uuid(),
  position        int  not null,
  name            text not null check (length(trim(name)) > 0),
  trigger_minutes int  not null check (trigger_minutes between 0 and 1440),
  condition       text not null check (condition in ('agent_missing', 'nobody_in', 'fewer_than_n')),
  condition_n     int  check (condition_n between 1 and 20),
  recipient_type  text not null
    check (recipient_type in ('missing_agents', 'all_assignees', 'employees', 'role', 'group')),
  recipient_ids   uuid[] not null default '{}',          -- employees or groups, by recipient_type
  recipient_role  public.employee_role,                  -- when recipient_type = 'role'
  channels        text[] not null default array['email', 'telegram'],
  message_tpl     text not null check (length(trim(message_tpl)) > 0),
  template_scope  uuid[],                                -- NULL = every block (and test shifts)
  enabled         boolean not null default true,
  critical        boolean not null default false,        -- ignores quiet hours and channel choices
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint notification_rules_n_when_needed
    check ((condition = 'fewer_than_n') = (condition_n is not null)),
  constraint notification_rules_role_when_needed
    check ((recipient_type = 'role') = (recipient_role is not null)),
  constraint notification_rules_channels
    check (cardinality(channels) > 0 and channels <@ array['email', 'telegram'])
);

-- One row per (rule, shift) for shift-level rules and per (rule, shift, assignment) for
-- per-agent rules. NULLS NOT DISTINCT makes the shift-level rows unique too, so two overlapping
-- cron runs can never both claim the same firing.
create table public.rule_firings (
  id            bigint generated always as identity primary key,
  rule_id       uuid not null references public.notification_rules (id) on delete cascade,
  shift_id      uuid not null references public.shifts (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  fired_at      timestamptz not null default now(),
  constraint rule_firings_once unique nulls not distinct (rule_id, shift_id, assignment_id)
);
create index rule_firings_shift_idx on public.rule_firings (shift_id);

-- Every send attempt, including suppressed ones and "Send test".
create table public.alerts (
  id                    bigint generated always as identity primary key,
  rule_id               uuid references public.notification_rules (id) on delete set null,
  rule_name             text not null,
  shift_id              uuid references public.shifts (id) on delete set null,
  assignment_id         uuid references public.assignments (id) on delete set null,
  recipient_employee_id uuid references public.employees (id) on delete set null,
  recipient             text not null,                   -- email address or Telegram chat id
  channel               text not null check (channel in ('email', 'telegram')),
  status                text not null check (status in ('sent', 'failed', 'suppressed')),
  success               boolean not null,
  error                 text,
  payload               jsonb,
  is_test               boolean not null default false,
  sent_at               timestamptz not null default now()
);
create index alerts_sent_at_idx on public.alerts (sent_at desc);
create index alerts_shift_idx on public.alerts (shift_id);

create table public.telegram_link_tokens (
  token       text primary key,
  employee_id uuid not null references public.employees (id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index telegram_link_tokens_employee_idx on public.telegram_link_tokens (employee_id);

-- ---------------------------------------------------------------------------
-- RLS: read-only for clients (or nothing at all); every write goes through a function.
-- ---------------------------------------------------------------------------
alter table public.notification_groups        enable row level security;
alter table public.notification_group_members enable row level security;
alter table public.notification_rules         enable row level security;
alter table public.rule_firings               enable row level security;
alter table public.alerts                     enable row level security;
alter table public.telegram_link_tokens       enable row level security;

-- Everyone can see the list of groups (to subscribe); membership is own rows or supervisor.
create policy notification_groups_select on public.notification_groups
  for select to authenticated using ((select public.current_employee_id()) is not null);
create policy notification_group_members_select on public.notification_group_members
  for select to authenticated
  using ((select public.is_supervisor()) or employee_id = (select public.current_employee_id()));
create policy notification_rules_select on public.notification_rules
  for select to authenticated using ((select public.is_supervisor()));
create policy rule_firings_select on public.rule_firings
  for select to authenticated using ((select public.is_supervisor()));
create policy alerts_select on public.alerts
  for select to authenticated using ((select public.is_supervisor()));
-- telegram_link_tokens: no policies. Service role and the functions below only.

-- Hardening: notification prefs could still be written straight through PostgREST, which let a
-- supervisor change someone's settings with no audit row. Use the functions below instead.
drop policy prefs_insert on public.employee_notification_prefs;
drop policy prefs_update on public.employee_notification_prefs;

alter table public.employee_notification_prefs
  add constraint employee_notification_prefs_channels
    check (channels <@ array['email', 'telegram']),
  add constraint employee_notification_prefs_quiet_pair
    check ((quiet_hours_start is null) = (quiet_hours_end is null));

-- ---------------------------------------------------------------------------
-- Shared validation for notification preferences
-- ---------------------------------------------------------------------------
create function public.assert_valid_prefs(p_channels text[], p_quiet_start time, p_quiet_end time)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_channels is null or not (p_channels <@ array['email', 'telegram']) then
    raise exception 'Channels can be email and Telegram.' using errcode = 'P0001';
  end if;
  if (p_quiet_start is null) <> (p_quiet_end is null) then
    raise exception 'Quiet hours need both a start and an end (or neither).' using errcode = 'P0001';
  end if;
  if p_quiet_start is not null and p_quiet_start = p_quiet_end then
    raise exception 'Quiet hours can''t start and end at the same time.' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Supervisor mutations
-- ---------------------------------------------------------------------------

-- p_rule = { name, trigger_minutes, condition, condition_n, recipient_type, recipient_ids[],
--            recipient_role, channels[], message_tpl, template_scope[]|null, enabled, critical }
-- p_id null = create (added at the end of the ladder), otherwise update.
create function public.save_notification_rule(p_id uuid, p_rule jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text := trim(coalesce(p_rule ->> 'name', ''));
  v_trigger   int  := (p_rule ->> 'trigger_minutes')::int;
  v_condition text := p_rule ->> 'condition';
  v_n         int  := (p_rule ->> 'condition_n')::int;
  v_rtype     text := p_rule ->> 'recipient_type';
  v_rids      uuid[];
  v_rrole     text := p_rule ->> 'recipient_role';
  v_channels  text[];
  v_tpl       text := coalesce(p_rule ->> 'message_tpl', '');
  v_scope     uuid[];
  v_enabled   boolean := coalesce((p_rule ->> 'enabled')::boolean, true);
  v_critical  boolean := coalesce((p_rule ->> 'critical')::boolean, false);
  v_before    public.notification_rules;
  v_after     public.notification_rules;
  v_audit     bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    raise exception 'Malformed rule.' using errcode = 'P0001';
  end if;

  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'Give the stage a name (up to 80 characters).' using errcode = 'P0001';
  end if;
  if v_trigger is null or v_trigger not between 0 and 1440 then
    raise exception 'A stage fires 0 to 1440 minutes after the shift starts.' using errcode = 'P0001';
  end if;
  if v_condition is null or v_condition not in ('agent_missing', 'nobody_in', 'fewer_than_n') then
    raise exception 'Pick a condition.' using errcode = 'P0001';
  end if;
  if v_condition = 'fewer_than_n' then
    if v_n is null or v_n not between 1 and 20 then
      raise exception '"Fewer than N" needs N from 1 to 20.' using errcode = 'P0001';
    end if;
  else
    v_n := null;
  end if;
  if v_rtype is null or v_rtype not in ('missing_agents', 'all_assignees', 'employees', 'role', 'group') then
    raise exception 'Pick who receives it.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_rule -> 'recipient_ids') = 'array' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_rids
    from jsonb_array_elements_text(p_rule -> 'recipient_ids') as x;
  else
    v_rids := '{}';
  end if;

  if v_rtype = 'employees' then
    if cardinality(v_rids) = 0 then
      raise exception 'Pick at least one person.' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(v_rids) as x
               left join public.employees e on e.id = x where e.id is null) then
      raise exception 'One of the people no longer exists.' using errcode = 'P0001';
    end if;
  elsif v_rtype = 'group' then
    if cardinality(v_rids) = 0 then
      raise exception 'Pick at least one group.' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(v_rids) as x
               left join public.notification_groups g on g.id = x where g.id is null) then
      raise exception 'One of the groups no longer exists.' using errcode = 'P0001';
    end if;
  else
    v_rids := '{}';
  end if;

  if v_rtype = 'role' then
    if v_rrole is null or v_rrole not in ('supervisor', 'agent') then
      raise exception 'Pick a role.' using errcode = 'P0001';
    end if;
  else
    v_rrole := null;
  end if;

  if jsonb_typeof(p_rule -> 'channels') = 'array' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_channels
    from jsonb_array_elements_text(p_rule -> 'channels') as x;
  else
    v_channels := '{}';
  end if;
  if cardinality(v_channels) = 0 or not (v_channels <@ array['email', 'telegram']) then
    raise exception 'Pick at least one channel: email or Telegram.' using errcode = 'P0001';
  end if;

  if length(trim(v_tpl)) = 0 or length(v_tpl) > 2000 then
    raise exception 'The message is required (up to 2000 characters).' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_rule -> 'template_scope') = 'array'
     and jsonb_array_length(p_rule -> 'template_scope') > 0 then
    select array_agg(distinct x::uuid) into v_scope
    from jsonb_array_elements_text(p_rule -> 'template_scope') as x;
    if exists (select 1 from unnest(v_scope) as x
               left join public.shift_templates t on t.id = x where t.id is null) then
      raise exception 'One of the blocks no longer exists.' using errcode = 'P0001';
    end if;
  else
    v_scope := null;
  end if;

  if p_id is null then
    insert into public.notification_rules (
      position, name, trigger_minutes, condition, condition_n, recipient_type, recipient_ids,
      recipient_role, channels, message_tpl, template_scope, enabled, critical
    ) values (
      (select coalesce(max(position), 0) + 1 from public.notification_rules),
      v_name, v_trigger, v_condition, v_n, v_rtype, v_rids,
      v_rrole::public.employee_role, v_channels, v_tpl, v_scope, v_enabled, v_critical
    )
    returning * into v_after;

    v_audit := public.write_audit('notification_rules.create', 'notification_rules', v_after.id::text,
                                  null, to_jsonb(v_after));
  else
    select * into v_before from public.notification_rules where id = p_id for update;
    if not found then
      raise exception 'That stage no longer exists. Reload the page.' using errcode = 'P0001';
    end if;

    update public.notification_rules set
      name = v_name, trigger_minutes = v_trigger, condition = v_condition, condition_n = v_n,
      recipient_type = v_rtype, recipient_ids = v_rids, recipient_role = v_rrole::public.employee_role,
      channels = v_channels, message_tpl = v_tpl, template_scope = v_scope,
      enabled = v_enabled, critical = v_critical, updated_at = now()
    where id = p_id
    returning * into v_after;

    v_audit := public.write_audit('notification_rules.update', 'notification_rules', p_id::text,
                                  to_jsonb(v_before), to_jsonb(v_after));
  end if;

  return jsonb_build_object('audit_id', v_audit, 'data', to_jsonb(v_after));
end;
$$;

create function public.delete_notification_rule(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.notification_rules;
  v_audit  bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  delete from public.notification_rules where id = p_id returning * into v_before;
  if not found then
    raise exception 'That stage no longer exists. Reload the page.' using errcode = 'P0001';
  end if;

  v_audit := public.write_audit('notification_rules.delete', 'notification_rules', p_id::text,
                                to_jsonb(v_before), null);
  return jsonb_build_object('audit_id', v_audit, 'data', jsonb_build_object('id', p_id));
end;
$$;

-- p_ids = every rule id, in the new order.
create function public.reorder_notification_rules(p_ids uuid[])
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
  if p_ids is null
     or cardinality(p_ids) <> (select count(*) from public.notification_rules)
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) as x)
     or exists (select 1 from unnest(p_ids) as x
                left join public.notification_rules r on r.id = x where r.id is null) then
    raise exception 'The list of stages changed. Reload the page and try again.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(r.id order by r.position, r.created_at), '[]'::jsonb) into v_before
  from public.notification_rules r;

  update public.notification_rules r set position = o.ord, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, ord)
  where r.id = o.id and r.position <> o.ord;

  select coalesce(jsonb_agg(r.id order by r.position, r.created_at), '[]'::jsonb) into v_after
  from public.notification_rules r;

  v_audit := public.write_audit('notification_rules.reorder', 'notification_rules', null,
                                jsonb_build_object('order', v_before),
                                jsonb_build_object('order', v_after));
  return jsonb_build_object('audit_id', v_audit, 'data', jsonb_build_object('count', cardinality(p_ids)));
end;
$$;

-- p_id null = create. Members are replaced with p_member_ids.
create function public.save_notification_group(p_id uuid, p_name text, p_member_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text := trim(coalesce(p_name, ''));
  v_members uuid[];
  v_id      uuid := p_id;
  v_before  jsonb;
  v_after   jsonb;
  v_audit   bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'Give the group a name (up to 80 characters).' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_members
  from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x where x is not null;
  if exists (select 1 from unnest(v_members) as x
             left join public.employees e on e.id = x where e.id is null) then
    raise exception 'One of the people no longer exists.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.notification_groups g
             where lower(g.name) = lower(v_name) and (v_id is null or g.id <> v_id)) then
    raise exception 'A group with that name already exists.' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.notification_groups (name) values (v_name) returning id into v_id;
  else
    select jsonb_build_object('name', g.name, 'members',
             (select coalesce(jsonb_agg(m.employee_id order by m.employee_id), '[]'::jsonb)
              from public.notification_group_members m where m.group_id = g.id))
      into v_before
    from public.notification_groups g where g.id = v_id for update;
    if v_before is null then
      raise exception 'That group no longer exists. Reload the page.' using errcode = 'P0001';
    end if;
    update public.notification_groups set name = v_name where id = v_id;
  end if;

  delete from public.notification_group_members
  where group_id = v_id and employee_id <> all (v_members);
  insert into public.notification_group_members (group_id, employee_id)
  select v_id, x from unnest(v_members) as x
  on conflict do nothing;

  v_after := jsonb_build_object('name', v_name, 'members',
    (select coalesce(jsonb_agg(m.employee_id order by m.employee_id), '[]'::jsonb)
     from public.notification_group_members m where m.group_id = v_id));

  v_audit := public.write_audit(
    case when p_id is null then 'notification_groups.create' else 'notification_groups.update' end,
    'notification_groups', v_id::text, v_before, v_after);
  return jsonb_build_object('audit_id', v_audit, 'data',
    jsonb_build_object('id', v_id, 'name', v_name, 'members', cardinality(v_members)));
end;
$$;

create function public.delete_notification_group(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_used   text;
  v_audit  bigint;
begin
  if not public.is_supervisor() then
    raise exception 'Supervisors only.' using errcode = '42501';
  end if;

  select string_agg(r.name, ', ' order by r.position) into v_used
  from public.notification_rules r
  where r.recipient_type = 'group' and p_id = any (r.recipient_ids);
  if v_used is not null then
    raise exception 'That group is still used by: %. Change those stages first.', v_used
      using errcode = 'P0001';
  end if;

  select jsonb_build_object('name', g.name, 'members',
           (select coalesce(jsonb_agg(m.employee_id order by m.employee_id), '[]'::jsonb)
            from public.notification_group_members m where m.group_id = g.id))
    into v_before
  from public.notification_groups g where g.id = p_id for update;
  if v_before is null then
    raise exception 'That group no longer exists. Reload the page.' using errcode = 'P0001';
  end if;

  delete from public.notification_groups where id = p_id;

  v_audit := public.write_audit('notification_groups.delete', 'notification_groups', p_id::text,
                                v_before, null);
  return jsonb_build_object('audit_id', v_audit, 'data', jsonb_build_object('id', p_id));
end;
$$;

-- A supervisor overriding someone's channels and quiet hours.
create function public.update_employee_prefs(
  p_employee_id uuid,
  p_channels    text[],
  p_quiet_start time,
  p_quiet_end   time
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
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'That person no longer exists.' using errcode = 'P0001';
  end if;
  perform public.assert_valid_prefs(p_channels, p_quiet_start, p_quiet_end);

  select to_jsonb(p) into v_before
  from public.employee_notification_prefs p where p.employee_id = p_employee_id;

  insert into public.employee_notification_prefs (employee_id, channels, quiet_hours_start, quiet_hours_end)
  values (p_employee_id, p_channels, p_quiet_start, p_quiet_end)
  on conflict (employee_id) do update set
    channels = excluded.channels,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end;

  select to_jsonb(p) into v_after
  from public.employee_notification_prefs p where p.employee_id = p_employee_id;

  v_audit := public.write_audit('employee_prefs.update', 'employees', p_employee_id::text, v_before, v_after);
  return jsonb_build_object('audit_id', v_audit, 'data', v_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Self-service: the signed-in employee, their own row only. No audit row.
-- ---------------------------------------------------------------------------
create function public.update_my_prefs(
  p_channels    text[],
  p_quiet_start time,
  p_quiet_end   time,
  p_display_tz  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
  v_tz text := nullif(trim(coalesce(p_display_tz, '')), '');
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  perform public.assert_valid_prefs(p_channels, p_quiet_start, p_quiet_end);
  perform public.assert_valid_timezone(v_tz);

  insert into public.employee_notification_prefs
    (employee_id, channels, quiet_hours_start, quiet_hours_end, display_tz)
  values (v_me, p_channels, p_quiet_start, p_quiet_end, v_tz)
  on conflict (employee_id) do update set
    channels = excluded.channels,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    display_tz = excluded.display_tz;

  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_my_group_subscription(p_group_id uuid, p_subscribed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.notification_groups where id = p_group_id) then
    raise exception 'That group no longer exists.' using errcode = 'P0001';
  end if;

  if p_subscribed then
    insert into public.notification_group_members (group_id, employee_id)
    values (p_group_id, v_me) on conflict do nothing;
  else
    delete from public.notification_group_members where group_id = p_group_id and employee_id = v_me;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- A one-time token for https://t.me/<bot>?start=<token>. Expires after 15 minutes.
create function public.create_telegram_link_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.current_employee_id();
  v_token text;
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  delete from public.telegram_link_tokens
  where employee_id = v_me or expires_at < now() - interval '1 day';

  v_token := left(public.new_checkin_token(), 48);
  insert into public.telegram_link_tokens (token, employee_id, expires_at)
  values (v_token, v_me, now() + interval '15 minutes');
  return v_token;
end;
$$;

create function public.disconnect_my_telegram()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  update public.employees set telegram_chat_id = null where id = v_me;
  delete from public.telegram_link_tokens where employee_id = v_me;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Service role only
-- ---------------------------------------------------------------------------

-- The Telegram webhook: match the /start token and save the chat id. Returns the employee's name,
-- or NULL when the token is unknown, used or expired.
create function public.link_telegram(p_token text, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid;
  v_name     text;
begin
  update public.telegram_link_tokens
  set used_at = now()
  where token = p_token and used_at is null and expires_at > now()
  returning employee_id into v_employee;
  if v_employee is null then
    return null;
  end if;

  -- One Telegram chat belongs to one employee.
  update public.employees set telegram_chat_id = null
  where telegram_chat_id = p_chat_id and id <> v_employee;
  update public.employees set telegram_chat_id = p_chat_id
  where id = v_employee and active
  returning full_name into v_name;
  return v_name;
end;
$$;

-- Claim firings: returns only the rows this call actually inserted, so each firing is sent by
-- exactly one cron run however many overlap.
--   p_rows = [{"rule_id": uuid, "shift_id": uuid, "assignment_id": uuid|null}, ...]
create function public.claim_rule_firings(p_rows jsonb)
returns setof public.rule_firings
language sql
security definer
set search_path = ''
as $$
  insert into public.rule_firings (rule_id, shift_id, assignment_id)
  select r.rule_id, r.shift_id, r.assignment_id
  from jsonb_to_recordset(p_rows) as r(rule_id uuid, shift_id uuid, assignment_id uuid)
  on conflict on constraint rule_firings_once do nothing
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.assert_valid_prefs(text[], time, time) from public, anon;
revoke execute on function public.save_notification_rule(uuid, jsonb) from public, anon;
revoke execute on function public.delete_notification_rule(uuid) from public, anon;
revoke execute on function public.reorder_notification_rules(uuid[]) from public, anon;
revoke execute on function public.save_notification_group(uuid, text, uuid[]) from public, anon;
revoke execute on function public.delete_notification_group(uuid) from public, anon;
revoke execute on function public.update_employee_prefs(uuid, text[], time, time) from public, anon;
revoke execute on function public.update_my_prefs(text[], time, time, text) from public, anon;
revoke execute on function public.set_my_group_subscription(uuid, boolean) from public, anon;
revoke execute on function public.create_telegram_link_token() from public, anon;
revoke execute on function public.disconnect_my_telegram() from public, anon;
revoke execute on function public.link_telegram(text, bigint) from public, anon, authenticated;
revoke execute on function public.claim_rule_firings(jsonb) from public, anon, authenticated;

grant execute on function public.assert_valid_prefs(text[], time, time) to authenticated;
grant execute on function public.save_notification_rule(uuid, jsonb) to authenticated;
grant execute on function public.delete_notification_rule(uuid) to authenticated;
grant execute on function public.reorder_notification_rules(uuid[]) to authenticated;
grant execute on function public.save_notification_group(uuid, text, uuid[]) to authenticated;
grant execute on function public.delete_notification_group(uuid) to authenticated;
grant execute on function public.update_employee_prefs(uuid, text[], time, time) to authenticated;
grant execute on function public.update_my_prefs(text[], time, time, text) to authenticated;
grant execute on function public.set_my_group_subscription(uuid, boolean) to authenticated;
grant execute on function public.create_telegram_link_token() to authenticated;
grant execute on function public.disconnect_my_telegram() to authenticated;
grant execute on function public.link_telegram(text, bigint) to service_role;
grant execute on function public.claim_rule_firings(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Default escalation ladder (the seed only; supervisors edit it in Settings > Notification rules)
-- ---------------------------------------------------------------------------
insert into public.notification_rules
  (position, name, trigger_minutes, condition, recipient_type, recipient_role, channels, message_tpl, critical)
select v.position, v.name, v.trigger_minutes, v.condition, v.recipient_type,
       v.recipient_role::public.employee_role, array['email', 'telegram'], v.message_tpl, v.critical
from (values
  (1, 'Agent reminder 1', 10, 'agent_missing', 'missing_agents', null,
   '⏰ Block {block} started at {start_local}. Please check in: {checkin_link}', false),
  (2, 'Agent reminder 2', 15, 'nobody_in', 'missing_agents', null,
   '⏰ Second reminder: Block {block} started at {start_local} and nobody has checked in. Please check in now: {checkin_link}', false),
  (3, 'Supervisor alert', 17, 'nobody_in', 'role', 'supervisor',
   '⚠️ Block {block} ({start_local}) is UNCOVERED — nobody has checked in after 17 min. Assigned: {agents}. {dashboard_link}', true)
) as v(position, name, trigger_minutes, condition, recipient_type, recipient_role, message_tpl, critical)
where not exists (select 1 from public.notification_rules);

-- ---------------------------------------------------------------------------
-- The cron tick: every minute, POST {app_url}/api/cron/check-shifts with the shared secret.
-- Both values come from Supabase Vault, so this file holds no secrets and no URLs. Until the two
-- Vault secrets exist (see SETUP.md) the tick does nothing.
--   select vault.create_secret('https://your-app.vercel.app', 'app_url');
--   select vault.create_secret('<the same value as CRON_SECRET in Vercel>', 'cron_secret');
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create function public.invoke_check_shifts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/check-shifts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

revoke execute on function public.invoke_check_shifts() from public, anon, authenticated;

select cron.schedule('shiftboard-check-shifts', '* * * * *', $cron$select public.invoke_check_shifts()$cron$);

-- ---------------------------------------------------------------------------
-- Realtime for the live dashboard (RLS still applies: supervisors see everything, agents their own)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.assignments, public.shifts;
