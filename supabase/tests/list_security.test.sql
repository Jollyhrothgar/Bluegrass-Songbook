-- A1 / A2 verification: list ownership RPCs, list read policies, log_events.
--
-- Runs against the LOCAL stack that supabase/tests/run.sh starts, as a single
-- transaction that is rolled back at the end. Every actor is played by
-- switching role and the JWT claim (the same thing PostgREST does), so what is
-- exercised is the real RLS and the real GRANTs, not a mock.
--
-- Any failed expectation raises and the psql run exits non-zero.

\set ON_ERROR_STOP on
\set QUIET on
begin;

-- ---------------------------------------------------------------- helpers ---
create schema t;
grant usage on schema t to anon, authenticated;

-- Become a signed-in user (PostgREST: role + request.jwt.claims).
create function t.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function t.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

create function t.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function t.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FAIL: %', p_what;
  end if;
  raise notice 'ok   %', p_what;
end $$;

-- Run p_sql and return the SQLSTATE it fails with ('' when it succeeds).
create function t.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlstate;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- --------------------------------------------------------------- fixtures ---
-- O  owner of list L          O2 (becomes) a co-owner by invite
-- F  follower of L            S  stranger, owns the private list P
-- F2 a second follower of L
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'o@test.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'o2@test.invalid'),
  ('00000000-0000-0000-0000-00000000000f', 'authenticated', 'authenticated', 'f@test.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'f2@test.invalid'),
  ('00000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's@test.invalid');

insert into user_lists (id, user_id, owners, name, position) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
   array['00000000-0000-0000-0000-00000000000a']::uuid[], 'L', 0),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000005',
   array['00000000-0000-0000-0000-000000000005']::uuid[], 'P', 0);
insert into user_list_items (list_id, song_id, position, metadata) values
  ('11111111-1111-1111-1111-111111111111', 'song-a', 0, '{"notes": "private note"}'),
  ('11111111-1111-1111-1111-111111111111', 'song-b', 1, '{}'),
  ('22222222-2222-2222-2222-222222222222', 'song-p', 0, '{"notes": "s private"}');
insert into list_followers (list_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000f'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000f2');
insert into list_invites (list_id, token, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'invite-token-1', '00000000-0000-0000-0000-00000000000a');

-- ------------------------------------------------------------------- anon ---
do $$
declare v_l uuid := '11111111-1111-1111-1111-111111111111'; r json;
begin
  perform t.as_anon();
  perform t.expect((select count(*) from user_lists) = 0, 'anon reads no user_lists');
  perform t.expect((select count(*) from user_list_items) = 0, 'anon reads no user_list_items');
  perform t.expect((select count(*) from list_followers) = 0, 'anon reads no list_followers');
  perform t.expect((select count(*) from list_invites) = 0, 'anon reads no list_invites');

  perform t.expect(t.sqlstate_of($q$select add_list_owner('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000005')$q$) = '42501',
                   'anon cannot execute add_list_owner');
  perform t.expect(t.sqlstate_of($q$select remove_list_owner('11111111-1111-1111-1111-111111111111')$q$) = '42501',
                   'anon cannot execute remove_list_owner');
  perform t.expect(t.sqlstate_of($q$select claim_list_invite('invite-token-1')$q$) = '42501',
                   'anon cannot execute claim_list_invite');
  perform t.expect(t.sqlstate_of($q$select cleanup_expired_orphans()$q$) = '42501',
                   'anon cannot execute cleanup_expired_orphans');
  perform t.expect(t.sqlstate_of($q$insert into user_lists (user_id, name) values ('00000000-0000-0000-0000-000000000005', 'x')$q$) = '42501',
                   'anon cannot insert a list');

  -- The share-link door stays open, and carries the songs.
  r := get_public_list(v_l);
  perform t.expect(json_array_length(r->'songs') = 2, 'anon get_public_list returns the songs');
  perform t.expect((r->>'is_owner')::boolean = false and (r->>'is_follower')::boolean = false,
                   'anon get_public_list: not owner, not follower');
  perform t.expect(r->'list'->>'name' = 'L', 'anon get_public_list returns the list name');
  perform t.expect((get_public_list('99999999-9999-9999-9999-999999999999')->>'error') = 'List not found',
                   'anon get_public_list reports a missing list');

  -- A2: analytics goes through log_events for anon.
  perform t.expect(log_events('visitor-anon', '[{"event_name":"a"},{"event_name":"b","properties":{"x":1}}]'::jsonb) = 2,
                   'anon log_events inserts 2 rows');
  perform t.reset();
  perform t.expect((select count(*) from analytics_events where visitor_id = 'visitor-anon') = 2,
                   'log_events rows landed in analytics_events');
