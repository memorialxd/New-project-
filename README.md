# Fresh Delivery (quick-handoff-grid)

Real-time food delivery marketplace connecting **customers**, **restaurants**, and **drivers**.

| App | Route |
|---|---|
| Customer | `/order` |
| Driver | `/driver` |
| Store | `/store` |
| Admin | `/admin` |
| Support | `/support` |

**Stack:** React 18 + Vite + TypeScript + Tailwind/shadcn · Supabase · Mapbox · Stripe · Capacitor

---

## Why it was broken

Two issues stopped a fresh clone / the Vercel demo from working:

1. **Missing Vite env at build time** — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` lived only in (incomplete) local files. Production `vite build` never inlined them, so the browser client started with `undefined` credentials.
2. **Empty restaurant catalog** — a later migration dropped the broad `stores` SELECT policy while `stores_public` still used `security_invoker = true`, so anon/authenticated catalog queries returned `[]` even though menu items existed.

This repo now ships working `.env.development` / `.env.production` (public frontend keys) and a migration + one-shot SQL to restore the catalog.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:8080
```

Or production-style:

```bash
npm run build
npm run preview      # serves dist/
```

### Environment

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | e.g. `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes | anon / publishable key |
| `VITE_PAYMENTS_CLIENT_TOKEN` | payments | Stripe publishable key |
| `VITE_MAPBOX_TOKEN` | optional | else fetched via `get-mapbox-token` edge function |

Templates: `.env.example`, `.env.development` (dev), `.env.production` (build).

For Vercel/hosting, set the same `VITE_*` variables in the project settings (build-time).

---

## Restore the store catalog (required once on Supabase)

The app is already wired to project **`ajkefntritjjynzofprq`**. Catalog browsing is empty until this one-time SQL is applied (RLS/`stores_public` bug).

**Option A — script** (needs a personal access token or DB URI):

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...   # https://supabase.com/dashboard/account/tokens
npm run db:fix-stores
```

**Option B — SQL Editor:** paste [`supabase/fix_stores_public.sql`](./supabase/fix_stores_public.sql), then:

```sql
select count(*) from public.stores_public;
```

Until this runs, `/order` loads but shows no restaurants.

Also rotate any anon JWT that was previously committed in cron SQL (see [`CRON_README.md`](./CRON_README.md)) and prefer `supabase/cron_sanitize.sql`.

---

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run test
npm run test:e2e
```

---

## Project layout

```
src/                 React apps (customer / driver / store / admin / support)
supabase/            Migrations + Edge Functions
e2e/                 Playwright flows
android/             Capacitor Android shell
```

---

## Mobile

```bash
npx cap sync
npx cap open android   # or ios
```
