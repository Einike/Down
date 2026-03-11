-- 0009_reports_bans.sql
-- Adds user roles, ban fields, and a private reports/moderation table.
-- All new columns are nullable or have safe defaults — no existing data affected.

-- ── 1. Role + ban fields on profiles ─────────────────────────────────────────
alter table profiles
  add column if not exists role         text        not null default 'user'
    constraint profiles_role_ck check (role in ('user','admin')),
  add column if not exists is_banned    boolean     not null default false,
  add column if not exists banned_until timestamptz,
  add column if not exists ban_reason   text,
  add column if not exists banned_by    uuid        references profiles(id);

-- ── 2. Reports table ─────────────────────────────────────────────────────────
create table if not exists reports (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  reporter_id      uuid        not null references profiles(id),
  reported_user_id uuid        not null references profiles(id),
  order_id         uuid        references orders(id),
  listing_id       uuid        references listings(id),
  reason_code      text        not null,
  message          text        not null,
  status           text        not null default 'open'
    constraint reports_status_ck check (status in ('open','reviewed','resolved','dismissed')),
  admin_notes      text,
  reviewed_by      uuid        references profiles(id),
  reviewed_at      timestamptz,
  constraint reports_no_self_report check (reporter_id != reported_user_id)
);

-- ── 3. RLS on reports ────────────────────────────────────────────────────────
alter table reports enable row level security;

-- Users can submit a report (reporter_id must be themselves)
create policy "users_insert_reports" on reports
  for insert to authenticated
  with check (auth.uid() = reporter_id);

-- Reporters can view only their own submitted reports
create policy "reporter_view_own" on reports
  for select to authenticated
  using (auth.uid() = reporter_id);

-- No UPDATE / DELETE for regular users — admin reads/writes via service_role (bypasses RLS)

-- ── 4. Indexes ───────────────────────────────────────────────────────────────
create index if not exists reports_status_idx       on reports(status);
create index if not exists reports_reported_user_idx on reports(reported_user_id);
create index if not exists reports_created_at_idx   on reports(created_at desc);
create index if not exists reports_reporter_idx     on reports(reporter_id);
