-- Tabs join the instant contribution pipeline.
--
-- docs/plans/contribution-pipeline.md deferred this at 4c ("tabs keep the PR
-- flow") for one concrete reason: `pending_songs` was one row per SONG with a
-- `content text` column holding ChordPro and no notion of parts or
-- instruments, so an OTF had nowhere to sit. This migration is that reason
-- being removed. The row becomes parts-aware:
--
--   part_type   'lead-sheet' (everything that exists today) or 'tablature'
--   instrument  which instrument a tablature row is for — it names the part
--               AND becomes its filename, so it is shape-checked here
--   part_file   for a tab CORRECTION, the works/ filename being corrected
--               ('banjo-mfa3k2px9.otf.json'); null for a new tab
--
-- For a tablature row `content` holds the serialized OTF JSON document — the
-- same string create-tab-pr used to receive as `otf`. Text, diffable,
-- validatable: exactly the property 2b required of anything that goes
-- additive-instant, which is why the OTF was always eligible and only the
-- table shape was in the way.
--
-- Row ids: `id` is the PRIMARY KEY and, for a chart, it IS the work slug —
-- one row per song is the right shape when a song has one chart. It is the
-- wrong shape for a part. Two people tabbing the same song is ordinary on a
-- bounty board, and keying their rows by the work id would collide on the
-- PK; worse, the update policy gates on `created_by = auth.uid()`, so the
-- second person's upsert fails as a PERMISSIONS error that says nothing
-- about what actually went wrong. A pending chart and a pending tab for the
-- same song could not coexist either. So tab rows live in their own id
-- namespace:
--
--     tab:<slug>:<rand>
--       <slug>  the target work slug, or slugify(title) for a new work —
--               human-scannable only; nothing derives meaning from it
--       <rand>  >= 6 chars of [a-z0-9], which is what actually makes it unique
--
-- and `replaces_id` carries the work being targeted (null = mint a new one).
-- The CHECK below makes that structural rather than a convention nobody
-- remembers. A chart slug can never contain `:` (slugify emits [a-z0-9-]),
-- so the two namespaces cannot overlap in either direction.
--
-- RLS is deliberately untouched. 20260815120000 opened insert to any
-- authenticated user for rows they own (`created_by = auth.uid()`, defaulted
-- from the session) and kept update owner-or-trusted; none of that reads
-- `content` or cares what kind of part a row carries, so a tablature row is
-- governed by exactly the same rails a chart row is. The only RLS-adjacent
-- thing that DID need changing is the size cap — see below.
--
-- NOT APPLIED by this branch — apply with the rest of the phase.

-- ============================================
-- 1. Columns
-- ============================================

alter table pending_songs
  add column if not exists part_type text not null default 'lead-sheet';

alter table pending_songs add column if not exists instrument text;
alter table pending_songs add column if not exists part_file text;

comment on column pending_songs.part_type is
  'lead-sheet (content is ChordPro) or tablature (content is an OTF JSON document).';
comment on column pending_songs.instrument is
  'Required for part_type=tablature. Names the part and its file in works/.';
comment on column pending_songs.part_file is
  'Tab corrections only: the works/<id>/ filename this row targets. '
  'Null for a new tab — the writer picks a non-colliding name.';

-- ============================================
-- 2. Constraints
-- ============================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_part_type') then
    alter table pending_songs
      add constraint pending_songs_part_type
      check (part_type in ('lead-sheet', 'tablature'));
  end if;

  -- The one implication the contract turns on: a tablature row with no
  -- instrument cannot be given a filename, a part identity, or a place in
  -- the instrument pill. Refuse it at the table rather than discovering it
  -- in CI a minute later.
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_tab_needs_instrument') then
    alter table pending_songs
      add constraint pending_songs_tab_needs_instrument
      check (part_type <> 'tablature' or instrument is not null);
  end if;

  -- instrument and part_file both become paths inside works/. Same rule
  -- create-tab-pr enforced in TypeScript, now enforced where every writer
  -- has to pass it.
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_instrument_shape') then
    alter table pending_songs
      add constraint pending_songs_instrument_shape
      check (instrument is null or
             (instrument ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(instrument) <= 40));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pending_songs_part_file_shape') then
    alter table pending_songs
      add constraint pending_songs_part_file_shape
      check (part_file is null or
             (part_file ~ '^[a-z0-9]+(-[a-z0-9]+)*\.otf\.json$'
              and char_length(part_file) <= 200));
  end if;

  -- The id namespace split described in the header. Trivially true for every
  -- row that exists today (they are all part_type = 'lead-sheet'), so this
  -- cannot fail on apply; it only binds new tab rows.
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_tab_id_namespace') then
    alter table pending_songs
      add constraint pending_songs_tab_id_namespace
      check (part_type <> 'tablature' or id ~ '^tab:[a-z0-9-]*:[a-z0-9]{6,}$');
  end if;
end
$$;

-- Deliberately NO unique index on (replaces_id, instrument, created_by).
-- It looks like it would stop duplicate submissions, but the thing it would
-- actually stop is the case `add` mode exists to serve: a work carrying
-- several takes on one instrument (foggy-mountain-breakdown has eight banjo
-- ones). Adding `part_file` to the key to fix that leaves it forbidding
-- nothing. Volume is already bounded by the per-user hourly rate limit, and
-- cleanup-pending reaps what lands.

-- ============================================
-- 3. Size cap, per part type
-- ============================================

-- 20260815120000 capped content at 200KB, sized as "~4x the largest chart in
-- the corpus". An OTF is not a chart: create-tab-pr's own cap was 2,000,000
-- chars against a corpus max around 180KB, and multi-track arrangements are
-- the big ones. Leaving the chart cap in place would have rejected exactly
-- the tabs most worth having, at INSERT, with a constraint error the UI has
-- no story for. So the bound now depends on what the row is carrying.
alter table pending_songs drop constraint if exists pending_songs_content_size;

alter table pending_songs
  add constraint pending_songs_content_size
  check (content is null or octet_length(content) <=
         (case when part_type = 'tablature' then 2097152 else 204800 end));

-- ============================================
-- 4. The two columns the size-cap pass missed
-- ============================================

-- 20260815120000 capped title / artist / composer / content / tags and then
-- said, in a comment, "pending_songs has no notes column". It does —
-- 20260217000000 added `notes` and `status` — and that mistaken belief is
-- also what PR #237 ("drop CHECK on nonexistent pending_songs.notes") acted
-- on. So the one user-controlled text column with no bound is the one the
-- comment claimed did not exist, and tabs make it worse: a tab correction
-- writes the submitter's comment into `notes`.
--
-- 5000 matches dedup_hold and create-tab-pr's own comment cap, which is what
-- this field used to be before the PR flow was retired.
alter table pending_songs drop constraint if exists pending_songs_notes_len;

alter table pending_songs
  add constraint pending_songs_notes_len
  check (notes is null or char_length(notes) <= 5000);

-- `status` is user-writable through the same open insert policy, and
-- process_pending copies it STRAIGHT INTO work.yaml (`extra={'status': ...}`).
-- work_schema documents exactly two values and validate_work does not check
-- them, so an unbounded string here is unbounded text in the corpus. Bound it
-- to the enum instead of merely capping its length.
alter table pending_songs drop constraint if exists pending_songs_status_valid;

alter table pending_songs
  add constraint pending_songs_status_valid
  check (status is null or status in ('complete', 'placeholder'));

-- ============================================
-- 5. Index
-- ============================================

-- Tab rows are a small minority of the table but the surfaces that want them
-- (My Submissions, the tab overlay) want only them.
create index if not exists idx_pending_songs_tablature
  on pending_songs(created_by, created_at desc)
  where part_type = 'tablature';
