# ShiftBoard setup

This file grows with each milestone. Sections are marked with the milestone that needs them.
Do the steps in order; each ends with a quick check so you know it worked.

---

## M1: Project, sign-in, employees

### 1. GitHub repository
The repo is https://github.com/nimjj/shift-management
1. **Make it private.** On GitHub: the repo's **Settings > General > Danger Zone > Change repository visibility > Make private**.
   (It holds the employee roster logic and, later, deployment details. Keep it private.)
2. Connect this folder to it:
   ```
   git remote add origin https://github.com/nimjj/shift-management.git
   ```
   If git answers `error: remote origin already exists`, it is already connected; confirm with `git remote -v`.
3. The local branch is `main`. After your first commit, publish it with `git push -u origin main`.

### 2. Supabase dev project
1. https://supabase.com/dashboard, then **New project** (free plan is fine for dev). Pick a region near you and save the database password.
2. From **Project Settings > API** copy: the **Project URL**, the **anon / publishable key**, and the **service_role / secret key**.
3. Link the CLI and push the schema (run in this folder):
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   The project ref is the part of the URL before `.supabase.co`.
   This applies both migrations in `supabase/migrations/`. The second one adds the atomic employee functions
   and removes direct inserts into `audit_log`: audit rows can only be written by those functions.
4. Load the seed data: open **SQL Editor**, paste the contents of `supabase/seed.sql`, run it.
   (Safe to run twice.) This creates the org settings and the five employees.
   Only `nimithra@adept-tech.us` is a real email. The four agents have `@placeholder.invalid` emails until you edit them in the app.
5. Check: **Table Editor > employees** shows 5 rows.

### 3. Google sign-in
1. https://console.cloud.google.com, create or choose a project (this same project is reused for Calendar and Gmail in M5/M6).
2. **APIs & Services > OAuth consent screen**: user type **Internal** (only Adept Workspace accounts can sign in). App name `ShiftBoard`.
3. **Credentials > Create credentials > OAuth client ID**, type **Web application**.
   - Authorised redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.
5. Supabase: **Authentication > Sign In / Providers > Google**, enable it, paste the Client ID and secret, save.
6. Supabase: **Authentication > URL Configuration**
   - Site URL: your Vercel URL (or `http://localhost:3000` while developing locally)
   - Redirect URLs: add `http://localhost:3000/**` and `https://<your-vercel-domain>/**`

### 4. Turn off email/password sign-up (Google only)
Supabase accepts email + password accounts by default. The app only supports Google, so close that door.
1. Supabase: **Authentication > Sign In / Providers**.
2. Open **Email**, switch **Enable Email provider** off, and save. With the Email provider disabled, nobody can sign up or sign in with an email and password.
3. **Leave "Allow new users to sign up" switched ON** (Authentication > Sign In / Providers, user signups setting).
   Google creates the Supabase user the first time someone signs in, so turning it off would lock out every new employee.
   Who may get in is decided by the domain hook (step 5) and the roster, not by this switch.
4. Make sure **Anonymous sign-ins** is off (the default) and that Google is the only provider enabled.
5. Check: the provider list shows only Google enabled.

### 5. Turn on the domain-restriction hook
This is a second lock behind the app's own check: Supabase itself refuses to create accounts outside the allowed domains.
1. Supabase: **Authentication > Auth Hooks** (may be labelled Hooks).
2. Add the **Before User Created** hook, type **Postgres function**, choose `public.hook_before_user_created`, save.
3. Check: try signing in with a personal Gmail; you should be refused ("Sign-in is restricted to company accounts").

### 6. Environment variables
Local: copy `.env.example` to `.env.local` and fill it in.

| Name | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key. **Server only. Never put this in client code or commit it.** |
| `APP_URL` | `http://localhost:3000` locally, your Vercel URL when deployed (no trailing slash) |

### 7. Run it locally
```
npm install
npm run dev
```
Open http://localhost:3000 and sign in as `nimithra@adept-tech.us`.

