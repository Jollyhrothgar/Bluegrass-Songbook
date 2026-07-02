# Visual Song Editor — Design

**Date:** 2026-07-01
**Branch:** `feature/visual-editor`
**Status:** Approved design, pre-implementation

## Problem

Editing or adding a song currently requires writing raw ChordPro syntax in a
textarea. That's a barrier for most of the bluegrass community. We want a
visual, mobile-first editor where users place chords on lyrics by tapping and
organize songs into sections — while keeping the raw ChordPro editor for power
users.

## Goals

- First-class on mobile: tap-driven, native text input, no required drag gestures.
- Equally good for correcting the ~18k imported songs and authoring new ones.
- Never corrupt or silently rewrite song content; untouched content round-trips
  byte-exact.
- Reuse the existing parse/theory/save infrastructure; do not add a third
  ChordPro parser variant.

## Non-Goals (v1)

- Drag-and-drop chord placement (tap covers it; drag is a later desktop enhancement).
- Editing ABC notation blocks or `{comment}` directives (passthrough to Raw tab).
- Nashville-number display inside the editor.
- Audio preview of chords.
- Touch-drag section reordering (up/down buttons instead).
- Consolidating the Raw tab's legacy monospace preview renderer (follow-up cleanup).

## Key Facts From the Codebase and Data

- The canonical line model everywhere (JS `chords.js:parseLineWithChords`,
  Python `parser.py:ChordPosition`) is
  `{ lyrics: string, chords: [{chord, position}] }` where `position` is a
  character offset into the stripped lyric string. Persisted format is
  inline-bracket ChordPro text.
- Real data anchors chords mid-word constantly (`D[D/F]own` = chord over "own")
  and source lyrics already carry hyphen syllable splits (`sen-ses`).
- Chord vocabulary is overwhelmingly simple/tonal (C, G7, G, F, D7, Am, Em, Dm
  dominate); `chord-explorer/theory.js:getDiatonicChords` can drive a smart palette.
- Most imported songs are flat `{start_of_verse}` blocks; chorus/bridge
  structure is rare in the data, so section tooling must make structure easy to add.
- Save flows already exist and must be reused unchanged: trusted users upsert
  to Supabase `pending_songs` + auto-commit edge function; regular users create
  a GitHub issue via `create-song-issue` (`editor.js:1031`, `editor.js:1143`).
- `chord-explorer/grid.js` has a working HTML5 drag-drop reference for the
  future drag enhancement.

## Design Decisions (settled with user)

1. **Anchoring granularity:** chords anchor to **syllables**, not characters.
2. **Placement interaction:** **tap syllable → tap chord in a docked palette.**
3. **Section model:** **block cards** (Notion-style stack of section cards).
4. **Lyric editing:** **per-card mode toggle** — Chords mode (syllable cells +
   palette, text locked) vs Lyrics mode (plain textarea, native input).
5. **Relationship to raw editor:** **Visual | Raw tabs** on the existing editor
   panel, two-way synced; **Visual is the default**.

## Data Model

The editing source of truth is an in-memory **SongDocument**:

```js
{
  metadata: {
    title, artist, composer, key, /* ... */
    passthrough: [ /* raw metadata lines we don't model, emitted verbatim */ ]
  },
  sections: [
    {
      id,                       // stable within the session (for DOM/undo)
      type: 'verse' | 'chorus' | 'bridge' | 'intro' | 'outro',
      label: 'Verse 1',
      lines: [
        {
          syllables: [ { text: 'sen' }, { text: '-ses' }, /* ... */ ],
          chords: [
            {
              chord: 'F',
              syllableIndex: 0,     // syllables.length = end-of-line anchor
              originalOffset: 12    // char offset from parse; null once moved
            }
          ]
        }
      ]
    },
    { id, type: 'passthrough', raw: '{start_of_abc}...{end_of_abc}' }
  ]
}
```

### Syllable seams

Seams come from four merged sources:

1. Whitespace (word boundaries).
2. Existing hyphens in the lyric text (`sen-ses`).
3. A lightweight heuristic syllabifier. Its seams are real tap targets
   (rendered subtly, e.g. a faint dot on selection), not just hints — otherwise
   chords could only land on word starts. Heuristic seams do not alter the
   lyric text; a chord placed at one serializes at that character offset.
4. **Existing chord offsets on load** — a chord parsed mid-word *forces* a seam
   at its offset (`D[D/F]own` → syllables `D` + `own`, chord anchored to `own`).

Rule 4 makes the model an honest representation of the file: junk placements
surface visually as odd seams for a human to fix, instead of being silently
"corrected" across 18k songs.

### Round-trip guarantee

- **Parse:** reuse `parseChordPro` (song-view.js) for document structure and
  `parseLineWithChords` (chords.js) per line; then tokenize syllables and
  attach chords by offset.
- **Serialize:** insert `[chord]` brackets right-to-left. A chord whose
  `originalOffset` is set (never moved by the user) serializes at that exact
  offset; a moved/new chord serializes at its anchor syllable's start offset.
  Sections emit `{start_of_X: label}` / `{end_of_X}`; metadata emits in project
  order (title, artist, composer, key, tempo, `x_*`); passthrough nodes emit
  verbatim.
- **Invariant (tested):** `serialize(parse(text)) === text` for lyric lines and
  chord positions on untouched content. A user who fixes one chord produces a
  one-character diff.

### Edge cases

- **Chord-only lines** (intros/turnarounds like `[G] [C] [D7]`): a line with no
  lyric text renders as a row of chord chips in array order. Existing chords
  serialize at their `originalOffset`; chords added to such a line append to
  the array and serialize space-separated after the last chord.
