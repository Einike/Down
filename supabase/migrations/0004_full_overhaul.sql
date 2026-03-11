-- ═══════════════════════════════════════════════════════════════════
-- 0004: Full overhaul — status normalization, new order flow,
--       notifications improvements, audit log, storage policies,
--       anti-abuse constraints
-- ═══════════════════════════════════════════════════════════════════

-- ── Drop old functions ────────────────────────────────────────────
drop function if exists claim_listing_atomic(uuid,uuid,timestamptz);
drop function if exists create_notification(uuid,text,text,text,text);

-- ── LISTING STATUS normalization ──────────────────────────────────
-- Canonical set: OPEN LOCKED IN_PROGRESS COMPLETED CANCELLED EXPIRED
do $$ declare r record; begin
  for r in select conname from pg_constraint c join pg_class t on t.oid=c.conrelid
           where t.relname='listings' and c.contype='c' and pg_get_constraintdef(c.oid) ilike '%status%'
  loop execute format('alter table listings drop constraint if exists %I', r.conname); end loop;
end $$;

-- Migrate old values
update listings set status='CANCELLED' where status not in ('OPEN','LOCKED','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED');
alter table listings alter column status set default 'OPEN';
alter table listings add constraint listings_status_ck
  check (status in ('OPEN','LOCKED','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED'));

-- Add cooldown tracking
alter table listings add column if not exists completed_at timestamptz;

-- ── ORDER STATUS normalization ────────────────────────────────────
do $$ declare r record; begin
  for r in select conname from pg_constraint c join pg_class t on t.oid=c.conrelid
           where t.relname='orders' and c.contype='c' and pg_get_constraintdef(c.oid) ilike '%status%'
  loop execute format('alter table orders drop constraint if exists %I', r.conname); end loop;
end $$;

-- Map old values → new canonical set
update orders set status='LOCKED'          where status in ('DRAFT','LOCKED');
update orders set status='BUYER_SUBMITTED' where status in ('SELLER_ACCEPTED','PAID','QR_SENT','DELIVERED') and qr_image_url is null;
update orders set status='SELLER_ACCEPTED' where status='SELLER_ACCEPTED';
update orders set status='QR_UPLOADED'     where status in ('QR_SENT','DELIVERED') and qr_image_url is not null;
update orders set status='COMPLETED'       where status='COMPLETED';
update orders set status='CANCELLED'       where status in ('CANCELLED','REFUNDED');
-- Catch anything missed
update orders set status='CANCELLED' where status not in
  ('LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED','COMPLETED','CANCELLED');

alter table orders alter column status set default 'LOCKED';
alter table orders add constraint orders_status_ck
  check (status in ('LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED','COMPLETED','CANCELLED'));

-- Payment placeholders (not enforced yet)
alter table orders add column if not exists payment_status text not null default 'UNPAID'
  check (payment_status in ('UNPAID','PENDING','HELD','RELEASED','REFUNDED'));
alter table orders add column if not exists currency text not null default 'USD';

-- ── AUDIT LOG ─────────────────────────────────────────────────────
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,   -- e.g. 'listing.create','order.claim','order.qr_upload'
  entity_type text,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz default now()
);
alter table audit_log enable row level security;
-- Admins only (service_role); no user-level access

-- ── NOTIFICATIONS improvements ────────────────────────────────────
alter table notifications add column if not exists metadata jsonb;
-- Index for fast unread count
create index if not exists notif_user_unread on notifications(user_id) where read_at is null;

-- ── ANTI-ABUSE partial indexes ────────────────────────────────────
-- Prevent two concurrent OPEN/LOCKED listings per seller
create unique index if not exists listings_one_active_per_seller
on listings(seller_id)
where status in ('OPEN','LOCKED','IN_PROGRESS');
-- Prevent two concurrent active orders per buyer
create unique index if not exists orders_one_active_per_buyer
  on orders(buyer_id)
  where status in ('LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED');
-- ── RECREATE claim_listing_atomic ────────────────────────────────
create or replace function claim_listing_atomic(
  p_listing_id uuid,
  p_buyer_id   uuid,
  p_lock_until timestamptz
) returns jsonb language plpgsql security definer as $$
declare
  v_listing listings%rowtype;
  v_order   orders%rowtype;
begin
  -- Auto-heal expired locks
  update listings
     set status='OPEN', locked_by=null, lock_until=null
   where id=p_listing_id and status='LOCKED' and lock_until < now();

  -- Lock the row for this transaction
  select * into v_listing from listings where id=p_listing_id for update;

  if not found then
    return jsonb_build_object('ok',false,'error','Listing not found');
  end if;
  if v_listing.seller_id = p_buyer_id then
    return jsonb_build_object('ok',false,'error','You cannot claim your own listing');
  end if;
  if v_listing.status <> 'OPEN' then
    return jsonb_build_object('ok',false,'error','This meal is no longer available');
  end if;
  if v_listing.expires_at <= now() then
    return jsonb_build_object('ok',false,'error','This listing has expired');
  end if;

  update listings
     set status='LOCKED', locked_by=p_buyer_id, lock_until=p_lock_until
   where id=p_listing_id;

  -- Will fail with unique index violation if buyer already has active order
  begin
    insert into orders(
      listing_id, seller_id, buyer_id, status,
      quantity, amount_cents, seller_payout_cents, platform_fee_cents, lock_expires_at
    ) values (
      v_listing.id, v_listing.seller_id, p_buyer_id, 'LOCKED',
      1, v_listing.price_cents, v_listing.price_cents, 0, p_lock_until
    ) returning * into v_order;
  exception when unique_violation then
    return jsonb_build_object('ok',false,'error','You already have an active order');
  end;

  return jsonb_build_object('ok',true,'order',row_to_json(v_order));
end;
$$;

revoke all   on function claim_listing_atomic(uuid,uuid,timestamptz) from public;
grant execute on function claim_listing_atomic(uuid,uuid,timestamptz) to service_role;

-- ── RECREATE notifications helper ────────────────────────────────
create or replace function create_notification(
  p_user_id uuid, p_type text, p_title text, p_body text,
  p_link text default null, p_metadata jsonb default null
) returns void language plpgsql security definer as $$
begin
  insert into notifications(user_id,type,title,body,link,metadata)
  values(p_user_id,p_type,p_title,p_body,p_link,p_metadata);
end;
$$;
grant execute on function create_notification(uuid,text,text,text,text,jsonb) to service_role;

-- ── RLS sanity pass ───────────────────────────────────────────────
-- audit_log: only service_role
-- notifications: already done in 0003

-- Ensure messages table exists for future chat
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  sender_id  uuid not null references auth.users(id),
  content    text not null check (length(content) between 1 and 2000),
  created_at timestamptz default now()
);
alter table messages enable row level security;
drop policy if exists messages_participants_select on messages;
drop policy if exists messages_participants_insert on messages;
create policy messages_participants_select on messages for select
  using (exists(select 1 from orders o where o.id=messages.order_id
    and (o.buyer_id=auth.uid() or o.seller_id=auth.uid())));
create policy messages_participants_insert on messages for insert
  with check (sender_id=auth.uid() and exists(
    select 1 from orders o where o.id=messages.order_id
    and (o.buyer_id=auth.uid() or o.seller_id=auth.uid())));
