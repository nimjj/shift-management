-- Seed for first run. Safe to re-run (idempotent).
-- Run in Supabase Dashboard > SQL Editor after `supabase db push`.

insert into public.org_settings (id, org_name, client_tz, default_display_tz, week_start, allowed_domains)
values (1, 'Adept Technologies', 'America/Chicago', 'Asia/Colombo', 1, array['adept-tech.us'])
on conflict (id) do nothing;

-- Seed employees. Only Nimithra has a real, login-capable email.
-- The agents use non-routable placeholders so nobody can sign in as them by accident;
-- replace them with real work emails in the app under Settings > Employees.
insert into public.employees (full_name, email, role) values
  ('Nimithra', 'nimithra@adept-tech.us',    'supervisor'),
  ('Pooja',    'pooja@placeholder.invalid',    'agent'),
  ('Thejan',   'thejan@placeholder.invalid',   'agent'),
  ('Luchitha', 'luchitha@placeholder.invalid', 'agent'),
  ('Sayuru',   'sayuru@placeholder.invalid',   'agent')
on conflict (email) do nothing;

-- Shift blocks (times are in the client zone, org_settings.client_tz; weekday 0 = Sunday).
-- Confirm these with the client before go-live. Everything here is editable in Settings > Shift templates.
insert into public.shift_templates (code, name, start_weekday, start_local_time, end_weekday, end_local_time, required_headcount, colour) values
  ('1',  'Block 1 · Fri',    5, '16:00', 5, '22:00', 1, '#6366f1'),
  ('2a', 'Block 2a · Sat AM', 6, '10:00', 6, '16:00', 1, '#0ea5e9'),
  ('2b', 'Block 2b · Sat PM', 6, '16:00', 6, '22:00', 1, '#14b8a6'),
  ('3a', 'Block 3a · Sun AM', 0, '10:00', 0, '16:00', 1, '#f59e0b'),
  ('3b', 'Block 3b · Sun PM', 0, '16:00', 0, '22:00', 1, '#a855f7')
on conflict (code) do nothing;

-- The default 10 / 15 / 17 notification ladder is seeded by migration 20261111000007 (only when the
-- table is empty), and the check-in and calendar defaults are column defaults on org_settings.
-- Everything is editable under Settings.
