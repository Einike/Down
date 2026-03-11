-- ═══════════════════════════════════════════════════════════════════════════
-- 0011: Abuse prevention — buyer daily claim cap + performance indexes
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Performance indexes for abuse-prevention queries ───────────────────

-- Daily claim count query: orders WHERE buyer_id = ? AND created_at >= ?
-- The existing orders_one_active_per_buyer index only covers active statuses.
-- This composite index covers the full date-scoped buyer lookup.
create index if not exists orders_buyer_created_at
  on orders(buyer_id, created_at desc);

-- Seller cooldown query: listings WHERE seller_id = ? AND status = 'COMPLETED'
--   AND completed_at > ?
create index if not exists listings_seller_completed_at
  on listings(seller_id, completed_at desc)
  where status = 'COMPLETED';

-- Buyer post-completion cooldown: orders WHERE buyer_id = ? AND status = 'COMPLETED'
--   AND updated_at > ?
create index if not exists orders_buyer_completed_updated
  on orders(buyer_id, updated_at desc)
  where status = 'COMPLETED';

-- ── 2. DB-level buyer daily cap trigger (defense-in-depth) ────────────────
-- The application layer (claim/route.ts) is the primary enforcer.
-- This trigger fires at INSERT time so it catches any race condition or
-- direct API access that bypasses the application check.
--
-- Counting logic mirrors the application:
--   Count orders created today (PT time) for this buyer
--   EXCEPT those cancelled by the seller (seller_id = cancelled_by)
--   i.e.: include active, completed, and buyer-cancelled orders.

create or replace function check_buyer_daily_claim_limit()
returns trigger language plpgsql as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from orders
  where buyer_id   = NEW.buyer_id
    and (created_at at time zone 'America/Los_Angeles')::date
        = (now()    at time zone 'America/Los_Angeles')::date
    -- exclude orders cancelled by the seller (not buyer's fault)
    and not (status = 'CANCELLED' and cancelled_by is distinct from NEW.buyer_id
             and cancelled_by is not null and cancelled_by = seller_id);

  if v_count >= 3 then
    raise exception
      'Daily limit reached: you can claim at most 3 meals per day (Pacific time)'
      using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists buyer_daily_claim_limit_trg on orders;
create trigger buyer_daily_claim_limit_trg
  before insert on orders
  for each row
  execute function check_buyer_daily_claim_limit();

-- ── 3. Cancel-reason columns (ensure migration 0008 applied) ─────────────
-- These columns are needed by the cancelled_by field referenced above.
-- Safe to run even if already applied (uses IF NOT EXISTS).
alter table orders
  add column if not exists cancelled_by      uuid references profiles(id),
  add column if not exists cancel_reason_code text,
  add column if not exists cancel_reason_text text;

-- ── 4. Cancellation count visibility for admins ───────────────────────────
-- Add a DB view so the admin audit page can cheaply surface repeat-cancellers
-- without loading all orders into memory for JS aggregation.

create or replace view buyer_cancel_summary as
select
  buyer_id,
  p.username,
  count(*) filter (where o.status = 'CANCELLED' and o.cancelled_by = o.buyer_id) as buyer_cancels,
  count(*) filter (where o.status = 'CANCELLED' and o.cancelled_by = o.seller_id) as seller_cancels,
  count(*) filter (where o.status = 'COMPLETED')                                   as completions,
  count(*)                                                                           as total_claims,
  max(o.created_at)                                                                  as last_claim_at
from orders o
join profiles p on p.id = o.buyer_id
group by o.buyer_id, p.username;

-- Grant read access to service_role (app uses service_role for admin queries)
-- RLS does not apply to views unless security_invoker is set; service_role bypasses it.

create or replace view seller_cancel_summary as
select
  seller_id,
  p.username,
  count(*) filter (where o.status = 'CANCELLED' and o.cancelled_by = o.seller_id) as seller_cancels,
  count(*) filter (where o.status = 'CANCELLED' and o.cancelled_by = o.buyer_id)  as buyer_cancels,
  count(*) filter (where o.status = 'COMPLETED')                                   as completions,
  count(*)                                                                           as total_orders,
  max(o.created_at)                                                                  as last_order_at
from orders o
join profiles p on p.id = o.seller_id
group by o.seller_id, p.username;
