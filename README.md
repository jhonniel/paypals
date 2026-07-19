# Paypals

AI receipt splitter and bill sharing — through Phase 4 (analytics, admin, account controls).

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS + shadcn-style UI
- Supabase Auth, PostgreSQL, Storage, Realtime
- TanStack Query, React Hook Form, Zod, Framer Motion, Recharts
- React Three Fiber (landing hero only)
- Decimal.js for money; qrcode.react for invites

## Prerequisites

1. Node.js 20+
2. A [Supabase](https://supabase.com) project
3. (Optional) Google OAuth credentials for Google login

## Setup

```bash
cp .env.example .env.local
npm install
```

Fill `.env.local` with your Supabase URL and keys (Project Settings → API).

### Apply database migrations

In the Supabase SQL Editor, run in order:

1. [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
2. [`supabase/migrations/002_phase3_invites_realtime.sql`](supabase/migrations/002_phase3_invites_realtime.sql)
3. [`supabase/migrations/003_phase4_feature_flags.sql`](supabase/migrations/003_phase4_feature_flags.sql)
4. [`supabase/migrations/004_signup_invites.sql`](supabase/migrations/004_signup_invites.sql) (invite-only signup)
5. [`supabase/migrations/005_paid_by_and_guest_claim.sql`](supabase/migrations/005_paid_by_and_guest_claim.sql) (who paid + guest claim)
6. [`supabase/migrations/006_payment_methods.sql`](supabase/migrations/006_payment_methods.sql) (where to pay / payout details)
7. [`supabase/migrations/007_payment_qr_storage.sql`](supabase/migrations/007_payment_qr_storage.sql) (payment QR uploads)

This creates tables, RLS policies, triggers, invite RPCs, realtime publication, and storage buckets (`avatars`, `receipts`, `ocr-json`).

### Sample users (optional)

After the migration, run [`supabase/seed.sql`](supabase/seed.sql) or [`supabase/bootstrap-demo-user.sql`](supabase/bootstrap-demo-user.sql) in the SQL Editor.

| Email | Password | Notes |
|-------|----------|--------|
| `alex@example.com` | `Paypals123!` | Primary demo user |
| `jordan@example.com` | `Paypals123!` | Member |
| `sam@example.com` | `Paypals123!` | Member |
| `morgan@example.com` | `Paypals123!` | Member |
| `casey@example.com` | `Paypals123!` | Admin |

Sign in at `/login` with any of the above.

> Note: some Supabase projects reject `@paypals.dev` — use `@example.com` for local demos.

### Auth providers

In Supabase → Authentication → Providers:

- Enable **Email** (password + magic link)
- Enable **Google** and set Client ID / Secret

Redirect URLs (Authentication → URL Configuration):

- Site URL: `http://localhost:3000` (prod: your Vercel URL)
- Redirect: `http://localhost:3000/auth/callback`

Google Cloud OAuth authorized redirect:

`https://YOUR_PROJECT.supabase.co/auth/v1/callback`

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy on Vercel

See the full checklist in [PRODUCTION.md](PRODUCTION.md).

1. Push the repo to GitHub and import in Vercel
2. Set env vars from `.env.example` (especially `NEXT_PUBLIC_APP_URL` + `SUPABASE_SERVICE_ROLE_KEY`)
3. Apply all three SQL migrations in Supabase (skip seed in production)
4. Update Supabase Auth Site URL + redirect URLs to your production domain
5. Deploy and verify `GET /api/health` returns `"status":"ok"`

## Phase status

See [PHASES.md](PHASES.md).

### Phase 2 — Receipts & OCR

1. Sign in and open **Upload receipt** (or the Scan button in the mobile nav).
2. Drop an image/PDF (or use camera / clipboard).
3. OCR runs automatically → you land in the **receipt editor**.
4. Fix items, adjust tax/tip, **Save** or **Finalize**.

Without an OCR API key, a **demo Filipino receipt** is extracted so the flow still works. For live OCR:

```bash
OCR_PROVIDER=ocrspace
OCR_SPACE_API_KEY=your_key
```

Optional providers: `google` + `GOOGLE_VISION_API_KEY`, `openai` + `OPENAI_API_KEY`, `tesseract` (uses OCR.Space engine 1).

### Phase 3 — Groups, splits, realtime

1. Open **Groups** → create a group → copy invite link or show QR.
2. Friends can open `/invite/[code]` (sign in if needed) and join.
3. On a receipt, use **Split** to pick a group, assign items to members, and save.
4. Watch balances update live; notifications appear in the top bar bell.

### Phase 4 — Analytics & admin

1. Open **Analytics** for monthly spend, merchants, categories, and group stats.
2. **Settings → Data & privacy** to export JSON, check storage, or delete your account.
3. Sign in as an admin (`casey@example.com` in the seed) → **Admin** for users, OCR logs, feature flags, and audit trail.

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `npm run dev`  | Dev server (Turbopack)   |
| `npm run build`| Production build         |
| `npm run start`| Start production server  |
| `npm run lint` | ESLint                   |
