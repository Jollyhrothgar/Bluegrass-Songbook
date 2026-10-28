# Lead-sheet editor (`lead-editor/`)

One CodeMirror 6 view whose document is the ChordPro text. Three modes share one
document, one undo history and one caret. Spec:
`docs/plans/2026-10-26-lyrics-editor-redesign.md`.

| Mode | Job | CodeMirror state |
|---|---|---|
| Lyrics | write, paste, mark sections | decorations on, editable; chords drawn but inert |
| Chords | place / change / move / delete chords | same decorations, `editable` false, `user-select:none` |
| ChordPro | edit the source | source highlighting, editable, beside a read-only preview |

- `index.js` owns the three-way mode; `cm-editor.js` only knows two decoration sets
  (`buildVisual` for Lyrics and Chords, `buildSource` for ChordPro) plus `setEditable`.
- The mode is remembered per device in `localStorage['bgb-lead-mode']`
  (`lyrics|chords|chordpro`; the old value `visual` means `lyrics`). A song opened with
  `setText(text, {reset:true})` gets the remembered mode; a new empty song always opens in Lyrics.
- Lyrics and Chords reuse the book's own classes (`.song-body`, `.song-section`,
  `.cl-line`, `.cl-segment`, `.cl-chord`), so the look matches by construction. The e2e
  compares `.cl-segment` widths against `#work/old-home-place`.
- CodeMirror is vendored (`docs/vendor/codemirror.js`, rebuild with `./scripts/vendor-codemirror`).
  It must be reached only through `editor.js`'s lazy import, never from `main.js`'s static
  graph. `docs/js/__tests__/lazy-modules.test.js` enforces this; a new module goes in
  `LAZY_MODULE_URLS` (`docs/js/lazy-modules.js`).
- Shared code outside this directory: `chordGlyphHtml` in `../chords.js`,
  `../visual-editor/{model,syllables,wrap-section}.js`, `../smart-paste.js`.
  `chordGlyphHtml` always escapes chord text. Never put chord text into `innerHTML` any
  other way; section labels use `textContent`.

`doc-model.js` is pure text rules and the single owner of the song key (`currentSongKey`).
`chord-motion.js` holds the cursor-motion tuning constants. `index.js` is the controller and sets
`host.__lead` (a test hook). The other files are named for their job.

## Rendering traps

- **No vertical margin inside the editor.** CodeMirror's height map ignores margins, so a
  `margin-bottom` on `.cm-line` or on a block widget drifts the map away from the screen
  (112px by Verse 3 of old-home-place); `posAtCoords` then hits the wrong line. The editor
  stylesheet turns the book's spacing into padding (`.le-cm .cm-line.song-line`,
  `.cl-last`) and block widgets use `display:flow-root`. `lead-editor-cm.test.js` fails if a
  vertical margin comes back.
- **Widget buffers.** CodeMirror puts zero-width `img.cm-widgetBuffer` around inline widgets. Only
  the first child of a `.cl-segment` (the buffer before its `.cl-chord` label, which sits above the
  lyric) is taken out of flow, via `position:absolute` in `style.css`; in flow it adds a phantom row.
  The others must stay inline: absolute ones made iOS WebKit give a segment a third row after a
  font-size change ("staircase"), and `display:none` breaks `coordsAtPos`. Reproduces only in
  Playwright WebKit; the Chromium e2e checks the cause ("no staircase inside a word").
- **Native selection only** (no `drawSelection()`, no custom `::selection`): iOS drew a second one.
- **`.le-cm .cm-scroller` is `overflow-x: clip`.** CodeMirror's `measureTextSize` inserts a 99999px
  line that briefly widened the page, and phones answered by resetting scroll to 0.

## Lyrics mode

- Backspace deletes the letter and hops over chords; Delete mirrors it. A selected range
  deletes the chords in it and a toast says "Removed N chords - Undo".
- Text typed or pasted where a chord sits goes before it (`typingRulesFilter`; `Programmatic` edits skip it).
- **Protected text.** Metadata and section directives are protected by the document, not
  by how they draw. `protectedSpans(text)` covers every line `analyzeDocument` calls hidden,
  label or locked. `protectDirectivesFilter` clips any user delete / replace / paste / move /
  drop to the unprotected pieces (`doc-model.js::clipDeletion`). Exceptions: a section lying
  wholly inside the range goes too, `{start_of_*}` to `{end_of_*}` (`freedSectionLines`), and
  the blank lines it leaves are tidied as one change. `{meta:}`, `{key:}`, other header
  directives and locked blocks (ABC / tab / grid) always stay. Edits through
  `editor.change` / `setText` (`Programmatic`) and undo/redo are exempt. Select-all + Delete
  leaves the metadata lines; select-all + paste puts the new text after them. For tests:
  replacing a song that has directives by select-all + typing keeps the directives (use
  `appendLead` in `e2e/helpers/lead-editor.js`).
- **Sections.** `wrapSelectionAsSection` (`../visual-editor/wrap-section.js`) re-sections across
  boundaries and renumbers `Verse N`.