- **Trailing chords** after the last syllable: anchor `syllableIndex ===
  syllables.length`.
- **Chords anchored in whitespace:** preserved via `originalOffset`; if moved,
  they snap to a syllable start (renders identically in the song view).
- **Blank lines inside sections:** preserved as empty line nodes.

### Lyric edits under chords

When a card's lyrics change in Lyrics mode, re-tokenize and remap chord anchors
by diffing old→new words. Chords on deleted words are removed with an undoable
toast ("2 chords removed with deleted lyrics — Undo"). Never silent.

### Undo/redo

Snapshot the sections array on each edit operation (capped stack, ~50 entries).

## Module Layout

```
docs/js/visual-editor/
├── model.js          # parse (ChordPro → SongDocument), serialize, pure edit ops:
│                     #   placeChord, moveChord, removeChord, changeChord,
│                     #   setSectionType, relabelSection, addSection, deleteSection,
│                     #   reorderSection, updateLyrics (with re-anchoring)
├── syllables.js      # tokenizer: whitespace + hyphens + heuristic + chord-offset seams
├── palette.js        # bottom-docked chord palette:
│                     #   diatonic chords for detected key (chord-explorer/theory.js),
│                     #   recents used in this song, "More…" root×quality picker,
│                     #   free-text entry for anything else
├── section-card.js   # one section card: header (tap to change type/label),
│                     #   Lyrics/Chords mode toggle, syllable rows or textarea,
│                     #   card menu (duplicate, delete, move up/down, collapse)
├── visual-editor.js  # orchestrator: mounts cards, selection state, undo stack,
│                     #   tab sync, transpose integration
└── CLAUDE.md
```

### Integration with the existing editor

- `docs/index.html`: the editor panel (`#editor-panel`) gains **Visual | Raw**
  tabs. Raw tab = today's textarea + smart-paste pipeline, untouched. Visual is
  default.
- Tab sync: Visual→Raw serializes the model into the textarea; Raw→Visual
  re-parses the textarea into a fresh model.
- Save/submit (`submitAsTrustedUser`, `submitToGitHubIssue`, auto-commit
  trigger) is extracted from `editor.js` into a shared `editor-submit.js`;
  both tabs call it with a ChordPro string. Behavior unchanged.
- Title/artist/composer/key metadata fields stay above the tabs, shared.
- Smart paste (Ultimate Guitar / ChordU cleanup) continues to land in the raw
  text path; pasting into the visual editor's Lyrics mode is plain text.
- Rendering uses the song view's `.cl-segment` / `.cl-chord` inline-block
  visual language — the editor *is* the preview. Do not extend the legacy
  monospace preview renderer in `editor.js`.

## Interaction Design

### Chords mode (default per card)

- Tap a syllable → it highlights; palette slides up from the bottom.
- Tap a chord in the palette → chip appears above the syllable.
- Tap an existing chip → selected: palette opens to replace; ✕ deletes;
  tapping another syllable moves the chip there.
- Transpose up/down buttons run `transposeChord` over every chord in the model.
- Key detection (`detectKey`) drives the palette's diatonic row; user can pin key.

### Sections

- Song = stack of cards. Card header shows type + label; tap → menu to change
  type (Verse/Chorus/Bridge/Intro/Outro) and edit label. Auto-numbering for new
  verses ("Verse 3").
- Card menu: duplicate, delete, move up/down, collapse.
- "⊕ Add section" at the bottom with a type picker.
- Pasted multi-paragraph lyrics (Lyrics mode / new song) auto-split into
  section cards on blank lines.

### Lyrics mode

- Plain `<textarea>` per card: native keyboard, autocorrect, paste.
- On toggle back (or blur), re-tokenize and re-anchor chords (see above).

### Mobile specifics

- Cards full-width, collapsible (headers scannable on long songs).
- Palette is a sticky bottom sheet sized for thumbs.
- No gesture requires drag or long-press in v1.

## Error Handling & Safety

- Lenient parse: unrepresentable content ({comment}, ABC blocks, unknown
  directives, x_* meta) becomes passthrough nodes — shown as non-editable gray
  rows ("ABC notation — edit in Raw tab"), emitted verbatim on save.
- Nothing is ever dropped silently; destructive lyric edits produce undoable
  toasts.
- Raw tab is the escape hatch for anything the visual editor can't express.

## Testing

- **Vitest (bulk of coverage)** — `model.js` and `syllables.js` are pure:
  - Round-trip fixtures from real `works/` songs: Annie's Song (hyphen splits),
    Believe (mid-word chords, slash chords, chorus/bridge), an intro-heavy song
    (chord-only lines), an ABC fiddle tune (passthrough).
  - Property-style test: `serialize(parse(x)) === x` over a few hundred sampled
    works.
  - Every edit operation; lyric-edit re-anchoring including chord-drop cases.
- **Playwright E2E** — extend `e2e/editor.spec.js`:
  - Open existing song → visual editor → tap syllable → place chord → Raw tab
    shows the bracket → save flow fires.
  - Section add / retype / reorder.
  - Tab-switch sync both directions.
  - One mobile-viewport run of the core placement flow.

## Implementation Notes

- Follow the "Adding a Feature" flow in `docs/js/CLAUDE.md` (state in state.js,
  DOM refs in main.js, styles in style.css).
- `editor.js` extraction (save flow → `editor-submit.js`) should be a separate,
  behavior-preserving commit before the visual editor lands.
- Analytics: reuse `trackEditor` / `trackSubmission` with a mode dimension
  (visual vs raw) so we can see adoption.
