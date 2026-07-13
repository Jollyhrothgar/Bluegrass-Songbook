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
├── palette.js        # chord palette (diatonic via chord-explorer/theory.js)
├── popover-position.js # pure rect math: anchored-popover placement (wide layout)
├── autoscroll.js     # keep the selection clear of the docked palette
├── drag-reorder.js   # pure geometry for drag-and-drop section reorder
├── wrap-section.js   # pure make-verse/chorus text transform for the textarea
├── preview.js        # LIVE orchestrator: selection, ghost entry, sections, undo
│
│   # ---- PARKED (kept, not wired up) ----
├── section-card.js   # old card chrome: mode toggle, per-card menu, lyrics mode
└── visual-editor.js  # old card-based orchestrator (add-section footer, splits)
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

Sections render as a header row (`.ve-psec-header`: ⠿ drag handle, label,
⋯ menu) over interactive lines (`.ve-psec`, chorus indented) — no cards, no
per-section mode toggles. Passthrough blocks (ABC, unknown directives)
render read-only but keep the handle and a Delete-only menu. Each line is
a row of `.ve-seg` segments: a chord strip (`.ve-strip`, the chip container,
≥1.4em tall) over the syllable text (`.ve-syl`). The trailing `+` end slot
lives IN the chord row (`.ve-strip-end`). Every editable section ends with
a quiet `+ Add line` ghost row (`.ve-add-line`). Blank lines inside a
section render as whisper-quiet end-slot rows (`.ve-line-blank`) that wake
on hover/selection.

## Interactions

**Vertical position is the mode**: the chord strip above each line is
chord territory; the lyric text below is text territory. There is no
hidden mode — clicking a word never places a chord, and chord entry never
needs the lyrics.

**Chord row**: hovering a strip shows a faint ghost slot (`.ve-slot-ghost`)
snapped to the nearest syllable seam under the cursor (seams = token
starts from `syllables.js`, plus the line-end slot; `nearestSeamPosition`
in line-view.js picks own-vs-next by which edge is closer). Clicking
selects that offset — from there everything downstream is unchanged: chord
palette (diatonic chips, recents, More… picker), ghost-chip typed entry,
Space/Tab advance, chip tap/hover-×/Delete. The selected seam highlights
the syllable beneath it (`.ve-syl-selected`), which is what the popover
anchors to. Tap a chip → same palette in edit mode with ✕ Remove.
On wide (side-by-side, ≥800px) layouts the palette floats as a popover
anchored to the selection (`popover-position.js`: below the line, flipped
above when there's no room, shrunk with internal scroll when neither side
fits — it never covers its anchor line, and follows it on scroll/resize).
On narrow/stacked layouts it stays docked at the bottom (the mobile tap
flow depends on this).

**Lyric row = text**: clicking lyric text (or a row's bare tail / a blank
row / `+ Add line`) swaps the line for a single-line input
(`.ve-lyric-input`, same font) with the caret at the clicked character
(`caretPositionFromPoint` refines within the syllable; falls back to the
token start). While editing, typing is plain text — the document-level
chord keydown ignores editable targets. Commit on blur or click elsewhere;
Escape reverts; Tab is not trapped (focus moves on, the blur commits).
The commit path builds the section's full lyrics text (opaque lines
excluded) → `updateLyrics` (word-LCS chord re-anchoring) → one undo step;
nothing commits if the text is unchanged; dropped chords raise the undo
toast ("N chords dropped — Undo"). Committing a section this way drops its
opaque lines (documented v1 behavior); opaque lines themselves are never
editable. Enter splits the line at the caret and Backspace at position 0
merges into the previous line (caret at the join) — both commit
immediately through the EXACT structural ops `splitLine`/`mergeLines`
(chords keep their character anchors; only a text edit made before the
keystroke goes through LCS), then editing continues on the right line by
section index + line index. While an input is focused, pressing on another
strip/chip/lyric keeps focus (capture-phase mousedown preventDefault) so
the click lands and its handler commits the edit first; presses on other
chrome (menus, drag handles, the raw pane) commit via the input's blur and
may need a second click.

Every edit lands in the textarea as one undo step. Desktop extras:

