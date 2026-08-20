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
- Renaming and reordering the instrument tracks (below)
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

### Tracks: the name IS the id, and the order IS the lead

Both track edits live in the toolbar's **Track** section, beside the
switcher — the only other place a track is chosen or named. No key
bindings: choosing a track never had one, and these are
once-per-document edits, not entry-speed ones.

| | rename (✏️) | reorder (◀ ▶) |
|---|---|---|
| **facade op** | `renameTrack(trackId, newId)` | `moveTrack(trackId, toIndex)` |
| **state wrapper** | `renameTrack(newId)` | `moveTrack(delta)` |
| **UI** | `TrackNamePopover` in `popover.js` | two toolbar buttons |
| **recorder** | `renameTrack` | `moveTrack` |

**A rename edits the `id`, and there is no alternative.** A track has no
display-name field: the id is what `renderers/tablature.js` prints on the
stave's track-info row, what work-view's mixer and percussion placeholder
print, and what the editor's own switcher shows. A name stored anywhere
else would be invisible on the site.

- **`notation` is keyed by track id, so the notation moves with it** —
  `renameTrack` rebuilds the object in key order, putting the renamed key
  back exactly where it was. Miss this and the track's music vanishes;
  `validate_otf` in `scripts/lib/process_pending.py` would reject the
  submission with "track X: no notation". (Real files' notation key order
  is NOT the `tracks[]` order — 27493 keys guitar/bass/banjo/mandolin for
  tracks guitar/bass/mandolin/banjo — so never rebuild it from `tracks`.)
- **Duplicate ids are refused** (they'd collide in `notation`). The popover
  disables Save and says which track owns the name; the facade throws as a
  backstop. Names are cleaned by `sanitizeTrackId` — spaces and mixed case
  are kept, `< > & " ' \` and control chars are not, because the renderer
  interpolates a track id into innerHTML unescaped.
- **Undo of a rename re-points the facade.** `_reconcileTrack` runs after
  every history swap: a stale `trackId` would make the next `getNotation()`
  *mint* an empty bucket under the dead name. EditorState follows via the
  facade's `trackChange`.

**A reorder moves `tracks[]` and nothing else.** `notation` is keyed, not
positional — reordering it would be churn with no meaning. Order is
load-bearing anyway: work-view takes its lead as the first *pitched* track
(`pitched[0]?.id`) unless the part instrument names one, `resolveEditTrackId`
and `EditingFacade` fall back to `tracks[0]`, and the song page stacks the
staves in `tracks[]` order. "Make this the lead" really is "move it first".

`role` is **not** where lead-ness lives, despite the name: it comes from
the TEF importer's instrument guess (`banjo`/`mandolin` → `lead`, else
`rhythm`), so red-haired-boy's ensemble has three tracks claiming `lead`
and work-view treats it as a hint next to position, never as the answer.
Neither op touches it. `tablature_parts[].tracks` in the index is a *count*
of non-percussion tracks, so neither op moves it either.

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
├── toolbar.js         # Track / duration / grid / articulation / text / edit buttons
├── popover.js         # NoteEntryPopover + AnnotationPopover + TrackNamePopover
├── context-menu.js    # Right-click menu
├── actions.js         # Document-level helpers (validate, cleanup, download)
├── recorder.js        # Record/replay of edit events
├── work-edit.js       # The work-page edit SESSION (mount, apply, exit, submit)
└── tab-drafts.js      # Per-(work, part) localStorage drafts of a live edit
```

## Editing a tab on a work page is a stand-alone session

`work-edit.js` + `work-view.js enterTabEditMode` own this, and the shape is
deliberate — it was rebuilt after edits went missing when someone clicked
another part mid-edit:

- **One part, one session.** `body.tab-editing` (set by work-view's
  `setEditingLayout`) hides the part tabs, the pill row, the title row and
  the arrangement bar. Edit mode edits the part you opened it on, and leaving
  the part switcher live both said otherwise and destroyed the session when
  clicked.
- **The window is the frame.** The session mounts the editor with
  `fillHeight: true` and the page stops scrolling, so the shell's top band
  (carrying the session's own Done / Cancel / Download / Submit, hoisted
  there via `hoistActions`) and the editor's toolbar + transport stay pinned.
  Same arrangement `create.html` uses for a new tab.
- **Every change is drafted.** `onChange` → `saveTabDraft` on a key built from
  the work id and `otfCacheKey(part)`. Reopening that part offers the draft
  back in a banner; `session.restore(doc)` loads it AND forces the dirty flag,
  because `editor.load()` resets the undo stack that `canUndo()` reads.
  Applying, discarding or submitting clears the draft.
- **`destroy()` is still the silent path** and `teardownTablatureView` still
  calls it — but every user-driven route into it (part switch, arrangement
  switch, `openWork`, `showView`) now asks `confirmLeaveTabEdit()` first, and
  a `beforeunload` guard covers reload/close. The draft is what makes all of
  those recoverable rather than final.

**One rule holds the editor together: nothing mutates the document
except `EditingFacade`.** Its undo history is a whole-document snapshot
pair per op, so anything routed through it is undoable for free — and
anything that reaches around it is silently *not*.

## Related

- `docs/js/renderers/tablature.js` - TabRenderer class
- `docs/js/renderers/tab-player.js` - Playback engine
- `sources/banjo-hangout/CLAUDE.md` - OTF format details
