-- A work's METADATA becomes editable on its own.
--
-- Every row shape this table has carried so far edits a PART: a chart's
-- ChordPro, a tab's OTF. The work-level fields — title, artist, key, notes —
-- have only ever ridden along as a side effect of rewriting the primary
-- chart (`process_pending.apply_row`, the `work_updates` block). That leaves
-- a work minted by a TAB stranded: it has a title taken from whatever the
-- submitter typed, no artist, no key, and no part anybody would want to
-- rewrite in order to fix them. There is no path to the fix at all.
--
-- So a third `part_type`, which is the honest name for "this row edits the
-- work, not a part of it":
--
--     part_type   'lead-sheet' | 'tablature' | 'metadata'
--
-- The owner's rule for who may send one (2026-08-18):
--
--   * own a part of the work — ANY part, chart or tab — and you may edit its
--     metadata;
--   * trusted users get full edit privileges, on any work.
--
-- That is deliberately a LOOSER ownership question than the one the part
-- columns ask, and the difference is what it buys. Owning a tab does not buy
-- an in-place rewrite of a stranger's lyrics (see `submittersOf` in
-- pending-dispatch.ts — that scoping is a fix for a real escalation and must
-- not be relaxed). It does buy the right to say the song is in A and was
-- written by the Stanley Brothers, because nobody's content is touched by
-- saying so. The rule is enforced in the edge function, which is the only
-- party that can see works/; SQL cannot answer "who owns a part" because the
-- answer lives in git.
--
-- NOT APPLIED by this branch — apply with the rest of the phase.

-- ============================================
-- 1. part_type gains a third value
-- ============================================

-- 20260818000000 added this constraint and IS APPLIED, so it exists and has
-- to be replaced rather than conditionally created. Dropping and re-adding a
-- CHECK is a full-table validation; pending_songs is a working set of tens of
-- rows, reaped by cleanup-pending, so that costs nothing.
alter table pending_songs drop constraint if exists pending_songs_part_type;

alter table pending_songs
  add constraint pending_songs_part_type
  check (part_type in ('lead-sheet', 'tablature', 'metadata'));

comment on column pending_songs.part_type is
  'lead-sheet (content is ChordPro), tablature (content is an OTF JSON '
  'document), or metadata (no content — this row edits the work''s own '
  'title/artist/key/notes and touches no part).';

-- ============================================
-- 2. What a metadata row must and must not carry
-- ============================================

do $$
begin
  -- A metadata edit has no work to mint. `create` is not one of its modes,
  -- there is no content to seed a work from, and slugify(title) as a target
  -- would let a typo mint an empty directory. It must name what it edits.
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_metadata_needs_target') then
    alter table pending_songs
      add constraint pending_songs_metadata_needs_target
      check (part_type <> 'metadata' or replaces_id is not null);
  end if;

  -- ...and it must carry no content. The whole point of the row is that it
  -- writes work.yaml and nothing else; a row with both would be ambiguous
  -- about which part the bytes were for, and `process_pending` would have to
  -- decide — which is exactly the kind of decision this table exists to keep
  -- out of the writer. Refuse it here instead.
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_metadata_has_no_content') then
    alter table pending_songs
      add constraint pending_songs_metadata_has_no_content
      check (part_type <> 'metadata' or content is null);
  end if;

  -- The id namespace, for exactly the reason tab rows got one
  -- (20260818000000, `pending_songs_tab_id_namespace`): `id` is the PRIMARY
  -- KEY and for a chart it IS the work slug, so keying a metadata row by the
  -- work it targets means the second person to fix a song's artist collides
  -- on the PK with the first — and, because the update policy gates on
  -- `created_by = auth.uid()`, fails as a PERMISSIONS error that says nothing
  -- about what actually went wrong. A pending chart and a pending metadata
  -- edit for the same song could not coexist either.
  --
  --     meta:<slug>:<rand>
  --       <slug>  the target work slug — human-scannable only; nothing
  --               derives meaning from it (the target is replaces_id)
  --       <rand>  >= 6 chars of [a-z0-9], which is what makes it unique
  --
  -- A chart slug can never contain `:` (slugify emits [a-z0-9-]), so the
  -- three namespaces cannot overlap in any direction.
  if not exists (select 1 from pg_constraint where conname = 'pending_songs_metadata_id_namespace') then
    alter table pending_songs
      add constraint pending_songs_metadata_id_namespace
      check (part_type <> 'metadata' or id ~ '^meta:[a-z0-9-]*:[a-z0-9]{6,}$');
  end if;
end
$$;

-- The size cap (20260818000000, `pending_songs_content_size`) is left exactly
-- as it is: it is already `content is null or ...`, and a metadata row's
-- content is null by the constraint above. `notes` keeps its own 5000-char
-- cap, which is the only free text one of these rows carries.

-- ============================================
-- 3. Index
-- ============================================

-- Same shape as idx_pending_songs_tablature, same reason: metadata rows are a
-- small minority of the table and the surfaces that want them (My
-- Submissions) want only them.
create index if not exists idx_pending_songs_metadata
  on pending_songs(created_by, created_at desc)
  where part_type = 'metadata';
