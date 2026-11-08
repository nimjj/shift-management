# ShiftBoard — Shift Management for Voicify Weekend Monitoring

## What this is
Adept Technologies runs a weekend monitoring service for Voicify's AI ordering system. Agents work fixed shift blocks. This app replaces a Google Sheet roster with real shift management:

- Supervisor assigns agents to shifts.
- Each assignment automatically sends a Google Calendar invite to the agent's work email, containing a one-click **check-in link**.
- Agent clicks the link at shift start → shift slot is marked covered.
- Escalating reminders: missing agents are nudged at **+10 min** and (if the shift is still uncovered) **+15 min**; the supervisor is alerted at **+17 min** only if **nobody** on the shift has checked in. See "No-show checker".
- Supervisor dashboard shows live status for every shift.

Future: weekday coverage, then a wider HR system. Design the data model so `employees` and `shifts` can carry more features later. Do NOT build HR features now.

## Stack (decided — don't change without asking)
- **TypeScript** everywhere
- **Next.js (App Router)** on **Vercel** (Hobby for dev, Pro at go-live on a company subdomain, e.g. `shifts.adept-tech.us`)
- **Supabase**: Postgres, Auth (Google provider), Realtime, `pg_cron` + `pg_net`
- **Google Calendar API** via a service account with **domain-wide delegation** (Adept is on Google Workspace)
- **Email alerts**: Gmail API via the same service account (impersonating a sender mailbox), fallback Resend
- **Phone alerts**: Telegram Bot API
- UI: Tailwind + shadcn/ui
- Validation: Zod. DB access: Supabase JS client with generated types.

## Users & auth
- Sign-in with Google only, restricted to the `adept-tech.us` domain (check the `hd` claim / email domain server-side; reject everything else).
- Roles: `supervisor`, `agent`. Stored on `employees.role`. Supervisors can do everything; agents see only their own shifts and the check-in page.
- Use Supabase Row Level Security on every table.

## Time zones — critical
- Shift blocks are anchored to the **client's US time zone** (config value `CLIENT_TZ`, default `America/Chicago` — confirm with the user). Displayed to agents in `Asia/Colombo`.
- Store all timestamps as `timestamptz` (UTC). Generate shift instances by converting template local times in `CLIENT_TZ` → UTC per date, so US daylight-saving changes are handled automatically. (The old sheet shows the Colombo start moving from 2:30 → 3:30 AM after the US clock change — this is why.)
- Dashboard shows both the Colombo time and the client time.

## Shift blocks (seed data — times in CLIENT_TZ, confirm before go-live)
| Code | Start (client TZ) | End | Colombo equivalent (CST) |
|---|---|---|---|
| 1  | Fri 16:00 | Fri 22:00 | Sat 03:30–09:30 |
| 2a | Sat 10:00 | Sat 16:00 | Sat 21:30–Sun 03:30 |
| 2b | Sat 16:00 | Sat 22:00 | Sun 03:30–09:30 |
| 3a | Sun 10:00 | Sun 16:00 | Sun 21:30–Mon 03:30 |
| 3b | Sun 16:00 | Sun 22:00 | Mon 03:30–09:30 |

Seed agents (emails to be filled in by the user): Pooja, Thejan, Luchitha, Nimithra (supervisor), Sayuru.

## Configuration principle — everything editable in the UI
Nothing about shifts, time zones, check-in windows or notifications is hardcoded or kept in env vars. Env vars hold **secrets and infrastructure only**. All business rules live in the database and are edited by supervisors on a **Settings** area. Code reads them at runtime, so a change takes effect on the next cron tick, with no redeploy. Every settings change is written to `audit_log`.

### Settings screens
1. **General**: org name, client time zone, default display time zone, week start day, allowed email domain(s).
2. **Shift templates**: create, edit or archive blocks (code, name, start/end day + time, time zone, required headcount, colour, active days). Changes apply to future generated shifts only; existing shifts can be regenerated on request with a preview of what changes.
3. **Check-in rules** (global default, overridable per template): window opens X min before start, closes Y min after start or at shift end, and what counts as "covered" (all assignees / at least N).
4. **Notification rules**: an ordered list of escalation stages, fully editable. Each stage has:
   - trigger minutes after start (e.g. 10, 15, 17)
   - condition: `this agent not checked in` | `nobody checked in` | `fewer than N checked in`
   - recipients: `missing agents` | `all assignees` | specific employees | a role (e.g. all supervisors) | a notification group
   - channels: email, Telegram (later: WhatsApp)
   - message template with placeholders (`{block}`, `{start_local}`, `{agents}`, `{missing_agents}`, `{checkin_link}`, `{dashboard_link}`)
   - enabled toggle, and an optional scope (all templates or selected ones)
   - Stages can be added, removed, reordered, and given a **Send test** button.
   - Default seed = the 10 / 15 / 17 ladder described under "No-show checker".
5. **Notification groups and subscriptions**: named groups (e.g. "Weekend supervisors"). Each employee can subscribe to groups, choose their channels and set quiet hours. A supervisor can override any of these.
6. **Calendar**: on/off, event title and description templates, reminder minutes, which calendar to use.
7. **Employees and roles**: as in the "Supervisor dashboard" section, plus a personal display time zone and notification preferences.