end $$;

-- --------------------------------------------------------------- stranger ---
do $$
declare v_l uuid := '11111111-1111-1111-1111-111111111111';
        v_s uuid := '00000000-0000-0000-0000-000000000005';
        v_o uuid := '00000000-0000-0000-0000-00000000000a'; r json;
begin
  perform t.as_user(v_s);
  perform t.expect((select count(*) from user_lists where id = v_l) = 0, 'stranger cannot read list L');
  perform t.expect((select count(*) from user_list_items where list_id = v_l) = 0, 'stranger cannot read L items');
  perform t.expect((select count(*) from list_followers where list_id = v_l) = 0, 'stranger cannot read L followers');
  perform t.expect((select count(*) from user_lists) = 1, 'stranger reads exactly their own list');
  perform t.expect((select count(*) from user_list_items) = 1, 'stranger reads exactly their own items');

  perform t.expect(t.sqlstate_of($q$select add_list_owner('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000005')$q$) = '42501',
                   'stranger cannot execute add_list_owner');
  perform t.expect(t.sqlstate_of($q$select remove_list_owner('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a')$q$) = '42883',
                   'the two-argument remove_list_owner no longer exists');
  r := remove_list_owner(v_l);
  perform t.expect(r->>'error' = 'Not an owner', 'stranger remove_list_owner(L) is refused');
  perform t.expect(t.sqlstate_of($q$select cleanup_expired_orphans()$q$) = '42501',
                   'authenticated cannot execute cleanup_expired_orphans');

  -- Direct table writes against someone else's list touch nothing.
  delete from user_lists where id = v_l;
  update user_lists set owners = array[v_s] where id = v_l;
  delete from user_list_items where list_id = v_l;
  perform t.expect(t.sqlstate_of($q$insert into user_list_items (list_id, song_id) values ('11111111-1111-1111-1111-111111111111', 'spam')$q$) = '42501',
                   'stranger cannot add items to L');
  perform t.expect(update_list_item_metadata(v_l, 'song-a', '{"notes":"x"}'::jsonb) = false,
                   'stranger update_list_item_metadata is refused');
  perform t.expect(t.sqlstate_of($q$insert into list_followers (list_id, user_id) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a')$q$) = '42501',
                   'stranger cannot make someone else follow a list');
  perform t.expect(t.sqlstate_of($q$insert into user_lists (user_id, owners, name) values ('00000000-0000-0000-0000-000000000005', array['00000000-0000-0000-0000-00000000000a']::uuid[], 'spam')$q$) = '42501',
                   'stranger cannot create a list that names another user as owner');
  perform t.expect(t.sqlstate_of($q$insert into user_lists (user_id, owners, name) values ('00000000-0000-0000-0000-000000000005', array['00000000-0000-0000-0000-000000000005']::uuid[], 'mine')$q$) = '',
                   'a user can create a list they own');
  perform t.expect(generate_list_invite(v_l)->>'error' = 'Not an owner of this list',
                   'stranger generate_list_invite is refused');
  perform t.reset();

  -- Nothing above changed L.
  perform t.expect((select owners from user_lists where id = v_l) = array[v_o]::uuid[], 'L still has exactly its owner');
  perform t.expect((select count(*) from user_list_items where list_id = v_l) = 2, 'L still has its items');
  perform t.expect((select count(*) from list_invites where list_id = v_l) = 1, 'no invite was created for L by the stranger');
  perform t.expect((select count(*) from user_lists where name = 'spam') = 0, 'no spam list');
end $$;

-- ------------------------------------------------------------------ owner ---
do $$
declare v_l uuid := '11111111-1111-1111-1111-111111111111';
        v_o uuid := '00000000-0000-0000-0000-00000000000a'; r json;
begin
  perform t.as_user(v_o);
  -- fetchCloudLists
  perform t.expect((select count(*) from user_lists where owners @> array[v_o]) = 1, 'owner reads own list (contains owners)');
  perform t.expect((select count(*) from user_list_items where list_id in (select id from user_lists where owners @> array[v_o])) = 2,
                   'owner reads own items with metadata');
  perform t.expect((select count(*) from list_followers where list_id = v_l) = 2, 'owner sees who follows their list');
  perform t.expect((select count(*) from list_invites where list_id = v_l) = 1, 'owner sees their invites');
  perform t.expect(get_public_list(v_l)->>'is_owner' = 'true', 'owner get_public_list: is_owner');

  -- writes the client makes
  update user_lists set name = 'L renamed' where id = v_l;
  perform t.expect((select name from user_lists where id = v_l) = 'L renamed', 'owner renames list');
  insert into user_list_items (list_id, song_id, position) values (v_l, 'song-c', 2);
  insert into user_list_items (list_id, song_id, position) values (v_l, 'song-c', 5)
    on conflict (list_id, song_id) do update set position = excluded.position;
  perform t.expect((select position from user_list_items where list_id = v_l and song_id = 'song-c') = 5, 'owner upserts an item');
  perform t.expect(update_list_item_metadata(v_l, 'song-a', '{"key":"G"}'::jsonb) = true, 'owner update_list_item_metadata');
  delete from user_list_items where list_id = v_l and song_id = 'song-c';
  perform t.expect((select count(*) from user_list_items where list_id = v_l) = 2, 'owner removes an item');

  r := generate_list_invite(v_l);
  perform t.expect(r->>'status' = 'success' and length(r->>'token') = 32, 'owner generate_list_invite');
  perform t.expect(t.sqlstate_of($q$select add_list_owner('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000005')$q$) = '42501',
                   'even the owner cannot call add_list_owner directly');
  perform t.reset();
end $$;

-- --------------------------------------------------------------- follower ---
do $$
declare v_l uuid := '11111111-1111-1111-1111-111111111111';
        v_f uuid := '00000000-0000-0000-0000-00000000000f'; r json;
begin
  perform t.as_user(v_f);
  -- fetchFollowedLists
  perform t.expect((select count(*) from list_followers where user_id = v_f) = 1, 'follower reads their follow row');
  perform t.expect((select count(*) from list_followers) = 1, 'follower sees no other follower rows');
  perform t.expect((select count(*) from user_lists where id in (select list_id from list_followers where user_id = v_f)) = 1,
                   'follower reads the followed list');
  perform t.expect((select count(*) from user_list_items where list_id = v_l) = 2, 'follower reads the followed items');
  perform t.expect((select metadata->>'notes' from user_list_items where list_id = v_l and song_id = 'song-a') = 'private note',
                   'follower reads item metadata');
  perform t.expect((select count(*) from user_lists) = 1, 'follower reads only the followed list');
  perform t.expect(get_public_list(v_l)->>'is_follower' = 'true', 'follower get_public_list: is_follower');

  -- read-only
  update user_lists set name = 'hacked' where id = v_l;
  delete from user_lists where id = v_l;
  update user_list_items set position = 99 where list_id = v_l;
  delete from user_list_items where list_id = v_l;
  perform t.expect(remove_list_owner(v_l)->>'error' = 'Not an owner', 'follower cannot remove_list_owner');
  perform t.expect(claim_orphaned_list(v_l)->>'error' = 'List is not orphaned', 'follower cannot claim a non-orphaned list');

  -- unfollow own row only
  delete from list_followers where list_id = v_l and user_id = '00000000-0000-0000-0000-0000000000f2';
  perform t.reset();
  perform t.expect((select count(*) from list_followers where list_id = v_l) = 2, 'follower cannot unfollow someone else');
  perform t.expect((select name from user_lists where id = v_l) = 'L renamed', 'follower did not rename the list');
  perform t.expect((select count(*) from user_list_items where list_id = v_l and position = 99) = 0, 'follower did not move items');
end $$;

-- --------------------------------------- follow by link, then invite, leave ---
do $$
declare v_l uuid := '11111111-1111-1111-1111-111111111111';
        v_o uuid := '00000000-0000-0000-0000-00000000000a';
        v_o2 uuid := '00000000-0000-0000-0000-00000000000b';
        v_f uuid := '00000000-0000-0000-0000-00000000000f';
        v_f2 uuid := '00000000-0000-0000-0000-0000000000f2'; r json;
begin
  -- A signed-in user opens a share link (get_public_list), follows, and can then read the list.
  perform t.as_user(v_o2);
  perform t.expect((select count(*) from user_lists where id = v_l) = 0, 'before following: O2 cannot read L');
  insert into list_followers (list_id, user_id) values (v_l, v_o2);
  perform t.expect((select count(*) from user_lists where id = v_l) = 1, 'after following: O2 reads L');
  perform t.expect((select count(*) from user_list_items where list_id = v_l) = 2, 'after following: O2 reads L items');

  -- Invite claim: add_list_owner runs as the definer even though nobody can call it.
  r := claim_list_invite('invite-token-1');
  perform t.expect(r->>'status' = 'success', 'O2 claims the invite');
  perform t.expect((select owners from user_lists where id = v_l) @> array[v_o2], 'claim_list_invite made O2 an owner');
  perform t.expect((select count(*) from list_followers where list_id = v_l and user_id = v_o2) = 0, 'claim removed O2 from followers');
  perform t.expect(claim_list_invite('invite-token-1')->>'error' = 'Invite already used', 'an invite cannot be claimed twice');
  perform t.expect((select count(*) from user_lists where owners @> array[v_o2]) = 1, 'O2 now reads L as an owner');

  -- Leave with another owner remaining.
  r := remove_list_owner(v_l);
  perform t.expect(r->>'status' = 'removed', 'O2 leaves: list survives');
  perform t.expect((select count(*) from user_lists where id = v_l) = 0, 'O2 no longer reads L after leaving');
  perform t.reset();
  perform t.expect((select owners from user_lists where id = v_l) = array[v_o]::uuid[], 'only O2 was removed');

  -- Last owner leaves with followers: orphaned, followers still read it.
  perform t.as_user(v_o);
  r := remove_list_owner(v_l);
  perform t.expect(r->>'status' = 'orphaned' and (r->>'follower_count')::int = 2, 'last owner leaves: list is orphaned');
  perform t.expect((select count(*) from user_lists where id = v_l) = 0, 'ex-owner no longer reads the orphaned list');
  perform t.as_user(v_f);
  perform t.expect((select count(*) from user_lists where id = v_l and orphaned_at is not null) = 1, 'follower still reads the orphaned list');
  perform t.expect(get_public_list(v_l)->>'can_claim' = 'true', 'follower can_claim an orphaned list');
  perform t.expect(claim_orphaned_list(v_l)->>'status' = 'claimed', 'follower claims the orphaned list');
  perform t.expect((select owners from user_lists where id = v_l) = array[v_f]::uuid[], 'claimant owns the list');

  -- Last owner leaves, other follower remains (F2): orphaned again; F2 claims and leaves -> deleted.
  r := remove_list_owner(v_l);
  perform t.expect(r->>'status' = 'orphaned', 'claimant leaves: orphaned again (F2 follows)');
  perform t.as_user(v_f2);
  perform t.expect(claim_orphaned_list(v_l)->>'status' = 'claimed', 'F2 claims');
  r := remove_list_owner(v_l);
  perform t.expect(r->>'status' = 'deleted', 'last owner with no followers: list deleted');
  perform t.reset();
  perform t.expect((select count(*) from user_lists where id = v_l) = 0, 'list is gone');
  perform t.expect((select count(*) from user_list_items where list_id = v_l) = 0, 'its items cascaded away');

  -- No signed-in user (auth.uid() is null), no removal.
  perform t.expect(remove_list_owner('22222222-2222-2222-2222-222222222222')->>'error' = 'Not signed in',
                   'remove_list_owner with no auth.uid() is refused');
  perform t.expect((select count(*) from user_lists where id = '22222222-2222-2222-2222-222222222222') = 1,
                   'and the list is untouched');
end $$;

-- ------------------------------------------------------ catalog assertions ---
do $$
begin
  perform t.expect(not exists (
      select 1 from pg_policies
       where tablename in ('user_lists','user_list_items','list_followers')
         and cmd in ('SELECT','ALL')
         and (qual = 'true' or roles <> array['authenticated']::name[])),
    'no open read policy on the three list tables');
  perform t.expect(not has_function_privilege('anon', 'public.add_list_owner(uuid,uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.add_list_owner(uuid,uuid)', 'execute'),
                   'add_list_owner is not executable by anon or authenticated');
  perform t.expect(has_function_privilege('anon', 'public.get_public_list(uuid)', 'execute'),
                   'anon can execute get_public_list');
  perform t.expect(has_function_privilege('anon', 'public.log_events(text,jsonb)', 'execute'),
                   'anon can execute log_events');
end $$;

-- ------------------------------------------ other 20260107010000 functions ---
-- update_updated_at() keeps working with an empty search_path.
do $$
declare v_s uuid := '00000000-0000-0000-0000-000000000005'; v_before timestamptz; v_after timestamptz;
begin
  insert into song_votes (user_id, song_id, group_id, updated_at) values (v_s, 'song-x', 'g', now() - interval '1 day');
  select updated_at into v_before from song_votes where song_id = 'song-x';
  update song_votes set vote_value = 2 where song_id = 'song-x';
  select updated_at into v_after from song_votes where song_id = 'song-x';
  perform t.expect(v_after > v_before, 'update_updated_at trigger still runs under an empty search_path');
end $$;

rollback;
\echo PASS: list_security.test.sql
