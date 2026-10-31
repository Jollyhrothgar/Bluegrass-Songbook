# The song page's bands and docks (G19)

Read this before changing either band (`#app-topbar`, `#app-bottomband`), the
song page's top dock or bottom dock (lyrics, chart, ABC, tab), the Key /
Display / View sheets, auto-hide, or how a song opened from a set list moves
to the next one. The design and its decisions are in
`docs/plans/2026-10-30-g19-song-page-docks.md`; `e2e/CLAUDE.md` lists the
selectors.

## Bands and auto-hide

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
- The bottom band's height varies (it wraps on narrow windows and the tab band
  collapses on phones), so `shell.js` publishes its measured height as `--bottomband-h` on `<html>`. Anything stacked on the
  band (drop-ups, the tab settings sheet, `.container` padding) offsets from that
  variable, never a literal, and never from `100%` (Chromium does not make
  `container-type` the containing block for `position: fixed` drop-ups).

## The song page's docks

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
- **Set lists (G19c, `list-pill.js`).** A song opened from a list
  (`state.js` `listContext`, set by `openSongInList` and the favorites
  equivalent) gets two things and nothing else: `← <list name>` in the top
  dock (work-view.js `updateWorkTopBar`, `back: {label}`; it goes to the list,
  `song-view.js` `goToList`) and `‹ 2 of 9 ›` as the first control of the
  bottom dock. `listPillModel(ctx)` (pure) says whether and what; the pill is
  added by the reading dock, the ABC dock and the tab dock; a view with no
  dock (placeholder, PDF part, a song loading) gets `listPillDock()`, a dock
  holding only the pill. `‹ ›` are `navigatePrev` / `navigateNext`; the middle
  is `goToList`: `history.back()` while the list's own entry is just behind,
  or the list's address once the reader has stepped (`listContext.stepped`).
  On a tab the Tempo stepper becomes a "♩ 120" chip (`buildTempoChip` in
  tab-dock.js) that opens a − n + sheet; the stepper is the same node the
  player wired, parked in `.tab-display-store` and moved into the sheet. On a
  phone (under 560px) a list's lyric dock shows View ▾ in place of Lyrics |
  Chart. ←/→ step through the list; `isStepKey` ignores them in a field, an
  editor, an open sheet, with a modifier, or while `body.tab-editing`. Song
  notes stay in ⋯ ▸ This song. The old second bar `#song-nav-bar`,
  `--listbar-h` and `body.has-list-context` are gone.

## The tab editing band

- `tab-controls-sheet.js` collapses the tab EDITING band (only; the reading dock
  has one layout) below a band width of 640 px by
  MOVING (not rebuilding) controls into a gear sheet, so listeners from
  `setupTablaturePlayer` survive. The width is the band's, not the window's
  (ResizeObserver sets `.is-narrow-band`; CSS uses `@container tabband`); the
  `@media` query is only the seed, and tests inject `media` to stop the observer.
- `tab-edit-band.js::bindBandToEditor` keeps the bottom band alive in edit mode.
  Controls that cannot work while editing are disabled with a reason
  (`DISABLED_REASONS`), not removed: a vanished control reads as a bug.

## Selectors (e2e)

Helpers are in `e2e/helpers.js` (`openMenu`, `openDock`, `closeSheet`) and
`e2e/helpers/tab-edit.js` (`pressTabEdit`).