- **Section bar placement.** Desktop floats it beside the selection; phones dock it above the keyboard (`placeDockedBar`), because iOS draws its own Cut / Copy / Paste menu where the floating bar sat and that menu always wins.
- **Copy / cut / paste of whole sections.** Section markers are hidden widgets, so a browser copy of
  the lyrics lost them (a copied chorus pasted back as a verse). `handleCopy` (`index.js`) uses
  `section-ops.js::sectionsForClipboard`: a selection covering or crossing sections puts each touched
  section on the clipboard with balanced start/end lines; anything inside one section stays the
  browser's copy. A cut of whole sections is a user deletion, so the protect rules apply. Pasted text
  holding a section (`holdsSections`) lands between sections, never nested (`placeSectionPaste`).
  e2e: "copy and paste of whole sections".
- **Empty-sheet hint** (`.le-empty`) is a sibling overlay, not CodeMirror's `placeholder()` (that makes the node inert and killed the Paste button). Paste is offered only where `isSecureContext && navigator.clipboard.readText`; on plain http the hint says how to paste.

## Chords mode

- **The box** is a document position (`boxField`): the start of a syllable, after any chords
  already there, mapped through edits with `assoc 1`. Its shape is
  `{pos, active, after?, newLine?}`. `after: 1` is a virtual slot at the line end after the
  trailing chords; `newLine: true` is a pending empty chord line. Neither writes anything
  until a chord is picked.
- **Pointing.** `posAtCoords` picks only the line; `chords-touch.js::seamAtPoint` picks the
  seam whose syllable span contains x, using where it is really drawn (`coordsAtPos`). A tap
  on a chord glyph selects that chord; a tap on the rest of the chord row belongs to the lyric
  under it. A tap right of the last word opens the after-the-words slot.
- **Keys (desktop).** A capture `keydown` on `document` while in Chords mode (the locked chart
  cannot take focus): arrows, typed chord letters (ghost chip, 1.5s grace so `E` then `b7` is `Eb7`),
  Space/Tab, Delete/Backspace, Esc.
- **The key.** The `select.chm-key` in the chord panel header writes `{key: X}`. `currentSongKey` feeds the sheet,
  `#editor-key-select` and the submitted `key`/`mode`, so they cannot disagree.

### Where the cursor stops

The cursor stands on stops, never on a letter. `doc-model.js::lineStops(text, lineFrom)`
returns `{pos, kind, after, at, col, chord}` in reading order:

| kind | where | placing D writes |
|---|---|---|
| `syllable` | a syllable start (`tokenizeLine` seams, including a chord already mid-word) | `[D]hollow` |
| `gap` | one per whitespace run between words, at its first space | `years[D] since` |
| `after` | each chord already trailing the words, then one virtual empty slot at line end | `home   [D]` |

- `snapCursor(text, pos)` is the single normalisation step; `fixBox` (`cm-editor.js`) applies it to
  every box set or mapped through an edit. The offsets just before and just after a chord token are
  the same letter, so a position at or inside chord tokens moves to the end of the run; then to
  the nearest stop (ties go earlier). Fuzz-tested in `lead-editor-protect.test.js`.
- Arrows walk the stops; up/down move by line and land on the stop whose drawn x is nearest `anchorX` (`index.js::stepCursor`:
  set from the cursor's `coordsAtPos` on the first up/down, cleared by any other kind of move). Syllables come from `../visual-editor/syllables.js` (silent-e words like home are one
  stop; a-way, to-night, ev-ery split).

### Gliding the cursor

A glide moves a virtual point in screen space, not a text offset. Tuning constants are in
`chord-motion.js`; read them there rather than from here.

- **The chart glide is absolute**: `driver.moveTo(clientX, clientY, t)`. The point is the
  finger, with no gain and no accumulated state. The relative `move(dx, dy, dt)` (speed-based
  gain) is kept only for the two trackpads: holding the sheet and dragging the magnifier.
- **Nothing may scroll under a 1:1 finger.** Text sliding under a still finger would move the
  cursor, which scrolls again (a 1px wiggle scrolled 783px). While `glideAbsolute`,
  `commitView({light})` skips `scrollBoxIntoView` (the lift scrolls once), the hold opens the
  box with `openBox(.., {scroll:false})`, and the locked chart holds no DOM selection
  (`dropChartSelection()` on entering Chords and at a glide's start). e2e: "the page never
  scrolls under a finger gliding 1:1".
- **Two outputs per move.** The ring follows the point; the committed cursor is always a stop, the
  one whose span contains the point (like a tap). Stepping to a neighbour needs `HYSTERESIS`.
- **A stop's geometry must never depend on the cursor.** `measure()` takes the row of trailing
  stops from the last real letter (`coordsAtPos(rowPos - 1, 1)`), never from the line end where
  the cursor's own slot widget sits (it flipped the stop between rows: 194 flips in 212
  jittered moves). Anything the cursor draws must be absolute and take no width. e2e: "the end
  of a line".
