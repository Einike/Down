-- 0015_drop_locked_by_fkey.sql
--
-- CRITICAL FIX: listings.locked_by FK constraint blocks all non-admin buyers.
--
-- In production the listings_locked_by_fkey constraint is failing for regular
-- users with: "insert or update on table listings violates foreign key
-- constraint listings_locked_by_fkey" (PG error 23503).
-- Diego's ID works; every other user's ID fails — despite both being present
-- in auth.users AND profiles. This indicates the constraint in production is
-- referencing a different table than intended (possibly profiles instead of
-- auth.users, or a subset thereof).
--
-- Fix: drop the constraint entirely. It is not needed for business logic:
--   - The order row records the buyer_id authoritatively.
--   - locked_by is a transient convenience field cleared on unlock.
--   - No query in the app joins through listings.locked_by.

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_locked_by_fkey;

-- Belt-and-suspenders: notify PostgREST to reload schema cache.
NOTIFY pgrst, 'reload schema';