- **Ghost-chip typed entry**: with a chord-row seam or chip selected, typing a
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
  and only when focus is OUTSIDE editable targets; inside the textarea and
  the lyric input the native undo applies (until commit). Delete/Backspace
  removes a selected chip.

Undo/redo is a capped stack of textarea snapshots owned by the preview;
host edits that rewrite the textarea (toolbar transpose, key select) call
`preview.pushUndoSnapshot(prevText)` first so they are one undo step too.
The toolbar buttons (`#editor-undo`/`#editor-redo`) reflect stack state.

Auto-scroll: after every render the selection is nudged clear of the docked
palette (`autoscroll.js`) on narrow layouts. In popover mode the palette
follows the target instead, so autoscroll degrades to ensure-target-visible
(no paletteEl passed).

## Section operations

- **Drag reorder**: the ⠿ handle is the only lift zone. Pointer Events +
  setPointerCapture; touch lifts after a ~350ms long-press (early movement
  = scroll, not drag). The preview never re-renders mid-drag — the lifted
  section follows the pointer via a transform, a `.ve-drop-indicator` line
  marks the gap, and an rAF loop edge-auto-scrolls the pane's scroll
  container. Drop = `moveSectionTo` → one undo step; Escape/pointercancel
  abort. Geometry is pure (`drag-reorder.js`).
- **⋯ header menu**: Rename (inline input in the header; Enter/blur commit,
  Escape cancels), Make verse/chorus/bridge/intro/outro (`setSectionType`,
  relabels + renumbers), Duplicate, Delete. Delete shows an undo toast
  ("Deleted Chorus — Undo", `.ve-toast`) wired to the orchestrator undo
  stack.
- Section ids are positional (`ps-<index>`), so EVERY section op clears the
  chip/syllable selection and hides the palette before committing — never
  guess where the selection landed after ids shift.

## Make-verse/chorus from the textarea

Selecting text in `#editor-content` reveals a mini-bar in the ChordPro pane
header (`#editor-selection-toolbar`: Make verse | Make chorus | Make
bridge). It sits at that FIXED spot rather than floating near the
selection: textareas expose no selection coordinates (measuring them needs
a mirror-div hack that fights scrolling/resize), and a bar popping in above
the text would shift the very lines being drag-selected. A click runs the
pure transform in `wrap-section.js`: extend to whole lines, strip section
directives inside the range, trim edge blank lines, auto-number the label
positionally (sections of the type above the selection), wrap in
`{start_of_X}`/`{end_of_X}`. One document-level undo step; the preview
re-renders immediately and the new block stays selected (so a second click
can re-type it).

## Smart paste

Pasting into the TEXTAREA runs the raw pipeline in `../smart-paste.js`
(ChordU clean → Ultimate Guitar clean → chords-over-lyrics conversion, with
title/artist backfill into empty metadata fields), then the preview
re-renders from the converted text. The parked card-mode paste targets
(`.ve-empty-paste`, per-card lyrics textareas) are gone.

## Parked (do not render, do not delete)

`section-card.js` (card chrome, lyrics mode) and the old orchestrator
`visual-editor.js` (add-section footer, per-card menus, blank-line splits)
are unused but kept as pattern references. `drag-reorder.js` is LIVE again
(the preview's section drag reuses its geometry).

## Design docs

- Spec: `docs/superpowers/specs/2026-07-01-visual-song-editor-design.md`
- Plan: `docs/superpowers/plans/2026-07-01-visual-song-editor.md`

## Tests

- Unit: `visual-editor-preview.test.js` (orchestrator behaviors, section
  menu/drag/toast; chord placement via chord-row strip clicks),
  `visual-editor-lyric-edit.test.js` (in-preview lyric editing:
  commit/revert/split/merge/add-line/toast/seam behavior),
  `visual-editor-wrap-section.test.js` (make-verse/chorus text transform),
  `editor-sync.test.js` (two-pane wiring in editor.js), plus the model /
  syllables / palette / autoscroll / drag-reorder suites
  (`visual-editor-model-sections.test.js` covers `updateLyrics` LCS
  re-anchoring and the exact `splitLine`/`mergeLines` ops).
- E2E: `e2e/visual-editor.spec.js` (two-pane flows, chord-row hover/click,
  lyric editing), `e2e/editor.spec.js`.
