# Chords mode: stops, the glide, trailing chords, the chord panel

Read before changing how the Chords-mode cursor moves or lands, how chords
after the words are spaced, or how the chord panel is laid out. The mode
overview, the box and hit spans are in `CLAUDE.md` beside this file.

## Where the cursor stops

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

## Gliding the cursor

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

## Chords after the words

- **Even spacing.** Spaces after a chord are its lyric, so a chord's segment is as wide as the chord
  or its spaces, whichever is wider. A chord is therefore followed by its name's length (characters, no brackets) + `AFTER_GAP` spaces,
  and the first chord after a word gets `AFTER_GAP` (2): `home  [C#7]     [D]   [A]`.
  `placeAtCursor` rewrites only the tail of that line, with the smallest change; other lines keep
  their spacing. Editor and ChordPro preview must agree on every `.cl-segment` x (e2e).

## The chord panel

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
