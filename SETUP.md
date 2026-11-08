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
