# OTF Editor

In-browser tablature editor for OpenTabFormat (OTF) files.

## Status

**Design phase** - See `DESIGN.md` for full specification.

## Quick Summary

A modal, keyboard-accelerated tablature editor inspired by vim. Two audiences:

1. **Casual users**: Click/tap to place notes, use toolbars and popovers
2. **Power users**: Vim-style keyboard shortcuts for rapid entry

### Key Features (Planned)

- Edit existing tabs from the site
- Create new tabs
- Support for 5-string banjo (MVP), then guitar, mandolin, bass
- Articulations: hammer-on, pull-off, slide, tie
- Triplet entry with visual feedback
- Roll mode for quick picking pattern entry (banjo)
- Undo/redo, copy/paste
- Placed free text: section labels, playing notes and chord names (below)
- Mobile-friendly touch interface

### Placed text vs. "annotation mode" — two different things

The word is overloaded, and getting it wrong sends you to the wrong file:

| | per-note marks | placed free text |
|---|---|---|
| **what** | fingering (`T`/`I`/`M`), technique | "PART A", "Long Choke", "Bb6+9" |
| **stored** | on the note (`finger`, `tech`) | `otf.annotations[]` — top level, `{measure, tick, text}` |
| **reached by** | `A` (ANNOTATION mode) | `c` / `C` in NORMAL mode |
| **facade ops** | `setFingering`, `setArticulation` | `addAnnotation` / `setAnnotationText` / `deleteAnnotation` / `findAnnotationIndex` |

Placed text is score-level, not track-level: one array for the whole
document, positioned by written measure + tick, drawn above the staff by
`renderers/tablature.js`. Chord names live there too, so `c` is also how
you write chords over a tab.

- `c` opens the prompt (`AnnotationPopover` in `popover.js`), pre-filled
  with whatever is within a beat of the cursor; `C` deletes it; the
  toolbar's **Text** section (Aa / ⌫) is the mouse path to both.
- **Empty text deletes** — text is trimmed, and a blank one is never
  stored (you could never click or find it again).
- Two annotations may share one `(measure, tick)`, so they are addressed
  by INDEX. `state.getAnnotationAtCursor()` returns `{index, annotation}`.
- Everything routes through the facade, so undo/redo covers text and
  notes in one stack, and a document you only read round-trips
  byte-identical (adds splice into score order without reordering).

## Architecture

Wraps existing `TabRenderer` with editing capabilities:

```
OTFEditor
├── TabRenderer (existing) - renders OTF to SVG
├── CursorOverlay - shows cursor position
├── NoteEntryPopover - UI for entering notes
├── Toolbar - duration, articulation buttons
└── EditorState - manages document, cursor, history
```

## Implementation Phases

1. **Foundation**: Basic editor, cursor, note entry popover, save/load
2. **Articulations**: h/p//, triplets, ties, undo/redo
3. **Power User**: Roll mode, visual mode, macros
4. **Integration**: Edit site tabs, submit corrections
5. **Multi-Instrument**: Guitar, mandolin, bass support

## Files

```
docs/js/otf-editor/
├── DESIGN.md          # Full specification (read this first)
├── CLAUDE.md          # This file
├── editor.js          # OTFEditor — wires everything together
├── state.js           # UI-session state (cursor, mode, grid) over the facade
├── facade.js          # UI-free document API: ALL mutations + undo history
├── cursor.js          # Cursor/grid/selection overlays and navigation
├── keyboard.js        # Modal vim-style key bindings
├── toolbar.js         # Duration / grid / articulation / text / edit buttons
├── popover.js         # NoteEntryPopover + AnnotationPopover (click/tap entry)
├── context-menu.js    # Right-click menu
├── actions.js         # Document-level helpers (validate, cleanup, download)
└── recorder.js        # Record/replay of edit events
```

**One rule holds the editor together: nothing mutates the document
except `EditingFacade`.** Its undo history is a whole-document snapshot
pair per op, so anything routed through it is undoable for free — and
anything that reaches around it is silently *not*.

## Related

- `docs/js/renderers/tablature.js` - TabRenderer class
- `docs/js/renderers/tab-player.js` - Playback engine
- `sources/banjo-hangout/CLAUDE.md` - OTF format details
