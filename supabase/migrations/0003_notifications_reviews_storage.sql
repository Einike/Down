-- ── 0003: Notifications, Reviews, Storage policies, Payment fields ────────────

-- Payment status placeholder on orders
alter table orders
  add column if not exists payment_status text not null default 'UNPAID'
    check (payment_status in ('UNPAID','PENDING','HELD','RELEASED','REFUNDED')),
  add column if not exists currency text not null default 'USD';

-- Notifications table
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,          -- e.g. 'listing_claimed','qr_uploaded','order_complete'
  title      text not null,
  body       text not null,
  link       text,                   -- e.g. /orders/uuid
  read_at    timestamptz,
  created_at timestamptz default now()
);

alter table notifications enable row level security;

drop policy if exists notif_owner_select on notifications;
drop policy if exists notif_owner_update on notifications;
create policy notif_owner_select on notifications for select using (auth.uid() = user_id);
create policy notif_owner_update on notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Only service_role can insert notifications (via server-side code)

-- Reviews schema (no UI yet)
-- Reviews schema disabled for now (will be added later after order schema is stable)
-- create table if not exists reviews (
--   id         uuid primary key default gen_random_uuid(),
--   order_id   uuid not null references orders(id),
--   seller_id  uuid not null references auth.users(id),
--   rating     int  not null check (rating between 1 and 5),
--   text       text,
--   created_at timestamptz default now()
-- );

-- alter table reviews enable row level security;
-- drop policy if exists reviews_public_select on reviews;
-- drop policy if exists reviews_buyer_insert on reviews;
-- create policy reviews_public_select on reviews for select using (true);-- ── Storage policies for order-qr bucket ─────────────────────────────────────
-- NOTE: The bucket must be created manually in Supabase dashboard (see README).
-- Bucket name: order-qr   (private, no public access)
--
-- These policies use storage.objects and join with orders to restrict access.

-- Allow seller to upload to their own orders
drop policy if exists "seller_can_upload_qr" on storage.objects;
create policy "seller_can_upload_qr" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'order-qr'
    and (storage.foldername(name))[1] = 'orders'
    and exists (
      select 1 from orders o
      where o.id::text = (storage.foldername(name))[2]
        and o.seller_id = auth.uid()
        and o.status in ('LOCKED','SELLER_ACCEPTED')
    )
  );

-- Allow seller to overwrite (update) QR
drop policy if exists "seller_can_update_qr" on storage.objects;
create policy "seller_can_update_qr" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'order-qr'
    and exists (
      select 1 from orders o
      where o.id::text = (storage.foldername(name))[2]
        and o.seller_id = auth.uid()
    )
  );

-- Allow buyer AND seller to read (via signed URL generation — service_role handles this)
drop policy if exists "participants_can_read_qr" on storage.objects;
create policy "participants_can_read_qr" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'order-qr'
    and exists (
      select 1 from orders o
      where o.id::text = (storage.foldername(name))[2]
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
  );

-- Function: create a notification (called server-side via service_role)
create or replace function create_notification(
  p_user_id uuid, p_type text, p_title text, p_body text, p_link text default null
) returns void language plpgsql security definer as $$
begin
  insert into notifications(user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link);
end;
$$;

grant execute on function create_notification(uuid,text,text,text,text) to service_role;
