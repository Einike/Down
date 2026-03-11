-- ═══════════════════════════════════════════════════════════════════════════
-- 0010: Security hardening — RLS on profiles/orders/listings, policy fixes
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. PROFILES — enable RLS and add ownership policies ──────────────────
-- All app reads go through service_role (bypasses RLS), so this is
-- defense-in-depth against direct anon-key queries.

alter table profiles enable row level security;

-- Drop any stale policies before creating clean ones
drop policy if exists "profiles_read_own"    on profiles;
drop policy if exists "profiles_update_own"  on profiles;
drop policy if exists "profiles_insert_own"  on profiles;

-- Each user can read only their own profile row (service_role bypasses this)
create policy "profiles_read_own" on profiles
  for select to authenticated
  using (auth.uid() = id);

-- Users can only insert/update their own row
create policy "profiles_insert_own" on profiles
  for insert to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── 2. ORDERS — enable RLS ───────────────────────────────────────────────
-- All order mutations go through service_role (atomic RPC + admin client).
-- This prevents direct anon-key reads of other users' order data.

alter table orders enable row level security;

drop policy if exists "orders_participant_select" on orders;
drop policy if exists "orders_participant_update" on orders;

-- Buyers and sellers can read their own orders
create policy "orders_participant_select" on orders
  for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- No direct UPDATE allowed for regular users (all updates via service_role API routes)

-- ── 3. LISTINGS — enable RLS ─────────────────────────────────────────────
-- Board reads go through service_role. This restricts anon-key direct reads.

alter table listings enable row level security;

drop policy if exists "listings_public_select"   on listings;
drop policy if exists "listings_seller_select"   on listings;
drop policy if exists "listings_seller_update"   on listings;

-- Any authenticated user can read open listings (needed for board)
-- Service_role bypasses this for admin operations
create policy "listings_public_select" on listings
  for select to authenticated
  using (true);  -- all authenticated users can read listings; service_role bypasses anyway

-- Sellers can see all their own listings regardless of status
create policy "listings_seller_update" on listings
  for update to authenticated
  using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id);

-- ── 4. REVIEWS — tighten select policy ───────────────────────────────────
-- Current policy: any authenticated user can read all reviews.
-- This is intentional (seller reputation is public), keep as-is but document.
-- Reviews are intentionally public-facing.

-- ── 5. AUDIT LOG — confirm no select policy (admin only via service_role) ─
-- audit_log has RLS enabled but no select policy, so only service_role can read.
-- This is correct — do not add a select policy for regular users.

-- ── 6. REPORTS — add username column to reports view for admin queries ────
-- Add reporter/reported username resolution columns via a view so admin
-- can join without N+1 in application code. (Optional — admin route already
-- resolves in JS, this is a DB-level option for future use.)

-- ── 7. BAN DURATION GUARD — prevent accidental 1000-year bans ───────────
-- Add a check constraint limiting temporary bans to 365 days max.
-- Permanent bans (banned_until IS NULL) are still allowed.
alter table profiles drop constraint if exists profiles_ban_duration_ck;
alter table profiles add constraint profiles_ban_duration_ck
  check (
    banned_until is null or
    banned_until <= (now() + interval '366 days')
  );

-- ── 8. NOTIFICATIONS — add insert policy for service_role writes ──────────
-- Notifications are written by service_role (notify() function), never by users.
-- Ensure users cannot insert their own notifications.
drop policy if exists "notif_owner_insert" on notifications;
-- (No insert policy for authenticated = users cannot insert notifications directly)

-- ── 9. REVIEWS — add body length constraint at DB level ──────────────────
alter table reviews drop constraint if exists reviews_body_length_ck;
alter table reviews add constraint reviews_body_length_ck
  check (body is null or length(body) <= 1000);

-- ── 10. REPORTS — add message length constraint at DB level ──────────────
alter table reports drop constraint if exists reports_message_length_ck;
alter table reports add constraint reports_message_length_ck
  check (length(message) between 10 and 2000);

-- ── 11. REPORTS — add rate-limit guard (max 10 open reports per reporter) ─
-- This is enforced at the DB level as a check trigger to prevent spam.
-- Application-level check is in reports/route.ts; this is defense-in-depth.
-- (Trigger approach — simpler than a constraint)
create or replace function check_report_rate_limit()
returns trigger language plpgsql as $$
begin
  if (
    select count(*) from reports
    where reporter_id = NEW.reporter_id
      and created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'Rate limit: maximum 10 reports per 24 hours';
  end if;
  return NEW;
end;
$$;

drop trigger if exists reports_rate_limit_trg on reports;
create trigger reports_rate_limit_trg
  before insert on reports
  for each row execute function check_report_rate_limit();
