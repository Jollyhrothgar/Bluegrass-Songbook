# G23: tracks are switched on the staff, View lists only the song's tabs

Fix-it item G23. Mike, 2026-10-31, on the View sheet of Foggy Mountain
Breakdown's ensemble: "I'd like to make it clearer somehow what are other
variants / parts vs what are tracks in this specific tab."

## The problem

The View sheet had two sections that read as equals:
- **"Tabs":** the song's parts, such as Mandolin Break, Banjo (9 takes),
  Ensemble ✓ and Fiddle.
- **"Tracks":** the staffs inside the tab that's open (banjo, guitar,
  guitar-2, bass, All).

Nothing tied the tracks to Ensemble. "Banjo" the tab and "banjo" the track
collided, track ids were shown raw ("guitar-2"), and "9" didn't say what it
counted.

## What changes (Mike chose option 1 of two)

- **View lists only the song's tabs.** Its heading becomes "Tabs for this
  song". A part with several takes reads "9 versions ›", and the open tab
  shows ✓.
- **The read view switches tracks on the staff.** The instrument name in the
  track header (`.track-info`) becomes "Banjo ▾ 1 of 4", on every width,
  whenever the tab has more than one pitched track.
  - Its list holds the tracks by name, then "All tracks".
  - While All is chosen it reads "All tracks ▾".
- **Track names:** the track's own name when the file has one, otherwise the
  id made readable ("guitar-2" becomes "Guitar 2").
- **One control for reading and editing.** The tab editor's phone header
  (G20a, `otf-editor/track-switcher.js`) moves to `docs/js/track-switcher.js`
  as a pure control. Its owner, the tab editor session, OK'd this on
  2026-10-31.
  - API: `new TrackSwitcher({ getTracks, getActive, choose, enabled, extra })`.
    - `getTracks()` returns `[{id}]`.
    - `getActive()` returns an id or `'all'`.
    - `choose(id)` switches to it.
    - `enabled()` replaces `isPhone`.
    - `extra` is optional items at the end of the list, e.g.
      `[{id:'all', label:'All tracks'}]`.
  - **The editor's adapter:** `getTracks: () => state.getTracks()`,
    `getActive: () => state.trackId`, `choose: id => state.setTrack(id)`,
    `enabled: isPhone`, and no `extra` (the editor has no All).
  - **Kept unchanged:** the `.track-switcher-*` classes,
    `aria-haspopup`/`aria-expanded`, `menuitemradio`, closing on Escape or a
    tap outside, and the 44px targets.
  - **Gates:** `e2e/tab-editor-track-switcher-mobile.spec.js` and
    `docs/js/__tests__/otf-editor/track-switcher.test.js` pass with only their
    import paths changed. Add the new path to `lazy-modules.js`.

## Open for Mike

On a desktop the tab editor still switches tracks with its toolbar's Track
row, and shows the ▾ header only on phones. Matching the read view would mean
the header on every width and no toolbar row. That's his call; until he
answers, the editor keeps today's behaviour.
