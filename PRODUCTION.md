# Paypals — Production checklist

Use this before pointing a custom domain or sharing with real users.

## 1. Database

In the Supabase SQL Editor, apply in order:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_phase3_invites_realtime.sql`
3. `supabase/migrations/003_phase4_feature_flags.sql`

Do **not** run `supabase/seed.sql` in production unless you intentionally want demo accounts.

Promote at least one real admin:

```sql
UPDATE public.profiles SET is_admin = true WHERE email = 'you@yourdomain.com';
```

## 2. Supabase Auth

Authentication → URL Configuration:

- **Site URL:** `https://your-domain.com`
- **Redirect URLs:**
  - `https://your-domain.com/auth/callback`
  - `http://localhost:3000/auth/callback` (local only)

Providers:

- Email (password + magic link)
- Google (optional) — authorized redirect: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`

Recommended Auth settings:

- Enable email confirmations for new signups
- Set a strong password policy
- Disable public signup only if you want invite-only

Realtime: ensure `receipts`, `receipt_items`, `receipt_item_assignments`, `group_members`, `notifications` are in the `supabase_realtime` publication (migration 002).

Storage buckets `avatars`, `receipts`, `ocr-json` must exist (migration 001).

## 3. Vercel

1. Import the GitHub repo
2. Framework: Next.js (auto-detected)
3. Set environment variables (Production + Preview as needed):

| Variable | Required |
|----------|----------|
| `NEXT_PUBLIC_APP_URL` | Yes (`https://your-domain.com`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (account delete / storage purge) |
| `OCR_PROVIDER` | Recommended |
| `OCR_SPACE_API_KEY` (or other OCR key) | Recommended |

4. Deploy
5. Attach custom domain → re-check Supabase redirect URLs

`vercel.json` sets Singapore (`sin1`) and longer timeouts for upload/OCR routes.

## 4. Verify

```bash
npm run typecheck
npm run build
npm run start
```

After deploy:

- `GET https://your-domain.com/api/health` → `"status":"ok"`
- Sign up / log in / upload a receipt / create a group / open analytics
- Admin panel as an `is_admin` user
- Export data from Settings → Data & privacy

## 5. Security notes (already in the app)

- Security headers (CSP, HSTS, frame deny, nosniff)
- Open-redirect protection on `next=` params
- Auth rate limits (login / signup)
- Demo credentials removed from the login form
- API errors do not leak stack details in production
- `.env*` is gitignored (`.env.example` is allowed)

## 6. Post-launch hygiene

- Rotate any keys that were shared during development
- Monitor Supabase Auth logs and storage usage
- Keep `SUPABASE_SERVICE_ROLE_KEY` production-only
- Revisit feature flags in `/admin` before enabling experimental flows
