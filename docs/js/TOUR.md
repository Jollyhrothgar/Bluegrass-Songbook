# Feature tour: rules

Read this before changing `tour.js`, `tour-editor-demo.js`, the tour copy, or
the `lead.present` hooks in `lead-editor/index.js`.

- Steps are data (`TOUR_STEPS`); a step's `targets` are tried in order and the
  first visible one is ringed. Eleven steps: two at `/#search`, three on Old
  Home Place, three in the editor, three on a tab.
- **The search demo** (`searchByWords` in `tour.js`) types "ten long years since
  I left my home" (Old Home Place's first line; no other song has it) into the
  real box a letter at a time, searching at each word, then rings the top
  result and keeps the ring there; Next opens the song. The step's target is
  `#results`, so the card rests off the song it rings. It searches through
  main.js's `search: { fill, run }`: `run` calls `search(text, { track: false })`,
  so the query is never recorded as a visitor's search (search-gaps, the
  dashboard), and no input event fires. A press in the box stops it.
- **Pages:** the song steps always run on `old-home-place`, the song the search
  finds (Mike, 2026-10-28); the tab steps use the reader's own tab when the
  tour starts on one. Done returns to the starting page.
- Three steps type a song into the real editor
  (`tour-editor-demo.js`) by pressing real buttons. Its only editor hooks are
  `lead.present.select / boxAt / end` (`lead-editor/index.js`): a selection that
  shows the section bar without focusing the editor (focus raises a phone
  keyboard). It calls `resetEditorForNewSong()` on leaving the editor.
- The `.tef` step copy was checked against the app (G15c): a drop, and ⋯ ▸
  Tab editor ▸ Open a tab file…, both open the editor signed out; sign-in is
  only asked at Submit. Re-check the card text if either flow changes.
- The invitation (`setTourInvite`) sets `localStorage['songbook-tour-seen']`;
  after that the tour is the first overflow item (`setOverflowLead`), or
  "Take the tour" in ⋯ ▸ Go to on the thin-dock pages (song page, lyrics
  editor). On those pages the invitation is the ⋯ button glowing, not a Tour
  button (`.topbar-dock` hides that). It
  never opens itself. `?tour` starts it, `?tour=reset` re-arms the invitation.
- No backdrop: the card (`z-index: 899`) sits under both bands, the ring (`901`)
  never takes a click. `main.js::startFeatureTour` refuses to start (toast) while the lyrics & chords
  editor is open (`currentView === 'add-song'`) or the URL is a tab-editor route
  (`parseTabRoute`).
- Tests: `__tests__/tour*.test.js`, `e2e/tour.spec.js`, `e2e/tour-mobile.spec.js`.