## Data model
- `employees` — id, auth_user_id, full_name, email, role, telegram_chat_id (nullable), active, created_at
- `shift_templates` — id, code, name, weekday_start, start_local_time, end_weekday, end_local_time, timezone, active
- `shifts` — id, template_id, starts_at, ends_at (UTC), status_override (nullable), notes
- `assignments` — id, shift_id, employee_id, role (`primary`|`backup`), calendar_event_id, checkin_token (random, unique), checked_in_at, created_by, created_at
- `org_settings` — single row: client_tz, default_display_tz, week_start, allowed_domains[], checkin_open_before_min, checkin_close_rule, calendar_enabled, calendar_title_tpl, calendar_desc_tpl, calendar_reminders_min[]
- `template_overrides` — template_id, checkin_open_before_min, checkin_close_rule, covered_rule, required_headcount (nullable fields = inherit)
- `notification_rules` — id, position, name, trigger_minutes, condition (`agent_missing`|`nobody_in`|`fewer_than_n`), condition_n, recipient_type (`missing_agents`|`all_assignees`|`employees`|`role`|`group`), recipient_ids[], channels[], message_tpl, template_scope (nullable = all), enabled
- `notification_groups` — id, name; `notification_group_members` — group_id, employee_id
- `employee_notification_prefs` — employee_id, channels[], quiet_hours_start, quiet_hours_end, display_tz
- `rule_firings` — rule_id, shift_id, assignment_id (nullable), fired_at — UNIQUE(rule_id, shift_id, assignment_id). This replaces fixed `reminder_*_sent_at` columns, so any number of stages can be added.
- `alerts` — id, rule_id, shift_id, assignment_id (nullable for supervisor alerts), stage (`agent_reminder_1`|`agent_reminder_2`|`supervisor`), recipient, channel (`email`|`telegram`), sent_at, payload, success, error
- `audit_log` — id, actor_id, action, entity, entity_id, before, after, created_at

Unique constraint: (shift_id, employee_id).

### Derived statuses
Per assignment:
- `upcoming` — now < starts_at − 15 min
- `checkin_open` — check-in window open, not yet checked in, now ≤ starts_at + 10 min
- `checked_in` — checked_in_at set
- `late` — not checked in, now > starts_at + 10 min, shift not ended
- `missed` — not checked in and shift ended

Per shift (over its `primary` assignments):
- `covered` — all checked in
- `partial` — at least one checked in, at least one not
- `uncovered` — none checked in (after start)
- `upcoming` — before start

## Core flows

### 1. Assign / reassign / unassign (supervisor)
- Week view grid: rows = blocks, columns = weeks (mirrors the old sheet), each cell lists assigned agents. Click a cell → pick one or more agents.
- "Copy last week" and "Generate next N weeks" from templates.
- On assignment create: create a Google Calendar event on the shared shift calendar (impersonated owner from `GOOGLE_CALENDAR_OWNER`), attendee = agent, `sendUpdates=all`, title `Voicify Monitoring — Block {code}`, description includes the check-in link `{APP_URL}/checkin/{checkin_token}`, reminders at 30 and 10 min. Save `calendar_event_id`.
- On reassign: delete the old event (sends cancellation), create a new one for the new agent.
- On shift time change: update the event.
- Calendar calls must be idempotent and retried; if a call fails, show a warning badge on the assignment with a "Retry invite" button. Never block the DB write on Google.

