create extension if not exists pgcrypto;

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text unique not null,
  username   text unique,
  created_at timestamptz default now()
);

create table if not exists listings (
  id                 uuid primary key default gen_random_uuid(),
  seller_id          uuid not null references auth.users(id) on delete cascade,
  dining_location    text not null default 'Ortega',
  price_cents        int  not null check (price_cents >= 0 and price_cents <= 600),
  status             text not null default 'OPEN'
                       check (status in ('OPEN','LOCKED','IN_PROGRESS','COMPLETED','CANCELLED')),
  expires_at         timestamptz not null,
  locked_by          uuid references auth.users(id),
  lock_until         timestamptz,
  pickup_start       timestamptz default now(),
  pickup_end         timestamptz default now() + interval '1 hour',
  available_quantity int  not null default 1,
  quantity_remaining int  not null default 1,
  fee_cents          int  not null default 0,
  total_cents        int  not null default 0,
  tags               text[] default '{}',
  created_at         timestamptz default now()
);

create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),
  listing_id          uuid not null references listings(id),
  seller_id           uuid not null references auth.users(id),
  buyer_id            uuid not null references auth.users(id),
  status              text not null default 'LOCKED'
                        check (status in ('DRAFT','LOCKED','PAID','SELLER_ACCEPTED',
                                          'QR_SENT','PICKED_UP','COMPLETED','CANCELLED','REFUNDED')),
  qr_image_url        text,
  customizations      text,
  handoff_info        text,
  quantity            int  not null default 1,
  amount_cents        int  not null default 0,
  platform_fee_cents  int  not null default 0,
  seller_payout_cents int  not null default 0,
  lock_expires_at     timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  sender_id  uuid not null references auth.users(id),
  content    text not null,
  created_at timestamptz default now()
);

alter table profiles  enable row level security;
alter table listings  enable row level security;
alter table orders    enable row level security;
alter table messages  enable row level security;

drop policy if exists profiles_owner_select on profiles;
drop policy if exists profiles_owner_upsert on profiles;
create policy profiles_owner_select on profiles for select using (auth.uid()=id);
create policy profiles_owner_upsert on profiles for all using (auth.uid()=id) with check (auth.uid()=id);

drop policy if exists listings_auth_select  on listings;
drop policy if exists listings_owner_insert on listings;
drop policy if exists listings_owner_update on listings;
create policy listings_auth_select  on listings for select using (auth.role()='authenticated');
create policy listings_owner_insert on listings for insert with check (auth.uid()=seller_id);
create policy listings_owner_update on listings for update using (auth.uid()=seller_id) with check (auth.uid()=seller_id);

drop policy if exists orders_participants_select on orders;
drop policy if exists orders_buyer_insert        on orders;
drop policy if exists orders_participants_update on orders;
create policy orders_participants_select on orders for select using (auth.uid()=buyer_id or auth.uid()=seller_id);
create policy orders_buyer_insert        on orders for insert with check (auth.uid()=buyer_id);
create policy orders_participants_update on orders for update
  using (auth.uid()=buyer_id or auth.uid()=seller_id)
  with check (auth.uid()=buyer_id or auth.uid()=seller_id);

drop policy if exists messages_participants_select on messages;
drop policy if exists messages_participants_insert on messages;
create policy messages_participants_select on messages for select
  using (exists(select 1 from orders o where o.id=messages.order_id and (o.buyer_id=auth.uid() or o.seller_id=auth.uid())));
create policy messages_participants_insert on messages for insert
  with check (sender_id=auth.uid() and exists(select 1 from orders o where o.id=messages.order_id and (o.buyer_id=auth.uid() or o.seller_id=auth.uid())));

create or replace function claim_listing_atomic(p_listing_id uuid, p_buyer_id uuid, p_lock_until timestamptz)
returns jsonb language plpgsql security definer as $$
declare v_listing listings%rowtype; v_order orders%rowtype;
begin
  update listings set status='OPEN', locked_by=null, lock_until=null
    where id=p_listing_id and status='LOCKED' and lock_until < now();
  select * into v_listing from listings where id=p_listing_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Listing not found'); end if;
  if v_listing.seller_id=p_buyer_id then return jsonb_build_object('ok',false,'error','You cannot claim your own listing'); end if;
  if v_listing.status<>'OPEN' then return jsonb_build_object('ok',false,'error','Listing is no longer available'); end if;
  if v_listing.expires_at<=now() then return jsonb_build_object('ok',false,'error','Listing has expired'); end if;
  update listings set status='LOCKED', locked_by=p_buyer_id, lock_until=p_lock_until where id=p_listing_id;
  insert into orders(listing_id,seller_id,buyer_id,status,quantity,amount_cents,seller_payout_cents,platform_fee_cents,lock_expires_at)
  values(v_listing.id,v_listing.seller_id,p_buyer_id,'LOCKED',1,v_listing.price_cents,v_listing.price_cents,0,p_lock_until)
  returning * into v_order;
  return jsonb_build_object('ok',true,'order',row_to_json(v_order));
end; $$;

revoke all on function claim_listing_atomic(uuid,uuid,timestamptz) from public;
grant execute on function claim_listing_atomic(uuid,uuid,timestamptz) to service_role;