### 8. Vercel
1. https://vercel.com, **Add New > Project**, import the GitHub repo (framework: Next.js).
2. Add the four environment variables above (`APP_URL` = the Vercel URL, e.g. `https://shiftboard-xxxx.vercel.app`).
3. Deploy, then add that URL to the Supabase redirect list (step 3.6).
4. Check: `https://<vercel-url>/api/health` returns `{"ok":true}`.

### 9. Keep-alive (stops the free Supabase project pausing)
GitHub repo > **Settings > Secrets and variables > Actions > New repository secret**: `APP_URL` = your Vercel URL.
Then **Actions > Keep Supabase alive > Run workflow** once to confirm it goes green.

### Checks for M1
- Sign in as Nimithra, you land on the home page and see **Settings** in the nav.
- Personal Gmail is refused. A company account that is not on the roster is refused ("not on the shift roster").
- Settings > Employees: add someone, edit them, deactivate them. Each change appears as a row in `audit_log` (Table Editor).
- An agent account (after you replace a placeholder email with a real one) sees no Settings link, and opening `/settings` bounces to the home page.
- You cannot deactivate or demote yourself.
- Email/password is off: the login page only offers Google, and calling the Supabase email sign-up API directly is rejected.
- Audit rows are atomic: try adding an employee with an email on a disallowed domain. You get an error and no employee **and no audit row** is created.

## Tests and checks
```
npm run typecheck && npm run lint && npm test
```

---

## M2: Shift templates and shift generation

Nothing manual to set up. The schema, the five seed blocks and the database functions are already applied
to the dev project (applied through the Supabase connector; the same SQL is in `supabase/migrations/` and
`supabase/seed.sql` for a fresh project, e.g. production later).

### Checks for M2 (about 10 minutes, signed in as a supervisor)
1. **Settings > Shift templates**: you see Blocks 1, 2a, 2b, 3a, 3b. The "Next, in Asia/Colombo" column shows
   Block 1 as a **Sat 03:30-09:30** shift now that the US is on standard time (it was 02:30 until 1 Nov).
2. **Shifts > Generate shifts** with 4 weeks: it reports about 17 new shifts. Block 1 on a Friday shows
   16:00 in Chicago and Sat 03:30 in Colombo. Press it again: **0 new** ("already existed").
3. **Regenerate preview**: edit Block 2a (Settings > Shift templates) so it starts at 11:00 and save.
   Existing shifts do not change. Open **Shifts > Review & regenerate**: it lists exactly the future 2a shifts
   as **moved**, showing now vs after in both zones, and nothing else. Press Apply. Then check the
   `audit_log` table (action `shifts.regenerate`). Change 2a back to 10:00 and apply again.
4. **Archive**: untick Active on a block and save. Generating again produces no new shifts for it; the
   regenerate preview offers to remove its future shifts.
5. **Settings > General**: change the client time zone (for example to America/New_York), generate more weeks,
   and confirm the new shifts follow it. **Set it back to America/Chicago** afterwards.
6. **Refusals** (each shows a clear message and changes nothing): an unknown time zone, a duplicate block
   code, a block that ends before it starts, and removing your own domain from the allowed domains.

### Notes
- Changing a block never touches existing shifts by itself. Only **Apply** on the regenerate page does, and
  it only moves or removes shifts that have not started.
- Block times are the ones from the old roster sheet; confirm them with the client before go-live.

---

## M3: Assignment grid

Nothing manual to set up. The `assignments` table and its functions are already applied to the dev
project (same SQL in `supabase/migrations/20261108000004_assignments.sql` and `...0005_...sql`).

### Checks for M3 (about 10 minutes, signed in as a supervisor)
1. **Grid**: the new **Grid** link shows one row per block and four week columns, each cell with the
   shift time in Colombo and how many people are on it (`0/1`). Use **‹ Earlier** / **Later ›** to move
   through the weeks; cells with no generated shift read "not generated".
