-- ════════════════════════════════════════════════════════════════
-- 0005: DEFINITIVE schema — run this to get a clean, correct state
-- ════════════════════════════════════════════════════════════════

-- ── Drop all old functions ─────────────────────────────────────────
drop function if exists claim_listing_atomic(uuid,uuid,timestamptz);
drop function if exists create_notification(uuid,text,text,text,text);
drop function if exists create_notification(uuid,text,text,text,text,jsonb);

-- ── LISTINGS: normalize status ─────────────────────────────────────
do $$ declare r record; begin
  for r in
    select conname from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'listings' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop execute format('alter table listings drop constraint if exists %I', r.conname); end loop;
end $$;

-- Drop the partial index whose WHERE predicate references listings.status.
-- PostgreSQL cannot change a column's type (even text→text with a USING clause)
-- while an index has a predicate that depends on that column.
-- This index is recreated with its correct final definition later in this migration.
drop index if exists listings_one_active_per_seller;

-- Ensure column is TEXT (handles both enum and previous text)
alter table listings alter column status type text using status::text;

-- Normalize all existing values to canonical set
update listings set status = case
  when status in ('open','OPEN') then 'OPEN'
  when status in ('locked','LOCKED') then 'LOCKED'
  when status in ('in_progress','IN_PROGRESS','IN PROGRESS') then 'IN_PROGRESS'
  when status in ('completed','COMPLETED') then 'COMPLETED'
  when status in ('cancelled','CANCELED','CANCELLED') then 'CANCELLED'
  when status in ('expired','EXPIRED') then 'EXPIRED'
  else 'CANCELLED'
end;

alter table listings alter column status set default 'OPEN';
alter table listings add constraint listings_status_ck
  check (status in ('OPEN','LOCKED','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED'));

-- Extra columns
alter table listings add column if not exists completed_at timestamptz;

-- ── ORDERS: normalize status ───────────────────────────────────────
do $$ declare r record; begin
  for r in
    select conname from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'orders' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop execute format('alter table orders drop constraint if exists %I', r.conname); end loop;
end $$;

-- Drop every object that holds a pg_depend entry on orders.status before the
-- ALTER COLUMN TYPE.  PostgreSQL 15+ enforces two separate rules here:
--
--   (a) "cannot alter type of a column used in a policy definition"
--       Root cause: 0003_notifications_reviews_storage.sql created the storage
--       policy "seller_can_upload_qr" on storage.objects with a subquery that
--       filters on `o.status in ('LOCKED','SELLER_ACCEPTED')`.  PostgreSQL
--       records a cross-table column dependency in pg_depend when any policy
--       expression (including subqueries) references a column on another table.
--
--   (b) "cannot alter type of column because there is an index depending on it"
--       Root cause: 0004_full_overhaul.sql created the partial index
--       orders_one_active_per_buyer with WHERE status IN (...), which also
--       records a pg_depend entry on orders.status.
--
-- All three storage policies and the partial index are recreated with their
-- correct final definitions later in this same migration.
drop policy if exists "seller_can_upload_qr"     on storage.objects;
drop policy if exists "seller_can_update_qr"     on storage.objects;
drop policy if exists "participants_can_read_qr" on storage.objects;
drop index  if exists orders_one_active_per_buyer;

alter table orders alter column status type text using status::text;

update orders set status = case
  when status in ('DRAFT','draft','LOCKED','locked') then 'LOCKED'
  when status in ('BUYER_SUBMITTED','buyer_submitted') then 'BUYER_SUBMITTED'
  when status in ('SELLER_ACCEPTED','seller_accepted','PAID','paid') then 'SELLER_ACCEPTED'
  when status in ('QR_UPLOADED','qr_uploaded','QR_SENT','qr_sent','DELIVERED','delivered') then 'QR_UPLOADED'
  when status in ('COMPLETED','completed') then 'COMPLETED'
  else 'CANCELLED'
end;

alter table orders alter column status set default 'LOCKED';
alter table orders add constraint orders_status_ck
  check (status in ('LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED','COMPLETED','CANCELLED'));

-- order_items column (structured meal selection)
alter table orders add column if not exists order_items jsonb;

-- Payment stubs
alter table orders add column if not exists payment_status text not null default 'UNPAID'
  check (payment_status in ('UNPAID','PENDING','HELD','RELEASED','REFUNDED'));
alter table orders add column if not exists currency text not null default 'USD';

-- ── NOTIFICATIONS ──────────────────────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null,
  link       text,
  metadata   jsonb,
  read_at    timestamptz,
  created_at timestamptz default now()
);
alter table notifications enable row level security;
drop policy if exists notif_owner_select on notifications;
drop policy if exists notif_owner_update on notifications;
create policy notif_owner_select on notifications for select using (auth.uid() = user_id);
create policy notif_owner_update on notifications for update using (auth.uid() = user_id);
create index if not exists notif_user_unread on notifications(user_id) where read_at is null;

