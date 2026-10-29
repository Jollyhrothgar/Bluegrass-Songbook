# Frontend (docs/js)

A no-build single-page app of ES modules, served as-is from `docs/` (GitHub
Pages). `index.html` loads `js/main.js`; `shell.js` builds the chrome. Subdirectory
docs: `renderers/`, `otf-editor/` (tab editor), `lead-editor/` (lead-sheet
editor), `visual-editor/` (model helpers it uses), `chord-explorer/`.
Reference files next to this one, each opening with "read before touching X":
`OFFLINE.md` (service worker, drafts, icons), `CORPUS.md` (index/archive/overlay
loading, arrangements), `CONTRIBUTIONS.md` (submit/pending flows, sign-in
return), `TOUR.md` (feature tour).

## Commands

```bash
./scripts/server      # dev server (needs ./scripts/bootstrap once for docs/data/)
npm test              # Vitest, once; `npm test -- tab-edit-band` runs one file
npm run test:watch    # never exits; don't run it from an agent
npm run test:e2e      # Playwright; starts its own server (e2e/CLAUDE.md)
```

`__tests__/setup-webstorage.js` undoes Node 25's empty global `localStorage`
shadowing jsdom's, so unit tests pass on any Node.

A test of the code reads a frozen copy of a song (`__tests__/fixtures/`), never
the live one: `works/` is edited from the site, and an edit to Old Home Place
broke CI for hours (#320). Live songs are only for smoke tests that catch
problems in the data (Mike, 2026-10-28; `.claude/rules/tests.md`).

## Orientation

- `state.js`: reactive state. `subscribe(name, fn)` notifies a frame later
  (`requestAnimationFrame`). `setCurrentView`, `setCurrentDetectedKey` and
  `setDungeonMode` do nothing when the value is unchanged; never write a
  redundant value to force a callback.
- `corpus.js` builds `allSongs`; `song-content.js` reads charts (always
  `getSongContent(song)`, never `song.content`); `work-view.js` is the song page.
  Any path that cannot find an id awaits `window.ensureArchiveLoaded()` once
  before showing "not found" (details in `CORPUS.md`).
- `supabase-auth.js` is not an ES module: its whole surface is the
  `window.SupabaseAuth` literal at the bottom
  (`sed -n '/^window.SupabaseAuth = {/,/^};/p' docs/js/supabase-auth.js`). Keys
  do not always match function names (`init:` exposes `initSupabase`).
- Nothing calls the GitHub API from the browser. Anything reaching GitHub goes
  through a Supabase edge function that holds the token.

## App shell (`shell.js`)

- `setTopBar({back, title, actions, overflow, navActive})` declares a page's top
  band; `setBottomBand(el)` mounts practice/playback controls, and in the
  lead-sheet editor the editor's own (`#editor-band`, via
  `editor.js::showEditorBand`; see `lead-editor/CLAUDE.md`) (`null` hides);
  `pill(label, buildContent, opts)` is the labeled popover button all song-page
  controls use (built in `song-controls.js`; the Arrangement pill is in
  work-view.js). `setChromeAutoHide(true)` hides the top band while scrolling
  down on song pages (`body.chrome-hidden`); there is no focus mode.
- The bottom band's height varies (it wraps on narrow windows and the tab band
  collapses on phones), so `shell.js` publishes its measured height as `--bottomband-h` on `<html>`. Anything stacked on the
  band (drop-ups, the tab settings sheet, `.container` padding) offsets from that
  variable, never a literal, and never from `100%` (Chromium does not make
  `container-type` the containing block for `position: fixed` drop-ups).
- `tab-controls-sheet.js` collapses the tab band below a band width of 640 px by
  MOVING (not rebuilding) controls into a gear sheet, so listeners from
  `setupTablaturePlayer` survive. The width is the band's, not the window's
  (ResizeObserver sets `.is-narrow-band`; CSS uses `@container tabband`); the
  `@media` query is only the seed and fallback, and tests inject a `media`
  object to turn the observer off.