### 2. Check-in (agent)
- `/checkin/[token]`: requires Google sign-in; the signed-in employee must match the assignment's employee.
- Allowed window: starts_at − 15 min → ends_at. Outside the window show a clear message and the shift time.
- Success sets `checked_in_at` once (idempotent) and shows a confirmation screen with the shift details.
- Also a "My shifts" page with a big **Check in** button for the current shift (backup path if the calendar link isn't handy).

### 3. No-show checker
- Next.js route `POST /api/cron/check-shifts`, protected by `CRON_SECRET` header.
- Triggered **every minute** by Supabase `pg_cron` + `pg_net` (works on Vercel Hobby and Pro). Document the SQL in `supabase/migrations`.
- The checker is a generic rule engine: on each tick, for each enabled `notification_rules` row in scope, evaluate its condition per shift/assignment and fire once (claim via INSERT into `rule_firings` … ON CONFLICT DO NOTHING RETURNING). The table below is the **default seed only**; supervisors edit it in Settings.
- Default escalation ladder: Only `primary` assignments count. Skip shifts that have ended.
  | Stage | When | Condition | Recipient |
  |---|---|---|---|
  | Agent reminder 1 | ≥ +10 min | that agent not checked in | that agent (whether or not a co-agent has checked in) |
  | Agent reminder 2 | ≥ +15 min | **nobody** on the shift checked in | each missing agent |
  | Supervisor alert | ≥ +17 min | **nobody** on the shift checked in | supervisors |
- If one agent of a two-person shift has checked in, the missing agent gets **only** reminder 1 — no reminder 2, no supervisor alert. The shift still shows `partial` on the dashboard and in history.
- Single-agent shifts follow the "nobody checked in" path.
- If an agent checks in between stages, later stages for that shift are re-evaluated and usually skipped.
- Each rule fires once per shift (or once per assignment for per-agent conditions), enforced by the `rule_firings` unique constraint so overlapping cron runs can't double-send. Respect recipients' quiet hours and channel preferences, except for rules marked `critical` (default: supervisor alert). Log every send in `alerts`.
- Agent reminders go to the agent's work email, plus Telegram if `telegram_chat_id` is set. Message: `⏰ Block {code} started at {Colombo time}. Please check in: {checkin link}` (reminder 2 marked as second reminder).
- Supervisor alert (email + Telegram): `⚠️ Block {code} ({Colombo time}) is UNCOVERED — nobody has checked in after 17 min. Assigned: {agents}. {dashboard link}`
- Phase 2: optional escalation to a backup assignee.
- Also a keep-alive: a GitHub Actions workflow pinging `/api/health` (which runs a trivial DB query) every 3 days, so the Supabase free project never pauses.

### 4. Supervisor dashboard
- **Now / Next** panel: current shift, who's checked in, who's late, live via Supabase Realtime.
- Upcoming shifts list with per-assignment status chips.
- History: past shifts, check-in times, late/missed counts.
- Totals per agent per month (replaces the "Tol. shifts" column).
- Team management: add/deactivate employees, set role, see each person's connected channels (Telegram linked / push enabled).

## Notification channels
Web app only — no native mobile apps. Messages reach phones through apps people already have.
- **Email** — Gmail API via the service account (impersonating `ALERT_EMAIL_SENDER`).
- **Telegram** — primary phone channel. **Connect flow:** "My notifications" page → "Connect Telegram" button → opens `https://t.me/{bot}?start={one-time token}` → user taps Start → bot webhook (`/api/telegram/webhook`, verified with secret token header) matches the token and saves `telegram_chat_id` on the employee. Tokens expire after 15 min. Include "Disconnect" and a "Send test message" button.
- **Browser push (Phase 2)** — make the app an installable PWA (manifest + service worker), Web Push with VAPID keys, store subscriptions in `push_subscriptions` (employee_id, endpoint, keys, user_agent, created_at). Show an install guide: iPhone needs iOS 16.4+ and Safari → Share → Add to Home Screen before notifications can be enabled. Treat push as a backup channel, not the primary one.
- **WhatsApp / SMS** — later, only if needed (paid).
- Channel senders implement one interface (`send(recipient, message)`) in `lib/alerts/`, so new channels plug in without touching the rule engine. Failed sends are retried once, then logged.

## Environment variables
Secrets and infrastructure only (everything else is in Settings): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_OWNER`, `ALERT_EMAIL_SENDER`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`; Phase 2: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
Seed values for the first run (client TZ `America/Chicago`, display TZ `Asia/Colombo`, domain `adept-tech.us`, the five blocks, the 10/15/17 ladder) go in `supabase/seed.sql`.

## Manual setup the human must do (write a SETUP.md walking through each)
1. Create the Supabase project; enable the Google auth provider; enable `pg_cron` and `pg_net`.
2. Google Cloud project → enable the Calendar API and Gmail API → create a service account + JSON key.
3. Workspace admin: Security → API controls → Domain-wide delegation → add the service account client ID with scopes `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/gmail.send`.
4. Create a shared "Voicify Shifts" calendar owned by `GOOGLE_CALENDAR_OWNER`.
5. Create a Telegram bot via @BotFather, then register the webhook URL. Users link their accounts through the app's Connect flow, so nobody copies chat ids by hand.
6. Vercel project + env vars; later add the custom domain.

## Phases
- **Phase 1 (MVP):** auth, employees, templates, shift generation, assignment grid, calendar invites, check-in, rule-engine checker with email + Telegram, live dashboard, Settings screens 1–4 and 7.
- **Phase 1b:** Settings screens 5–6 (groups, subscriptions, quiet hours, calendar templates).
- **Phase 2:** browser push (PWA), shift swap requests (agent requests → supervisor approves), backup-assignee escalation, check-out/handover notes, CSV import of the old roster.
- **Phase 3:** move the Tickets log into the app (ticket linked to shift + agent), reports, weekday coverage, WhatsApp alerts.

## Engineering rules
- Small, typed modules: `lib/time.ts` (all TZ maths, unit tested), `lib/google/calendar.ts`, `lib/alerts/*`, `lib/status.ts` (derived statuses, unit tested).
- Unit tests (Vitest) for time conversion across a DST boundary, status derivation, checker idempotency, the rule engine (a rule edited mid-shift takes effect on the next tick; disabled rules never fire; quiet hours respected except for critical rules), and the default escalation ladder (cases: solo shift no-show; pair with nobody in; pair with one in; agent checks in between +10 and +15).
- Every supervisor mutation writes to `audit_log`.
- No secrets in client code. Service-role key only in server routes.
- Ask before adding new paid services or changing the stack.
