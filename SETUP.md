# GauchoGrub — Complete Setup Guide

## Quick Start (from a fresh clone)

```bash
# 1. Install
npm install

# 2. Configure
cp .env.local.example .env.local
# Edit .env.local with your Supabase values (see below)

# 3. Apply DB schema (all 5 migrations)
npm run schema:apply

# 4. Create the private storage bucket (fixes "Bucket not found")
npm run storage:setup

# 5. Seed dev test accounts
npm run seed

# 6. Run dev server
npm run dev

# 7. Open app
open http://localhost:3000/dev/login

# 8. Run full test suite
npm run verify
```

## Environment Variables

Get these from your Supabase project (Settings → API and Settings → Database):

```
NEXT_PUBLIC_SUPABASE_URL         = https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY    = eyJ...
SUPABASE_SERVICE_ROLE_KEY        = eyJ...
SUPABASE_DB_URL                  = postgresql://postgres.xxxxx:PASS@aws-0-us-west-2.pooler.supabase.com:5432/postgres
APP_ENV                          = dev
NEXT_PUBLIC_APP_ENV              = dev
NEXT_PUBLIC_APP_URL              = http://localhost:3000
```

## Storage Bucket: `order-qr`

The bucket is created automatically by `npm run storage:setup`.
It is **private** — all QR access goes through signed URLs generated server-side.

Storage path format: `orders/{orderId}/qr/{timestamp}.ext`

If you see "Bucket not found", run:
```bash
npm run storage:setup
```

## Migrations Applied (in order)

| File | What it does |
|------|-------------|
| `0001_init.sql` | Base tables, RLS, original claim function |
| `0002_text_status.sql` | Converts enum → TEXT (fixes original enum crash) |
| `0003_notifications_reviews_storage.sql` | Notifications table, reviews schema, storage policies |
| `0004_full_overhaul.sql` | Status normalization, anti-abuse indexes, audit log |
| `0005_definitive.sql` | Final definitive schema — normalizes all statuses, adds missing columns |

## Test Accounts (after `npm run seed`)

| Account | Email | Password | Role |
|---------|-------|----------|------|
| seller_test | seller_test@ucsb.edu | TestPass123! | Seller |
| buyer_test | buyer_test@ucsb.edu | TestPass123! | Buyer |
| buyer2_test | buyer2_test@ucsb.edu | TestPass123! | Buyer 2 |

Login at: http://localhost:3000/dev/login

## Order Flow (Correct State Machine)

```
Listing: OPEN → LOCKED → IN_PROGRESS → COMPLETED
                         ↓ (cancel)
                       CANCELLED

Order:  LOCKED → BUYER_SUBMITTED → SELLER_ACCEPTED → QR_UPLOADED → COMPLETED
         ↓ (cancel anywhere up to QR_UPLOADED)
       CANCELLED
```

## Verify Pipeline

```bash
npm run verify
# Runs: lint + typecheck + unit tests + e2e tests
```

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never in `NEXT_PUBLIC_` vars
- QR bucket is private — no public URLs ever issued
- All auth via `requireUser(req)` which verifies the JWT server-side
- RLS enforced at DB level for all tables
- `/dev/*` routes return 404 in production (`APP_ENV=production`)
- `@ucsb.edu` requirement enforced server-side in production
