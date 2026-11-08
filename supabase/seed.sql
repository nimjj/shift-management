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
