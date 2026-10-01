-- READ-ONLY post-deploy check for 20260930000000 (list ownership + read
-- policies) and 20260930010000 (log_events). One SELECT, no writes, safe to run
-- against production. Every row says PASS, FAIL or INSPECT; FAIL sorts first.
--
--   Dashboard:  paste into Supabase > SQL Editor > Run.
--   psql:       psql "$PROD_DB_URL" -X -f supabase/tests/post_deploy_check.sql
--
-- (run.sh also runs this file against the local stack, so the file itself is
-- tested.) INSPECT rows are things only a human can judge: read them.
-- The role-switched probes (anon really sees no rows; log_events really
-- inserts) are in post_deploy_probe.sql.

with
list_tables(t) as (values ('user_lists'), ('user_list_items'), ('list_followers')),

-- 1. Every policy on the list tables, so a dashboard-made one cannot hide.
policies as (
  select 'policy ' || p.tablename || ' / ' || p.policyname as check_name,
         case when (p.cmd in ('SELECT', 'ALL')
                    and (p.qual is null or p.qual = 'true'
                         or p.roles && array['public', 'anon']::name[]))
                   or p.qual = 'true' or p.with_check = 'true'   -- an open write policy, any command
              then 'FAIL' else 'PASS' end as status,
         p.cmd || ' to ' || p.roles::text || ' using ' || coalesce(p.qual, '(none)')
           || ' check ' || coalesce(p.with_check, '(none)') as detail
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in (select t from list_tables)
),

-- 1b. Legacy lists (owners = '{}', never orphaned) are invisible to their own
--     creator under the owner-or-follower read policy. The migration backfills
--     them; none may remain.
legacy as (
  select 'no non-orphaned list without owners',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*) || ' row(s) with owners = {} and orphaned_at IS NULL'
    from public.user_lists
   where (owners is null or owners = '{}'::uuid[]) and orphaned_at is null
),

-- 2. RLS is on.
rls as (
  select 'rls on ' || c.relname,
         case when c.relrowsecurity then 'PASS' else 'FAIL' end,
         'relrowsecurity = ' || c.relrowsecurity
    from pg_class c
   where c.oid in ('public.user_lists'::regclass, 'public.user_list_items'::regclass,
                   'public.list_followers'::regclass)
),

-- 3. Who can execute what. aclexplode on the real ACL, grantee 0 = PUBLIC.
fn(proc, anon, authed, expect_anon, expect_authed) as (values
  ('public.add_list_owner(uuid,uuid)',       false, false, false, false),
  ('public.remove_list_owner(uuid)',         false, true,  false, true),
  ('public.cleanup_expired_orphans()',       false, false, false, false),
  ('public.claim_list_invite(text)',         false, true,  false, true),
  ('public.claim_orphaned_list(uuid)',       false, true,  false, true),
  ('public.generate_list_invite(uuid)',      false, true,  false, true),
  ('public.get_public_list(uuid)',           true,  true,  true,  true),
  ('public.log_events(text,jsonb)',          true,  true,  true,  true)
),
grants as (
  select 'execute ' || f.proc,
         case when p.oid is not null
               and has_function_privilege('anon', p.oid, 'execute') = f.expect_anon
               and has_function_privilege('authenticated', p.oid, 'execute') = f.expect_authed
               and (f.expect_anon
                    or not exists (select 1
                                     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                    where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
              then 'PASS' else 'FAIL' end,
         'anon=' || has_function_privilege('anon', p.oid, 'execute')
           || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
           || ' PUBLIC=' || exists (select 1
                                      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                     where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           || ' (want anon=' || f.expect_anon || ' authenticated=' || f.expect_authed || ')'
    from fn f
    left join pg_proc p on p.oid = to_regprocedure(f.proc)   -- a missing function is a FAIL row, not a missing row
),

-- 4. remove_list_owner has ONE overload, and it is the one-argument form.
overloads as (
  select 'remove_list_owner overloads',
         case when count(*) = 1 and bool_and(p.pronargs = 1) then 'PASS' else 'FAIL' end,
         coalesce(string_agg(p.oid::regprocedure::text, ', '), 'none')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'remove_list_owner'
),

-- 5. Security attributes.
attrs as (
  select 'definer + search_path ' || p.proname,
         case when p.prosecdef
                   and (p.proname <> 'log_events'
                        or exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                    where c in ('search_path=', 'search_path=""')))
                   and p.proconfig is not null
              then 'PASS' else 'FAIL' end,
         'prosecdef=' || p.prosecdef || ' proconfig=' || coalesce(p.proconfig::text, 'NULL')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('log_events', 'get_public_list', 'remove_list_owner')
),

-- 6. Functions 20260107010000 emptied the search_path of, whose bodies are not
--    in the repo (submit_flag, get_visitor_flag_count) or are trivial. An empty
--    search_path plus an UNQUALIFIED table name in the body is the log_events
--    bug. Read the body; every table must read public.<name>.
inspect as (
  select 'inspect body of ' || p.proname,
         'INSPECT',
         'proconfig=' || coalesce(p.proconfig::text, 'NULL')
           || E'\n' || regexp_replace(p.prosrc, E'\\s+', ' ', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('submit_flag', 'get_visitor_flag_count', 'update_updated_at')
),

-- 7. Every function whose body mentions a list table and that anon or PUBLIC
--    can execute (a dashboard-made SECURITY DEFINER function would show up
--    here). Read the list: each one must be something you expect an anonymous
--    caller to run (get_public_list, log_events, and trigger functions).
exposed as (
  select 'inspect anon-executable functions touching list tables',
         'INSPECT',
         coalesce(string_agg(p.oid::regprocedure::text
                               || case when p.prosecdef then ' [definer]' else '' end,
                             E'\n' order by p.proname),
                  '(none)')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.prosrc ~* '(user_lists|user_list_items|list_followers)'
     and (has_function_privilege('anon', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
)

select status, check_name, detail
  from (select * from policies union all select * from legacy union all select * from rls union all
        select * from grants union all select * from overloads union all
        select * from attrs union all select * from inspect union all
        select * from exposed) all_checks
 order by case status when 'FAIL' then 0 when 'INSPECT' then 1 else 2 end, check_name;
