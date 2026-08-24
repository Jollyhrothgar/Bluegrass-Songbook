# OTF Editor Design Specification

> A modal, keyboard-accelerated tablature editor for bluegrass instruments.

**Status**: Design phase
**Target**: Phase 1 MVP for 5-string banjo
**Last updated**: 2026-01-13

## Table of Contents

1. [Vision & Goals](#vision--goals)
2. [Architecture Overview](#architecture-overview)
3. [Data Model](#data-model)
4. [User Interface Design](#user-interface-design)
5. [Input Handling](#input-handling)
6. [Keyboard Shortcuts](#keyboard-shortcuts)
7. [Core Workflows](#core-workflows)
8. [Multi-Instrument Support](#multi-instrument-support)
9. [Integration Points](#integration-points)
10. [Implementation Phases](#implementation-phases)
11. [File Structure](#file-structure)
12. [Open Questions](#open-questions)

---

## Vision & Goals

### What We're Building

A browser-based tablature editor that feels as fluid as typing text. The editor should serve two audiences:

1. **Casual users**: Click/tap to place notes, use toolbars and popovers
2. **Power users**: Vim-style modal keyboard interface for rapid entry

The key insight: **bluegrass banjo is pattern-based**. Rolls, licks, and phrases repeat with variations. The editor should make pattern entry fast.

### Design Principles

1. **UI-first, keyboard-accelerated**: Anyone can use it with mouse/touch; power users discover keyboard shortcuts
2. **Build on existing renderer**: Compose with `TabRenderer`, don't replace it
3. **Edit existing tabs**: Load any OTF from the site and modify it
4. **Multi-instrument ready**: Architecture supports guitar, mandolin, bass from day 1
5. **Mobile-friendly**: Touch targets, iPad support, responsive layout

### Non-Goals (for MVP)

- Standard music notation (staff notation) - future phase
- Audio recording/transcription
- Real-time collaboration
- MIDI input

---

## Architecture Overview

### Component Hierarchy

```
OTFEditor (new)
├── EditorToolbar
│   ├── DurationSelector
│   ├── ArticulationButtons
│   ├── TripletToggle
│   ├── UndoRedoButtons
│   └── ModeIndicator
├── EditorCanvas
│   ├── TabRenderer (existing, wrapped)
│   ├── CursorOverlay
│   ├── SelectionOverlay
│   └── GhostNotePreview
├── NoteEntryPopover
│   ├── StringSelector
│   ├── FretPad
│   └── TechniqueSelector
├── EditorStatusBar
│   ├── PositionDisplay
│   ├── TuningDisplay
│   └── KeyboardHints
└── EditorState (internal)
    ├── OTF document
    ├── Cursor position
    ├── Selection range
    ├── Edit mode
    ├── Clipboard
    └── Undo history
```

### Data Flow

```
User Input (keyboard/mouse/touch)
    ↓
InputHandler (normalizes events)
    ↓
EditorState (applies mutations)
    ↓
OTF Document (source of truth)
    ↓
TabRenderer (renders to SVG)
    ↓
CursorOverlay (renders cursor/selection)
```

### Key Classes

```javascript
// Main editor class
class OTFEditor {
  constructor(options: {
    container: HTMLElement,
    otf?: OTFDocument,           // Existing document to edit
    instrument: InstrumentType,
    onSave?: (otf: OTFDocument) => void,
    onChange?: (otf: OTFDocument) => void,
  })

  // Public API
  load(otf: OTFDocument): void
  save(): OTFDocument
  getSelection(): Selection | null
  setMode(mode: EditorMode): void
  undo(): void
  redo(): void
  destroy(): void
}

// Editor state management
class EditorState {
  otf: OTFDocument
  cursor: CursorPosition
  selection: SelectionRange | null
  mode: EditorMode
  currentDuration: Duration
  clipboard: ClipboardContent | null
  history: UndoHistory
}

// Cursor position in the document
interface CursorPosition {
  measure: number      // 1-indexed measure
  tick: number         // Position within measure (0 to ticks_per_measure)
  string: number       // 1-indexed string (1-5 for banjo)
  trackId: string      // Track identifier
}
```

---

## Data Model

### OTF Document Structure (Reference)

The editor works with the existing OTF format. Key structures:

```typescript
interface OTFDocument {
  otf_version: "1.0"
  metadata: {
    title: string
    time_signature: string    // "4/4", "2/4", etc.
    tempo: number
    composer?: string
    key?: string
  }
  timing: {
    ticks_per_beat: number    // Standard: 480
  }
  tracks: Track[]
  notation: Record<string, Measure[]>
  reading_list?: ReadingRange[]
}

interface Track {
  id: string                  // e.g., "banjo", "guitar"
  instrument: string          // e.g., "5-string-banjo"
  tuning: string[]            // e.g., ["D4", "B3", "G3", "D3", "G4"]
  capo: number
  role: "lead" | "rhythm"
}

interface Measure {
  measure: number             // 1-indexed
  events: NoteEvent[]
}

interface NoteEvent {
  tick: number                // Position in measure (0 to ticks_per_measure)
  notes: Note[]
}

interface Note {
  s: number                   // String (1-indexed)
  f: number                   // Fret (0 = open)
  tech?: "h" | "p" | "/" | "\\" | "x" | "b"  // Technique
  finger?: "T" | "I" | "M"    // Fingering annotation
  tie?: boolean               // Tied from the previous note on this string
  dur?: number                // Duration in ticks
}
```

**`~` is not a technique.** A tie is `tie: true` on the CONTINUATION note
— that is what the corpus contains (1,785 in a 400-file sample), what
`renderers/tablature.js` draws the arc from, and what `tab-player.js`
sustains. `tech: '~'` was an editor-only invention that nothing rendered
or played; `EditingFacade` now refuses it (`setArticulation(pos, '~')`
and `insertNote({tech: '~'})` are routed to `setTie`, and `load()`
converts any legacy `~` it finds). `tie` and `tech` are independent
fields — 21 corpus notes carry both `tie: true` and `tech: '/'`.

The tech vocabulary is `TECHS` in `facade.js`; anything outside it
throws rather than landing a symbol no renderer knows.

### Duration Constants

```typescript
const TICKS_PER_BEAT = 480

const DURATIONS = {
  whole: TICKS_PER_BEAT * 4,      // 1920
  half: TICKS_PER_BEAT * 2,       // 960
  quarter: TICKS_PER_BEAT,        // 480
  eighth: TICKS_PER_BEAT / 2,     // 240
  sixteenth: TICKS_PER_BEAT / 4,  // 120
  thirtySecond: TICKS_PER_BEAT / 8, // 60
  tripletEighth: TICKS_PER_BEAT / 3, // 160
} as const

type Duration = keyof typeof DURATIONS
```

### Editor-Specific Types

```typescript
type EditorMode =
  | "normal"      // Navigation, selection
  | "insert"      // Note entry
  | "visual"      // Selection mode
  | "roll"        // Quick pattern entry
  | "annotation"  // Adding fingering/technique

interface SelectionRange {
  start: CursorPosition
  end: CursorPosition
}

interface ClipboardContent {
  type: "notes" | "measures"
  data: NoteEvent[] | Measure[]
}

interface UndoHistoryEntry {
  timestamp: number
  description: string
  beforeState: OTFDocument
  afterState: OTFDocument
}
```

---

## User Interface Design

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  TOOLBAR                                                        │
│  [◀][▶] │ M:3 │ [𝅗𝅥][𝅘𝅥][♪][𝅘𝅥𝅮][𝅘𝅥𝅯] │ [3] │ [h][p][/] │ [↩][↪] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CANVAS (TabRenderer + overlays)                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Tuning: Open G (gDGBD)  Capo: 0                        │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │     │ 1       2       │ 3       4       │               │    │
│  │  1  │--0-------0------|--0h2-----0------|               │    │
│  │  2  │----0-------0----|------0-------0--|               │    │
│  │  3  │------0-------0--|--------0--------|               │    │
│  │  4  │-----------------|-----------------|               │    │
│  │  5  │0-------0--------|0-------0--------|               │    │
│  │     │        ▲        │                 │               │    │
│  │     │     cursor      │                 │               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  STATUS BAR                                                     │
│  INSERT │ Beat 1.5 │ String 3 │ Duration: ♪ eighth │ Press ? help│
└─────────────────────────────────────────────────────────────────┘
```

### Toolbar Components

#### Duration Selector
```
[𝅗𝅥] [𝅘𝅥] [♪] [𝅘𝅥𝅮] [𝅘𝅥𝅯]
 w    h    q    e    s    t
 ↑ keyboard shortcuts shown on hover
```

- Visual note symbols
- Current duration highlighted
- Keyboard hint on hover
- Click to select

#### Triplet Toggle
```
[3]  ← toggles triplet mode
```

- When active, next 3 notes form a triplet
- Visual indicator shows triplet entry state

#### Articulation Buttons
```
[h] [p] [/] [~]
 ↑ hammer-on, pull-off, slide, tie
```

- Click to apply to next note
- Shows as modifier in status bar

#### Undo/Redo
```
[↩] [↪]
 u   Ctrl+r
```

#### Track Switcher (multi-track documents)
```
TRACK  [guitar] [bass] [lead mandolin] [banjo]   [◀] [▶] [✏️]
```

- One segmented button per track, labelled by its id (which IS its name)
- ◀ / ▶ move the active track earlier / later; the first track is the lead
- ✏️ opens the rename prompt
- See "Track Name and Track Order" below for why a rename edits the id

### Note Entry Popover

Appears when user clicks/taps on the canvas to enter a note:

```
┌─────────────────────────────────────┐
│  String                             │
│  [1] [2] [3●] [4] [5]              │
│                                     │
│  Fret                               │
│  ┌───┬───┬───┐                      │
│  │ 7 │ 8 │ 9 │  [+10]               │
│  ├───┼───┼───┤                      │
│  │ 4 │ 5 │ 6 │  [+20]               │
│  ├───┼───┼───┤                      │
│  │ 1 │ 2 │ 3 │                      │
│  ├───┴───┼───┤                      │
│  │   0   │ ⌫ │                      │
│  └───────┴───┘                      │
│                                     │
│  Technique                          │
│  [h] [p] [/] [~] [none]            │
│                                     │
│  [Cancel]        [Insert ↵]         │
└─────────────────────────────────────┘
```

**Behavior:**
- Opens on double-click/tap at position
- String defaults to cursor's current string (or 3)
- Fret entry: tap number, or tap [+10]/[+20] then number
- Keyboard works while popover is open
- Enter/Insert commits and advances cursor
- Escape/Cancel closes without inserting

### Cursor Visualization

```css
/* Cursor styles */
.cursor-normal {
  /* Vertical line at tick position */
  width: 2px;
  background: var(--accent-color);
  animation: blink 1s infinite;
}

.cursor-insert {
  /* Box around current note position */
  border: 2px solid var(--accent-color);
  background: var(--accent-color-transparent);
}

.cursor-visual {
  /* Selection highlight */
  background: var(--selection-color);
}
```

### Ghost Note Preview

When in insert mode, show a preview of the note that will be inserted:

```
│  3  │------0-------[2]--|  ← ghost note at cursor
│     │           preview  │
```

- Semi-transparent
- Shows string + fret that will be entered
- Updates as user changes string/fret selection

### Mode Indicator

Prominent display of current mode:

```
┌──────────────┐
│ -- INSERT -- │  ← green background
└──────────────┘

┌──────────────┐
│ -- NORMAL -- │  ← default/gray
└──────────────┘

┌──────────────┐
│ -- VISUAL -- │  ← blue background
└──────────────┘

┌──────────────┐
│ -- ROLL --   │  ← orange background
└──────────────┘
```

### Track Name and Track Order

The complaint that produced this: *"I found that I wanted to rename /
reposition the instrument tracks. The lead track should be the 'first
one', if that makes sense."* It does — order is real, and the name is
real, and neither was editable.

Both live in the toolbar's **Track** section, right of the switcher:

```
TRACK  [guitar] [bass] [lead mandolin] [banjo]   [◀] [▶] [✏️]
                        ↑ active                   ↑ earlier / later / rename
```

Buttons, not drag: the editor has no drag vocabulary anywhere else (the
switcher is segmented buttons, phrases move by selection + clipboard),
and ◀ / ▶ read correctly against a horizontal row. No key bindings
either — choosing a track has never had one, and this is a
once-per-document edit.

**Rename edits the `id`.** A track has no display-name field, and adding
one would be inert: `renderers/tablature.js` prints `track.id` on the
stave's track-info row, work-view's mixer and percussion placeholder
print `track.id`, and the switcher prints `track.id`. The id *is* the
name, so that is what the prompt writes.

Which makes it a two-part edit, because **`notation` is keyed by track
id**:

```js
tracks:   [{id: 'mandolin', …}]        →  [{id: 'lead mandolin', …}]
notation: {mandolin: [...]}            →  {'lead mandolin': [...]}
```

Move only the first half and the track's music is gone from every
surface, and `validate_otf` (`scripts/lib/process_pending.py`, the only
structural check a submission gets) rejects it as `track X: no
notation`. `renameTrack` rebuilds the notation object in key order so
the renamed key lands back in its own slot — real files do NOT key
notation in `tracks[]` order (27493 is guitar/bass/banjo/mandolin for
tracks guitar/bass/mandolin/banjo), so it can never be rebuilt from the
track list.

`TrackNamePopover` guards the two ways a name goes wrong before the
facade is asked — blank, and a name another track already holds (which
would collide in `notation`) — with Save disabled and the reason inline.
`sanitizeTrackId` keeps spaces and mixed case and drops `< > & " ' \`
and control characters, because the renderer interpolates a track id
into innerHTML without escaping.

**Reorder moves `tracks[]` only.** `notation` is a keyed map: reordering
it would be diff churn with no meaning, so `moveTrack` does not touch
it. Order alone is what makes a track the lead:

| Consumer | Rule |
|---|---|
| `work-view.js` | `leadTrackId = pitchedTracks(otf.tracks)[0].id` unless the part instrument names one |
| `work-view.js` | staves are stacked, and the mixer listed, in `tracks[]` order |
| `work-edit.js` `resolveEditTrackId` | part instrument → `role === 'lead'` → `tracks[0]` |
| `EditingFacade` / `EditorState` | default edit track is `tracks[0]` |

`role` is **not** the answer, despite reading like it. It is the TEF
importer's instrument guess (`banjo`/`mandolin` → `lead`, everything
else → `rhythm`, drums → `percussion`), so red-haired-boy's ensemble has
three tracks claiming `lead` at once. work-view treats it as a hint
alongside position; neither track op writes it.

Rules the implementation holds to:

- **One history stack**, like every other edit: rename and reorder are
  `EditingFacade` ops with snapshot undo, so `u` / `Ctrl+R` walk them
  together with note and text edits.
- **Undo re-points the facade.** After any history swap `_reconcileTrack`
  checks that the current track still exists — undoing a rename is
  exactly when it does not — and falls back to the track now at the same
  index. Without it, the next `getNotation()` would silently *mint* an
  empty measure list under the dead name. `EditorState` and the cursor
  follow through the facade's `trackChange`.
- **The toolbar re-reads the row** on every `change` (signature-guarded,
  so note entry costs nothing), which is what makes undo of a rename
  relabel the button without any op knowing the toolbar exists.
- **Untouched means untouched.** A document that is only opened and read
  exports byte-identically; a rename changes one track's `id` and one
  notation key and nothing else; a reorder changes `tracks[]` and
  nothing else.

---

## Input Handling

### Input Priority

1. **Popover** (if open): Popover handles input
2. **Mode-specific handler**: Based on current mode
3. **Global shortcuts**: Always available (Escape, Ctrl+S, etc.)

### Mouse/Touch Handling

| Action | Result |
|--------|--------|
| Single click on canvas | Move cursor to nearest valid position |
| Double click on canvas | Open note entry popover at position |
| Click on note | Select note, move cursor there |
| Drag on canvas | Create selection (visual mode) |
| Click toolbar button | Execute action |
| Touch and hold | Open context menu (mobile) |

### Keyboard Event Flow

```javascript
handleKeyDown(event: KeyboardEvent) {
  // 1. Check for global shortcuts
  if (this.handleGlobalShortcut(event)) return

  // 2. If popover is open, delegate to popover
  if (this.popover.isOpen) {
    this.popover.handleKey(event)
    return
  }

  // 3. Delegate to mode-specific handler
  switch (this.state.mode) {
    case 'normal': this.handleNormalKey(event); break
    case 'insert': this.handleInsertKey(event); break
    case 'visual': this.handleVisualKey(event); break
    case 'roll': this.handleRollKey(event); break
    case 'annotation': this.handleAnnotationKey(event); break
  }
}
```

---

## Keyboard Shortcuts

### Global Shortcuts (Always Available)

| Key | Action |
|-----|--------|
| `Escape` | Exit to NORMAL mode / close popover |
| `Ctrl+S` | Save document |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `?` | Show keyboard shortcut help |

### Normal Mode

| Key | Action |
|-----|--------|
| `h` / `←` | Move cursor left (previous tick) |
| `l` / `→` | Move cursor right (next tick) |
| `j` / `↓` | Move cursor down (next string) |
| `k` / `↑` | Move cursor up (previous string) |
| `w` | Jump forward one beat |
| `b` | Jump backward one beat |
| `0` | Jump to start of measure |
| `$` | Jump to end of measure |
| `gg` | Jump to start of document |
| `G` | Jump to end of document |
| `{number}G` | Jump to measure number |
| `i` | Enter INSERT mode at cursor |
| `a` | Enter INSERT mode after cursor |
| `o` | Insert new measure after current, enter INSERT |
| `O` | Insert new measure before current, enter INSERT |
| `r` | Enter ROLL mode |
| `c` | Add/edit the PLACED TEXT at the cursor (opens the text prompt) |
| `C` | Delete the placed text at the cursor |
| `A` | Enter ANNOTATION mode (per-note fingering — a different thing) |
| `v` | Enter VISUAL mode |
| `x` | Delete note under cursor |
| `dd` | Delete current beat |
| `dw` | Delete to next beat |
| `D` | Delete to end of measure |
| `y` | Yank (copy) note under cursor |
| `yy` | Yank current beat |
| `yw` | Yank to next beat |
| `p` | Paste after cursor |
| `P` | Paste before cursor |
| `u` | Undo |
| `Ctrl+R` | Redo |
| `.` | Repeat last action |

### Insert Mode

| Key | Action |
|-----|--------|
| `1-5` | Select string |
| `0-9` | Enter fret digit |
| `f` | High fret prefix (then type number, e.g., `f12`) |
| `Space` | Advance cursor by current duration |
| `Enter` | Move to next measure |
| `Backspace` | Delete previous note |
| `q` | Set duration: quarter |
| `e` | Set duration: eighth |
| `s` | Set duration: sixteenth |
| `t` | Set duration: thirty-second |
| `w` | Set duration: whole |
| `h` (after duration set) | Set duration: half |
| `3` | Enter triplet mode |
| `Ctrl+H` | Add hammer-on to next note |
| `Ctrl+P` | Add pull-off to next note |
| `Ctrl+/` | Add slide to next note |
| `Ctrl+T` | Add tie to next note |
| `Escape` | Return to NORMAL mode |

### Roll Mode (Banjo-Specific)

| Key | Action |
|-----|--------|
| `T` | Play string 5 (thumb) |
| `I` | Play string 3 (index) |
| `M` | Play string 2 (middle) |
| `R` | Play string 1 (ring) |
| `P` | Pinch: strings 5 + 1 together |
| `0-9` | Fret modifier for next finger |
| `f` | High fret modifier |
| `Space` | Rest (advance without note) |
| `q/e/s/t` | Change duration |
| `Escape` | Return to NORMAL mode |

**Roll mode example:**
```
T I M T I M T I   → 8 eighth notes on strings 5-3-2-5-3-2-5-3
T2 I0 M3          → String 5 fret 2, string 3 open, string 2 fret 3
```

### Visual Mode

| Key | Action |
|-----|--------|
| `h/j/k/l` | Extend selection |
| `y` | Yank selection |
| `d` | Delete selection |
| `>` | Shift selection right by duration |
| `<` | Shift selection left by duration |
| `Escape` | Exit visual mode |

### Annotation Mode

| Key | Action |
|-----|--------|
| `t` | Add thumb fingering |
| `i` | Add index fingering |
| `m` | Add middle fingering |
| `h` | Mark as hammer-on |
| `p` | Mark as pull-off |
| `/` | Mark as slide |
| `~` | Mark as tie |
| `x` | Remove annotation |
| `Escape` | Return to NORMAL mode |

### Placed Text (the document's `annotations`)

**Two different things wear the word "annotation".** ANNOTATION *mode*
above edits per-NOTE marks (fingering, technique) stored on the note.
The document's top-level `annotations` array is something else: free
text placed at a spot in the SCORE —

```json
"annotations": [
  {"measure": 1, "tick": 0,   "text": "Press F-12 to play whole tune from beginning."},
  {"measure": 4, "tick": 960, "text": "PART A"},
  {"measure": 7, "tick": 0,   "text": "Bb6+9"}
]
```

— section banners, playing notes AND chord names, all in one array.
TEF import produces them, `renderers/tablature.js` draws them above the
staff (x-positioned by `tick` within the written measure, lane-stacked
on overlap), and the whole document is what a submission carries, so
editing them needs no pipeline change.

Editing is in NORMAL mode, not a mode of its own — placing a label is
as ordinary as placing a note:

| Key / control | Action |
|-----|--------|
| `c` | Open the text prompt at the cursor — pre-filled with the text already there (within one beat), empty otherwise |
| `C` | Delete the text at/nearest the cursor |
| Toolbar **Aa** / **⌫** (Text section) | The same two, for the mouse |
| In the prompt: `Enter` | Save |
| In the prompt: `Escape` | Cancel |
| In the prompt: clear the box, Save | **Delete** — an empty annotation is never stored |

Rules the implementation holds to:

- **Text is trimmed; empty deletes.** There is no way to leave a blank
  label behind, because a blank one can never be clicked or found again.
- **Two annotations may share one (measure, tick)** — Welcome to New
  York m14 carries both "PART B" and "F" — so they are addressed by
  INDEX. `c` reaches the first at that spot; delete it and `c` reaches
  the next.
- **Reach is one beat.** `c` on empty ground adds; `c` within a beat of
  an existing label edits that one. The status bar's `Text:` field says
  which label `c` would hit before you press it.
- **One history stack.** Every write goes through `EditingFacade`'s
  snapshot undo, so `u` / `Ctrl+R` step through text and note edits
  together, in the order you made them.
- **Untouched means untouched.** Adds splice into score order without
  reordering existing entries; edits mutate one entry in place. A
  document that is only read round-trips byte-identical.

---

## Core Workflows

### Workflow 1: Enter a Simple Note

**Via UI:**
1. Click on canvas at desired position
2. Double-click to open popover
3. Tap string button (e.g., [3])
4. Tap fret button (e.g., [2])
5. Click [Insert]

**Via Keyboard:**
1. Navigate with `h/j/k/l` to position
2. Press `i` for insert mode
3. Type `3` (string) then `2` (fret)
4. Press `Space` to advance

### Workflow 2: Enter a Forward Roll (Scruggs)

**Pattern:** T I M T I M T I (eighth notes on strings 5-3-2-5-3-2-5-3)

**Via Roll Mode:**
1. Press `r` to enter roll mode
2. Type: `T I M T I M T I`
3. Press `Escape` to exit

**Result:** 8 notes entered in ~2 seconds

### Workflow 3: Enter a Triplet

**Via UI:**
1. Click [3] triplet toggle in toolbar
2. Visual shows three slots: `[_] [_] [_]`
3. Enter first note (string 3, fret 0)
4. Enter second note (string 2, fret 0)
5. Enter third note (string 1, fret 0)
6. Triplet auto-completes

**Via Keyboard (Insert mode):**
1. Press `3` to enter triplet mode
2. Type: `3 0 Space 2 0 Space 1 0`
3. Triplet inserted, cursor advances

### Workflow 4: Add Articulation to Existing Note

**Scenario:** Mark a note as hammer-on destination

**Via UI:**
1. Click on the note
2. Click [h] in toolbar

**Via Keyboard:**
1. Navigate to note with `h/j/k/l`
2. Press `A` for annotation mode
3. Press `h` for hammer-on
4. Press `Escape`

### Workflow 5: Copy/Paste a Measure

**Via Keyboard:**
1. Navigate to measure
2. Press `yy` to yank the beat (or `yw` for beat, measure)
3. Navigate to destination
4. Press `p` to paste

### Workflow 6: Edit Existing Tab from Site

1. View a work with tablature
2. Click "Edit Tab" button
3. Editor opens with OTF loaded
4. Make changes
5. Click "Save" or "Submit Correction"

---

## Multi-Instrument Support

### Instrument Configuration

```typescript
interface InstrumentConfig {
  id: string
  displayName: string
  strings: number
  defaultTuning: string[]
  fretRange: [number, number]
  rollFingers?: Record<string, number>  // Optional roll mode mapping
  stringLabels?: string[]               // Optional custom labels
}

const INSTRUMENTS: Record<string, InstrumentConfig> = {
  '5-string-banjo': {
    id: '5-string-banjo',
    displayName: '5-String Banjo',
    strings: 5,
    defaultTuning: ['D4', 'B3', 'G3', 'D3', 'G4'],
    fretRange: [0, 24],
    rollFingers: { T: 5, I: 3, M: 2, R: 1, P: [5, 1] },
  },

  '6-string-guitar': {
    id: '6-string-guitar',
    displayName: 'Guitar',
    strings: 6,
    defaultTuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    fretRange: [0, 24],
    rollFingers: { T: 6, I: 3, M: 2, R: 1, P: 5 },
  },

  'mandolin': {
    id: 'mandolin',
    displayName: 'Mandolin',
    strings: 4,
    defaultTuning: ['E5', 'A4', 'D4', 'G3'],
    fretRange: [0, 20],
    // No roll mode - mandolin uses different picking patterns
  },

  'upright-bass': {
    id: 'upright-bass',
    displayName: 'Upright Bass',
    strings: 4,
    defaultTuning: ['G2', 'D2', 'A1', 'E1'],
    fretRange: [0, 12],
    stringLabels: ['G', 'D', 'A', 'E'],  // Position markers instead of frets
  },

  'tenor-banjo': {
    id: 'tenor-banjo',
    displayName: 'Tenor Banjo',
    strings: 4,
    defaultTuning: ['A4', 'D4', 'G3', 'C3'],
    fretRange: [0, 22],
  },

  'dobro': {
    id: 'dobro',
    displayName: 'Dobro/Resonator',
    strings: 6,
    defaultTuning: ['D4', 'B3', 'G3', 'D3', 'B2', 'G2'],  // Open G
    fretRange: [0, 24],
  },
}
```

### Instrument-Specific Behavior

| Instrument | Keyboard Numbers | Roll Mode | Special |
|------------|-----------------|-----------|---------|
| 5-string banjo | 1-5 for strings | Yes (T/I/M/R/P) | String 5 is drone |
| Guitar | 1-6 for strings | Yes (T/I/M/R) | Standard 6-string |
| Mandolin | 1-4 for strings | No | Paired strings |
| Bass | 1-4 for strings | No | Position-based |

### Adapting Keyboard Shortcuts

```typescript
function getStringKey(instrument: InstrumentConfig, keyCode: string): number | null {
  const num = parseInt(keyCode)
  if (isNaN(num)) return null
  if (num >= 1 && num <= instrument.strings) return num
  return null
}
```

---

## Integration Points

### Loading from Existing Work

```typescript
// In work-view.js or similar
async function openEditorForWork(workSlug: string, partIndex: number) {
  const work = await fetchWork(workSlug)
  const part = work.parts[partIndex]

  if (part.format !== 'opentabformat') {
    throw new Error('Can only edit OTF tablature')
  }

  const otfPath = part.file
  const otf = await fetch(otfPath).then(r => r.json())

  const editor = new OTFEditor({
    container: document.getElementById('editor-container'),
    otf: otf,
    instrument: part.instrument,
    onSave: (updatedOtf) => submitCorrection(workSlug, partIndex, updatedOtf),
  })
}
```

### Saving / Submitting Changes

```typescript
interface SaveOptions {
  mode: 'download' | 'submit-correction' | 'save-draft'
}

async function handleSave(otf: OTFDocument, options: SaveOptions) {
  switch (options.mode) {
    case 'download':
      downloadAsJson(otf, `${otf.metadata.title || 'untitled'}.otf.json`)
      break

    case 'submit-correction':
      // Create GitHub issue via Supabase edge function
      await submitTabCorrection(otf)
      break

    case 'save-draft':
      // Save to localStorage
      localStorage.setItem(`otf-draft-${otf.metadata.title}`, JSON.stringify(otf))
      break
  }
}
```

### URL Routing

```
#edit-tab/{work-slug}           → Edit existing work's tab
#edit-tab/{work-slug}/{part}    → Edit specific part
#new-tab                        → Create new tab
#new-tab?instrument=mandolin    → Create new tab for specific instrument
```

---

## Implementation Phases

### Phase 1: Foundation (MVP)

**Goal:** Basic working editor for 5-string banjo

**Deliverables:**
- [ ] `OTFEditor` class with basic lifecycle
- [ ] `EditorState` with cursor, mode, OTF document
- [ ] Integration with existing `TabRenderer`
- [ ] Cursor overlay rendering
- [ ] Click-to-position cursor
- [ ] Note entry popover (UI-driven)
- [ ] Basic keyboard navigation (h/j/k/l)
- [ ] INSERT mode with string+fret entry
- [ ] Duration selection (toolbar + keyboard)
- [ ] Save/download OTF JSON
- [ ] Status bar with position and mode

**Files to create:**
```
docs/js/otf-editor/
├── editor.js           # Main OTFEditor class
├── state.js            # EditorState management
├── cursor.js           # Cursor rendering and logic
├── popover.js          # Note entry popover
├── toolbar.js          # Toolbar component
├── keyboard.js         # Keyboard event handling
├── actions.js          # Edit actions (insert, delete, etc.)
└── index.js            # Public exports
```

**Estimated scope:** ~1500-2000 lines of JS

### Phase 2: Articulations & Flow

**Goal:** Support all OTF note features, improve editing flow

**Deliverables:**
- [ ] Hammer-on, pull-off, slide entry
- [ ] Tie support
- [ ] Triplet mode with visual slots
- [ ] Undo/redo with history
- [ ] Copy/paste (notes, beats, measures)
- [ ] Ghost note preview
- [ ] Improved keyboard navigation (w/b, 0/$, gg/G)
- [ ] Delete operations (x, dd, dw, D)

### Phase 3: Power User Mode

**Goal:** Full vim-style editing for power users

**Deliverables:**
- [ ] ROLL mode for rapid pattern entry
- [ ] VISUAL mode for selection
- [ ] ANNOTATION mode for fingering
- [ ] Repeat last action (.)
- [ ] Macros for common patterns
- [ ] Keyboard shortcut help overlay

### Phase 4: Platform Integration

**Goal:** Integrate with Bluegrass Songbook site

**Deliverables:**
- [ ] "Edit Tab" button on work view
- [ ] Load existing OTF from works
- [ ] Submit corrections workflow
- [ ] Auto-save drafts to localStorage
- [ ] URL routing (#edit-tab/...)
- [ ] Mobile touch optimization

### Phase 5: Multi-Instrument

**Goal:** Support guitar, mandolin, bass

**Deliverables:**
- [ ] Instrument configuration system
- [ ] Guitar tab editing
- [ ] Mandolin tab editing
- [ ] Bass tab editing
- [ ] Instrument-specific keyboard mappings
- [ ] Multi-track editing (Phase 5b)

---

## File Structure

```
docs/js/otf-editor/
├── DESIGN.md              # This document
├── index.js               # Public exports
├── editor.js              # OTFEditor main class
├── state.js               # EditorState, history, clipboard
├── cursor.js              # Cursor position, rendering
├── selection.js           # Selection range handling
├── canvas.js              # Canvas wrapper around TabRenderer
├── popover.js             # Note entry popover component
├── toolbar.js             # Toolbar component
├── status-bar.js          # Status bar component
├── keyboard.js            # Keyboard event handling
├── actions/
│   ├── index.js           # Action registry
│   ├── navigation.js      # Cursor movement actions
│   ├── insert.js          # Note insertion actions
│   ├── delete.js          # Delete actions
│   ├── clipboard.js       # Copy/paste actions
│   └── history.js         # Undo/redo actions
├── modes/
│   ├── normal.js          # Normal mode handler
│   ├── insert.js          # Insert mode handler
│   ├── visual.js          # Visual mode handler
│   ├── roll.js            # Roll mode handler (banjo)
│   └── annotation.js      # Annotation mode handler
├── instruments.js         # Instrument configurations
├── utils.js               # Utility functions
└── __tests__/
    ├── state.test.js
    ├── cursor.test.js
    ├── actions.test.js
    └── keyboard.test.js
```

---

## Open Questions

### Resolved

| Question | Resolution |
|----------|------------|
| String display direction | Standard tab: string 1 at top |
| Default cursor string | String 3 (middle) |
| High fret entry | `f` prefix: `f12` = fret 12 |
| Fingering annotations | Manual only, not automatic |
| Mobile support | Yes, touch-friendly UI-first |
| Multi-instrument | Architecture ready, banjo MVP |

### Still Open

1. **Measure insertion**: When inserting a new measure, should all subsequent measures renumber? Or use a sparse numbering scheme?

2. **Reading list editing**: Should the editor support editing repeat structures (reading_list), or just linear measures?

3. **Track switching**: For multi-track files, how does user switch between tracks? Dropdown? Tabs? Keyboard shortcut?

4. **Playback during editing**: Should editor have playback capability, or rely on separate player? Having playback helps verify what you've entered.

5. **Autosave frequency**: How often to autosave drafts? On every edit? On blur? Time-based?

6. **Conflict resolution**: If user edits a tab that has been modified on the server, how to handle conflicts?

---

## References

- **OTF Format**: See `sources/banjo-hangout/CLAUDE.md` for format details
- **TabRenderer**: `docs/js/renderers/tablature.js`
- **TabPlayer**: `docs/js/renderers/tab-player.js`
- **TEF Parser**: `sources/banjo-hangout/src/tef_parser/`

---

*Document version: 1.0*
*Created: 2026-01-13*
