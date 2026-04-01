-- 0013_notifications_realtime.sql
-- Add the notifications table to the Supabase Realtime publication so the
-- NotifBell component receives instant INSERT events instead of relying
-- solely on polling.

do $$
begin
  alter publication supabase_realtime add table notifications;
exception
  when duplicate_object then null; -- already in publication, ignore
end $$;
