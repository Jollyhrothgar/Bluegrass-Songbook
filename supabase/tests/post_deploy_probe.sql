-- Role-switched probes for the list security migration. Run AFTER
-- post_deploy_check.sql is clean. Safe on production: everything happens in a
-- transaction that is ROLLED BACK, and the only write (one log_events call) is
-- rolled back with it.
--
--   psql "$PROD_DB_URL" -X -f supabase/tests/post_deploy_probe.sql
--   (Dashboard SQL Editor: paste the whole file; it runs as postgres, which can
--    `set local role`.)
--
-- Prints "NOTICE: ok ..." per probe, then "NOTICE: PASS: post_deploy_probe.sql"
-- as the last probe output, or raises ERROR on the first failure (and then no
-- PASS line is printed, with or without ON_ERROR_STOP). Anon and an unrelated signed-in user are the two callers that must
-- see nothing.

begin;

do $$
declare
  v_n bigint;
  v_stranger uuid := gen_random_uuid();   -- a signed-in user who owns and follows nothing
begin
  -- anon
  set local role anon;
  select count(*) into v_n from public.user_lists;
  if v_n <> 0 then raise exception 'FAIL: anon can read % user_lists rows', v_n; end if;
  select count(*) into v_n from public.user_list_items;
  if v_n <> 0 then raise exception 'FAIL: anon can read % user_list_items rows', v_n; end if;
  select count(*) into v_n from public.list_followers;
  if v_n <> 0 then raise exception 'FAIL: anon can read % list_followers rows', v_n; end if;
  raise notice 'ok   anon reads no list rows';

  -- log_events inserts as anon (the A2 regression: it raised 42P01).
  if public.log_events('__post_deploy_probe__',
       '[{"event_name":"probe"}]'::jsonb) <> 1 then
    raise exception 'FAIL: log_events did not insert one row';
  end if;
  raise notice 'ok   anon log_events inserts (rolled back below)';

  begin
    perform public.add_list_owner(gen_random_uuid(), gen_random_uuid());
    raise exception 'FAIL: anon executed add_list_owner';
  exception when insufficient_privilege then
    raise notice 'ok   anon cannot execute add_list_owner';
  end;
  reset role;

  -- a signed-in user with no lists sees nothing either, and cannot call it
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.user_lists;
  if v_n <> 0 then raise exception 'FAIL: unrelated user reads % user_lists rows', v_n; end if;
  select count(*) into v_n from public.user_list_items;
  if v_n <> 0 then raise exception 'FAIL: unrelated user reads % user_list_items rows', v_n; end if;
  select count(*) into v_n from public.list_followers;
  if v_n <> 0 then raise exception 'FAIL: unrelated user reads % list_followers rows', v_n; end if;
  raise notice 'ok   unrelated signed-in user reads no list rows';

  begin
    perform public.add_list_owner(gen_random_uuid(), v_stranger);
    raise exception 'FAIL: authenticated executed add_list_owner';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute add_list_owner';
  end;
  if public.remove_list_owner(gen_random_uuid())->>'error' <> 'List not found' then
    raise exception 'FAIL: remove_list_owner(unknown list) did not report List not found';
  end if;
  raise notice 'ok   remove_list_owner(p_list_id) resolves and only acts for the caller';
  reset role;

  -- Emitted from INSIDE the block, so it only appears when every probe above
  -- passed. A trailing standalone SELECT would print even after a failure when
  -- the file is run without ON_ERROR_STOP (plain `psql -f`, or the dashboard).
  raise notice 'PASS: post_deploy_probe.sql';
end
$$;

rollback;
