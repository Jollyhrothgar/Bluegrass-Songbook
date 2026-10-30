# Corpus loading and arrangements

Read this before changing `corpus.js`, `song-content.js`, `loadIndex` /
`ensureArchiveLoaded` in `main.js`, or how View ▸ Versions picks takes.

## Two takes on one work (`arrangements`)

Editing a chart you do not own does not overwrite it: the server adds an extra
lead-sheet part to the same work, and the build publishes it as
`data/songs/{id}--{slug}.pro` with an entry in the row's `arrangements`
(`slug`, `label`, `file`, `default`, `arrangement_by`, ...). The field is absent
unless a work holds two charts. The pill expands the current work into one row
per take; `selectLeadSheetArrangement` swaps the chart in place (same work, same
URL). Only the primary row has a vote button, since votes are per work id.
`getArrangementContent(song, arrangement)`: the entry's own `content` wins (a
pending submission), else its `file`, else the work's lead sheet.
`corpus.pendingForkArrangements` synthesizes the same list for a pending fork
("Your arrangement") so the fork shows in the pill before the build lands.
Ownership follows `process_pending.owns_content`. Representative of a group:
a `canonical` row wins, else content > most chords > highest `canonical_rank`.

## Data loading

- `data/index.jsonl` (searchable canon, fetched at startup), `data/archive.jsonl`
  (pruned rows, lyrics truncated, forced to `indexed: false`, fetched only on
  demand), `data/songs/{id}.pro` (one chart per work, fetched per song page). The
  canon rows carry `has_content` / `has_abc` flags, not text. Row fields come
  from `scripts/lib/build_works_index.py`; read a row (`head -1 docs/data/index.jsonl`)
  rather than trusting a schema here.
- `getSongContent` also accepts rows with an inline `content` string (pending
  rows, synthetic editor rows); rows with neither flag nor string resolve to `''`
  so tab-only works make no 404s. A failed fetch is never cached.
- The archive is loaded only when something needs an archived row, through
  `window.ensureArchiveLoaded()`; any path that fails to find an id awaits it
  once before showing "not found". Callers include `openWork`, the Dungeon,
  lists/favorites/export (`lists.js::ensureArchiveForRefs`), the bounty board,
  the add-song picker, the editor dedup check and `syncArchiveNeed()`.
- Overlays (`pending_songs`, deleted, promoted) are fetched in parallel with the
  canon (`fetchSupabaseOverlays`) and raced against `OVERLAY_GRACE_MS` (800 ms)
  so a slow backend cannot hold first paint; the corpus is re-merged when they
  land. `window.whenOverlaysSettled()` resolves when they are merged or after
  3 s. The last deleted/promoted id sets are cached in localStorage
  (`songbook-curation-deleted|promoted`) so deletes do not flash in; fetched
  sets replace the cached ones.
- `promoted_songs` rescues archived rows into search, and until the next build
  folds a promotion into the canon that row exists only in `archive.jsonl`. So
  `corpus.overlaysNeedArchive` makes `syncArchiveNeed()` load the archive when a
  promoted id, or a pending edit/tab's `replaces_id`, names a work the canon
  lacks; until then `mergeCorpus({archiveLoaded: false})` holds those pending
  rows back. Known gap: an archived sibling of a canon work (same `group_id`) is
  missing from the "N versions" badge until the archive loads (Mike's open call in
  `docs/plans/2026-09-30-fix-it-list.md`, Speed section: accept it, or have the
  build emit a group size).
- The pending overlay is lean: `PENDING_OVERLAY_COLUMNS` omits `content`, with
  an id-only second query for rows that have a body. Lean rows carry
  `has_content` + `deferred_content` (songs), `content_deferred` (tab parts),
  `pending_id` (forks). The text is read when the song opens, through
  `song-content.js::getPendingContent`. A brand-new pending song has no
  `first_line`/`lyrics` until the build, so search finds it by title/artist only.
  A pending edit's lean row omits keys (never `''`), so the merge keeps the
  published values.
- Collection cards render only when the home view shows
  (`renderCollectionCardsIfHome`), never for a deep link.
- `data/legacy_id_mapping.json` is fetched by `lists.js` only for a stored list
  holding an id that is not a known work slug.

