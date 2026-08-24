-- is_trusted_user(): pin search_path and schema-qualify the body.
--
-- It was the ONLY one of the 24 functions in `public` still running
-- SECURITY DEFINER with a mutable search_path.
-- 20260107010000_fix_function_search_path.sql pinned seven of them on
-- 2026-01-07; this one was created three weeks later, on 2026-01-31 in
-- 20260131000000_pending_songs.sql, and missed the pass.
--
-- Why it matters more than the others: this is the predicate inside the RLS
-- policies on pending_songs, promoted_songs, bounties and review_requests.
-- SECURITY DEFINER means it executes as the owner (postgres), and the body
-- named `trusted_users` unqualified — so resolution depended on whatever
-- search_path the caller brought. A caller able to influence it could have
-- the check read a different relation entirely and answer "yes", which is a
-- privilege-escalation path straight into the write policies. This is the
-- class Supabase's own database linter flags as
-- `function_search_path_mutable`.
--
-- `search_path = ''` means NOTHING resolves unqualified, so the body has to
-- name `public.trusted_users` and `auth.uid()` in full. That is the point:
-- an empty search_path cannot be hijacked because it grants no ambient
-- resolution at all.
--
-- CREATE OR REPLACE preserves the existing grant to `authenticated`
-- (20260131000000) and every policy that references the function, so this
-- neither re-grants nor re-creates anything downstream.

create or replace function public.is_trusted_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trusted_users where user_id = auth.uid()
  );
$$;

-- Postcondition. See "Self-verifying migrations" in supabase/CLAUDE.md: a
-- migration that changes a security-relevant attribute asserts its own
-- result, so it cannot be stamped-without-running. `db push` wraps each file
-- in a transaction, so raising here rolls this back and the ledger never
-- records it — which is exactly the failure mode
-- 20260209000000_pending_nullable_content.sql demonstrated by going six
-- months marked-applied with its DDL never having run.
do $$
begin
  -- proconfig holds the SET clauses as `name=value` strings. An EMPTY
  -- search_path is rendered either as `search_path=` or as `search_path=""`
  -- depending on server version, so both spellings count and neither is
  -- matched with `@>` against a guessed literal — that guess is what made
  -- the first draft of this migration fail its own assertion.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'is_trusted_user'
       and p.prosecdef                                    -- still definer
       and exists (                                       -- and now pinned
         select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
          where cfg in ('search_path=', 'search_path=""')
       )
  ) then
    raise exception
      'POSTCONDITION FAILED: public.is_trusted_user() is not SECURITY '
      'DEFINER with search_path pinned to the empty string. The ledger '
      'would say this migration applied. It did not.';
  end if;
end
$$;
