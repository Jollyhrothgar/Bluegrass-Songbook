# G19: the song page between two docks

Fix-it item G19. Mike approved the design on 2026-10-29 from the mockups
`design/ui-states/proposed/g18b3-docks-phone.html` (12 frames) and
`g18b3-docks-desktop.html` (3 frames). He asked to "proceed with the redesign,
but before going absolutely bonkers, consider the other views and how they
will be impacted (tab, abc, the editor, etc)". This note is that pass: what the
song page has today in every view, where each control goes, what changes for
the views the mockups didn't draw, and the order to build it in.

Evidence: a read of `work-view.js`, `song-view.js`, `song-controls.js`,
`shell.js`, `tab-controls-sheet.js`, `tab-edit-band.js`, `lead-editor/`,
`otf-editor/` and `style.css` on 2026-10-30, plus screenshots of today's page
in each view (`node design/ui-states/capture.js song-lead-sheet song-abc
tab-single-track tab-multi-track tab-settings-sheet tab-editor
editor-existing-song list-song`).

## What Mike decided (2026-10-29)

- A thin top dock and a thin bottom dock. No card, no nested containers.
- Top dock: ← · BB inlay logo · 🔍 · ✏️ Edit · ⋯. Ruthless on phones: Lists,
  Favorites, Tour, theme and account leave the band.
- Bottom dock: Key · Size · View · Display. ▶ joins it when the view plays.
  From a set list: ‹ 2 of 9 › joins it, and ← names the list.
- View: Lyrics / Lyrics + Chart / Chart; versions and tabs when a song has
  them.
- Display: layout options, the chart's options, and "Auto-hide controls"
  (off by default: both docks stay while you scroll; on: both hide on scroll
  down).
- Details: the song's facts as a sheet, opened from the "Written by… ›" line,
  with Edit details at the bottom. Absorbs today's Info pill.
- ⋯: This song / Trusted and admin / Go to / You. The tour moves into ⋯ and
  ⋯ glows on a first visit.
- Edit is encouraged: one Edit, always in the top dock. No Edit at the end of
  the song; the closing line points at the top Edit.

## The finding that keeps this small

The bottom dock already exists. `#app-bottomband` (`shell.js`
`setBottomBand`; fixed, z 900, publishes `--bottomband-h`, is the
`tabband` container for the 640px collapse) already carries:

