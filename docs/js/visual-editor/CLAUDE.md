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

## Design docs

- Spec: `docs/superpowers/specs/2026-07-01-visual-song-editor-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-visual-song-editor.md`

## Tests

- Unit: `docs/js/__tests__/visual-editor-*.test.js` (model, syllables,
  palette, section card, orchestrator)
- E2E: `e2e/visual-editor.spec.js`
