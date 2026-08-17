-- Leaderboard: hidden rows (2026-08-17).
--
-- An opted-in identity can now also be HIDDEN: the row exists and scores
-- accumulate, but no other viewer's board contains it — not aliased,
-- absent. The filter runs BEFORE ranking, so visible ranks have no gaps
-- and nobody's total implies a ghost above them. The hidden user still
-- sees their own row (named, is_you) on their own board.
--
-- Seeded: Mike hides himself — a 19k-song founder wall at rank 1 would
-- discourage the newcomers the board exists to encourage.
--
-- The function below is the 20260816120000 body verbatim plus the
-- `visible` CTE; keep them in sync if either is edited.

alter table leaderboard_identities
  add column if not exists hidden boolean not null default false;

update leaderboard_identities set hidden = true where display_name = 'Mike';

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
  -- provenance uuids (see the 20260816120000 contract), so a missing salt row
  -- is a privacy failure, not a cosmetic one.
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
  -- Hidden identities leave every board except their owner's, BEFORE the
  -- alias/rank steps, so downstream logic never sees them at all.
  visible as (
    select t.*
    from totals t
    left join leaderboard_identities hi on hi.user_id = t.user_id
    where coalesce(hi.hidden, false) = false
       or t.user_id = auth.uid()
  ),
  hashed as (
    select
      t.*,
      md5(v_salt || t.user_id::text) as h
    from visible t
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

revoke all on function get_leaderboard() from public;
grant execute on function get_leaderboard() to anon;
grant execute on function get_leaderboard() to authenticated;