2. **Assign**: click a cell, tick two people, set one to **backup**, press **Save roster**. The cell
   now lists both, the backup is tagged, and the count shows `1/1`.
3. **Reassign and unassign**: reopen the cell, untick one person and tick someone else, save. Then
   untick everyone and save — the cell reads "Nobody assigned". Each save is one row in `audit_log`
   (action `assignments.set`), with the before and after rosters in it.
4. **Copy a week**: fill one week's cells, then use **Copy a week** from that week to the next. It
   reports how many shifts it filled. Run it again: it fills 0 and says they "already had people on
   it" — it never overwrites a roster.
5. **Regeneration leaves assigned shifts alone**: with someone assigned to a future 2a shift, change
   Block 2a's start time and open **Shifts › Review & regenerate**. The assigned shift appears under
   **Kept as they are** (with where it would have gone) and is *not* in the Moved list. Apply, then put
   2a back.
6. **Agent view**: sign in as the agent you assigned. They see **My shifts** with only their own
   shifts, no Grid or Settings link, and `/grid` bounces them to the home page.
7. **Refusals**: a finished shift cannot be rostered (its cell says so), and once M4's check-in exists,
   somebody who has checked in cannot be removed from a shift.

### Notes
- Assign, reassign and unassign are all one database call that sets the whole roster of a cell, so a
  cell can never be left half-changed and every edit writes exactly one audit row.
- Each assignment gets a 64-character check-in token now; M6 puts it in the calendar invite.

---

## M4 to M8: check-in, alerts, calendar, dashboard, audit log

### 0. Apply the two new migrations (required before anything below works)
The code for M4 to M8 is in the repo, but it needs two schema changes:

- `supabase/migrations/20261111000006_checkin_calendar.sql`
- `supabase/migrations/20261111000007_rules_alerts_cron.sql`

Either approve them when Claude applies them through the Supabase connector, or do it by hand:
Supabase dashboard > **SQL Editor** > paste the whole of file `...000006...`, **Run**; then the same for
`...000007...`. Run them in that order, once each. (For a fresh project, `npx supabase db push` applies
every migration in order.)

Check: **Table Editor** shows `notification_rules` with three rows (the 10 / 15 / 17 ladder).

Until they are applied, the dashboard and grid still open but Settings > Check-in rules, Notification
rules, Groups and Calendar show an error.

### What works with no further setup
Check-in (the link, and the button on My shifts), check-in rules, test shifts, derived statuses on the
grid, the live dashboard, History, the audit log, and editing the notification ladder. Sending is what
needs the integrations below; each one is independent, and Settings shows a "Not connected yet" note
for any that is missing.

### 1. Deploy to Vercel (if you have not done M1 step 8 yet)
The every-minute checker and the Telegram webhook both need a public URL, so do M1 steps 8 and 9 first.

### 2. The every-minute checker
1. Make a long random secret, for example in PowerShell:
   `[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))`
2. Vercel > Project > **Settings > Environment Variables**: add `CRON_SECRET` = that value. Redeploy.
3. Supabase > **SQL Editor**, run (with your own values; this stores them encrypted in Vault):
   ```sql
   select vault.create_secret('https://YOUR-APP.vercel.app', 'app_url');
   select vault.create_secret('THE-SAME-VALUE-AS-CRON_SECRET', 'cron_secret');
   ```
   The second migration already scheduled the job; it does nothing until these two secrets exist.
4. Check, a minute later: `select status, return_message from cron.job_run_details order by start_time desc limit 3;`
   shows `succeeded`, and `select status_code, content from net._http_response order by id desc limit 3;`
   shows `200` and `{"ok":true,...}`. A `401` means the two secrets differ; `503` means `CRON_SECRET`
   is not set in Vercel.

To change the URL later (custom domain): `select vault.update_secret(id, 'https://shifts.adept-tech.us') from vault.secrets where name = 'app_url';`

