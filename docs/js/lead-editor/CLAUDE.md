# Lead-sheet editor (`lead-editor/`)

ONE CodeMirror 6 view whose document is the ChordPro text. Three explicit modes,
one document, one undo history, one caret (spec: `docs/plans/2026-10-26-lyrics-editor-redesign.md`):

| Mode | Job | CodeMirror | What you touch |
|---|---|---|---|
| **Lyrics** | write, paste, mark sections | decorations on, **editable** | text; chords are drawn but inert |
| **Chords** | place / change / move / delete chords | same decorations, **`editable` false**, `user-select:none` | the box + the chord sheet |
| **ChordPro** | edit the source | source highlighting, editable | text, beside a READ-ONLY preview |

The mode is remembered per device in `localStorage['bgb-lead-mode']`
(`lyrics|chords|chordpro`; the first build's `visual` means `lyrics`). A song
OPENED (`setText(text, {reset:true})`) gets the remembered mode; a NEW EMPTY
song always opens in Lyrics (not persisted). `cm-editor.js` only knows two
decoration sets (`visual` for Lyrics and Chords, `chordpro`) plus `setEditable`;
`index.js` owns the three-way mode.

Lyrics and Chords reuse the book's own classes (`.song-body`, `.song-section`,
`.section-label`, `.section-indent`, `.cl-line`, `.cl-segment`, `.cl-chord`), so
the look matches by construction; the e2e compares `.cl-segment` widths against
`#work/old-home-place`.

CodeMirror is vendored: `docs/vendor/codemirror.js` (one esbuild bundle of
`@codemirror/{state,view,commands}`, MIT notices at the top). Rebuild with
`./scripts/vendor-codemirror`. It is reached ONLY through `editor.js`'s lazy
import - never from `main.js`'s static graph (`__tests__/lazy-modules.test.js`
enforces it; new modules go in `LAZY_MODULE_URLS`).

## Files

| File | Role |
|---|---|
| `doc-model.js` | PURE text rules: `lineModel`, `analyzeDocument` (mirrors `parseChordPro`), the editing rules (`insertionPoint`, `backspaceRange`, `deleteForwardRange`), chord placement (`chordAt`, `placeChordChange`, `removeChordChange`), `lineSeams`, **`lineStops`** (the cursor stops), **`snapCursor` / `normalizeCursor`**, and **`currentSongKey(text)`** (declared `{key:}` else detected: the ONE key owner) |
| `cm-editor.js` | `createLeadEditor`: the view, widgets, `buildVisual` / `buildSource`, the mode `Compartment`, `setEditable`, `typingRulesFilter`, the box state field, `Programmatic` annotation |
| `index.js` | `mountLeadEditor`: controller. Modes, the chord box, typed entry, Move/Remove, paste, undo toast, section bar, label menu, ChordPro preview, empty overlay. Sets `host.__lead` (test hook) |
| `chord-motion.js` | PURE cursor motion + text ops: `createPointGlide` (pointer dx/dy/dt -> a screen-space point), `moveCursor` (arrows over `lineStops`), `placeAtCursor` / `removeAtCursor` / `carryChord` (slots after the words, chord lines), and the exported tuning constants (`HYSTERESIS`, `AFTER_GAP`, ...) |
| `glide-driver.js` | The in-flight cursor: the point, the synchronous overlay, the once-per-frame commit; `moveTo` (absolute, chart) and `move` (relative, trackpads); the stop history for settle-on-lift |
| `loupe.js` | The pop-up loupe above a thumb gliding on the chart: pure `placeLoupe` + `createLoupe` (DOM) |
| `chords-touch.js` | Chords-mode pointing: `cursorAtPoint` (tap / glide point -> a STOP hit `{pos, after, kind, rect, ring?}`), pure `pickItem` (taps, the ring) and `pickStop` (sticky glide), `tapTargets`, `seamAtPoint`, `seamOfChordEl`, `seamForPos`, `firstSeam` |
| `chord-menu-model.js` | PURE sheet contents for a key: outside row, in-key row, More roots, decorations that compose (`applyDecoration`, `applyBass`), the bass row |
| `chord-menu.js` | The chord panel DOM, always docked: the magnifier (`.chm-strip`) and the picker (`.chm-body`) in one root; the strip and hold-to-trackpad gestures (both feed `onGlide`) |
| `section-ops.js` | PURE text transforms: mark selection, rename, retype, duplicate, move, unlabel, delete, `diffChange`; what a copy of whole sections puts on the clipboard (`sectionsForClipboard`) and where pasted sections land (`placeSectionPaste`) |

Shared: `chordGlyphHtml` in `../chords.js` (display only, the file stays ASCII,
ALWAYS escapes the chord text - never pass chord text to innerHTML any other
way; section labels use `textContent`); `../visual-editor/{model,syllables,wrap-section}.js`;
`../smart-paste.js` `convertPastedText`.

## How the decorations draw the text

`buildVisual` (a `StateField`) scans the text with `analyzeDocument` and emits:

