# Visual Editor

Mobile-first visual song editor: tap a syllable, tap a chord. Songs are
section block cards (verse/chorus/bridge/intro/outro). Lives behind the
Visual|Raw tabs on the editor panel; the raw ChordPro textarea remains the
submission channel — the visual editor mirrors serialized ChordPro into
`#editor-content` on every change, so preview/copy/download/submit in
`editor.js` work unchanged.

## Structure

```
visual-editor/
├── model.js          # SongDocument: parseSong/serializeSong + pure edit ops
├── syllables.js      # view-layer tokenizer (tap targets); NOT in the model
├── palette.js        # docked chord palette (diatonic via chord-explorer/theory.js)
├── autoscroll.js     # keep the selection clear of the docked palette
├── drag-reorder.js   # pure geometry for drag-and-drop card reorder
├── section-card.js   # one section card (chords mode / lyrics mode)
└── visual-editor.js  # orchestrator: selection, undo/redo, rendering
```

## Data model

A line is `{ lyrics, chords: [{chord, position}] }` — the same shape as
`chords.js parseLineWithChords`. Chords anchor to CHARACTER OFFSETS
(ChordPro's native anchor). Syllables are render-time tap targets only.

Round-trip invariant (tested against 300 real works):
`serializeSong(parseSong(x))` equals `x` after normalization (trailing
whitespace, blank-line runs). Untouched chords keep their exact offsets;
unknown directives ride through as passthrough sections / opaque lines.

## Interactions

Tap a syllable → docked palette (diatonic chips, recents, More… picker with
a free-text input for pointer users). Tap a chip → same palette in edit mode
with ✕ Remove. Desktop extras:

- **Ghost-chip typed entry**: with a syllable or chip selected, typing a
  chord letter (A–G) starts a ghost chip at the chord position — dashed,
  dimmed, live-updating as keys accumulate (`Eb7`, `D/F#`, ...). Keystrokes
  are captured at the document keydown listener; no input is focused (so no
  mobile keyboard, and re-renders can't drop focus). ~800ms after the last
  keystroke a valid chord auto-commits through the same path as a palette
  pick (`isValidChord` in `chords.js` gates it; invalid text idles in a
  red invalid style and never commits). Enter commits immediately; Escape
  cancels; Backspace edits. On an existing chord, backspacing to empty and
  committing deletes it.
- **Resume grace**: typing again within ~1.5s of an auto-commit on the same
  chord resumes it ('E' commits, then 'b7' makes it Eb7, not a new B7).
- **Space/Tab advance**: Space/Tab moves the selection to the next syllable
  (Shift+Tab backward), wrapping across lines within the section — spam
  Space past syllables that don't get chords, type where one does. During
  ghost entry, Space/Tab commits first, then advances.
- **Hover ×**: on fine-pointer devices, hovering a chip reveals an ×
  that removes the chord (undoable). Mobile keeps tap-chip → ✕ Remove.
- **Shortcuts**: Cmd/Ctrl+Z undo, Shift+Cmd+Z / Ctrl+Y redo;
  Delete/Backspace removes a selected chip (when no ghost is active).

Ghost state lives in the orchestrator and is projected into
`renderSectionCard` via `ctx.ghost` — re-render safe, textContent only.

## Section reorder (drag-and-drop)

Every card header has a ⠿ drag handle (`.ve-drag-handle`, the only lift
zone). Mouse/pen: pointerdown starts the drag; touch: ~350ms long-press
lifts (early movement cancels, so swipes that start on the handle still
scroll). Pointer Events + `setPointerCapture` — not HTML5 DnD (unreliable
on touch). Cards do NOT re-render mid-drag: the lifted card follows the
pointer via a transform, a `.ve-drop-indicator` line marks the prospective
gap, and the page auto-scrolls near viewport edges (rAF loop). Drop applies
`moveSectionTo(doc, sectionId, targetIndex)` as one undo step (no-op drops
push nothing); Escape/pointercancel abort cleanly. Geometry (pointer Y +
card rects → target index / indicator Y / scroll speed) is pure in
`drag-reorder.js`. The ⋯ menu's Move up/down stays as the accessible
fallback.

## Smart paste

Both paste targets reuse the Raw editor's battle-tested pipeline, moved
verbatim to `../smart-paste.js` (`convertPastedText`: ChordU clean → Ultimate
Guitar clean → chords-over-lyrics conversion; `editor.js` re-exports it).

- **Section card (✎ Lyrics textarea)**: a paste that converts to ChordPro
  (or already is ChordPro) replaces that section via
  `spliceSectionWithParsed` — one anonymous block populates the card in
  place; multiple blank-line blocks or explicit `{sov}`/`{soc}` directives
  splice in as separate cards. One undo step; a toast reports replaced
  chords. Plain text falls through to the default textarea paste +
  blur-commit path (guard rail: a paste that parses to no lyric/chord lines
  is never intercepted).
- **Empty editor**: the empty state shows a `.ve-empty-paste` textarea; a
  whole-song paste (chord sheet, ChordPro, or plain lyrics) builds all cards
  — metadata directives included — in one undo step. Typed lyrics build on
  blur. ChordU/UG title/artist are reported to the host via `onImportMeta`,
  which fills empty title/artist inputs (same as the Raw paste handler).

## Design docs

- Spec: `docs/superpowers/specs/2026-07-01-visual-song-editor-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-visual-song-editor.md`

## Tests

- Unit: `docs/js/__tests__/visual-editor-*.test.js` (model, syllables,
  palette, section card, orchestrator)
- E2E: `e2e/visual-editor.spec.js`
