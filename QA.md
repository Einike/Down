# GauchoGrub — QA Self-Audit

## Known Failure Modes & Mitigations

| # | Failure Mode | Prevention | How to Confirm |
|---|---|---|---|
| 1 | QR upload "Bucket not found" | Run `npm run storage:setup` before first upload | Seller uploads QR → no error |
| 2 | Enum drift: status strings mismatch DB | Migration 0005 normalizes all values; `status.ts` is single source of truth | `npm run typecheck` passes; no DB constraint errors |
| 3 | Two buyers claim same listing | `claim_listing_atomic` uses `FOR UPDATE` row lock + unique partial index on buyer | Concurrent test shows only one succeeds |
| 4 | Seller spams listings | Partial unique index + 20-min cooldown check in API | Second listing returns 409 |
| 5 | Buyer claims own listing | DB function checks `seller_id ≠ buyer_id`; API checks too | Returns "cannot claim your own listing" |
| 6 | Session auth fails ("Invalid auth token") | `requireUser` uses service_role `admin.auth.getUser(token)` — reliable on server | Login → make request → no 401 |
| 7 | Weekend/after-hours orders | `getClosedReason()` blocks create listing + claim + customize server-side | Try claiming on Sat → 400 |
| 8 | IDOR: buyer reads another user's order | `requireUser` derives user from token; order routes check buyer_id/seller_id | Different user ID → 403 |
| 9 | QR publicly accessible | Bucket is private; GET /qr returns 5-min signed URL only to participants | Direct storage URL → access denied |
| 10 | DB secrets leaked in client | `supabaseAdmin` only imported in server files; service role key not in NEXT_PUBLIC_ | Check client bundle — no SERVICE_ROLE |
| 11 | Onboarding skipped | AuthGate checks profile.username; redirects to /onboarding if missing | Login fresh user → lands on onboarding |
| 12 | Stale lock not healed | `claim_listing_atomic` and `GET /api/listings` both auto-expire stale LOCKED → OPEN | Buyer abandons → listing re-appears on board |

## Test Coverage

### Unit tests (`npm run test:unit`)
- `tests/unit/menu.test.ts` — 12 tests covering validateOrderItems, getMealPeriod, hours gating
- `tests/unit/status.test.ts` — 7 tests covering status constants and transitions

### E2E tests (`npm run test:e2e`)
- Unauthenticated redirect
- Dev login page renders
- Seller cannot post 2 listings (409)
- Seller cannot claim own listing (409)
- Buyer with active order cannot claim (409)
- Customize rejects missing entree (422)
- Customize rejects 2 fruits + dessert (422)
- QR endpoint requires auth
- Cross-user QR read blocked (403)
- Full golden path: create → claim → customize → accept → QR upload → view → complete

## Manual Test Checklist (5 minutes)

1. [ ] Open http://localhost:3000 — homepage loads with how-it-works
2. [ ] Click "Browse meals" → redirects to /login (if not logged in)
3. [ ] Log in via /dev/login as seller_test
4. [ ] Go to /sell → post a listing at $2.50
5. [ ] Log in as buyer_test (new tab / incognito)
6. [ ] Go to /board → see listing → click "Lock meal"
7. [ ] Land on /orders/[id] → see "Choose your meal" button
8. [ ] Click → customize page → pick entree, side, 2 fruits (no dessert)
9. [ ] Confirm order → back on order page, status = "Meal chosen"
10. [ ] As seller: go to /orders/[id] → see "Accept order" button → click
11. [ ] As seller: see "Upload QR" section → upload any image
12. [ ] As buyer: page auto-refreshes → see "QR ready!" → click "Show QR code"
13. [ ] As buyer: click "I picked up my meal" → order COMPLETED
14. [ ] Check 🔔 bell — should have notifications for each step
15. [ ] Try posting a 2nd listing as seller → get error

## Deployment Checklist

### Supabase
- [ ] Create project at supabase.com
- [ ] Get URL, anon key, service role key from Settings → API
- [ ] Get DB URL from Settings → Database → Connection String (Session Pooler, port 5432)
- [ ] Apply schema: `npm run schema:apply`
- [ ] Create storage bucket: `npm run storage:setup`
- [ ] Enable Google OAuth: Authentication → Providers → Google
- [ ] Add site URL to Supabase: Authentication → URL Configuration → Site URL

### Vercel
- [ ] Connect GitHub repo
- [ ] Set environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_DB_URL`
  - `APP_ENV=production`
  - `NEXT_PUBLIC_APP_ENV=production`
  - `NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app`
- [ ] Redeploy
- [ ] Add Vercel domain to Supabase OAuth redirect allowlist
- [ ] Test full flow in production with real @ucsb.edu account