| View | Today's bottom band |
|---|---|
| Tab | the player: Size, Key (capo), Tempo, Play, Stop, Edit, metronome, count-in, loop, Repeats, Feel, mixer; ≤640px wide it keeps Play · Stop · Tempo · Loop · ⚙ and the rest moves into the ⚙ sheet |
| ABC notation | Aa − +, tempo − +, ▶ |
| Lyrics & chords editor | Lyrics / Chords / ChordPro, undo, redo, Key, Aa |
| Tab editor | the player plus Submit and ✓ Done (G17, #341) |
| Lead sheet, chart, placeholder | nothing |

So the lead sheet is the only reading view without a dock. G19 fills that gap
and moves the in-page controls (pill row, part tabs, title-row buttons) into
the two bands that already exist. It adds no new fixed element.

**Engineering rule: keep both elements, their ids, the 48px top height and the
CSS variables; change what goes in them.** The lyrics editor measures
`.app-topbar` and `#app-bottomband` (`lead-editor/index.js` `topInset`,
`visibleGap`, `visibleArea`, `placeDockedBar`), the tour lists them as its
`TOP_BARS` and `BOTTOM_BARS`, and the tab sheet and popovers sit on
`--bottomband-h`. Keeping the elements keeps all of that working.

## Every control, today → G19

### Top band (`#app-topbar`, song pages)

| Today | G19 |
|---|---|
| ← back | ← back; from a list it names the list ("← Friday Jam") |
| BB logo | BB inlay logo |
| Search / Add Song / Favorites / Lists nav (desktop) | 🔍 only; the others go to ⋯ ▸ Go to |
| ♡ Lists (`#list-picker-btn`) | ⋯ ▸ This song ▸ Save to list… |
| Export pill (desktop) / Print, Copy, Download in ⋯ (phone) | ⋯ ▸ This song ▸ Export / Print › |
| Promote (desktop) | ⋯ ▸ This song (signed in, archived songs) |
| ✨ Tour (first visit) | ⋯ glows; ⋯ ▸ Go to ▸ Take the tour |
| 🐛, theme, Sign in (desktop) | ⋯ ▸ Report a problem › / You ▸ Theme / You ▸ account |
| ⋯: Report issue, Copyright, Song notes, delete, suppress, merge | ⋯ grouped as in the mockup |
| ⋯ base entries: Install app, My tabs, Tab editor, High Scores, About, Dev Blog, Standards Board, Patreon, Buy me a coffee, Send Feedback | unchanged, a last group in ⋯ (the mockup left these out) |
| title-row ✏️ Edit (`#edit-song-btn`) | ✏️ Edit in the top dock (see "Edit is one button") |
| title-row 🏷️ Details (`#edit-meta-btn`) | Details sheet ▸ Edit details |

Pages other than the song page keep today's band. Slimming them is out of
scope (F10/F11 own the new look elsewhere).

### In-page controls

| Today | G19 |
|---|---|
| Key pill (key grid, −/+, Nashville) | Key in the bottom dock, same sheet |
| Display pill (size, two columns, section labels, compact, chord mode) | Size in the dock; the rest in Display |
| Info pill (writers, recordings, source, notes, tags, tag votes) | Details sheet, opened from "Written by… ›" |
| Versions pill (`#arrangement-pill`) | View ▸ Versions |
| Part tabs (Lyrics & Chords / Chart / Banjo Tab 9 / …) | View ▸ Lyrics, Chart, Notation, Tabs |
| Chord-chart header (Chart / Practice, One cell / Two cells) | Display ▸ Chart group (cells per row, bars, order) |
| Hybrid ABC + chords toggle (Chords / Notation) | View ▸ Chords, Notation |
| Tab takes bar ("schlange · 9 arrangements ▾") | View ▸ Tabs ▸ Banjo › (the takes); the credit stays on the page as one line |
| Tab "View track" (banjo / guitar / bass / All) | View ▸ Tracks, shown on multi-track tabs |
| List nav bar (`#song-nav-bar`: List · 1 of 5 · Prev · Next) | ← names the list; ‹ 1 of 5 › in the bottom dock; the bar is deleted |

### Must carry over (the mockups simplified these; the build keeps them)

- **Export / Print:** all five of today's options: Print, Copy ChordPro, Copy
  Plain Text, Download .pro, Download .txt. The ⋯ mockup shows three.
- **Details:** everything the Info pill has:
  - writers and recordings, with the "+n" expander
  - From (book)
  - Source
  - Notes
  - tags, tag votes and "+ Add your own"

  The mockup shows only the facts.
- **View ▸ Versions:** the vote buttons and the "Canonical" / "viewing" badges.
- **Tab editor:** the "Tab by" / "Link" credit fields above the editor (frame
  9 left them out).
- **Tab view:** the attribution block after the tab ("Tabbed by …", "View on
  Banjo Hangout", the disclaimer). The new credit line under the title is in
  addition, not instead.
- **Tab status notices** after a submission or a `.tef` import (`.arr-status`,
  `.arr-skipped`): they lived in the takes bar and stay in the page, under the
  credit line.
- **Lyrics editor:** the notice "Songs go live as soon as you submit them",
  which shared a row with the in-page "← Back" that goes.
- **Placeholder:** the Wanted section (+ Request a part, + Add a tab) under
  "Help complete this song".
- **⋯:** the site-wide group (Install app … Send Feedback).
- **Lead sheet:** the "Source:" link at the end of the song stays; Details
  shows it too.

### Further away than today (deliberate unless Mike says otherwise)

- **Lists / Save to list:** one tap → two (⋯ ▸ Save to list…).
- **Export on desktop:** two taps → three.
- **Theme, Report a bug and the desktop Sign in button:** now in ⋯. Signed
  out, Submit in either editor still asks you to sign in and keeps the draft.
- **Switching part, version or track:** one tap → two (View).
- **Desktop tab dock:** today's desktop band shows Size, Play in, metronome,
  count-in, loop, Repeats, Feel and the mixer in one row.
  - **Recommendation:** keep them inline on desktop and collapse into Display
    only when the dock is narrower than 640px, as the band already does.
  - Mockup D1 shows only ▶ · Tempo · View · Display; that would make desktop
    players reach into a sheet for things that are one click today.

### Removed on purpose

- **Chord-chart Practice mode** (chart rows interleaved with lyric lines,
  G18b2): Mike found it harder to perform from than lyrics beside a chart. He
  confirmed the loss on 2026-10-30, provided the chart and the lyrics + chords
  can share a page. It is replaced by:
  - View ▸ Lyrics + Chart: side by side on wide screens. On a phone, the chart
    (each section once) sits above the lyrics; this is a proposal to draw.
  - Display ▸ Chart ▸ Order ▸ As sung.
- **Auto-hide on by default:** now off.
- **The "Differs from the chart" notes:** removed (#342).
- **Edit at the end of the song.**
- **The Key and Display pills on tab and ABC pages**, where they did nothing.
- **The vestigial focus-mode "Exit" button.**

## The views the mockups didn't draw

### Tab

Today a tab page stacks five rows of controls above the music: the pill row,
the part tabs, the takes bar, "View track" and the track card. The player band
sits below. Phone: `tab-single-track--phone-light.png`.

G19:

- **Bottom dock = the player**: ▶/⏸ · Tempo − n + · View · Display. Stop
  shows only once playback has started. Loop, metronome and count-in move into
  Display ▸ Practice. Dragging over measures still arms a loop, and the
  Play button still reads "▶ Loop".
- **Display on a tab** is today's ⚙ sheet, renamed and reached the same way
  as on the lead sheet. Its sections are:
  - Size
  - Play in (today's band Key: a capo for playback, the frets don't move)
  - Layout (Unrolled / Repeats)
  - Feel
  - Practice (loop, metronome, count-in)
  - Tracks (mixer; Solo)
  - Auto-hide controls
- **No Key in a tab's dock.** Key there would promise the frets move. They
  don't, which is why it is labelled "Play in" inside Display.
- **Edit** in the top dock opens the tab editor. The band's ✏️ Edit and the ⚙
  sheet's Tab ▸ Edit row go.
- **Above the music**: the title, "Written by… ›", one credit line ("Banjo tab
  by schlange · Banjo Hangout ★"), then the tab. "View track" moves to View
  when the tab has more than one track. Per-track Solo stays on the track
  card.
- **Same shape everywhere**: the 640px collapse keeps its one breakpoint
  (`toolbar.js`, `tab-controls-sheet.js`, `style.css` `@container tabband`).
  Desktop gets the same dock in one row, as the tab band already is.

### ABC notation (fiddle tunes)

Today the Key and Display pills appear but do nothing to the notation:
`abcTranspose` is never set, and the Display options only touch the chord
view. The band has Aa, tempo and ▶. Phone: `song-abc--phone-light.png`.

G19:

- **Bottom dock**: ▶ · Tempo · Size · View. No Key and no Display, because
  nothing in them applies; that stops the page offering controls that do
  nothing.
- **Key on notation** is a follow-up issue, not G19. abcjs supports it
  (`visualTranspose` and `midiTranspose` are already passed), so it is small,
  but it is new behaviour.
- **View** lists Notation, Chords (for a hybrid ABC + chords part) and the
  tune's tabs.

### Lyrics & chords editor

The editor is its own view (`#edit/<id>`), not part of the song page. Its
bottom band is already a dock. Its top band is the full site nav: on a phone
BB 🔍 + ♡ ☰ ✨ 🐛 ◐ 👤 ⋯ (`editor-existing-song--phone-light.png`), the
"dashboard" feel Mike objected to. Its exit is an in-page "← Back", and
Submit sits at the end of the page, below the text.

- **In G19a**: the editor's band gets the song page's thin top dock: ← back to
  the song · BB · ⋯. The in-page "← Back" goes. Nothing else changes.
- **Recommended follow-on (G19e)**: Submit moves into the top dock where Edit
  was ("Submit correction"), so the way to finish an edit is always on
  screen; Copy ChordPro and Download .pro move to ⋯. This serves "encourage
  editing", but it changes the editor's flow, so it waits for Mike's yes.
- **Must keep working**: `lead-editor/index.js` reads the top band's height
  and the bottom band's top edge. Keeping both elements at their sizes means
  no geometry code changes. `visual-editor-mobile.spec.js` checks this at
  320–390px widths.

### Tab editor

It edits in place on the song page. Today everything stays on screen while
editing: the pill row (whose Key and Display do nothing to a tab), the part
tabs, the takes bar, the title-row Edit. G17 (#341) just settled its own
command surface (band: Submit and ✓ Done; File menu: the rest), so G19 leaves
the editor's own chrome alone.

- While editing:
  - The top dock's Edit hides, because ✓ Done in the band is the way out.
  - View is disabled; switching parts mid-edit means leaving the editor.
  - Display is disabled.
  - The band keeps G17's layout.
- Moving the pill row, part tabs and takes bar into the docks clears the space
  above the editor without touching the editor.

### Details (song facts)

Today: Info is a pill with a popover, and 🏷️ Details is a title-row button
that replaces the page with a form (title, artist, key, notes). No e2e spec
covers the form.

G19:

- Tapping "Written by… ›" opens the Details sheet. It holds Info's contents:
  - writers and recordings
  - source and notes
  - tags, tag votes and "+ Add your own"
- **Edit details** at the bottom opens today's form, unchanged, for people
  allowed to edit. It is the same `showMetadataEditor`.
- New e2e coverage for the form, since moving its entry point is the moment
  it could silently break.

### Set lists

Today `#song-nav-bar` is a second fixed bar (z 1001, 60px). When a view also
has a band, the band is lifted 60px to sit on top of it (`body.has-list-context
.app-bottomband`). A tab in a list on a phone therefore has two stacked bars,
about 120px of chrome. No e2e spec drives the bar.

G19:

- ← names the list.
- ‹ 2 of 9 › is a pill at the left of the bottom dock. Tapping the middle goes
  back to the list.
- ←/→ keys stay.
- `#song-nav-bar`, `--listbar-h` and the stacking rules are deleted.
- **The crowded case** is a tab in a list on a 390px phone:
  ‹ › · ▶ · Tempo · View · Display. The tempo readout drops its − / + there
  and opens a stepper. This is the one frame to draw before building.
- Song notes (list context) stay in ⋯ ▸ This song.
- Two bugs from the survey become moot once the bar is gone:
  - `has-list-context` may linger after leaving a list.
  - ←/→ fire inside the tab editor's canvas in a list.

  The second still needs a guard: the keys must ignore the editors.

### Placeholder and instrumental-only songs

- **Placeholder**:
  - Top dock: Edit opens the details form, as today's title-row Edit does.
  - No bottom dock: there is nothing to control.
  - "Help complete this song" and the Wanted section stay in the page.
- **Instrumental-only** (tabs, no lyrics): the tab dock. Export doesn't apply,
  because there is no ChordPro.

### The tour

`tour.js` points at `#key-pill`, `#list-picker-btn`, `#edit-song-btn`,
`.tab-play-btn`, `.tab-edit-btn`, `.tab-more-btn` and the bottom band.
`tour.spec.js` and `tour-mobile.spec.js` click through them. Every phase that
moves one of these updates its tour step in the same PR:

- Key → the dock's Key.
- Lists → ⋯ ▸ Save to list…
- Edit → the top dock's Edit (for a tab too).
- ⚙ → Display.

### Print

`@media print` hides the top band and `.tab-controls`, but not
`#app-bottomband` or the pill row. G19 hides the band and both docks'
contents, and prints the view that is showing.

## Size, Key and Auto-hide across views

- **Size**:
  - Today there are three controls. Display's Aa sets the lyric text and is
    remembered. The tab band's Aa sets the staff scale and resets on every
    redraw. The ABC band's Aa sets the notation scale and is not remembered.
  - G19 makes one Size in the dock, acting on whatever is showing. It is
    remembered per kind: text (lyrics and chart together), tab, notation.
  - The chart scales with Size; this was Mike's complaint about G18b2.
- **Key** appears only where it changes what you see:
  - lyrics and chart: yes
  - tab: no; "Play in" lives in Display
  - notation: no, until the follow-up
  - Nashville stays inside Key.
- **Auto-hide**:
  - Today it is on for every song page, and only the top band hides.
  - G19 turns it off by default; turned on, both docks hide together.
  - This changes what returning visitors see, and Mike chose it.
  - `ui.spec.js` (the `chrome-hidden` test) changes with it.

## Desktop

Still open from the mockups: a bottom dock on desktop, or a toolbar under the
title. **Recommendation: the bottom dock.** The tab, ABC and editor views
already put their controls in a full-width bottom band on desktop, so the
lead sheet joining them gives one place for controls on every view.

Desktop specifics:

- The ⋯ menu is a popover, not a sheet.
- Details is a popover, as in the desktop mockup.
- Two columns and Lyrics + Chart are desktop options.
- The chart column's sticky offset becomes `var(--topbar-h)`. Today it is a
  3.75rem guess, so `shell.js` publishes `--topbar-h` the way it already
  publishes `--bottomband-h`.

## Build order

Each phase is one PR. Each waits for Mike to see the real page (phone and
desktop) before merge. The tour, print and e2e changes go in the phase that
moves their controls.

1. **G19a: top dock and Details.**
   - Song-page top band becomes ← · BB · 🔍 · Edit · ⋯.
   - ⋯ is regrouped.
   - Edit becomes contextual: the lyrics editor; the tab editor on a tab;
     details on a placeholder.
   - "Written by… ›" opens the Details sheet, and the Info pill goes.
   - Title-row Edit and Details go.
   - The lyrics editor gets the thin top dock.
   - The tour moves into ⋯ and its Lists and Edit steps are updated.
2. **G19b: the reading dock.**
   - Lead sheet, chart and ABC get the bottom dock. The pill row and part tabs
     go.
   - View absorbs versions, parts and the hybrid toggle.
   - Display absorbs the Display pill, the chart header and Auto-hide (now off
     by default).
   - One Size, with the chart scaling with it.
   - `--topbar-h` is published.
3. **G19c: tabs and lists.**
   - The tab dock (▶ · Tempo · View · Display; ⚙ becomes Display); the takes
     bar and View track go into View.
   - The list pill joins the dock and `#song-nav-bar` is deleted.
   - The ←/→ guard.
   - The tab-in-a-list frame drawn and agreed first.
4. **G19d: tidy.** Print rules; delete the dead pieces:
   - `exit-fullscreen-btn`
   - `.focus-btn` naming
   - the empty "FOCUS HEADER" comment
   - `setShowChordProSource`
   - the `phoneBand` one-shot check
5. **G19e (on Mike's yes): the editor's Submit in the top dock.**

Before G19a: mockup frames for the tab, ABC, tab-in-a-list, tab editor and
lyrics editor states, added to the two G18b3 mockups, so these views are agreed
before any code moves.

## Risks

- **E2E selector churn.** Many specs select the pill row (`#key-pill`,
  `#display-pill`, `#info-pill`, `#export-pill`, `#arrangement-pill`), the part
  tabs, `#edit-song-btn` and the tab band. Each phase updates its specs.
  `helpers.js` `openPill` becomes a dock helper.
- **The lyrics editor's geometry** (see above): keep the elements.
- **Container queries.** The tab band's narrow layout keys off
  `@container tabband`. The reading dock lives in the same container, so it
  collapses at the same 640px.
- **iOS Safari's collapsing address bar** with fixed bottom bars is already
  unverified for the editor (`lead-editor/CLAUDE.md`). Check on Mike's phone
  at each phase.
