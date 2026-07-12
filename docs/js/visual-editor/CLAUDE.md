# Visual Editor (Interactive Preview)

The editor panel is TWO PANES: the raw ChordPro textarea (`#editor-content`,
left/top) and a live interactive preview (right/bottom, mounted on
`#editor-preview-container` by `editor.js`). The textarea is THE document:

- The preview is a pure projection — `render(parseSong(textarea.value))`.
- Every preview-side edit runs: parse current text → pure model op →
  `serializeSong` → write textarea → re-parse → re-render. Metadata and
  unknown directives ride through untouched (round-trip invariant), so the
  panes can never disagree and no document state survives across edits.
- Typing in the textarea re-renders the preview debounced (~200ms),
  preserving the preview pane's scroll; preview edits write the textarea
  without touching focus. Sync is one-way per edit (the preview's
  `onChange` only refreshes editor chrome — key select, progressive
  toolbar — never the preview itself), so there are no update loops.

New-song entry is content-first: Add Song / `#add` land here with an empty
textarea whose placeholder carries the paste/type guidance; pasting a chord
sheet into the textarea smart-converts (pipeline in `../smart-paste.js`).
The preview's empty state shows quiet "Upload a photo instead" (login-gated)
and "Request a song" links supplied by main.js. Metadata (title/artist/
writer) stays behind the compact tap-to-expand line; undo/redo buttons and
the transpose/key/Nashville group (hidden until the song has a chord) sit
in `#editor-toolbar` above the panes.

## Structure

```
visual-editor/
├── model.js          # SongDocument: parseSong/serializeSong + pure edit ops
├── syllables.js      # view-layer tokenizer (tap targets); NOT in the model
├── line-view.js      # shared line renderer: chord chips over syllable targets
├── palette.js        # docked chord palette (diatonic via chord-explorer/theory.js)
├── autoscroll.js     # keep the selection clear of the docked palette
├── preview.js        # LIVE orchestrator: selection, ghost entry, undo, render
│
│   # ---- PARKED (kept, not wired up; next round may revive on the preview) ----
├── section-card.js   # card chrome: header, mode toggle, per-card menu, lyrics mode
├── drag-reorder.js   # pure geometry for drag-and-drop reorder
└── visual-editor.js  # old card-based orchestrator (add-section footer, drag, splits)
```

## Data model

A line is `{ lyrics, chords: [{chord, position}] }` — the same shape as
`chords.js parseLineWithChords`. Chords anchor to CHARACTER OFFSETS
(ChordPro's native anchor). Syllables are render-time tap targets only.

Round-trip invariant (tested against 300 real works):
`serializeSong(parseSong(x))` equals `x` after normalization (trailing
whitespace, blank-line runs). Untouched chords keep their exact offsets;
unknown directives ride through as passthrough sections / opaque lines.

Section identity in the preview is positional: after every parse, ids are
normalized to `ps-<index>`, so a selection survives re-parses as long as it
still resolves (section/line/chord bounds are re-checked on refresh).

## Preview rendering

Sections render as label headers (`.ve-section-label`) over chord-chip
lines (`.ve-psec`, chorus indented) — no cards, no per-section mode
toggles. Passthrough blocks (ABC, unknown directives) render read-only.
The preview is ALWAYS chord-interactive; there is no lyrics mode — lyrics
are edited in the textarea.

## Interactions

Tap a syllable → docked palette (diatonic chips, recents, More… picker with
a free-text input). Tap a chip → same palette in edit mode with ✕ Remove.
Every edit lands in the textarea as one undo step. Desktop extras:

- **Ghost-chip typed entry**: with a syllable or chip selected, typing a
  chord letter (A–G) starts a ghost chip at the chord position — dashed,
  dimmed, live-updating as keys accumulate (`Eb7`, `D/F#`, ...). Keystrokes
  are captured at the document keydown listener; no input is focused (so no
  mobile keyboard, and re-renders can't drop focus). ~800ms after the last
  keystroke a valid chord auto-commits through the same path as a palette
  pick (`isValidChord` gates it; invalid text idles in a red invalid style
  and never commits). Enter commits immediately; Escape cancels; Backspace
  edits. On an existing chord, backspacing to empty and committing deletes.
- **Resume grace**: typing again within ~1.5s of an auto-commit on the same
  chord resumes it ('E' commits, then 'b7' makes it Eb7, not a new B7).
- **Space/Tab advance**: Space/Tab moves the selection to the next syllable
  (Shift+Tab backward), wrapping across lines within the section. During
  ghost entry, Space/Tab commits first, then advances.
- **Hover ×**: on fine-pointer devices, hovering a chip reveals an × that
  removes the chord (undoable). Mobile keeps tap-chip → ✕ Remove.
- **Shortcuts**: Cmd/Ctrl+Z undo, Shift+Cmd+Z / Ctrl+Y redo — document-level
  and only when focus is OUTSIDE editable targets; inside the textarea the
  native textarea undo applies. Delete/Backspace removes a selected chip.

Undo/redo is a capped stack of textarea snapshots owned by the preview;
host edits that rewrite the textarea (toolbar transpose, key select) call
`preview.pushUndoSnapshot(prevText)` first so they are one undo step too.
The toolbar buttons (`#editor-undo`/`#editor-redo`) reflect stack state.

Auto-scroll: after every render the selection is nudged clear of the docked
palette (`autoscroll.js`), scoped to the preview pane (its own scroll
container on wide screens; the page/fixed palette on narrow ones).

## Smart paste

Pasting into the TEXTAREA runs the raw pipeline in `../smart-paste.js`
(ChordU clean → Ultimate Guitar clean → chords-over-lyrics conversion, with
title/artist backfill into empty metadata fields), then the preview
re-renders from the converted text. The parked card-mode paste targets
(`.ve-empty-paste`, per-card lyrics textareas) are gone.

## Parked (do not render, do not delete)

`section-card.js` (card chrome, lyrics mode), `drag-reorder.js` geometry and
the old orchestrator `visual-editor.js` (add-section footer, per-card menus,
blank-line splits, drag) are unused but kept: the next round re-adds section
drag-reorder and make-verse/chorus actions on the preview surface.

## Design docs

- Spec: `docs/superpowers/specs/2026-07-01-visual-song-editor-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-visual-song-editor.md`

## Tests

- Unit: `visual-editor-preview.test.js` (orchestrator behaviors on the new
  surface), `editor-sync.test.js` (two-pane wiring in editor.js), plus the
  unchanged model / syllables / palette / autoscroll / drag-reorder suites.
- E2E: `e2e/visual-editor.spec.js` (two-pane flows), `e2e/editor.spec.js`.
