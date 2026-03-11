-- ════════════════════════════════════════════════════════════════════
-- 0006: Index to efficiently query buyer cooldown (last completed order)
-- ════════════════════════════════════════════════════════════════════

-- Ensure orders.updated_at is indexed for buyer cooldown lookups
create index if not exists orders_buyer_completed_at
  on orders(buyer_id, updated_at desc)
  where status = 'COMPLETED';

-- Ensure seller cooldown index too (completed/cancelled listings by seller)
create index if not exists listings_seller_completed_at
  on listings(seller_id, created_at desc)
  where status in ('COMPLETED','CANCELLED','EXPIRED');