- `[G]` -> replace widget `.cl-chord` > inner `span.cl-chord-glyph` (the box
  highlight paints only the glyph, not the book's full-width block)
- chord-to-next-chord range -> mark `.cl-segment` (`inclusiveStart`); text before
  the first chord gets a `GapWidget` chord row; a segment with no text of its own
  is a self-contained `.cl-segment` widget
- lines with chords -> `song-line cl-line`; chorus / repeated sections ->
  `section-indent`; last lyric of a section -> `cl-last`; blank -> `.cl-blank`
- `{start_of_*}` -> block `LabelWidget` (click = label menu, Lyrics only);
  untagged verses get a label before their first line; `{end_of_*}`, `{meta:}`
  -> hidden block; ABC / tab / grid / `{comment}` -> locked block
- every replaced range is also in `EditorView.atomicRanges`

**No vertical margin inside the editor.** CodeMirror's height map measures
`getBoundingClientRect().height`, margins excluded. A `margin-bottom` on
`.cm-line` (the book's `.song-line` has one) or on a block widget drifts the map
away from the screen (112px by Verse 3 of old-home-place), so `posAtCoords`
hits the wrong line and a drawn selection lands wrong. The editor stylesheet
keeps the book's spacing as PADDING (`.le-cm .cm-line.song-line` / `.cl-last`),
block widgets contain their children's margins (`display:flow-root`), and
`lead-editor-cm.test.js` fails if a vertical margin comes back.

**CodeMirror's widget buffers.** CodeMirror puts zero-width `<img class="cm-widgetBuffer">` around inline widgets (for a
caret beside them). Only the one BEFORE a segment's block chord leaves the flow (`.cl-segment > .cm-widgetBuffer:first-child
{position: absolute}`), because in flow it adds a phantom row above the chord. The others must stay inline: an absolute
buffer mid-word (around the cursor's slot) made WebKit (iOS) give the segment a third row once the font size changed (A+ /
A-), the "staircase" D / some / body; and they cannot be hidden either, because `coordsAtPos` measures them (display:none
put the cursor at 0,0). Reproduced and verified only in Playwright WebKit (0 staircases in 104 placements after the fix);
the e2e guard checks the cause in Chromium ("no staircase inside a word").

**Native selection only.** No `drawSelection()`, no custom `::selection`
override: with it, iOS drew a second selection and handles over the native one.

## Lyrics mode (editing rules, tested in `lead-editor-doc-model.test.js` / `-cm.test.js`)

- Backspace deletes the LETTER, hopping over chords; Delete is the mirror.
  A selected range deletes everything in it; when that holds chords a toast says
  "Removed N chords - Undo".
- Text typed (or pasted) where a chord sits goes BEFORE the chord
  (`typingRulesFilter`). Programmatic edits carry `Programmatic` and skip it.
- **Where the section bar sits** (2026-10-27): desktop (fine pointer) floats it beside the selection start; phones (a
  coarse pointer) DOCK it at the bottom of the visual viewport, above the keyboard (`placeDockedBar`, re-placed on
  `visualViewport` resize/scroll; `.le-selbar-docked` wraps so every type is in view). The floating bar sat exactly where
  iOS draws its own Cut / Copy / Paste menu, which always wins: shown, but covered (triage). NOT verifiable in
  Playwright: whether iOS's form accessory bar (˄ ˅ ✓) is inside the visual viewport's shrink (if not, it covers the bar).
- **The label menu and the undo toast fit the visible screen** (2026-10-28): `index.js::visibleArea()` = below the top band,
  above the bottom band / keyboard (`visualViewport`) and, in Chords on a phone, between the magnifier and the docked picker.
  `placeLabelMenu` opens the menu below the label; when it does not fit, the page first scrolls the label up to the top of
  that area (before the menu listens for pointerdown, since a finger scroll closes it), and a menu still too tall scrolls
  inside itself (`max-height`). It used to flip above, clamped to the WINDOW top, under the top band (types and label hidden).
  The undo toast sits above that area's bottom, so in Chords it no longer covers the picker; only its Undo takes taps
  (`.le-toast` is `pointer-events: none`). e2e: "the undo toast stands above the picker", "the section label menu on a phone".
- Sections: a selection shows the section bar; `wrapSelectionAsSection`
  (`../visual-editor/wrap-section.js`) re-sections across boundaries (closes the
  section open at the start, drops boundaries inside, re-opens the rest with its
  own type/label, renumbers `Verse N` labels from there on).
- **Other…** (`askType`) settles exactly once: Enter, the Add button and a blur with text COMMIT, Escape or an empty field cancels; the value is read and the blur listener removed BEFORE the input is removed. The bar's pointerdown/mousedown `preventDefault` skips the input so iOS places the caret.
- **The label menu follows the screen** (2026-10-28): `placeLabelMenu` runs again on `visualViewport` / window resize
  while the menu is open (`onViewportForLabelMenu`), measuring the menu's own height (its `max-height` cleared first). On
  an iPhone the keyboard closes AFTER a label is tapped, so a menu measured at the tap kept the space above the keyboard:
  "Remove label" cut in half, "Delete section" out of sight. e2e: "the section label menu on a phone".
- **Note rows can go** (2026-10-28): a `{comment}` row (smart paste turns UG's `[Interlude]` / `[Intro]` / `[Break]`
  headings into one) is a locked block, so it was protected like a tab and could only be removed in ChordPro mode.
  `freedSectionLines` now frees a comment row lying wholly inside a deletion (select across it + Backspace), and tapping
  it in Lyrics mode (`LockedWidget` -> `hooks.onComment` -> `index.js::openCommentMenu`) offers **Delete note**, one
  undo step. The row's line is read with `posAtDOM` at the tap (the widget is reused when text above it moves). Tab /
  ABC / grid blocks are still never deleted from Lyrics. e2e: "a note row" (`visual-editor.spec.js`).
- **Only the mode switch enters Chords** (2026-10-27): no double-click shortcut on any device; a double-click in Lyrics is the browser's word selection.
- **Chords are greyed in Lyrics** (2026-10-27): `.le-mode-lyrics .le-cm .cl-chord-glyph` is secondary colour, opacity 0.5, default cursor; colour / opacity only, so the layout is the book's.
- **Protected text** (2026-10-27): `protectDirectivesFilter` clips a USER delete / replace to the unprotected pieces (`doc-model.js::clipDeletion`), EXCEPT a section lying wholly inside the range: its `{start_of_*}` .. `{end_of_*}` lines go too (`freedSectionLines`), then the blank lines it leaves are tidied (no run of blank lines, none at an end the deletion reached) as one change. `{meta:}` / `{key:}` / other header directives and locked blocks (ABC / tab / grid) always stay. Partial deletes (held Backspace, all lyric lines but not the label line) keep labels. Select-all + Delete = just the metadata lines (`''` when there are none); select-all + paste puts the new text after the metadata.
- **Copy / cut / paste of whole sections** (2026-10-27): the section markers are hidden widgets here, so a selection
  of the lyrics never holds them and the browser's copy took the words alone: a copied chorus pasted back as a verse.
  `handleCopy` (the `copy` / `cut` DOM handlers in `cm-editor.js`) asks `section-ops.js::sectionsForClipboard`: lines
  from inside ONE section (or plain lines) stay the browser's copy, untouched, so a line repeated in a verse never
  becomes a section; a selection covering a whole section, or crossing from one section into another, puts every
  section it touches on the clipboard with its own start and end lines, balanced (an end line is written when the
  section had none; select-all copies the song exactly). A cut of whole sections is dispatched as a USER deletion of
  the widened range, so the protect rules take the label and tidy the blank lines. Pasted text holding a section
  (`holdsSections`) lands between sections in Lyrics mode (`placeSectionPaste`: after the section or plain paragraph
  the caret is in, a blank line either side, never nested), with auto-detect on or off; ChordPro mode pastes at the
  caret as typed. e2e: `visual-editor.spec.js` "copy and paste of whole sections".
- The empty-sheet hint (`.le-empty`) is a SIBLING overlay of CodeMirror's
  content, not a `placeholder()` (CodeMirror clones the node and makes it inert,
  which killed the Paste button). Paste reads the clipboard only where
  `isSecureContext && navigator.clipboard.readText`. A page that cannot (plain http, like the tailnet dev URL) gets NO
  Paste button: it says how to paste up front ("Tap and hold here, then Paste" / "Press ⌘V to paste"), since a button
  there could only show a hint and read as broken (2026-10-27). A refused permission at runtime still shows the hint.
  Real paste events run smart paste.
- **Paste just works** (2026-10-27): ⌘V / Ctrl+V ANYWHERE on the editor page pastes into the song (`onDocPaste`, a
  document `paste` listener while `host` is on screen). Only a field that takes text itself (`input`, `textarea`,
  `select`, `contenteditable`: the title, the section bar's Other…) keeps its own paste; CodeMirror handles one inside
  it; in Chords mode (locked) it switches to Lyrics first. A new empty song on a fine pointer also opens with the caret
  in the sheet (`focusIfEmpty`, called by `main.js` when the Add Song view shows, via `editor.js::focusEmptyEditor`);
  never on a phone (it would pop the keyboard). Before this, a ⌘V right after opening `#add` went to `<body>` and
  nothing happened, while the hint said "Press ⌘V to paste". e2e: `editor.spec.js` "Paste just works".
- **Line endings** (2026-10-28): clipboard text is normalized to `\n` (`clipText`, and `convertPastedText` itself) before
  anything measures it. CodeMirror drops every `\r` on insert, so an Ultimate Guitar copy (`\r\n`) set the cursor 36
  characters past the end: `RangeError: Selection points outside of document`, and the whole paste was lost.

## Chords mode

- **The box** is a document position (`boxField`): the start of a syllable, AFTER
  any chords already there. It maps through edits with `assoc 1`.
- **Pointing** (`chords-touch.js`): `click` -> `seamAtPoint(view, x, y)`.
  `posAtCoords` picks only the LINE; the seam is the one whose syllable span
  contains x, from where each seam is really drawn (`coordsAtPos`; the row comes
  from the letter at the seam, not the line-start gap widget). A tap on a chord's
  glyph (`.cl-chord-glyph`) selects that chord; a tap on the rest of the chord row
  belongs to the lyric under it. Measured on a phone viewport: 100% of syllable
  centres of old-home-place Verses 1-2 (73/73) and of the chord row above them.
- **The panel is always docked, never floating** (revised 2026-10-27). `index.js::padForSheet` picks the layout and publishes geometry:
  - **The magnifier is OFF by default** (phone and desktop): an accessibility toggle in the nav row of the picker,
    persisted per device in `localStorage['bgb-chord-magnifier']` (`'1'` = on). While off, `.chm-strip` is NOT in the DOM (the menu
    adds / removes it in `render()`), `--chm-strip-h` is `0px` and `#editor-lead.chm-docked` has no top padding
    (`--chm-strip-gap` is `0px`, `8px` when on). When on, everything below applies as before. The arrows are never in the strip.
  - **`split`** (phones, any touch screen, and a window under 1100px): `.chm-menu` is `display: contents`. The magnifier
    (`.chm-strip`: the enlarged line, drag = trackpad; only when switched on) is a FIXED bar at `top: var(--chm-top)`, which is `.app-topbar.offsetHeight` (the band's LAID-OUT height, never its transient
    rect and never a literal: the band is sticky and slides with a transform, and on iOS the visual viewport settles after the
    keyboard goes away, so a rect measured at the mode tap got stuck behind the band). `index.js` re-runs `padForSheet` on a
    ResizeObserver of the band, the band's `transitionend`, and `visualViewport` resize + scroll. e2e: "never hides behind the top band". The picker (`.chm-body`: header, decorations, both chord rows, More roots / Add chord
    line) is a fixed bar at the bottom. Live heights are published on `<html>` as `--chm-top`, `--chm-strip-h`,
    `--chm-picker-h` (the `--bottomband-h` pattern of `shell.js`; a ResizeObserver keeps them current) and `#editor-lead.chm-docked`
    is padded by the last two, so any line, first or last, can scroll into the gap between the parts.
  - **`side`** (`(min-width: 1100px) and (pointer: fine)`): the root moves into `#editor-workspace` (which becomes a grid,
    `.chm-has-side`) and is `position: sticky` in column 2, magnifier above picker, so it stays visible as the chart scrolls.
  - There is no anchored popover any more (`computePopoverPosition` / `visual-editor/popover-position.js` are deleted).
  - **Both parts keep a fixed height while you navigate**: the decorations row is ALWAYS rendered (disabled and dimmed,
    `.chm-decos.idle`, with an empty box), the header reserves the function line (`.chm-func-ph`), and `.chm-menu .chm-head` has a
    min-height. e2e (`visual-editor-mobile.spec.js`, "the docked parts keep their height") compares the picker, both header rows, the magnifier and
    the ▲ ▼ geometry for an empty box, a plain chord and an extended chord. Only user-opened parts (More roots, the bass row) grow the picker.
  - **`scrollBoxIntoView`** keeps the cursor's line (its chord row too) inside `visibleGap()`: below the top band and, in split,
    below the magnifier and above the picker. Used by taps, the arrows, a glide, placing a chord and Add chord line.
  - Hold-to-trackpad works on the picker AND on the magnifier (the arrows; dragging the strip itself is a trackpad at once).
  - `Esc` closes it. There is no Done: the picker's mode switch (below) returns to Lyrics.
  - **Picker header, three rows of fixed height** (`.chm-row1` / `.chm-row2` / `.chm-row3`, 40px each, same in split and side): row 1 = `Key` select
    left, a compact `Lyrics | Chords | ChordPro` segmented control right (`[data-picker-mode]`; calls the SAME `setMode` as the editor
    header's `#editor-mode-*`; `applyMode` -> `syncModeChrome` keeps the header in sync, and the picker is only on screen in Chords);
    row 2 = the function line, then Move / ✕ Remove when the cursor is on a chord;
    row 3 = THE nav row `◀ ▲ ▼ ▶ ... ↶ ↷ [magnifier]` (`.chm-prev .chm-up .chm-down .chm-next`, `.chm-undo`/`.chm-redo` = `editor.undo/redo`
    disabled from `editor.history()` like `#editor-undo/#editor-redo`, `.chm-mag` = icon button, aria-label "Magnifier", `aria-pressed`;
    every target 40px; at <=340px the mode switch, Key select and nav buttons compact (34px wide) so nothing leaves a 320px viewport, heights unchanged). Chord glyphs are `position: relative; z-index: 1`, above the cursor's `.cl-slot-pill`, so a tap on a visible chord selects it even when the pill overlaps it. Hold-to-trackpad works on the whole picker.
  - **Editor zoom**: `A−` / `A+` (`#editor-font-down/up`, in `#editor-toolbar`) step the SAME `fontSizeLevel` as the song page's Display pill
    (limits -5..6, `setFontSizeLevel`); `index.js::stepFont` re-applies the font, `view.requestMeasure()`s and, a frame later, redraws the
    sheet, scrolls the box into view and re-syncs the ring.
- **The strip** (the magnifier): a clone of the current `.cm-line` (or of the pending chord line's
  widget), enlarged (`STRIP_SCALE` 1.4, was 1.7), nowrap, compact padding (only when the magnifier is on). `refreshStrip` centres the cursor and clamps so it is always fully in view
  (the old code only shifted left, which left the box half cut off at the left edge), and slides from the previous
  shift (FLIP) so the line glides under the cursor. The clone's `data-chord` attributes are stripped: the strip is
  a picture, not a second set of chord buttons. The step buttons now live in the nav row: `.chm-prev/.chm-next` (a stop), `.chm-up/.chm-down` (a line).

## Where the cursor stops

The cursor stands on STOPS, never on a letter (decided 2026-10-27; plan: "Where the cursor stops"). `lineStops(text, lineFrom)`
(`doc-model.js`) returns `{pos, kind, after, at, col, chord}` in reading order:

| kind | where | cursor shape | placing D writes |
|---|---|---|---|
| `syllable` | a syllable start (`tokenizeLine` seams, incl. a chord already mid-word) | outline box `.cl-box-text` (the dashed pill only while there is no chord) | `[D]hollow` |
| `gap` | ONE per whitespace run between two words, at the offset of its first space (or just after a chord already in the run) | the empty slot's box, centred on the space: the dashed pill (only while the gap holds no chord; otherwise the chord's glyph is boxed) AND `.cl-slot-text` on the lyric row (`.cl-slot-gap`; absolute, takes no width). Was a 4px bar until 2026-10-27: it read as a text caret, not a place | `years[D] since` |
| `after` | each chord already trailing the words (`after: 0`), then ONE virtual empty slot (`after: 1`, pos = line end) | the boxed chord / for the empty slot: the dashed pill AND an outline on the lyric row below it (`.cl-slot-text`, like a syllable; absolute, takes no width) | `home   [D]` |

