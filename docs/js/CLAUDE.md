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
the live one: an edit to Old Home Place broke CI for hours (#320). Live songs
are for data smoke tests only (`.claude/rules/tests.md`).

## Orientation

- `state.js`: reactive state. `subscribe(name, fn)` notifies a frame later.
  `setCurrentView`, `setCurrentDetectedKey` and `setDungeonMode` do nothing when
  the value is unchanged; never write a redundant value to force a callback.
- `corpus.js` builds `allSongs`; `song-content.js` reads charts (always
  `getSongContent(song)`, never `song.content`); `work-view.js` is the song page.
  Any path that cannot find an id awaits `window.ensureArchiveLoaded()` once
  before showing "not found" (details in `CORPUS.md`).
- `supabase-auth.js` is not an ES module: its whole surface is the
  `window.SupabaseAuth` literal at the bottom (`sed -n '/^window.SupabaseAuth =
  {/,/^};/p' docs/js/supabase-auth.js`); keys differ from function names.
- The browser never calls the GitHub API; a Supabase edge function holds the token.

## App shell (`shell.js`)

- `setTopBar({back, title, actions, overflow, navActive})` declares a page's top
  band; `setBottomBand(el)` mounts practice/playback controls, and in the
  lead-sheet editor the editor's own (`#editor-band`, via
  `editor.js::showEditorBand`; see `lead-editor/CLAUDE.md`) (`null` hides);
  `pill(label, buildContent, opts)` is the labeled popover button (the tab
  band's capo key and the list export use it; the song page's controls are
  the dock below). `setChromeAutoHide(true)` hides BOTH bands while scrolling
  down (`body.chrome-hidden`; CSS slides `#app-topbar` and the song page's
  bottom band, not the lyrics editor's, and only when the page's dock has
  `#dock-display-btn`, the switch that turns it off: an ABC page never hides;
  a tab hides unless it is playing, `holdChrome(true)`). The shell owns no
  state, so
  work-view.js and main.js pass the reader's choice (`autoHideControls`,
  Display ▸ Auto-hide controls, OFF by default); there is no focus mode.
  `--topbar-h` is published next to `--bottomband-h`; the chart column sticks
  under it.
- **The thin top dock (G19).** `setTopBar({dock: 'song' | 'editor', back:
  {onClick, label}, actions, menu})` turns `#app-topbar` into ← · BB · [🔍] ·
  [Edit] · ⋯ and nothing else (CSS `.topbar-dock` hides the nav, bug, theme,
  tour and account; the elements stay, so supabase-auth and the density
  ladder keep working). The song page and the lyrics & chords editor use it;
  every other page keeps the full band. The ⋯ menu is built on open from the
  page's `menu` groups (work-view.js `updateWorkTopBar`), the site's groups
  (`setMenuSite`, main.js `siteMenuSections`: Go to, You) and `setOverflowBase`.
  A row can expand in place (`items`), or be a `segmented` choice (Theme).
  It is a popover on a wide screen and a sheet over a scrim at 640px (CSS
  only). A first visit glows ⋯ (`setTourInvite`), not a Tour button. Keep the
  element and its 48px: `lead-editor/index.js` measures it.
- **One Edit** is `#edit-song-btn` in that band (work-view.js
  `handleEditAction`): a placeholder gets the details form, a tab part the tab
  editor (`tabEditEntry`), anything else the lyrics editor. It hides while the
  tab editor is open (`body.tab-editing`, which also clears `#song-pill-row`
  and `#part-tabs`). The writer line `#song-details-btn` opens Details
  (`openSheet` in shell.js: a bottom sheet on a phone, a centred card on a
  wide screen, in the notes sheet's CSS), whose "Edit details" is
  `showMetadataEditor`.
- **The reading dock (G19b, `song-dock.js`).** The lyric sheet and the chord
  chart mount `Key: A · Aa − + · Lyrics | Chart · Display` in `#app-bottomband`
  (ABC notation: `▶ · tempo · Aa − + · View ▾`, no Key or Display). song-view.js
  draws the part and asks `setDockProvider`'s provider (work-view.js, which
  knows the parts and versions) for the dock each time it renders, so a dock
  is rebuilt with every redraw and an open sheet (`openSheet`: Key, Display,
  View) survives it. `viewModel` (pure, unit tested) decides which View the
  song has: `none`; `segmented` (lyrics + chart, plus Lyrics + Chart when
  `chartIsWide()`); or `sheet` (View ▾) once there are versions, tabs or a
  hybrid ABC + chords part. The sheet lists the choices, Versions
  (`renderArrangementList`, with votes and badges) and Tabs. A tab part's dock is the tab dock below. Chart choices are view prefs in
  state.js (`chartCells`, `chartBars`, `chartOrder`, `chartBeside`,
  `autoHideControls`), redrawn by the same subscriber as the other display
  prefs; the chart's text is em-sized and scales with Size. Size is
  remembered per kind: text in `songbook-view-prefs`, notation in
  `bgb-abc-scale`, a tab's staff in `bgb-tab-scale` (state.js `tabScale`).
  There is no pill row, part tabs, hybrid toggle or Practice mode.
