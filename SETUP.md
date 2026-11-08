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
