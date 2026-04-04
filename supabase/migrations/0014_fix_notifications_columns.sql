-- 0014_fix_notifications_columns.sql
-- The definitive migration (0005) recreated the notifications table using
-- CREATE TABLE IF NOT EXISTS without the `link` and `metadata` columns
-- that migration 0003/0004 originally added. If production was seeded from
-- 0005 on a clean DB (or if 0003/0004 never ran), those columns are absent,
-- causing PGRST204 errors on every notify() call.
-- This migration adds them back safely.

alter table notifications
  add column if not exists link     text,
  add column if not exists metadata jsonb;

-- Tell PostgREST to reload its schema cache so the columns are visible
-- immediately without needing a full Supabase API restart.
notify pgrst, 'reload schema';