### 3. Google service account (email alerts and calendar invites)
1. Google Cloud console, the same project as the sign-in client: **APIs & Services > Library**, enable
   **Gmail API** and **Google Calendar API**.
2. **IAM & Admin > Service Accounts > Create service account** (name `shiftboard`). No roles needed.
   Open it > **Keys > Add key > Create new key > JSON**. A file downloads: treat it like a password and
   keep it out of the project folder.
3. On the service account's **Details** tab copy its **Unique ID** (a long number, the client ID).
4. **Google Workspace admin** (admin.google.com) > **Security > Access and data control > API controls >
   Manage domain-wide delegation > Add new**:
   - Client ID: the Unique ID
   - OAuth scopes: `https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/gmail.send`
5. Vercel environment variables:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the contents of the JSON file. Pasting it as base64 avoids
     line-break trouble: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\key.json"))`
   - `ALERT_EMAIL_SENDER`: the mailbox alerts come from. It must be a real Workspace user (or an alias
     of one). Using an existing mailbox costs nothing; a new user is a paid seat.
   - `GOOGLE_CALENDAR_OWNER`: the Workspace user who owns the shared calendar (can be the same mailbox).
   Redeploy.
6. Check: **Settings > Notification rules > Send test to me** on any stage. The email arrives, and the
   attempt is listed under Recent alerts. An error mentioning delegation means step 4 (it can take a few
   minutes to take effect).

### 4. Telegram
1. In Telegram, message **@BotFather**: `/newbot`, choose a name and a username. It replies with a token.
2. Vercel environment variables: `TELEGRAM_BOT_TOKEN` (the token), `TELEGRAM_BOT_USERNAME` (without `@`),
   `TELEGRAM_WEBHOOK_SECRET` (any long random string of letters, digits, `_` and `-`). Redeploy.