- `tab-edit-band.js::bindBandToEditor` keeps the bottom band alive in edit mode.
  Controls that cannot work while editing are disabled with a reason
  (`DISABLED_REASONS`), not removed: a vanished control reads as a bug.

## Routing: everything lands in `openWork`

`openWork(id, opts)` renders lead sheets, tab-only works and multi-part works.
`openSong(id)` (song-view.js) only calls `openWork(id, {exact: true})` (that
exact version, not the group's representative, which
`song-content.js::pickRepresentative` chooses for search and the song page).
Do not add a second render path.

- `/songs/{song}/` and `/songs/{song}/{version}/` are a song and a version.
  `#work/{slug}` still routes and is rewritten to the path; a part
  (`#work/{slug}/{partId}`) and editor modes stay hash routes.
  `#song/{id}` is legacy (`resolveWorkId()`); `#list/{listId}/{workId}` keeps
  list URLs.
- Tab routes: `#work/{slug}/edit/{take}`, `#work/{slug}/add-tab?instrument=`,
  `#new-tab?title=&instrument=&ts=&tempo=&measures=`, all parsed by
  `parseTabRoute` (`otf-editor/create-tab-entry.js`). `{take}` is the take's name
  (its `src_file` stem, e.g. `banjo-18967`), never an index, because curation
  pins re-sort takes between builds.

### Song paths

Work-to-URL rules (`song:`, `version:`, `slug:`) are in `.claude/rules/works.md`;
`build_works_index.apply_songs` turns them into each row's `path` and
`group_id: song:{root}`. Votes are keyed by work id so regrouping never strands
them. Client side (`main.js`, `state.js`: `SONG_PATH`, `songHref`,
`songIdForPath`, `currentHref`):

- `<base href="/">` in `index.html` makes `fetch('data/...')` resolve from the
  root on any path; without it `/songs/x/` fetches `/songs/x/data/songs/x.pro`.
- Show a song at `songHref(id)`; write every other history entry absolute
  (`/#search`) so a hash route never inherits a song's path. Compare with
  `currentHref()`, not `location.hash`. A document click handler turns a `#...`
  link on a song path into in-place navigation (the base would load `/`).
- `scripts/lib/build_song_pages.py` writes the pages and `404.html`; `scripts/server`
  serves `404.html` for unknown paths like Pages does.
- `/tab-editor/` is the second path the app owns (`TAB_EDITOR_PATH`, state.js):
  the tab editor's front door, view `tab-editor`, rendered lazily by
  `tab-editor-home.js`. `handleDeepLink` routes it and returns true (boot would
  otherwise rewrite it to `/`); `normalizedHref` gives the URL back to the root
  when the view changes; in-app entry is `showView('tab-editor')` +
  `pushHistoryState('tab-editor')` (a push, no reload). It has no editor code:
  Open goes through `pwa.js` (`chooseTabFile` -> `openTabFile` -> `#new-tab?draft=`),
  Start goes to `#new-tab?title=&instrument=`, My tabs reuses `drafts-view.js`
  rows (`draftRowHtml`, `attachDraftActions`). "My tabs" is `#drafts` renamed in
  copy only (store `bgb-drafts` unchanged). Nothing before Submit asks for sign-in.
  A `.tef` open shows what wasn't kept (`x_source.skipped` → `skippedLine()` in
  `tef-skipped.js`, `.arr-skipped`; only for `file=1`, only when non-zero).

### Navigation invariants

