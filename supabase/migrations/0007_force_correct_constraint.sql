-- ════════════════════════════════════════════════════════════════════
-- 0007: Force-correct the orders status constraint by explicit name.
-- Previous migrations used dynamic loops which could silently fail.
-- This migration is idempotent and safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════

-- Drop every known name for the orders status constraint (all variants across history)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_ck;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;

-- Drop every known name for the listings status constraint
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_ck;
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_chk;

-- Re-add canonical constraints
ALTER TABLE orders ADD CONSTRAINT orders_status_ck
  CHECK (status IN ('LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED','COMPLETED','CANCELLED'));

ALTER TABLE listings ADD CONSTRAINT listings_status_ck
  CHECK (status IN ('OPEN','LOCKED','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED'));

-- Ensure orders.updated_at exists (required for cooldown queries)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Ensure listings.completed_at exists (required for seller cooldown)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Ensure order_items column exists
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_items JSONB;

-- Recreate anti-abuse indexes (idempotent)
DROP INDEX IF EXISTS listings_one_active_per_seller;
CREATE UNIQUE INDEX listings_one_active_per_seller
  ON listings(seller_id)
  WHERE status IN ('OPEN','LOCKED','IN_PROGRESS');

DROP INDEX IF EXISTS orders_one_active_per_buyer;
CREATE UNIQUE INDEX orders_one_active_per_buyer
  ON orders(buyer_id)
  WHERE status IN ('LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED');