- **The tab dock (G19c, `tab-dock.js`).** A tab part's band is `▶ [⏹] Tempo −
  n + · View ▾ · Display` on every width: `.tab-controls.tab-dock` in
  `#app-bottomband` (work-view.js `createTablatureControls` / `buildTabDock`;
  `tempoControl` is shared with the ABC dock). Stop shows only once playback
  has started (CSS hides a disabled `.tab-stop-btn` in the dock); the position
  readout rides the dock's top edge; ▶ reads ⏸ while playing and "▶ Loop"
  when a dragged phrase is armed. `#dock-display-btn` opens the Display sheet
  (`fillDisplaySheet`): Size (`#tab-size`, remembered), Play in (`#tab-play-in`,
  the twelve keys: a capo for playback, the frets never move), Layout, Feel,
  Practice (Loop, Metronome, Count-in), Tracks (the mixer), Auto-hide. Those
  controls are built with the band, parked in a hidden `.tab-display-store`,
  MOVED into the sheet while it is open and back when it closes (`openSheet`'s
  `onClose`), so setupTablaturePlayer wires each once; hold a node
  (`const mixer = controls.querySelector(...)`), never re-query from the band
  at play time. Layout and Feel redraw the tab and rebuild the band, so the
  sheet is reopened on the new one (`redraw` in renderTablaturePart). View's
  sheet lists Lyrics/Chart (if any), Tabs with their take counts (a part with
  several takes drills in: ★ the editor's pick, ✓ the take showing; picking
  one is `pickTake`) and Tracks (a multi-track tab; `pickTrack`). Above the
  music is one credit line (`renderTakeHeader`, `.arr-credit`) and the
  `.arr-status` notices; the takes bar and "View track" tabs are gone. The tab
  EDITOR keeps G17's band: `createTablatureControls(otf, part, {editing:
  true})` builds the old one-row band (⚙ sheet below 640px via
  `tab-controls-sheet.js`, no View or Display) for `bindBandToEditor`. CSS
  scopes the old band rules with `.tab-controls:not(.tab-dock)`.
- The bottom band's height varies (it wraps on narrow windows and the tab band
  collapses on phones), so `shell.js` publishes its measured height as `--bottomband-h` on `<html>`. Anything stacked on the
  band (drop-ups, the tab settings sheet, `.container` padding) offsets from that
  variable, never a literal, and never from `100%` (Chromium does not make
  `container-type` the containing block for `position: fixed` drop-ups).
- `tab-controls-sheet.js` collapses the tab EDITING band (only; the reading dock
  has one layout) below a band width of 640 px by
  MOVING (not rebuilding) controls into a gear sheet, so listeners from
  `setupTablaturePlayer` survive. The width is the band's, not the window's
  (ResizeObserver sets `.is-narrow-band`; CSS uses `@container tabband`); the
  `@media` query is only the seed, and tests inject `media` to stop the observer.
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
  `currentHref()`, not `location.hash`. A click handler turns a `#...` link on
  a song path into in-place navigation (the base would load `/`).
- `scripts/lib/build_song_pages.py` writes the pages and `404.html`; `scripts/server`
  serves `404.html` for unknown paths like Pages does.
- `/tab-editor/` is the second path the app owns (`TAB_EDITOR_PATH`, state.js):
  the editor's front door, view `tab-editor`, lazy `tab-editor-home.js`.
  `handleDeepLink` routes it and returns true (boot would rewrite it to `/`);
  `normalizedHref` restores the root URL when the view changes; in-app entry is
  `showView('tab-editor')` + `pushHistoryState` (⋯ ▸ Tab editor). No editor
  code: Start goes to `#new-tab?title=&instrument=`, its My tabs rows are
  `drafts-view.js`'s. Nothing before Submit asks for sign-in.
- File handling (`pwa.js`) has one path for the picker (`chooseTabFile`; `.tef`,
  `.otf.json`), a drop anywhere (`enableFileDrop`; an element with its own drop
  zone sets `data-file-drop`) and the installed app's `launchQueue`:
  `importTabFile` parses, `openTabFile` parks a draft and routes to
  `#new-tab?draft=&file=1` (a hash cannot carry a document). A `.tef` open
  shows what wasn't kept (`skippedLine()`, `tef-skipped.js`; `file=1` only).
- My tabs is `#drafts` renamed in copy; the store is `drafts.js` (IndexedDB
  `bgb-drafts`, newest 50). A draft keeps `source: {name, bytes?}`, the opened
  file (older drafts have none).
- File ▸ Save as… (`otf-editor/save-as.js`) is the mirror: `tef-export/`
  `writeTef(otf, {source, template})` returns `{bytes, notices}`, plus
  `noticeLine()` (TEF-REFERENCE.md "Writing a .tef"); only Save as `import()`s it.

### Navigation invariants

1. The `currentView` subscriber tears down the tablature view on the way out of
   `song`, never on the way in. Everything entering the song view goes through
   work-view, which tears down synchronously first; a teardown queued by entering
   lands a frame later and destroys what the entry just built (once
   `#new-tab?draft=...` mounted its editor and deleted it; `e2e/otf-editor-drafts.spec.js`).
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
  track names (one drum track is named "Guitar Standard"). The song page greys
  the track out on purpose: we detect a drum track but not which drum a line is.
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
  clears it), because the Supabase project is production everywhere.
  `supabase.rpc` resolves `{error}` rather than throwing, so `flush()` checks it
  and re-queues.
- Document upload is gone; document parts in `works/` still render
  (`renderDocumentPart`).