1. The `currentView` subscriber tears down the tablature view on the way out of
   `song`, never on the way in. Everything entering the song view goes through
   work-view, which tears down synchronously first; a teardown queued by entering
   lands a frame later and destroys what the entry just built (this once made
   `#new-tab?draft=...` mount its editor and delete it, depending on whether the
   editor's imports were cached; `e2e/otf-editor-drafts.spec.js`).
2. One navigation step, one route. Back/forward fires `popstate` then
   `hashchange`; `main.js` parks the popstate work for one task, a hashchange in
   that window cancels it and routes by hash, and an echo within 100 ms is
   dropped. Without this every step built the song page twice
   (`e2e/render-counts.spec.js`).

## Search

Search syntax, scope (canon, dungeon, both) and the virtual instrument tags
load from `.claude/rules/search.md` when you touch `search-core.js`,
`search-query.js` or `tags.js`. That rule also covers the Python copy of the
search (`scripts/lib/search_index.py`), which must change with `search()`.

## Song page

- `renderLeadSheetContent` stamps `container.dataset.renderedKey` and work-view's
  key subscriber skips a redraw when it matches (notifications arrive a frame
  after the write; without this every chart drew twice).
- Percussion tracks are excluded from the mixer, playback and the OTF editor via
  `isPercussionTrack` / `pitchedTracks` (`renderers/otf-tracks.js`): a drum
  track's `s` is a kit staff line, so `tuning[s-1] + f` is nonsense. Never sniff
  track names (one drum track is named "Guitar Standard"). The song page shows
  the track greyed out with a "drum notation is in progress" note on purpose: we
  detect a drum track reliably but not which drum each line is.
- A tab draws once per open. `renderTablaturePart` waits up to 250 ms for the
  Bravura font (`TabRenderer.whenBravuraReady`); a late font redraws only if that
  draw was made without it (`_drewWithBravura`, since the font promise resolves
  on a microtask even for a long-loaded font). The font URL is pinned
  (`TabRenderer.BRAVURA_URL`) because jsDelivr's `@latest` on `gh` is the repo's
  HEAD. `loadPartOtf` sets no `cache` option: freshness is the service worker's.
- Audio must stay synchronous inside the tap (`audio-unlock.js`): never let Play
  await an import. That is why `TabPlayer` loads with the renderer.

## Lazy modules

Whatever `main.js` imports statically is on every cold load; the rest is
`import()`ed at the point of use. `__tests__/lazy-modules.test.js` enforces the
boot-graph budget and names the modules that must stay out.

- Do not add a static import of a lazy module to the boot graph. If boot code
  needs one symbol from a heavy module, move the symbol (as `deleteAffordance`
  moved from `review-queue.js` to `delete-affordance.js`).
- Lazy modules have no module-level side effects (no `window.*` assignments or
  listeners at import).
- A new lazy module goes in `LAZY_MODULE_URLS` (`lazy-modules.js`); a new boot
  module needs a `<link rel="modulepreload">` before the `main.js` script tag in
  `index.html`. The test names the exact difference either way.

## Lead-sheet editor shell (`editor.js`)

Smart paste, the text adapter (`getText()` / `setText()`), leaving with unsaved
edits, and the in-place-or-fork wording load from
`.claude/rules/lead-sheet-editor-shell.md` when you touch `editor.js`,
`smart-paste.js` or `auth-return.js`. The editor itself is `lead-editor/`.

## Smaller rules

- Contributions: every logged-in submission is a `pending_songs` row, then a POST
  of its id to the `auto-commit-song` edge function; the client never claims
  create/update/fork and never sends who the submitter is. The `create-song-issue`
  and `create-tab-pr` flows are deleted; nothing may call them.
- Lists: owners and followers read the tables (RLS); everyone else uses the
  `get_public_list` RPC. `SupabaseAuth.fetchPublicList` returns
  `{list, songs, isOwner, isFollower, isOrphaned, canClaim}` (normalized in
  `normalizePublicList`); read those keys, never `is_owner` / `can_claim`.
- Analytics (`analytics.js`) run only when `telemetry.js::telemetryEnabled()`
  (production host, `navigator.webdriver` false, and the browser not marked
  internal: `/?internal=1` sets `localStorage['bgb-internal']`, `?internal=0`
  clears it), because the Supabase project is
  production everywhere and local servers and crawlers counted as visitors.
  `supabase.rpc` resolves `{error}` rather than throwing, so `flush()` checks it
  and re-queues.
- Document upload is gone, but document parts already in `works/` still render
  (`renderDocumentPart`, work-view.js).