- `snapCursor(text, pos)` -> `{pos, after}` is the single normalisation step (`normalizeCursor` is its `.pos`; `fixBox` in
  `cm-editor.js` applies it to every box set and every box mapped through an edit or undo). First the one-place-per-letter
  rule (a position at or inside chord tokens moves to the end of the run), then the nearest stop on a lyric line (ties go
  earlier; at or past the last word's end = the slot after the words). Non-lyric lines only get the first rule.
- **Hit spans** (`rowSpans` in `chords-touch.js`, used by `pickItem` and `pickStop`): a stop's span is its left edge to
  the next stop's, but one narrower than `MIN_HIT_PX` (24) grows by up to half the shortfall on each side, taken from a
  neighbour only while that neighbour stays at least `MIN_HIT_PX` wide. A one-space gap was ~5px wide (a tap 3px off
  boxed the word) while the slot after the words reached the chart's edge; a narrow stop never takes from another narrow
  one ("a" keeps its letter) and no word loses its centre. The returned `left/right` (ring, strip centring) are the span.
- **Arrows**: ◀ ▶ (`moveCursor` kind `'stop'`) walk the stops: syllable, gap, next word ... last word, trailing chords,
  the slot, then the next line. ▲ ▼ move by line and land on the stop whose DRAWN x (`coordsAtPos`) is nearest the kept x.
  Every step ticks.
- **Syllables** come from `../visual-editor/syllables.js` (Liang patterns + lyric rules, see its CLAUDE.md): silent-e words (home, grace)
  are ONE stop, a·way / to·night / ev·ery split.
- **Seams elsewhere**: `lineSeams` (syllable starts + line end) survives for the tests and `firstSeam`; `seamOfChordEl`
  and `seamForPos` use the stops.

## Gliding the cursor

A glide moves a virtual POINT in screen space, not a text offset. Files: `chord-motion.js` (`createPointGlide`, `gainFor`,
`clampPoint`, the tuning constants), `chords-touch.js` (`cursorAtPoint`, pure `pickItem` / `pickStop`), `glide-driver.js`
(`createGlideDriver`: point + overlay + once-per-frame commit), `index.js` (gestures).

- **The CHART glide is absolute (2026-10-27)**: `driver.moveTo(clientX, clientY, event.timeStamp)`. The point IS the finger: no gain,
  no accumulated state, and the chart's box clamps only the point handed to `pick` (a fast 300px swipe moves it 300px; the
  old gain + clamp left a permanent offset). `begin()` needs no cursor position there. The clamp is the chart you can SEE
  (`bounds()` = the content box cut to `visibleGap()` while `glideAbsolute`), so a finger over the picker means the last
  visible line, never text hidden under it. The RELATIVE `move(dx, dy, dt)` below (gain, accumulated point) is kept ONLY
  for the two trackpads: holding the sheet and dragging the strip (`onGlide`).
