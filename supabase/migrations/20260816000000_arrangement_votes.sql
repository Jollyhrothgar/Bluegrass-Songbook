-- NOT YET APPLIED. Per-arrangement voting (issue #233, Phase 2c of
-- docs/plans/contribution-pipeline.md).
--
-- Phase 2c makes "edit someone else's chart" fork into a NEW ARRANGEMENT on the
-- SAME work, and promises that "voting/curation picks the default". Voting
-- could not keep that promise: `song_votes` keys on `song_id` alone, so every
-- take a work holds shared one ballot and the Arrangement pill could only put a
-- vote button on the primary row.
--
-- The philosophy does NOT change: votes RANK and DISPLAY, editorial curation
-- PINS. Nothing here flips a work.yaml default. This migration only gives the
-- ranking a key fine enough to name an arrangement.
--
-- ---------------------------------------------------------------------------
-- Why extend song_votes instead of adding an arrangement_votes table
-- ---------------------------------------------------------------------------
-- A separate table would mean two ballots with two RLS policy sets, two views,
-- and a UI that has to decide which one a row belongs to. But a fork IS a
-- version of the song — the pill already renders forks and sibling works in one
-- list — so they belong in one ballot. Extending keeps every existing row
-- valid, keeps "one vote per user per version" as a single constraint, and lets
-- the pill read one shape.
--
-- `arr_slug IS NULL` means "the work's own chart" — exactly what every row
-- written before today meant, and what a work with no forks still means. Forks
-- carry `build_works_index.arrangement_slug()`, which is derived from the
-- part's filename and therefore stable across builds and label edits.
--
-- Known wrinkle, deliberately left alone: if curation later moves the
-- `default: true` flag to a fork, the NULL-slug votes stay attached to
-- "whichever chart is primary" rather than following the old chart. Default
-- flips are rare, editorial, and happen precisely BECAUSE a fork won the count,
-- so the reinterpretation is at worst a reset. Fixing it would mean rewriting
-- historical rows at flip time; not worth the machinery today.
--
-- Verified against a throwaway PostgreSQL 15 with pre-migration rows already in
-- the table: legacy rows survive with arr_key '', a stacked NULL-slug vote is
-- still refused, a fork vote by the same user on the same song is accepted,
-- `on conflict (user_id, song_id, arr_key)` arbitrates, fork votes do not
-- appear in song_vote_counts, and re-running the whole file is a no-op.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
alter table song_votes
  add column if not exists arr_slug text;

-- Uniqueness with a nullable key. `UNIQUE(user_id, song_id, arr_slug)` would
-- NOT work: Postgres treats NULLs as distinct in a unique index, so a user
-- could stack unlimited work-level votes on one song.
--
-- The obvious fix is a unique index on `coalesce(arr_slug, '')`, but PostgREST
-- (and therefore supabase-js `.upsert({ onConflict })`) can only name COLUMNS
-- as the conflict arbiter — it cannot emit `ON CONFLICT (coalesce(...))`, and
-- it cannot infer a partial index either, because that needs a matching
-- `WHERE` clause on the statement. So we make the coalesce a real column: a
-- stored generated column is index-able, arbiter-able, and never written by a
-- client.
alter table song_votes
  add column if not exists arr_key text
  generated always as (coalesce(arr_slug, '')) stored;

-- Replace the old constraint. Its semantics survive intact: for a work-level
-- vote arr_key is '', so (user_id, song_id, '') is still one row per user.
--
-- DEPLOY ORDER: this drop removes the arbiter the SHIPPED frontend upserts on
-- (`onConflict: 'user_id,song_id'`), so a cached old bundle would get a
-- "no unique constraint matching" error on its next vote. Apply this migration
-- with, or just after, the Pages deploy that carries the new
-- `supabase-auth.js` — not days before it. Nothing else in the app reads
-- song_votes, so the blast radius is one button.
alter table song_votes
  drop constraint if exists song_votes_user_id_song_id_key;

create unique index if not exists song_votes_user_song_arr_key
  on song_votes (user_id, song_id, arr_key);

create index if not exists idx_song_votes_song_arr
  on song_votes (song_id, arr_key);

-- RLS is unchanged and still correct: the policies key on `user_id`, which is
-- what "one vote per user" is about. A finer vote key does not widen reach.

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
-- `song_vote_counts` keeps its exact shape and meaning: the WORK-level tally,
-- which is what ranks sibling works inside a version group. Adding the filter
-- is a no-op against existing data (every row written before today has a NULL
-- arr_slug) and keeps fork votes from silently inflating a work's standing
-- against other works.
create or replace view song_vote_counts
with (security_invoker = true) as
select
    song_id,
    group_id,
    count(*) as vote_count,
    sum(vote_value) as vote_sum
from song_votes
where arr_slug is null
group by song_id, group_id;

-- Companion view: the per-arrangement tally for one work. Covers ALL rows,
-- including the NULL-slug ones (surfaced as arr_key '') so the pill can read
-- every row of a work — primary and forks — from a single query.
create or replace view song_arrangement_vote_counts
with (security_invoker = true) as
select
    song_id,
    group_id,
    coalesce(arr_slug, '') as arr_key,
    arr_slug,
    count(*) as vote_count,
    sum(vote_value) as vote_sum
from song_votes
group by song_id, group_id, arr_slug;

grant select on song_vote_counts to authenticated, anon;
grant select on song_arrangement_vote_counts to authenticated, anon;