-- ── REVIEWS ────────────────────────────────────────────────────────
create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id),
  seller_id  uuid not null references auth.users(id),
  buyer_id   uuid not null references auth.users(id),
  rating     int  not null check (rating between 1 and 5),
  body       text,
  created_at timestamptz default now(),
  unique(order_id, buyer_id)
);
alter table reviews enable row level security;
drop policy if exists reviews_select on reviews;
drop policy if exists reviews_insert on reviews;
create policy reviews_select on reviews for select using (auth.role() = 'authenticated');
create policy reviews_insert on reviews for insert
  with check (
    auth.uid() = buyer_id and
    exists(select 1 from orders o where o.id = reviews.order_id
           and o.buyer_id = auth.uid() and o.status = 'COMPLETED')
  );

-- ── AUDIT LOG ──────────────────────────────────────────────────────
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz default now()
);
alter table audit_log enable row level security;
-- Only service_role can access

-- ── ANTI-ABUSE UNIQUE PARTIAL INDEXES ─────────────────────────────
-- One active listing per seller (DB-level enforcement)
drop index if exists listings_one_active_per_seller;
create unique index listings_one_active_per_seller
  on listings(seller_id)
  where status in ('OPEN','LOCKED','IN_PROGRESS');

-- One active order per buyer (DB-level enforcement)
drop index if exists orders_one_active_per_buyer;
create unique index orders_one_active_per_buyer
  on orders(buyer_id)
  where status in ('LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED');

-- ── STORAGE RLS POLICIES ───────────────────────────────────────────
-- (bucket 'order-qr' must exist — created by: npm run storage:setup)
do $$ begin
  drop policy if exists "seller_upload_qr" on storage.objects;
  create policy "seller_upload_qr" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'order-qr'
      and exists (
        select 1 from orders o
        where o.id::text = (storage.foldername(name))[2]
          and o.seller_id = auth.uid()
          and o.status = 'SELLER_ACCEPTED'
      )
    );
exception when others then
  raise notice 'storage policy skipped (bucket may not exist yet): %', sqlerrm;
end $$;

do $$ begin
  drop policy if exists "seller_update_qr" on storage.objects;
  create policy "seller_update_qr" on storage.objects
    for update to authenticated
    using (
      bucket_id = 'order-qr'
      and exists (select 1 from orders o where o.id::text = (storage.foldername(name))[2]
                  and o.seller_id = auth.uid())
    );
exception when others then null; end $$;

do $$ begin
  drop policy if exists "participants_read_qr" on storage.objects;
  create policy "participants_read_qr" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'order-qr'
      and exists (
        select 1 from orders o
        where o.id::text = (storage.foldername(name))[2]
          and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
      )
    );
exception when others then null; end $$;

-- ── DEFINITIVE claim_listing_atomic ────────────────────────────────
create or replace function claim_listing_atomic(
  p_listing_id uuid,
  p_buyer_id   uuid,
  p_lock_until timestamptz
) returns jsonb language plpgsql security definer as $$
declare
  v_listing listings%rowtype;
  v_order   orders%rowtype;
begin
  -- Heal expired locks before we read
  update listings
     set status = 'OPEN', locked_by = null, lock_until = null
   where id = p_listing_id
     and status = 'LOCKED'
     and lock_until < now();

  -- Row-level lock prevents concurrent claims
  select * into v_listing from listings where id = p_listing_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Listing not found');
  end if;
  if v_listing.seller_id = p_buyer_id then
    return jsonb_build_object('ok', false, 'error', 'You cannot claim your own listing');
  end if;
  if v_listing.status <> 'OPEN' then
    return jsonb_build_object('ok', false, 'error', 'This meal is no longer available');
  end if;
  if v_listing.expires_at <= now() then
    update listings set status = 'EXPIRED' where id = p_listing_id;
    return jsonb_build_object('ok', false, 'error', 'This listing has expired');
  end if;

  update listings
     set status = 'LOCKED', locked_by = p_buyer_id, lock_until = p_lock_until
   where id = p_listing_id;

  begin
    insert into orders(
      listing_id, seller_id, buyer_id, status,
      quantity, amount_cents, seller_payout_cents, platform_fee_cents, lock_expires_at
    ) values (
      v_listing.id, v_listing.seller_id, p_buyer_id, 'LOCKED',
      1, v_listing.price_cents, v_listing.price_cents, 0, p_lock_until
    ) returning * into v_order;
  exception when unique_violation then
    -- Undo the listing lock
    update listings set status = 'OPEN', locked_by = null, lock_until = null where id = p_listing_id;
    return jsonb_build_object('ok', false, 'error', 'You already have an active order');
  end;

  return jsonb_build_object('ok', true, 'order', row_to_json(v_order));
end;
$$;

revoke all    on function claim_listing_atomic(uuid, uuid, timestamptz) from public;
grant execute on function claim_listing_atomic(uuid, uuid, timestamptz) to service_role;