- **Nothing scrolls under a 1:1 finger**: the text sliding under a still finger would move the cursor, which would scroll
  again (measured: a 1px wiggle over the picker scrolled 783px). So while `glideAbsolute`: `commitView({light})` skips
  `scrollBoxIntoView` (the lift scrolls once, `finishGlide` -> `commitView()`), the hold opens the box with
  `openBox(.., {scroll: false})`, and the locked chart holds no DOM selection (`dropChartSelection()` on entering Chords and
  at a glide's start: the Lyrics caret stays in the DOM after the switch, and CodeMirror re-collapses a selection inside its
  content on redraws). Two page-level causes found on the way: `.le-cm .cm-scroller` is `overflow-x: clip`, because
  CodeMirror's `measureTextSize` inserts a 99999px-wide absolute line (no line here is plain text, so always) and unclipped
  that widened the PAGE for an instant, which a phone viewport answered by resetting the scroll to 0 (locked tab/ABC
  blocks scroll in their own box, `overflow-x: auto`). e2e: "the page never scrolls under a finger gliding 1:1".
- **Settle on lift**: the driver keeps `(event time, stop)` each time the STOP changes, seeded with the cursor's stop at the
  start. `end(t)` commits the stop that was current at `t - SETTLE_MS` (80, `chord-motion.js`) when a newer one appeared inside
  that window (a lifting thumb slides), else the latest. Touch and pen only (`endPress` passes no time for a mouse); the
  relative path passes none either.
