-- ── 0002: Convert enum → TEXT + CHECK constraints ────────────────────────────
-- Fix the "invalid input value for enum listing_status: LOCKED" crash.

-- Step 1: Drop the atomic claim function temporarily (it references the columns)
drop function if exists claim_listing_atomic(uuid, uuid, timestamptz);

-- Step 2: Convert listings.status  enum → text
do $$ begin
  -- Only do conversion if column type is not already text
  if exists (
    select 1 from information_schema.columns
    where table_name = 'listings' and column_name = 'status'
      and data_type <> 'text'
  ) then
    alter table listings alter column status type text using status::text;
  end if;
end $$;

-- Normalise any lowercase / old values
update listings set status = upper(status)
  where status in ('open','locked','in_progress','completed','cancelled');

update listings set status = 'CANCELLED'
  where status not in ('OPEN','LOCKED','COMPLETED','CANCELLED');

-- Drop any old check constraints on listings.status
do $$ declare r record; begin
  for r in select conname from pg_constraint c
             join pg_class t on t.oid = c.conrelid
             where t.relname = 'listings' and c.contype = 'c'
               and pg_get_constraintdef(c.oid) ilike '%status%'
  loop execute format('alter table listings drop constraint if exists %I', r.conname); end loop;
end $$;

alter table listings
  alter column status set default 'OPEN',
  add constraint listings_status_check
    check (status in ('OPEN','LOCKED','COMPLETED','CANCELLED'));

-- Step 3: Convert orders.status  enum → text
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'orders' and column_name = 'status'
      and data_type <> 'text'
  ) then
    alter table orders alter column status type text using status::text;
  end if;
end $$;

update orders set status = upper(status);

update orders set status = 'CANCELLED'
  where status not in ('LOCKED','SELLER_ACCEPTED','DELIVERED','COMPLETED','CANCELLED');

do $$ declare r record; begin
  for r in select conname from pg_constraint c
             join pg_class t on t.oid = c.conrelid
             where t.relname = 'orders' and c.contype = 'c'
               and pg_get_constraintdef(c.oid) ilike '%status%'
  loop execute format('alter table orders drop constraint if exists %I', r.conname); end loop;
end $$;

alter table orders
  alter column status set default 'LOCKED',
  add constraint orders_status_check
    check (status in ('LOCKED','SELLER_ACCEPTED','DELIVERED','COMPLETED','CANCELLED'));

-- Step 4: Add order_items column for structured menu selection
alter table orders
  add column if not exists order_items jsonb;

-- Step 5: Drop old enum types if they exist
drop type if exists listing_status cascade;
drop type if exists order_status   cascade;

-- Step 6: Recreate claim_listing_atomic with TEXT status (no enum)
create or replace function claim_listing_atomic(
  p_listing_id uuid,
  p_buyer_id   uuid,
  p_lock_until timestamptz
) returns jsonb language plpgsql security definer as $$
declare
  v_listing listings%rowtype;
  v_order   orders%rowtype;
begin
  -- Auto-heal expired locks so they can be reclaimed
  update listings
     set status = 'OPEN', locked_by = null, lock_until = null
   where id = p_listing_id
     and status = 'LOCKED'
     and lock_until < now();

  select * into v_listing from listings where id = p_listing_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Listing not found');
  end if;
  if v_listing.seller_id = p_buyer_id then
    return jsonb_build_object('ok', false, 'error', 'You cannot claim your own listing');
  end if;
  if v_listing.status <> 'OPEN' then
    return jsonb_build_object('ok', false, 'error', 'Listing is no longer available');
  end if;
  if v_listing.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'Listing has expired');
  end if;

  update listings
     set status = 'LOCKED', locked_by = p_buyer_id, lock_until = p_lock_until
   where id = p_listing_id;

  insert into orders(
    listing_id, seller_id, buyer_id, status,
    quantity, amount_cents, seller_payout_cents, platform_fee_cents, lock_expires_at
  ) values (
    v_listing.id, v_listing.seller_id, p_buyer_id, 'LOCKED',
    1, v_listing.price_cents, v_listing.price_cents, 0, p_lock_until
  ) returning * into v_order;

  return jsonb_build_object('ok', true, 'order', row_to_json(v_order));
end;
$$;

revoke all   on function claim_listing_atomic(uuid, uuid, timestamptz) from public;
grant execute on function claim_listing_atomic(uuid, uuid, timestamptz) to service_role;
