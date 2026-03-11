-- ═══════════════════════════════════════════════════════════════════════════
-- 0012: Off-platform payment flow, seller payment methods, in-order chat
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor in order.
-- Safe to re-run (all creates use IF NOT EXISTS / ON CONFLICT DO NOTHING).

-- ── 1. Seller payment methods ─────────────────────────────────────────────
-- Stores each seller's accepted off-platform payment handles.
-- One row per (user, method). Upsert on conflict.

create table if not exists user_payment_methods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  method     text not null check (method in ('venmo','zelle','apple_pay','paypal','cash_app')),
  handle     text not null check (length(trim(handle)) > 0 and length(handle) <= 100),
  is_active  boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, method)
);

alter table user_payment_methods enable row level security;

-- Buyers must be able to read any seller's payment handles (needed for order flow).
-- Service_role bypasses this anyway for server-side reads.
drop policy if exists upm_read   on user_payment_methods;
drop policy if exists upm_insert on user_payment_methods;
drop policy if exists upm_update on user_payment_methods;
drop policy if exists upm_delete on user_payment_methods;

create policy upm_read on user_payment_methods
  for select to authenticated using (true);

create policy upm_insert on user_payment_methods
  for insert to authenticated with check (auth.uid() = user_id);

create policy upm_update on user_payment_methods
  for update to authenticated using (auth.uid() = user_id);

create policy upm_delete on user_payment_methods
  for delete to authenticated using (auth.uid() = user_id);


-- ── 2. In-order chat messages ─────────────────────────────────────────────

create table if not exists order_messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  sender_id  uuid not null references profiles(id),
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz default now()
);

alter table order_messages enable row level security;

drop policy if exists msg_read   on order_messages;
drop policy if exists msg_insert on order_messages;

-- Only buyer/seller for that order may read messages
create policy msg_read on order_messages
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_messages.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

-- Only buyer/seller may send messages; chat closes when order is terminal
create policy msg_insert on order_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from orders o
      where o.id = order_messages.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
        and o.status not in ('COMPLETED','CANCELLED','DISPUTED')
    )
  );

create index if not exists order_messages_order_ts
  on order_messages(order_id, created_at asc);

-- Enable realtime for chat (so clients can subscribe to new messages)
-- Ignore error if already in publication
do $$ begin
  alter publication supabase_realtime add table order_messages;
exception when others then null;
end $$;


-- ── 3. New columns on orders ──────────────────────────────────────────────

alter table orders
  add column if not exists payment_screenshot_url text,
  add column if not exists payment_sent_at        timestamptz,
  add column if not exists payment_confirmed_at   timestamptz;


-- ── 4. Migrate SELLER_ACCEPTED → PAYMENT_CONFIRMED ───────────────────────
-- SELLER_ACCEPTED meant the seller had reviewed and was ready to upload.
-- PAYMENT_CONFIRMED is the closest equivalent in the new flow.
-- (The QR upload gate is the same either way.)

update orders set status = 'PAYMENT_CONFIRMED'
  where status = 'SELLER_ACCEPTED';


-- ── 5. Update order status check constraint ───────────────────────────────

alter table orders drop constraint if exists orders_status_ck;

alter table orders add constraint orders_status_ck
  check (status in (
    'LOCKED',
    'BUYER_SUBMITTED',
    'PAYMENT_SENT',
    'PAYMENT_CONFIRMED',
    'QR_UPLOADED',
    'COMPLETED',
    'CANCELLED',
    'DISPUTED'
  ));


-- ── 6. Rebuild active-order uniqueness index ──────────────────────────────
-- Prevents a buyer from having more than one active order at a time.
-- Includes DISPUTED so disputed orders block new claims until resolved.

drop index if exists orders_one_active_per_buyer;

create unique index orders_one_active_per_buyer
  on orders(buyer_id)
  where status in (
    'LOCKED','BUYER_SUBMITTED',
    'PAYMENT_SENT','PAYMENT_CONFIRMED',
    'QR_UPLOADED','DISPUTED'
  );


-- ── 7. Update DB-level daily claim limit trigger ──────────────────────────
-- The trigger in 0011 excluded seller-cancelled orders.
-- Logic unchanged — CANCELLED exclusion still applies.
-- No action needed; trigger only references CANCELLED, which is preserved.


-- ── 8. Payment screenshot storage bucket ─────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'payment-screenshots',
    'payment-screenshots',
    false,
    5242880, -- 5 MB
    array['image/jpeg','image/png','image/webp']
  )
  on conflict (id) do nothing;


-- ── 9. Update buyer_cancel_summary view (references no changed statuses) ──
-- Views in 0011 only reference CANCELLED/COMPLETED — no changes needed.


-- ── 10. Update claim_listing_atomic to match new ACTIVE status set ─────────
-- The function inserts with status='LOCKED'. ACTIVE_ORDER_STATUSES used
-- in the in-memory check (TypeScript), not in the DB function.
-- No DB function change needed.