- **The loupe** (`loupe.js`, touch/pen chart glide only): `pointer-events: none`, `aria-hidden`, on `document.body`, z 70
  (above the docked picker). A bubble (min(280, vw-12) wide, 6px from the viewport edges, bottom edge 56px above the finger,
  never above `--chm-top`) holds a clone of the cursor's line at `LOUPE_SCALE` 1.6 (`data-chord` stripped; never built from
  chord text). The content is translated so the spot under the finger sits above the tail, also when the bubble is clamped
  (`placeLoupe`, pure, unit-tested). `commitView` calls `loupe.refresh()` so the clone is redrawn from the live line whenever
  the committed cursor changes (a cached copy once went stale). The strip (accessibility toggle) and the ring are unchanged.
- **Point (the relative trackpads)**: starts in the MIDDLE of the cursor's stop (`cursorPoint`; page px, so page scroll does not drag it: a stop
  contains the point, so a start on its left edge would step left at once and right only after a whole stop). Each pointer move adds
  (dx, dy) x `gainFor(speed)`: `GAIN_SLOW` 1.0 at or below `SLOW_SPEED` 0.5 px/ms, up to `GAIN_FAST` 2.4 at `FAST_SPEED`
  1.5. `SPEED_SMOOTHING` 0.8. Speed only changes the GAIN; the slow/fast tiers are gone and no longer change what is
  targetable. Clamped to the chart's content box.
