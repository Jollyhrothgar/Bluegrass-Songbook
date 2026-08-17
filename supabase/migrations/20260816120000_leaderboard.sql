-- NOT YET APPLIED. High Scores — the contribution leaderboard (#174, in part).
--
-- PRIVACY CONTRACT (this is the whole point of the design; read before editing)
--
--   The board is public. Contributor identities are NOT. The rule is
--   ANONYMIZE ON THE SERVER, NOT IN THE CLIENT: no email, no uuid, and no
--   auth.users metadata for any user other than the caller ever leaves the
--   database. This is not masking — the response literally does not contain
--   those columns, so there is nothing to un-mask in a devtools panel, a
--   cached response, or a scraped API call.
--
--   Three ways a row's `display` can be resolved, in this order:
--
--     1. leaderboard_identities  — an explicit, opt-in real name. Seeded with
--        exactly one row (Mike). Nobody is in here unless they asked to be.
--     2. the caller's own row    — the caller already knows their own email,
--        so showing it back to them ("that's me") leaks nothing.
--     3. everyone else           — a deterministic bluegrass alias derived
--        from a SALTED hash of the user's uuid.
--
--   WHY THE SALT MATTERS. Contributor uuids are already public: they are
--   written into works/*/work.yaml as `provenance.submitted_by`. An UNSALTED
--   hash would therefore be a join key — anyone could hash the uuids they
--   can read out of the repo and map every alias back to a real contributor,
--   which is exactly the de-anonymization this feature is meant to prevent.
--   leaderboard_salt holds a random uuid that never leaves the database (RLS
--   on, zero policies, read only by the definer function below), so the alias
--   space is not computable by anyone outside Postgres.
--
--   Consequently BOTH tables here are policy-less by design. `enable row level
--   security` with no policies means: no client, anon or authenticated, can
--   select a single row. The only reader is get_leaderboard(), which is
--   `security definer` and returns aggregates that carry no identifiers.
--
-- Relationship to #174: that issue asks for auto-generated user names wired
-- to bounties and contributions, eventually backed by real profiles. This
-- migration ships the deterministic-alias half of it and nothing more —
-- there is no profile table, no user-visible name choice, and no way for a
-- user to see their own alias. #174 stays open for the profile work.

-- ---------------------------------------------------------------------------
-- 1. Opt-in real names
-- ---------------------------------------------------------------------------

create table if not exists leaderboard_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table leaderboard_identities enable row level security;

-- Deliberately NO policies. Only get_leaderboard() (security definer) reads
-- this; adding a "readable by anyone" policy would publish the user_id ->
-- real name mapping, which is the one thing this table must not do.

-- Seed the one opt-in identity. Guarded: if that account does not exist in
-- this project (fresh/local database), the select returns no rows and the
-- migration still applies cleanly.
insert into leaderboard_identities (user_id, display_name)
select id, 'Mike' from auth.users where email = 'michael.beaumier@gmail.com'
on conflict (user_id) do update set display_name = excluded.display_name;

-- ---------------------------------------------------------------------------
-- 2. The private alias salt
-- ---------------------------------------------------------------------------

create table if not exists leaderboard_salt (
  id int primary key default 1 check (id = 1),
  salt uuid not null default gen_random_uuid()
);

alter table leaderboard_salt enable row level security;

-- Deliberately NO policies (see the contract above). If this value ever
-- leaks, every alias becomes linkable to a public provenance uuid; rotating
-- it re-randomizes the whole board's aliases, which is the intended repair.
insert into leaderboard_salt (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. get_leaderboard()
-- ---------------------------------------------------------------------------
--
-- Counts CONTENT contributions only. Verified against the edge functions that
-- actually write submission_log:
--
--   counted   song_submit       auto-commit-song/index.ts
--             song_correction   (labelled in docs/js/my-submissions.js; kept
--                                so historical//future correction rows count)
--             tab_submit        create-tab-pr/index.ts
--             tab_correction    create-tab-pr/index.ts
--   excluded  flag_report       create-flag-issue  — a report, not content
--             song_request      create-song-request — an ask, not content
--             placeholder_request create-song-request — likewise
--             doc_upload        retired with the doc-staging intake (phase 2d)
--
-- Anonymous rows (user_id is null) are dropped: there is nobody to credit.

create or replace function get_leaderboard()
returns table (
  rank int,
  display text,
  total int,
  songs int,
  tabs int,
  is_you boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
-- RETURNS TABLE names (rank/display/total/songs/tabs/is_you) are also plpgsql
-- variables; if one ever matches a column in the body, take the column. Every
-- such reference below is already table-qualified, so this is a guard against
-- a future edit, not a live fix. (Must precede DECLARE.)
#variable_conflict use_column
declare
  v_salt text;
  -- 24 x 24 = 576 aliases. Either list can grow independently: the modulo
  -- below reads array_length(), so nothing needs to stay in sync. Growing a
  -- list DOES reshuffle every existing alias, which is harmless (nobody is
  -- promised a stable handle yet) but will look like a mass rename.
  v_adjectives text[] := array[
    'Foggy Mountain', 'Lonesome', 'Clinch Mountain', 'High Lonesome',
    'Gospel', 'Flatpickin''', 'Blue Ridge', 'Rollin''',
    'Crooked', 'Barn-Burnin''', 'Midnight', 'Whiskey',
    'Old-Time', 'Hard-Drivin''', 'Shady Grove', 'Salty',
    'Cripple Creek', 'Back Porch', 'Rusty', 'Thumbpickin''',
    'Cumberland', 'Wayfarin''', 'Ramblin''', 'Sawmill'
  ];
  v_nouns text[] := array[
    'Willie', 'Rambler', 'Picker', 'Drifter',
    'Songbird', 'Fiddler', 'Banjoist', 'Hollerer',
    'Stomper', 'Yodeler', 'Bootlegger', 'Preacher',
    'Harmonizer', 'Wanderer', 'Crooner', 'Strummer',
    'Chopper', 'Whistler', 'Traveler', 'Balladeer',
    'Muleskinner', 'Hobo', 'Troubadour', 'Roustabout'
  ];
  v_adj_n int := array_length(v_adjectives, 1);
  v_noun_n int := array_length(v_nouns, 1);
begin
  select s.salt::text into v_salt from leaderboard_salt s where s.id = 1;
  -- Refuse to run unsalted: an unsalted alias is a join key onto the public
  -- provenance uuids (see the contract above), so a missing salt row is a
  -- privacy failure, not a cosmetic one.
  if v_salt is null then
    raise exception 'leaderboard_salt is not seeded';
  end if;

  return query
  with totals as (
    select
      l.user_id,
      count(*)::int as total,
      count(*) filter (where l.action in ('song_submit', 'song_correction'))::int as songs,
      count(*) filter (where l.action in ('tab_submit', 'tab_correction'))::int as tabs
    from submission_log l
    where l.user_id is not null
      and l.action in ('song_submit', 'song_correction', 'tab_submit', 'tab_correction')
    group by l.user_id
    having count(*) > 0
  ),
  hashed as (
    select
      t.*,
      md5(v_salt || t.user_id::text) as h
    from totals t
  ),
  aliased as (
    select
      hh.*,
      v_adjectives[(get_byte(decode(hh.h, 'hex'), 0) % v_adj_n) + 1]
        || ' ' ||
      v_nouns[(get_byte(decode(hh.h, 'hex'), 1) % v_noun_n) + 1] as alias
    from hashed hh
  ),
  disambiguated as (
    select
      a.*,
      -- 576 aliases over a small board still collide occasionally. Append a
      -- short hash suffix ONLY to the rows that actually collide, so the
      -- common case stays a clean two-word name. The suffix comes from the
      -- salted hash, so it is no more linkable than the alias itself.
      --
      -- Hex chars 5-6 = digest byte 2, deliberately NOT bytes 0-1: those two
      -- pick the adjective and the noun, so rows that collide on the alias
      -- already agree on them mod 24, and a suffix drawn from there would
      -- have only ~11 distinct values. Byte 2 is independent of the alias,
      -- so the suffix uses its full 256-value space.
      case
        when count(*) over (partition by a.alias) > 1
          then a.alias || ' #' || substr(a.h, 5, 2)
        else a.alias
      end as alias_display
    from aliased a
  )
  select
    (rank() over (order by d.total desc))::int as rank,
    coalesce(
      ident.display_name,
      case when d.user_id = auth.uid() then u.email end,
      d.alias_display
    )::text as display,
    d.total,
    d.songs,
    d.tabs,
    coalesce(d.user_id = auth.uid(), false) as is_you
  from disambiguated d
  left join leaderboard_identities ident on ident.user_id = d.user_id
  -- auth.users is joined ONLY to resolve the caller's own email. The join is
  -- narrowed to auth.uid() so no other user's row is even read.
  left join auth.users u on u.id = d.user_id and u.id = auth.uid()
  -- Stable ordering without leaking anything: ties break on the salted hash,
  -- not on a uuid, an email, or a created_at.
  order by d.total desc, d.h;
end;
$$;

-- Callable by signed-in users and by signed-out visitors alike (the board is
-- public; only the identities behind it are not). Nothing else gets it —
-- `public` would hand it to every future role by default.
revoke all on function get_leaderboard() from public;
grant execute on function get_leaderboard() to anon;
grant execute on function get_leaderboard() to authenticated;