3. Point the bot at the app. Put the same three values and the deployed `APP_URL` in `.env.local`, then:
   ```
   npm run telegram:set-webhook
   ```
   (Run it again whenever the app's URL changes.)
4. Check: **My notifications > Connect Telegram > Open Telegram > Start**. The bot answers "Connected",
   the page flips to connected by itself, and **Send test message** arrives on your phone.

### 5. Calendar invites
1. Signed in to Google Calendar as the `GOOGLE_CALENDAR_OWNER` user: **Other calendars > + > Create new
   calendar**, name it `Voicify Shifts`.
2. That calendar's **Settings > Integrate calendar**: copy the **Calendar ID**.
3. ShiftBoard: **Settings > Calendar**: paste the ID, tick **Send a Google Calendar invite**, save.
   Invites for every assignment on a shift that has not ended are sent straight away.
4. Check: assign yourself on the grid. An invite arrives with the check-in link in the description.

### Checks for M4: check-in (about 10 minutes)
1. **Shifts > Test shift**: start in `20` minutes, tick yourself, create. Open **My shifts**: it shows the
   shift as Upcoming with "Check-in opens ...". Copy your check-in link from the calendar invite, or wait
   for the button.
2. **Settings > Check-in rules**: change "Opens" to `30` and save. Reload My shifts: the big **Check in**
   button is now there, with no redeploy.
3. Press **Check in**: "You are checked in". Press the link again or reload: the same time, unchanged.
4. Sign in as another agent and open your check-in link: "Check-in link not found" (it is not for their account).
5. Give one block an override (for example Late after `2`): only that block's card says "(overridden)".
   Clear the fields and save: it goes back to the default.

### Checks for M5: alerts (needs sections 2 to 4)
Use test shifts that started 9 minutes ago, so things fire within a minute or two.
1. **Solo, nobody checks in**: you get the reminder at +10 and +15 and the supervisor alert at +17.
2. **Pair, one checks in before +10**: the other gets reminder 1 only; no second reminder, no alert.
3. **Check in between +10 and +15**: nothing further arrives.
4. Edit a stage's minutes or message while a test shift runs: it applies from the next minute.
   Untick **Enabled** on the +15 stage: it does not fire.
5. Set quiet hours covering now under My notifications: reminder 1 is logged as **suppressed** under
   Recent alerts, while the supervisor alert (critical) still arrives.
6. Every send, failure and suppression is a row under **Settings > Notification rules > Recent alerts**.

### Checks for M6: calendar (needs sections 3 and 5)
1. Assign yourself: the invite arrives within seconds, with reminders at 30 and 10 minutes.
2. Unassign: a cancellation arrives. Reassign to someone else: they get an invite.
3. Put a wrong calendar ID in Settings > Calendar and assign: the roster still saves, and the cell shows
   **invite failed**. Fix the ID, open the cell, press **Retry invite**. Press it twice: still one event.

### Checks for M7: dashboard
1. Open the dashboard (home page) on a laptop; the dot at the top says **Live**.
2. Check in on a phone with a test shift: the chip turns green on the laptop within a few seconds.
3. Let a test shift end with nobody in: it is **Missed** under History, and the monthly totals match.

### Checks for M8: audit log
**Settings > Audit log** lists every change you made above, with who, when, and before/after.
`npm test` includes `lib/audit-coverage.test.ts`, which fails if any function a signed-in user can call
is not either an audited mutation or a listed exception, if a table gains a write policy, or if a
server action skips the shared wrapper.

### Notes
- **Delivery is at-most-once.** A stage is claimed in the database before it is sent, so two overlapping
  checker runs can never both send it. The cost: a send that fails twice is logged as failed and not
  retried a minute later. That is deliberate, so a flapping channel cannot spam people.
- **Quiet hours** suppress non-critical stages. The supervisor alert is seeded as critical.
- **An unstaffed shift alerts the supervisors** at +17 like any uncovered shift ("Assigned: nobody").
- **Reminders in the invite**: Google only shows the organiser's reminders on the organiser's copy, so
  after sending an invite the app sets the 30 / 10 minute pop-ups on the agent's own copy, acting as
  the agent. That step is best effort and does not mark the invite as failed if it does not take.
- Seed agents still have `@placeholder.invalid` addresses. Email and invites to those are refused with a
  clear message until you enter real addresses under Settings > Employees.

---

## Go-live checklist
1. **Confirm the block times with the client** (Settings > Shift templates). They came from the old sheet.
2. **Real emails** for every agent (Settings > Employees), and each agent signs in once.
3. **Production Supabase project**: create it, `npx supabase link` + `npx supabase db push` (applies all
   seven migrations), run `supabase/seed.sql`, repeat M1 steps 3 to 5 (Google sign-in, email/password
   off, the domain hook), and add the two Vault secrets from section 2.
4. **Vercel Pro** project (or promote the existing one) with every environment variable from
   `.env.example` pointing at production values; add the custom domain `shifts.adept-tech.us` and set
   `APP_URL` to it.
5. **Redirect URLs**: add the production domain in Supabase > Authentication > URL Configuration, and the
   production Supabase callback URL to the Google OAuth client.
6. **Telegram**: run `npm run telegram:set-webhook` with the production `APP_URL`.
7. **Vault**: `app_url` = the production URL (section 2).
8. **Calendar**: paste the calendar ID in the production app and switch invites on.
9. Delete any test shifts, then run one weekend alongside the old sheet before retiring it.
10. Make the GitHub repo private if it is not already, and keep the service-account key only in Vercel
    and a password manager.

## Not built yet (later phases)
- **Phase 2**: browser push (installable PWA), shift-swap requests, escalation to a backup assignee,
  check-out and handover notes, CSV import of the old roster.
- **Phase 3**: the tickets log, reports, weekday coverage, WhatsApp alerts.
- The Resend email fallback named in CLAUDE.md is not wired up (it is a separate paid service; say if
  you want it).
