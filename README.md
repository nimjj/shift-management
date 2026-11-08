# ShiftBoard

Shift management for Voicify weekend monitoring (Adept Technologies). See `CLAUDE.md` for the product spec and `SETUP.md` for setup steps.

```
npm install
npm run dev          # http://localhost:3000
npm run typecheck && npm run lint && npm test
```

Stack: Next.js (App Router) on Vercel, Supabase (Postgres, Auth, Realtime, pg_cron), Tailwind + shadcn/ui, Zod, Vitest.