- **Two outputs per move**: the RING follows the point CONTINUOUSLY (`hit.ring` = the drawn rect of the letter under the
  point, from `letterItems`; letters exist only to draw smoothly), while the COMMITTED cursor is always a stop. The commit
  (`pickStop`) is the stop whose span CONTAINS the point, exactly like a tap (2026-10-27; it was the nearest stop start,
  so the right half of "some" boxed "body" while the loupe's tail pointed into "some"). Sticky at the edges: stepping to a
  NEIGHBOUR needs the point `HYSTERESIS` (0.35) x half the entered stop's width past the edge they share, either way; a
  jump over several stops, or a previous stop on another row (a row/line change), is taken at once.
  `createGlideDriver` hands `pick(x, y, prev)` the previous hit; `index.js` falls back to the cursor itself at the start.
  Every change of stop ticks (`TICK_MS`); lifting commits the current stop (`driver.end()`).
- **A stop's geometry never depends on the cursor** (2026-10-27): `measure()` takes the ROW of the trailing stops (chords
  after the words, the empty slot) from the last real letter (`coordsAtPos(rowPos - 1, 1)`), never from the line end,
  where the cursor's own slot widget sits (zero height at the baseline: the stop became a row of its own 14px low, so a
  finger past the last word picked the word, the widget went, the slot won again: 194 flips in 212 jittered moves, and a
  second tap right of the last word hit the word). Anything the cursor draws must be absolute and take no width (the
  slot's lyric-row outline included). e2e: "the end of a line".
- **Hit-test = the tap's**: `cursorAtPoint(view, x, y, {nearest, prev, ring})`. The line comes from `posAtCoords` (with
  `nearest`, a point over a label/gap probes up and down for the nearest lyric line); the VISUAL ROW is chosen among the
  line's drawn rows (a wrapped line is two rows; chord row + lyric row), along the row the stop whose span contains x (taps
  and glides alike); past the end of the last row = the after-the-words slot; past the end of a wrapped (non-last)
  row = that row's last stop. `pickItem(items, x, y)` / `pickStop(items, x, y, prev)` are the pure cores (unit-tested with a
  fake layout in `lead-editor-glide-point.test.js`).
- **No lag**: `createGlideDriver.move()` draws the overlay (`.le-cursor-ring`, `transform`, `.dragging` = no CSS
  transition) SYNCHRONOUSLY in the pointermove handler; the hit goes to CodeMirror / strip / sheet via `onCommit` at most
  once per animation frame (and on lift). `.settle` (90ms) is only for taps, arrows and release.
