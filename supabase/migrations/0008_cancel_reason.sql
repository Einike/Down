-- 0008_cancel_reason.sql
-- Adds optional cancel metadata columns to orders.
-- All columns are nullable so existing rows and cancel flows
-- that omit a reason are unaffected.

alter table orders
  add column if not exists cancelled_by       uuid references profiles(id),
  add column if not exists cancel_reason_code text,
  add column if not exists cancel_reason_text text;
