-- 0014_fix_notifications_columns.sql
-- The definitive migration (0005) recreated the notifications table without
-- the `link` and `metadata` columns that 0003 originally included.
-- If production was initialized from 0005 on a clean DB, those columns are
-- missing, causing PGRST204 errors on every notify() call.
-- This migration adds them back safely with IF NOT EXISTS.

alter table notifications
  add column if not exists link     text,
  add column if not exists metadata jsonb;

-- Force PostgREST to reload its schema cache so the new columns are visible
-- immediately (without needing a Supabase API restart).
notify pgrst, 'reload schema';
