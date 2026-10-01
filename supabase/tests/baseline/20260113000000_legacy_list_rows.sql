-- TEST-HARNESS ONLY. Never applied to production (it lives under
-- supabase/tests/, not supabase/migrations/).
--
-- Timestamped between 20260109224000_multi_owner_lists.sql (which added
-- user_lists.owners DEFAULT '{}' and backfilled it once) and
-- 20260930000000_list_ownership_and_read_policies.sql. It reproduces the rows
-- production can hold from that window: lists created after the backfill but
-- before the client started sending owners (ab7bf46d6, 2026-01-12), which kept
-- owners = '{}' and orphaned_at = NULL.
--
-- list_security.test.sql asserts that, after the A1 migration, the creator of
-- each legacy list can still read it and its items, and that a list that was
-- orphaned on purpose (owners = '{}' AND orphaned_at set) is NOT revived.

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'legacy-creator@test.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'legacy-orphan-creator@test.invalid');

-- Legacy list: no owners, not orphaned. Its creator must still see it.
insert into public.user_lists (id, user_id, owners, name, position) values
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000c1', '{}', 'Legacy', 0);
insert into public.user_list_items (list_id, song_id, position) values
  ('33333333-3333-3333-3333-333333333333', 'song-legacy', 0);

-- A deliberately orphaned list (Thunderdome): owners empty, orphaned_at set.
insert into public.user_lists (id, user_id, owners, orphaned_at, name, position) values
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000c2', '{}', now(), 'Orphan', 0);