- **Long-press anywhere** (`index.js`, `press`): pointerdown arms a `HOLD_MS` timer; moving more than
  `HOLD_SLOP_PX` cancels it (touch: the page scrolls). `touchmove` is blocked only after the hold
  fires, on the touch's own target, because CodeMirror may rebuild the widget under the finger.
  Pointer capture goes on `view.dom` once the glide starts, not on press (it would retarget the click).
- **Never stuck.** `resetGestures()` (`index.js`) and `cancelGesture()` (`chord-menu.js`) clear every in-flight gesture; they run on pointerup / cancel / lostpointercapture / blur / visibilitychange / a new pointerdown / mode change / closeBox / destroy. Add any new gesture state to them.

### Chords after the words

- **Even spacing.** Spaces after a chord are its lyric, so a chord's segment is as wide as the chord
  or its spaces, whichever is wider. A chord is therefore followed by its name's length (characters, no brackets) + `AFTER_GAP` spaces,
  and the first chord after a word gets `AFTER_GAP` (2): `home  [C#7]     [D]   [A]`.
  `placeAtCursor` rewrites only the tail of that line, with the smallest change; other lines keep
  their spacing. Editor and ChordPro preview must agree on every `.cl-segment` x (e2e).
- **Back-to-back chords** (`[A][D]Charlottesville`): the first has no lyric, so its glyph touches the
  next. Such a segment is `.cl-segment.cl-before-chord` (padding-right 1ch), set by both
  `renderers/chordpro.js` (`renderLine`) and the editor (`ChordWidget` `beforeChord`). Change both.

### The chord panel

The panel is always docked, never floating. `index.js::padForSheet` picks the layout and
publishes geometry on `<html>` as `--chm-top`, `--chm-strip-h`, `--chm-picker-h` (kept current
by a ResizeObserver, like `--bottomband-h` in `shell.js`).

- **`split`** (phones, any touch screen, or a window under 1100px): `.chm-menu` is
  `display:contents`; the picker (`.chm-body`) is a fixed bar at the bottom and
  `#editor-lead.chm-docked` is padded by the published heights. `--chm-top` is
  `.app-topbar.offsetHeight` (laid-out height, never its transient rect or a literal: the
  band slides with a transform, and on iOS the visual viewport settles after the keyboard
  goes). `padForSheet` re-runs on a ResizeObserver of the band, its `transitionend`, and
  `visualViewport` resize and scroll. e2e: "never hides behind the top band".
- **`side`** (`(min-width: 1100px) and (pointer: fine)`): the root moves into
  `#editor-workspace` (a grid, `.chm-has-side`) and is `position: sticky` in column 2.
- **The magnifier** (`.chm-strip`) is off by default, persisted in `localStorage['bgb-chord-magnifier']`
  (`'1'` = on). While off it is not in the DOM and `--chm-strip-h` is `0px`. It shows an enlarged
  clone of the cursor's line (`data-chord` stripped: a picture, not a second set of buttons).
- **The `.chm-strip` magnifier and the `.chm-body` picker keep a fixed height while you navigate** (decorations row always rendered,
  `.chm-func-ph`, `.chm-head` min-height), or the chart jumps. e2e: "the docked parts keep their height".
- **Sheet contents** (`chord-menu-model.js`): styling alone marks in-key vs outside, per chord, via
  `inKey(chord, key)`. `data-chord` is unique across the sheet (unit-tested); decoration buttons use
  `data-apply`. `sus2` / `sus4` own the quality (`Dm` + sus2 = `Dsus2`); toggling off restores it via
  `createSusMemory`.

## The tour's hooks (`present`)

The feature tour plays a song into this editor (`../tour-editor-demo.js`) by pressing real
buttons. `api.present` holds the two things a pointer does that code cannot: `select(from, to)`
shows the section bar without focusing the editor (on a phone, focus raises the keyboard), and
`boxAt(pos)` puts the chord box on a syllable. `end()` and `setText(.., {reset:true})` clear
`presenting`.

## Text adapter
`editor.js` `getText() / `setText()` are the only way to read the song text (submit, copy, dirty
check, sign-in return record, transpose). If the editor cannot mount, a hidden `#editor-content`
textarea serves the same adapter.

## Tests

- Unit (`docs/js/__tests__/`, `npm test`): `lead-editor-*.test.js`, `chord-glyph.test.js`,
  `visual-editor-wrap-section.test.js`, `syllable-corpus.test.js`.
- E2E (`e2e/`): `visual-editor.spec.js` (desktop), `visual-editor-mobile.spec.js` (phone),
  `editor.spec.js`, `editor-lifecycle.spec.js`; helpers in `e2e/helpers/lead-editor.js`
  (`leadText()` reads the text adapter through `host.__lead`). The spec files keep their old
  `visual-editor` names.
- Not verifiable without a real phone: iOS autocorrect or dictation next to hidden chords, the feel of the glide constants, haptics, and fixed bars under Safari's collapsing address bar.