On a song page the thin dock (G19): `#topbar-back`, `#topbar-search`, `#edit-song-btn` (the one Edit),
`#topbar-overflow-btn`. Everything else song-specific is in ⋯: use
`openMenu(page, expand?)` from `helpers.js` (rows `#list-picker-btn`,
`#export-menu-btn` and `#report-menu-btn`, which expand in place to hold
`[data-action=…]` / `#flag-btn` / `#report-bug-btn` / `#copyright-btn`;
`#overflow-tour`, `#menu-go-*`, `#menu-account` / `#menu-sign-in`). The writer
line `#song-details-btn` opens `#song-details-sheet` (`#edit-meta-btn` is its
Edit details). The song page's controls are the reading dock in
`#app-bottomband` (G19b): `#dock-key-btn` (opens `#dock-key-sheet`),
`#dock-size` (`[data-size="1"]` / `"-1"`), View as `#dock-view` (segments
`[data-view=lyrics|both|chart]`) or, when the song has versions, tabs or a
hybrid part, `#dock-view-btn` (opens `#song-view-sheet`: `.dock-row[data-view]`,
`.dock-row[data-part]`, the versions as `.arrangement-item`) and
`#dock-display-btn` (opens `#dock-display-sheet`: `#pill-compact`,
`#pill-autohide`, `#pill-chord-mode`, and for a chart `#pill-chart-cells`,
`#pill-chart-bars`, `#pill-chart-order`, whose buttons carry `data-value`). The
pill row and part tabs are gone. ABC notation has `#abc-play-btn`,
`#abc-tempo-label`, `#abc-size`.

A song opened from a set list (`#list/<id>/<ref>`; seed `songbook-lists` with
`addInitScript`, as `set-list-dock.spec.js` does) has `#topbar-back` labelled
with the list name (`.topbar-back-label`) and `#list-pill` leading the bottom
dock: `.list-prev`, `.list-pos` ("2 of 9", goes back to the list) and
`.list-next`, disabled at the ends. A view with no dock (a placeholder, a PDF
part, loading) gets a dock holding only the pill. A tab in a list shows
`#dock-tempo-chip` (♩ n) instead of the Tempo stepper; it opens
`#dock-tempo-sheet`, and the stepper (`.tab-tempo-up` / `-down` /
`-display`) is in the sheet while it is open and in `.tab-display-store`
otherwise. Below 560px a list's lyric dock shows View ▾ rather than Lyrics |
Chart. There is no `#song-nav-bar` and no `body.has-list-context`. A
dock that "fits" must be checked button by button: a segmented control
clips what overflows without widening the row. ←/→ step the list unless
focus is in an input, textarea, select, contenteditable, CodeMirror, the tab
editor or an open sheet.

A tab part's band is the tab dock (G19c): `.tab-play-btn` (▶ / ⏸ / ▶ Loop),
`.tab-stop-btn` (hidden until playing), `.tab-tempo-down` / `-display` / `-up`,
`.tab-view-btn` (also `#dock-view-btn`, opening `#song-view-sheet`) and
`#dock-display-btn` (opening `#dock-display-sheet`, the same id as on the lyric
sheet: `openDock(page, 'display')`). In the tab's Display sheet: `#tab-size`
(`[data-size]`), `#tab-play-in` (`.pill-key-btn`, with `.tab-capo-indicator`
under it), `.tab-repeat-group`, `.tab-feel-group`, `.tab-loop-toggle`,
`.tab-metronome-toggle`, `.tab-countin-toggle`, `.tab-track-mixer`
(`.track-toggle`, `.track-checkbox`), `#pill-autohide`. Those controls sit in
`.tab-display-store` while the sheet is closed, so open it before touching
them. In the tab's View sheet: `[data-part]` rows (`.dock-count`, `.dock-chev`
when a part has several takes; clicking drills into `.dock-take` rows with
`.dock-pin` ★, `.on`, `.dock-take-who`, and `.dock-back` in the title) and
`[data-track]` rows (`all` included). Above the music: `.arr-credit`,
`.arr-status`, `.arr-skipped`; the takes bar (`.arr-bar`, `#arr-list`) and
`.track-view-tabs` are gone. To assert what Play was asked for, stub
`TabPlayer.prototype.play` as `song-docks.spec.js` does (`stubPlay`). The tab
EDITING band is the old one: `.tab-edit-submit`, `.tab-edit-done`, `.tab-more-btn`
and `.tab-settings-sheet` below 640px, and no View or Display.
