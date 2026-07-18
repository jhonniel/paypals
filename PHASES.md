# Paypals — Delivery Phases

## Phase 1 — Complete

Foundation for production deployment on Vercel + Supabase.

- [x] Next.js 15 + React 19 + TypeScript + Tailwind
- [x] Design system, auth, dashboard, profile/settings
- [x] Full schema + RLS + storage
- [x] Default currency PHP (₱)

## Phase 2 — Complete

Receipt capture → OCR → editable bill.

- [x] Upload (drag/drop, camera, clipboard, HEIC, PDF)
- [x] OCR providers + demo fallback
- [x] Receipt editor + Decimal.js totals
- [x] Storage pipeline

## Phase 3 — Complete

Groups, invites, splits, realtime, notifications.

- [x] Groups CRUD with owner/admin/member roles
- [x] Invite links + QR codes (`/invite/[code]`)
- [x] Add members by username or guest email/name
- [x] Friends requests (send / accept / block)
- [x] Split engine: equal, percentage, quantity, weighted, custom
- [x] Item → member assignment UI on receipt detail
- [x] Pro-rata tax/tip/service/discount allocation
- [x] Supabase Realtime on receipts, assignments, members, notifications
- [x] Notifications bell + mark-as-read
- [x] Migration `002_phase3_invites_realtime.sql` (invite RPC + policies)

## Phase 4 — Complete

Analytics, admin, account controls, polish.

- [x] User analytics (`/analytics`) — monthly spend, merchants, categories, group stats
- [x] Admin panel (`/admin`) — users, receipts, OCR logs, health, audit trail
- [x] Feature flags table + admin toggles (`003_phase4_feature_flags.sql`)
- [x] Export data + delete account (Settings → Data & privacy)
- [x] Storage usage + OCR provider preference
- [x] Global search API (`/api/search`)
- [x] Performance: package import optimization, analytics cache headers, compress

## Beyond Phase 4

- Payments settlement flows
- Push notification delivery
- Edge Functions / email invites

## Production

See [PRODUCTION.md](PRODUCTION.md) for the deploy checklist. The app builds with `npm run build`, exposes `/api/health`, and ships with security headers, auth rate limits, and open-redirect protection.