- **Long-press anywhere** (`index.js`, `press`): pointerdown on the chart arms a `HOLD_MS` (300) timer; moving more than
  `HOLD_SLOP_PX` (8) first cancels it (touch = the page scrolls; decision is by time + slop, `touchmove` is blocked only
  after the hold fires, on the touch's OWN target because CodeMirror may rebuild the widget under the finger). On fire:
  a chord under the finger is carried (Move on, off on lift), empty chart = the cursor jumps to the finger (the tap's
  hit-test), then the point glides. A press ON the cursor (or, with a mouse, on a chord) drags after `GRAB_SLOP_PX` (5)
  without a hold. Mouse press-and-hold works; mouse holds on SHEET buttons stay clicks. Capture is taken on `view.dom`
  once the glide starts (not on press: it would retarget the tap's click).
- **Hold the sheet** (`chord-menu.js`): a non-mouse press within `HOLD_SLOP_PX` for `HOLD_MS` adds `.is-trackpad`; the
  sheet emits RAW `{dx, dy, dt}` to `onGlide`, the controller owns the point. The strip feeds it the same way (the strip
  is enlarged but is not scaled back: strip px count like chart px).
- **Never stuck** (`resetGestures()` in index.js, `cancelGesture()` in the menu): clears the press, hold timer, glide,
  overlay, `moving`, `suppressClickUntil`, `.is-trackpad`. Called on pointerup / pointercancel / lostpointercapture (when
  no button is held) / window blur / visibilitychange / a new pointerdown / enter + leave Chords / closeBox / destroy.
  A mouse move with no button held ends a mouse gesture. The click after a real drag is suppressed 400ms, nothing else.
- **While gliding** only the strip is redrawn; the full sheet redraws on lift. A carried chord hops over other chords
  (the hit is ignored there); the steps of one drag are ONE undo step (`DRAG_EVENT` + the 400ms join window).

## One place per letter

The offset just before a chord token and the one just after it are the same letter. `snapCursor` / `normalizeCursor(text, pos)`
(`doc-model.js`) move a position at or inside chord tokens to the end of the run (then on to the nearest stop, see above). It is applied in `boxField.update`
(`fixBox` in `cm-editor.js`), the single sink for `setBox` AND for positions mapped through edits (undo/redo, Move
diffs), for a box that is neither `after` nor `newLine`. So a cursor on a letter carrying a chord always stands after
it (selecting it: Move/Remove) and the renderer never draws an empty slot beside a chord. Fuzz-tested in
`lead-editor-protect.test.js`.

## Protected text (Lyrics mode)

Metadata and section directives are protected by the DOCUMENT, not by how they are drawn. `protectedSpans(text)` covers
every line `analyzeDocument` calls hidden / label / locked plus the newline joining it to its neighbours;
`backspaceRange` / `deleteForwardRange` return null at such a boundary, and `protectDirectivesFilter` (a visual-mode
transaction filter) CLIPS any user `input.* / delete.* / paste / move / drop` change to the unprotected pieces
(select-all + Delete clears the lyrics but keeps `{meta:}`, `{key:}`, `{start_of_*}`, `{end_of_*}`). Edits made through
`editor.change` / `setText` (annotated `Programmatic`: section ops, chord ops) and undo/redo are exempt. The `{meta:}`
match in `analyzeDocument` is anchored to the whole line. Consequence for tests: replacing a whole song that has
directives by select-all + typing keeps the directives (use `appendLead` in `e2e/helpers/lead-editor.js`).

## Chords after the words

- The box is `{pos, active, after?, newLine?}` (`boxField`). `after: 1` is a VIRTUAL slot at the line end, after any
  chords already trailing the words; `newLine: true` is a pending empty chord line below the line ending at `pos`.
  Neither writes anything until a chord is picked; leaving writes nothing.
- **Evenly spaced** (`AFTER_GAP = 2` in `chord-motion.js`, `evenTail`; 3 until the owner chose 2 on 2026-10-27): every GAP you see is 2 wide. In ChordPro the
  spaces after a chord are its lyric, a chord's segment is as wide as the chord or its spaces (whichever is wider), and the
  next chord starts where it ends; so a chord is followed by ITS OWN LENGTH + 3 spaces, and the first chord after a word
  gets 2: `home  [C#7]     [D]   [A]`. A chords-only line starts at its first chord: `[G]   [C]   [D7]    [G]`.
  (Until 2026-10-27 it was a flat 3 spaces before each chord, so the drawn gap was 3 minus the chord's width: C♯⁷ then D
  touched, 0.4 characters.) Measured with a gap of 3: 3.4 / 3.0 / 3.3 characters (C♯⁷ draws a little narrower than `C#7`).
  `placeAtCursor` rewrites ONLY the tail of that line (everything from the end of the last word: whitespace and chord
  tokens), with the smallest change; other lines keep their spacing until their slots are used (old songs are not
  re-spaced in bulk). The book renders the spaces as written, and the editor and the ChordPro preview agree on every
  `.cl-segment` x (e2e).
- **Back-to-back chords** (`[A][D]Charlottesville`, two on one syllable): the first one has no lyric of its own, so its
  segment was exactly its width and the glyphs touched ("AD"). Such a segment, when another chord follows, is
  `.cl-segment.cl-before-chord` (padding-right 1ch), marked by the book (`renderers/chordpro.js` renderLine) and the editor
  (`ChordWidget` `beforeChord`) alike; the plain-text export already kept one space. 5,480 such pairs in 1,626 works (267
  searchable) on 2026-10-27.
- **Changing** a chord in the tail (a pick, or a decoration: D -> D7) writes the tail evenly again (its width sets the gap
  after it) and returns the cursor ON that chord, so a second decoration goes to it.
- **Removing** an after-slot chord writes the rest of the tail evenly (the gap after a removed wide chord would be wrong
  for the one before it), so no trailing whitespace is left; a gap or mid-word chord is just its token (`removalRange`,
  which `carryChord` applies too). A chord line's last chord removes the line.
- Picking a chord appends it, then the cursor jumps to the NEXT new slot. Stepping right past the last word enters the slot.
- **Tapping empty space to the RIGHT of a line's last word** (`cursorAtPoint`) opens that slot, past any trailing chords.
  Trailing chords are stops of their own (a chord's segment starts before the position after it).
- **↵ Chord line** (sheet footer key `.chm-enter`, also `.chm-addline`; label "↵ Chord line" with an aria-label) replaces
  "+ Add chord line". From ANY stop it puts the cursor on a `NewLineWidget` (block widget, side 1, padding not margin)
  below the cursor's line inside the same section, like Enter while typing. The first pick writes `\n[G]`; each next pick
  appends `   [C]`. Leaving the pending line writes nothing. Turnarounds that belong to a verse stay on its own slot.
- The decorations already draw both the way the book does (chord-only rows and trailing segments are the same
  `.cl-segment` chain); the e2e compares geometry with the ChordPro preview (`renderSectionsHtml`).

## The chord sheet: every chord and extension exactly once

Rows, top to bottom: decorations (only while the box holds a chord), the flipped-quality row, the diatonic row, the
footer (`↵ Chord line`, `More roots`). **There are no row captions**: in key versus outside is the styling alone
(solid accent-tinted `chm-inkey` vs dashed, muted `chm-outside`), and it is decided per CHORD by `inKey(chord, key)` in
`chord-menu-model.js` (every chord tone, and the bass note, in the key's scale; a minor key's raised 7th counts only
for the chord on the dominant, so B and B7 are in key in Em but Cm is not). The rows keep `role=group` aria-labels,
cells carry "chord, numeral, in key|outside the key". The same helper styles every extension button by whether the
RESULT (chord in the box plus that extension) is in key (G in G: maj7 solid, 7 outlined). The chart itself is not
styled by this; the highlighting is the sheet only. **More roots** shows only the chromatic roots on neither row, as a
major and a minor cell with numerals, spelled for the key (sharps in G D A E B F# and Em Bm F#m C#m G#m D#m, else
flats), then the free-text field as the last resort. The decoration rows are the only place extensions live. The main row is always exactly 8 equal cells
(`grid`, `minmax(0,1fr)`, no sideways scroll, 320-430px): `7 maj7 6 sus4 sus2 add9 9 ⋯`. `⋯` is a toggle
(`aria-expanded`, pressed look) that opens a SECOND row (`.chm-decos2`) directly under it: `6/9 11 13 ° ø7 +`, then
`m(maj7)` on a minor chord only, then `/ bass` (moved out of the main row), which opens the row of the 12 bass notes
(key tones in-key, the rest outside; F# and Gb are the same bass). The second row wraps, never overflows. It is
USER-OPENED (like More roots and the bass row), so the picker grows only while it is open and `--chm-picker-h` follows
via the ResizeObserver; the main row's height stays fixed. `extraOpen` is null (opens itself while a rare mark is on
the chord), or true/false once toggled, and survives cursor moves. `°`/`+` replace the triad's quality and keep an
extension; `ø7`/`m(maj7)` carry their own minor. **sus2 / sus4 own the quality too** (a sus has no third): `Dm` + sus2 =
`Dsus2`, `Dm7`/`Ddim`/`Daug` + sus4 = `Dsus4`, never `Dmsus2`; `chordFunction` upper-cases a sus numeral (`IVsus2`).
Toggling a sus off gives back what it replaced (`Dm` -> `Dsus2` -> `Dm`): `createSusMemory` in `chord-menu-model.js`
remembers `{at, from, to}` (keyed by line and lyric offset, since the edit moves the doc position) and writes `from`
only while the box still holds `to`; otherwise the plain triad. Wired in `index.js::susChord`; decoration buttons pass
`{decoration: id}` as `onPick`'s second argument. **Function**: the chord in the box
shows its function ONCE, in the header next to Key ("A⁷ · II⁷ (V⁷/V)"), from `chordFunction(chord, key)`: the numeral
(case from quality) plus, for a major chord or dominant 7th that is not already in key and sits a fifth above a
diatonic non-tonic chord, its secondary-dominant name (V/ii, V/iii, V/IV, V/V, V/vi). Plain diatonic chords show just
the numeral. Numerals and the function are drawn with `chordGlyphHtml` (flats, superscripts). Decoration buttons use `data-apply`, never
`data-chord`, so `data-chord` is unique across the whole sheet (unit-tested). There is no "Also in this song" strip
and no root/quality grid; used chords keep their dots. Decoration marks are shown as plain characters (`readableMark`)
at 18px inside those buttons only; `chordGlyphHtml` elsewhere is untouched.
- **Place / change**: tap a chord cell (replaces the one in the box; in a slot it appends, see below). The
  decorations row appears only while the box holds a chord and composes with it
  (Am + 7 = Am7; tapping the active one removes it; one extension at a time).
- **Remove / Move**: shown while the box is on a chord. Remove is one undo step.
  Move toggles carry mode (`moving`): `moveBoxTo` removes the chord and re-places it
  at the new seam in one transaction; tapping Move again or tapping the chart drops it.
  Every chord operation is its own undo step (`history({joinToEvent})`).
- **Keys (desktop)**: `document` keydown (capture) while in Chords mode and the editor
  is visible (the locked chart can't take focus): arrows move the box; a chord letter
  starts typed entry (ghost chip: ~800ms idle commit, Enter commits, 1.5s resume grace
  so `E` then `b7` is `Eb7`); Space/Tab advance; Delete/Backspace remove; Esc closes the sheet.
- **The key**: the sheet's select writes `{key: X}` (declares; the owner has not
  decided whether it should transpose). `currentSongKey` feeds the sheet, the
  toolbar `#editor-key-select` and the submitted `key`/`mode`, so they cannot disagree.

## The tour's hooks (`present`)

The feature tour plays a song into this editor (`../tour-editor-demo.js`) by
pressing the real buttons. `api.present` holds the only two things a pointer
does that code cannot: `select(from, to)` shows the section bar for a
selection WITHOUT focusing the editor (`presenting` stands in for
`view.hasFocus` in `updateSelectionBar`, and `wrapSelection` skips its
`view.focus()` while it is set: on a phone, focus raises the keyboard), and
`boxAt(pos)` puts the chord box on a syllable as a tap would (Chords mode).
`end()` clears `presenting`; `setText(…, {reset: true})` does too.

## Text adapter

`editor.js` exports `getText()` / `setText()`; every reader (submit, copy,
download, dirty check, sign-in return record, transpose) goes through them. If
the editor cannot mount, the hidden `#editor-content` textarea is shown and the
same adapter serves it.

## Tests

Unit: `lead-editor-loupe` (placement), `lead-editor-glide-point` (point -> position on a fake layout incl. a wrapped line, `pickStop` hysteresis, the driver's synchronous overlay, the absolute path and settle-on-lift, `normalizeCursor` / `snapCursor`), `lead-editor-protect` (protected spans, clipped deletes, the box fuzz), `chord-glyph`, `lead-editor-doc-model` (incl. `currentSongKey`),
`-chord-motion` (gain, `lineStops`, stop walking, even spacing writes and removes, chord lines, carry), `-chord-menu` (incl. the once-only DOM check), `-section-ops`, `-cm`, `visual-editor-wrap-section` (the
old-home-place boundary case). E2E: `visual-editor.spec.js` (desktop: modes, Chords
mode, strip, Move/Remove, fixes), `visual-editor-mobile.spec.js` (phone: split
panel, the cursor line between the parts, fixed heights, taps, hit rates, strip with touch pointer events), plus `editor.spec.js` /
`editor-lifecycle.spec.js` (helpers in `e2e/helpers/lead-editor.js`; `leadText()`
reads the text adapter through `host.__lead`).

Magnifier default / nav row / zoom: `visual-editor-mobile.spec.js` "magnifier default and nav row" (the file's `beforeEach` seeds the magnifier
ON for every other test; that describe starts clean) and a desktop test in `visual-editor.spec.js`. Syllables: `syllable-corpus.test.js`.

NOT verifiable without a real phone: iOS autocorrect/dictation next to hidden
chords in Lyrics mode, the feel of the glide tuning constants (`chord-motion.js`: gain, smoothing, hold, `HYSTERESIS`), whether `MIN_HIT_PX` makes a gap easy to land on with a thumb, whether the 2-space `AFTER_GAP` reads right on a real phone, whether a carried chord's own width shifts the letters under a still finger enough to flicker, haptics, whether a held touch on the sheet beats iOS's own long-press behaviour, whether iOS really
shows no callout/handles on the locked chart, and how the fixed top bar and the bottom picker behave with iOS Safari's collapsing address bar and the visual viewport (`position: fixed` offsets and `window.innerHeight` can differ there).
