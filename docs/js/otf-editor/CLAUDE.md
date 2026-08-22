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
| **what** | fingering (`finger` T I M R P, `lh` 0–4), technique | "PART A", "Long Choke", "Bb6+9" |
| **stored** | on the note (`finger`, `lh`, `tech`) | `otf.annotations[]` — top level, `{measure, tick, text}` |
| **reached by** | `A` (ANNOTATION mode) | `c` / `C` in NORMAL mode |
| **facade ops** | `setFingering`, `setLeftHand`, `setArticulation` | `addAnnotation` / `setAnnotationText` / `deleteAnnotation` / `findAnnotationIndex` |

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

### Fingering: two hands, two fields, one clear

`finger` (picking hand) and `lh` (fretting hand) are **separate fields on
the note**, and the vocabulary is not ours to invent — it is what
`sources/banjo-hangout/src/tef_parser/otf.py` decodes out of TablEdit's
one base-6 V3 byte: `finger` ∈ `T I M R P` (MusicXML `<pluck>` p i m a c),
`lh` ∈ `0..4`, drawn by `renderers/tablature.js` as an italic letter under
the beams and a circled digit under that. `facade.js` exports
`PLUCK_FINGERS` / `LH_DIGITS` and **throws** on anything else, because a
value outside those two alphabets round-trips into a file no importer
wrote and no renderer draws.

| | picking hand | fretting hand | both |
|---|---|---|---|
| **facade** | `setFingering(pos, 'R'\|null)`, `setRangeFingering(startAbs, endAbs, …, {strings})` | `setLeftHand(pos, 3\|null)`, `setRangeLeftHand(…)` | — |
| **state** | `setFingering(f)` | `setLeftHand(d)` | `clearFingerings()` |
| **ANNOTATION** | `t i m r` + **`P`** | `0` `1` `2` `3` `4` | `c` |
| **TablEdit NORMAL** | — (via `A`) | `Alt+0`…`Alt+4` | `Alt+⌫` |
| **vim NORMAL** | `a t`/`a i`/`a m`/`a r`/`a P` | `a 0`…`a 4` | `a c` |

- **The picking pinky is `Shift+P`.** `p` in ANNOTATION is the pull-off
  and has been since the mode existed; a right-hand pinky is the rarest
  mark in the vocabulary and a pull-off is not, so the shift goes on the
  pinky. Everything else is the letter you would say out loud.
- **`c` clears the FINGERING; `x` / `n` still clear the EFFECTS.** They
  are different marks on the same note and people fix them separately —
  `clearEffectsAtCursor` never touched `finger`, and `clearFingerings`
  never touches `tech`/`tie`. `clearFingerings` is one `transact` over
  both hands, and refuses (no history entry) when there is nothing set.
- **The keys are TOGGLES at the cursor and plain SETs over a selection.**
  Pressing the letter a note already reads clears that hand, which is how
  the touch row behaves and how you un-mark one hand without a second
  key; over a phrase, "they all already read T" is not what the press
  meant. Every action takes the selection when there is one — same rule
  as `applyTech`, one undo step for the phrase.
- **`lh: 0` is a value, not a cleared field.** Clearing is `null`
  everywhere; `?? null` comparisons are why the ops refuse correctly.
- **No fingering palette in the toolbar** — eleven buttons for a mark
  most tabs never carry. What is set shows in the **status bar**
  (`Fing: T · lh 2`, `—` when there is none), recomputed on `cursorMove`
  and `change` like the rest of that line. The touch path is the note
  popover's Fingering row (`POPOVER_FINGERS` / `POPOVER_LH`), whose
  buttons are toggles.
- **Double-clicking an EXISTING note opens the popover as an edit of
  it** — fret, technique and both hands pre-selected, `Edit Note` in the
  title, and Insert rewrites that note in place inside ONE `transact`
  (`facade._placeNote` replaces whatever was on the string, so the
  fingering has to be re-applied in the same step or `u` costs two
  presses). An edit does not auto-advance; entry still does.

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

### The selection is a RECTANGLE, not a column

TablEdit's model, and the one the owner asked for: a selection has a
WIDTH (ticks) and a HEIGHT (strings). Dragging along string 3 selects
string 3 alone; dragging from string 3 down to string 5 selects 3, 4 and
5 across every measure the drag crossed. Strings 1–2 are simply not in
the block, and no op may touch them.

| piece | what it is |
|---|---|
| `SelectionRange` | two `CursorPosition`s — each already carried a `string`; the rectangle is what finally reads it |
| `state.selectionStrings()` | the inclusive span between the two endpoints' strings, low → high, clamped to the track (`[3,4,5]`) |
| `state.selectionRange()` | `{startAbs, endAbs, strings}` — **the one thing every range op is built from** |
| `cursor.js selectionBand(strings, geom)` | pure: the highlight's `{top, height}` in SVG units, from the renderer's own `topMargin` / `stringSpacing` |

- **The height comes from the ENDPOINTS, never from the tick
  normalization.** `getNormalized` orders the range in time; a drag that
  runs backwards in time still selects the same strings.
- **Every facade range op already took `{strings}`** (`copyRange`,
  `deleteRange`, `moveRange`, `setRangeDuration`, `scaleRangeDuration`,
  `notesInRange`, `transposeRange`) — the state simply never passed it,
  so every selection behaved as a full column. The wrappers that pass it
  now: `copy`, `deleteSelection`, `applyDurationToSelection`,
  `scaleSelectionDuration`, `transposeSelection`, the drag-move in
  `editor.js`, and `applyTech` in `bindings.js` (effects over a
  selection).
- **Paste keeps each note's OWN string.** A block copied off strings 3–5
  lands on strings 3–5 wherever the cursor is; the cursor's string is a
  tick address, not a transposition.
- **`fixDurations` is the one op the rectangle does NOT narrow.** The
  column rule reads every string of the measure to decide a duration, so
  re-timing "only strings 3–5" would compute durations from a phantom
  document. `fixDurationsInSelection` honours the ticks and ignores the
  height, deliberately.
- **`Ctrl+A` is still the whole column** — it asks for the MEASURE, so
  `select.measureOrAll` sets its own endpoints to string 1 and the last
  string. Pressing it again takes the whole tab, all strings.
- **Growing it**: `Shift+←/→` moves the end tick, `Shift+↑/↓` (and vim's
  `j`/`k` in VISUAL) moves the end string. `cursor.moveString` drags the
  selection end exactly the way `moveByTicks` always has — without that,
  vim's `j` in VISUAL moved the crosshair and left the rectangle behind.
- **Dragging**: the rectangle is anchored at the mousedown slot's string
  and follows the pointer's string. Re-grabbing to MOVE a phrase now
  requires the grab to be inside the band as well as the tick range —
  grabbing string 1 under a strings-3–5 selection starts a new selection,
  which is what it looks like it should do.
- **The highlight is clipped to the band** (`renderSelection`, and the
  dashed `renderMovePreview` with it). It used to be full staff height,
  which is the same picture for every selection and therefore told you
  nothing about what was about to be deleted.

### The binding table — `bindings.js` is the only place keys live

`keyboard.js` is a **matcher**, not a switch statement: every behaviour is
an entry in `ACTIONS`, every key is an entry in a `PRESETS` list. Menus,
tooltips and the `?` overlay all render from the same table, so an
advertised key is a bound key by construction. (It used to be 880 lines of
`if (key === …)` plus a hand-written overlay that lied in four places —
plan `docs/plans/tab-editor-input-parity.md` §3.)

| piece | what it is |
|---|---|
| `ACTIONS[id]` | `{ label, group, modes, run(ctx, {count, key, event}), repeatable }` — the verb |
| `PRESETS.tabledit` / `.vim` | `mode → [{keys, action, hidden?}]`, plus `global` (all modes), `countPrefix`, `exceptions` |
| `describe(preset)` | grouped `{keys[], label}` for the help overlay |
| `keyFor(action, preset)` | the key to print beside a tooltip |
| `menuKeyFor(action, preset, mode)` | the key to print beside a MENU item, in the mode the menu is read in — a key bound only in another mode is qualified with the way in (`A, t`) or not printed at all, because in NORMAL `t` is placed text and `m` is a dead note |
| `FretEntry` | THE digit→fret rule (two-digit refine, `f` prefix) — the canvas *and* the note popover use this one object |

**Key-string grammar** (one grammar for the table and for events): modifiers
`Ctrl+Alt+Shift+` in that order; **case decides Shift** for letters (`W` ≡
`Shift+W`, `Ctrl+Z` ≡ `Ctrl+Shift+Z` — write modified letters lower-case);
digits come off `event.code` (`Shift+3`, never `#`); punctuation is the
character itself (`<`, `?`, `*`); sequences are space-separated (`g g`,
`a h`); `0-9` and `Shift+A-J` are ranges, expanded for matching and kept
whole for display.

- **`Meta` is never in the table.** The matcher mirrors Cmd onto Ctrl for
  the seven system idioms (`S C X V Z Y A`) and returns `null` for every
  other Cmd chord, which is what hands `Cmd+F`/`Cmd+L`/`Cmd+1` back to the
  browser. `RESERVED_CHORDS` (`Ctrl+T/W/N`, `F6`, `F11`, …) is asserted
  against in `__tests__/otf-editor/bindings.test.js`.
- **Counts are opt-in per preset** (`countPrefix`), because in NORMAL every
  digit is a fret. vim uses `g`: `g12G`, `g3w`, `g4.`. A count that lands on
  a sequence with no binding falls back to the last chord alone — that is
  why `g3w` needs no `g w` entry. TablEdit has no count; `Ctrl+G` prompts.
- **The active preset is `getPreset()` / `setPreset()` / `onPresetChange()`
  in `bindings.js`**, persisted to `localStorage['otf-editor.preset']`,
  default `tabledit`. It lives there rather than on `EditorState` because
  the table is what consumes it.
- **`hidden: true`** marks an alias kept for muscle memory (`j`/`k`/`u` in
  the TablEdit preset, `Ctrl+C/X/V` in vim). It is bound but not
  advertised, so the help stays the preset's own vocabulary.
- **Walking forward past the last tick appends a measure** — `stepTicks()`
  is the one forward-step helper (`→`, `Tab`, `.`, `Enter`, auto-advance),
  and it calls `state.ensureMeasure` so one `u` takes the bar back.
- Anything that needs a NUMBER of ticks calls `state.effectiveDuration()`
  (or `entryAdvanceTicks()`, which is the grid under automatic duration).
  `currentDuration` is `null` under auto and multiplying by it is 0.

The tests in `__tests__/otf-editor/bindings.test.js` are the fence: every
preset key maps to a real action, every action is reachable from some
preset, no reserved chord is bound, no chord is both an action and a
sequence prefix, and every `<kbd>` the help overlay prints comes from
`describe()`.

### The menu bar and the palettes — one surface, generated

`menu-bar.js` is the same component in every wrapper, mounted by the
editor ABOVE the toolbar. Nothing in it (or in `toolbar.js`) writes a key
down: an item names an ACTION, and the key column comes from
`menuKeyFor(action, getPreset(), state.mode)` — mode-aware, because a
menu is read from wherever the user is standing (Note ▸ Fingering used to
print a bare `t`, which is ANNOTATION's thumb and NORMAL's placed text). Switching preset relabels the bar, the
tooltips and the `?` overlay at once, and an advertised chord is a bound
chord by construction (`__tests__/otf-editor/menu-bar.test.js` is the
fence). The toolbar used to claim `Ctrl+T`, `Shift+Q`, `G` and `3` —
none of them bound to anything.

| piece | what it is |
|---|---|
| `MENUS` | the tree: File · Edit · Note · Play · Score · View · Help (plan §8.3) |
| `{action}` item | label + key from the table; runs `keyboard.dispatchAction(id)` |
| `{hook}` item | a callback the EDITOR supplied — tempo, repeats, tracks, measures-per-row, zoom, about. **A hook the wrapper didn't pass is an item that isn't drawn**, which is how a surface says it can't do something |
| `{dynamic}` item | expanded at open time (`tracks`, `measuresPerRow`, and `file` ← `options.fileActions`) |
| `when(state)` | the item is disabled when it returns false (no note at the cursor, no selection, one measure left, empty clipboard) |

- **The popup hangs off `<body>`, fixed-positioned.** `.otf-editor` sets
  `overflow: hidden` for its rounded corner, and in fill mode the chrome
  is at the BOTTOM — an in-flow menu is cut in half either way. `_position`
  measures and drops up when there is no room below.
- **No `Alt+letter` mnemonics**: OS- and browser-sensitive. Menus open on
  click, then arrow keys walk them and `Esc` hands focus back to the canvas.
- **Under 720px the bar collapses to one `☰`** listing every menu as a
  sheet, so touch users reach insert/delete measure and repeats at all.
  `updateLayout()` RECONCILES rather than diffs — it asks what this
  width should look like and makes it so on every call — because the
  `narrow === this._narrow` early return it used to open with left a
  stale `☰` beside the full trigger row after one missed transition.

Two editor options carry a wrapper's answer into the shared component:

| option | default | who sets it |
|---|---|---|
| `fileActions: [{label, run, disabled?, action?}]` | Download OTF alone (`action: 'edit.save'` prints its key) | whoever owns the session's buttons — the song page's Submit / Download / Cancel / Done group belongs here |
| `hostTransport: true` | `false` | a wrapper that already shows ▶/⏹/BPM for this document (the song page's bottom band, `tab-edit-band.js`). It drops the status bar's transport so one tab doesn't get three sets of playback controls; Mode/M/Beat/String/Duration/Text and the help button stay |

**STEP and LENGTH are two captioned rows** (`.toolbar-row.step-row` and
`.toolbar-row.length-row`), not the old side-by-side "Duration" and
"Grid" groups. Nothing on screen used to say which knob moved the cursor
and which sized the note — the commonest first-session confusion, and
under automatic duration they really are different inputs (plan §6: the
grid IS the rhythm input):

| row | holds | caption |
|---|---|---|
| **STEP** (`.grid-section`) | `.grid-buttons` (1/4 · 1/8 · 1/16 · 1/32 · Trip), `▦` grid toggle, **`Rest`** | "how far the cursor moves; what the ruler draws" |
| **LENGTH** (`.duration-section`) | `Auto`, `.duration-buttons` (1 · 1/2 · 1/4 · 1/8 · 1/16 · 1/32), `Dot`, `³`, `⇥` | "what a typed note gets" |

`Rest` lives with STEP because that is what it does — advance one step
without a note. Captions are `.toolbar-caption` (small, muted, hidden on
phones; the STEP / LENGTH labels stay, they are what tells the rows
apart). Every class the e2e suite names is unchanged:
`.duration-buttons .button-symbol` is still `1 1/2 1/4 1/8 1/16 1/32` in
that order, `.rest-button`, `.grid-buttons`, `.grid-btn[data-subdivision]`,
`.toolbar-section`, `.mode-indicator`.

**The palettes reflect the note under the cursor** — TablEdit's purple
border, and the reason post-hoc duration/effect editing is usable at all.
Three outline states live on the LENGTH row and never mean the same
thing:

- `.active` (filled) = the ENTRY state: what the NEXT note gets.
- `.reflects-note` (inset outline) = what the note UNDER THE CURSOR
  already is, recomputed on `cursorMove` and `change`. A dotted value
  outlines its base button *and* `Dot` (`durationReflects`, exported);
  160 ticks outlines the triplet button; `tech`/`tie` outline their
  articulation button. An outline, never a border width — nothing moves
  when the cursor does.
- `.predicts-next` (dashed outline) = **under `Auto` only**, the live
  prediction: the value `state.effectiveDuration()` maps to for the slot
  the cursor is on, recomputed on `cursorMove`, `change`,
  `durationChange` and `autoDurationChange`. Dotted and triplet
  predictions light the same buttons `.reflects-note` would
  (`durationPredicts` is `durationReflects`); a prediction with no button
  (an odd gap like 1800) outlines nothing and the status bar still prints
  the number. Choosing a duration clears every dashed outline — there is
  no prediction then, only the choice. This is TablEdit's palette
  "dynamically displays the automatic duration of the note that would be
  inserted", and the only way to see the last-note rule before committing
  to it.
- `.pending` (orange) is still "armed for the next note": clicking `h`,
  `p`, `/`, `x` or `b` on an EMPTY slot arms it, on a note applies the
  binding action. Tie always goes to the action (it needs a real
  predecessor); Clear disarms before it touches the document. There is no
  `~`-as-technique button any more — a tie is `tie: true`.
- **The note popover's technique row is the same config**, not a second
  opinion about it: `POPOVER_TECHS` in `popover.js` is `toolbar.js`'s
  exported `ARTICULATION_BUTTONS` minus the clear latch (the row ends in
  its own `none`), so `h · p · / · x · b · ⌒` reach the one path a phone
  has. The tie carries `'~'` — the value `facade.insertNote` reads as
  "tie to the same-string predecessor" — and is DISABLED with the reason
  in its tooltip when `facade.tiePredecessor` finds none, rather than
  being dropped in silence at Insert.

The Track group sits at the END of the toolbar: rename and reorder are
once-per-document edits and used to spend four slots ahead of the buttons
you press every few seconds.

### Document ops added for TablEdit input parity

Every one goes through `EditingFacade`, so every one is a single undo
step (the "refuses" column means: returns `false`, document untouched).
State wrappers in `state.js` take the cursor/selection instead of a
position. Plan: `docs/plans/tab-editor-input-parity.md` §3, §6.

| facade op | state wrapper | refuses when | undoable |
|---|---|---|---|
| `setNoteDuration(pos, dur)` | `setDuration(d)` also re-times the note at the cursor and PINS it | no note there; already that duration | yes |
| `setRangeDuration(start, end, dur, {strings})` | `applyDurationToSelection(d)` | range holds no notes | yes (one step) |
| `scaleDuration(pos, factor)` | `scaleDurationAtCursor(f)` | no note; already clamped at 60 / 1920 | yes |
| `scaleRangeDuration(start, end, factor, {strings})` | `scaleSelectionDuration(f)` | nothing in range moves | yes (one step) |
| `transposeFret(pos, delta)` | `transposeFretAtCursor(d)` | no note; already at 0 or 24 | yes |
| `transposeRange(start, end, delta, {strings})` | `transposeSelection(d)` — what `+`/`-` run when there IS a selection | the block is empty; delta 0; **any** note would leave 0..24 (ATOMIC: a single 24 refuses the whole `+1`, no partial move) | yes (one step) |
| `moveNoteToString(pos, ±1)` | `moveNoteAcrossStrings(d)` (moves the cursor too, and emits `cursorMove` so the status bar's `String:` follows) | no such string; slot occupied; fret would leave 0..24; untuned track | yes |
| `setTie(pos, on)` | `toggleTieAtCursor()` | turning ON with no same-string predecessor; clearing a tie that isn't set | yes |
| `setArticulation(pos, null)` + `setTie(pos, false)` in one `transact` | `clearEffectsAtCursor()` — what `n` runs, TablEdit's N: `tech` AND `tie`, since neither op clears the other's field | the note carries neither | yes (one step) |
| `setFingering(pos, finger\|null)` — T I M R P, **throws** otherwise | `setFingering(f)` (selection or cursor) | no note there; already that letter | yes |
| `setLeftHand(pos, digit\|null)` — 0..4, **throws** otherwise | `setLeftHand(d)` | no note there; already that digit | yes |
| `setRangeFingering(start, end, finger\|null, {strings})` / `setRangeLeftHand(…)` | the same two wrappers, when a selection exists | no note in range changes | yes (one step) |
| `setFingering(pos, null)` + `setLeftHand(pos, null)` in one `transact` | `clearFingerings()` — what `c` runs. Fingering ONLY: the effects have their own clear | the note (or range) carries neither hand | yes (one step) |
| `deleteMeasure(n)` | `deleteMeasureAtCursor()`, `deleteEmptyTrailingMeasure()` | n out of range; it's the last measure; (wrapper) the tail has notes on ANY track | yes |
| `shiftRight(m, tick, ticks)` / `shiftLeft` | `shiftRightAtCursor()` / `shiftLeftAtCursor()` | a note would cross the barline or land on an occupied slot; nothing at/after the tick | yes |
| `repeatMeasure(n)` | `repeatPreviousMeasure()` | n < 2; n−1 missing or empty; n already has notes; source longer than destination | yes |
| `addMeasures` (existing) | `ensureMeasure(n)` — walk past the end to append | measure n already exists | yes |
| `fixDurations(n \| {startAbs,endAbs})` | `fixDurationsAtCursor()` / `fixDurationsInSelection()` | nothing changes | yes (one step) |
| `insertNote({autoDuration, pins, autoEntered})`, and the same option on `deleteNote` / `deleteTick` / `paste` | automatic via `state.isAutoDuration` | — | yes (note + neighbours in ONE step) |

**Automatic duration** (`state.currentDuration === null`) is TablEdit's
"no explicit current duration". Two halves:

- **Every note that has a later onset in its measure**: `dur` is the gap
  to that onset on ANY string of the same track — the *column* rule, not
  the same-string rule TablEdit's manual describes, because same-string
  would make every 5th-string note of a roll a dotted quarter and the
  corpus says TablEdit users write rolls as eighths (95,702 banjo notes:
  eighths 63.6%, dotted quarters 0.1%).
- **The measure's LAST sounding column** takes the same value as the
  interval that precedes it (`lastColumnDuration`, exported), clamped so
  it can never cross the barline; only a column with nothing before it
  fills to the barline. This half is the manual verbatim
  (`note_menu.shtml`, "Automatic duration"):

  > "if you enter a note at the very first position in a measure … it
  > will automatically be displayed as a whole note. If you then move the
  > cursor … an 1/8th note further on … TablEdit will automatically
  > change the first note into an 1/8th note and assign the same value to
  > the second note. If you then move the cursor to the beginning of the
  > next measure (and 'Automatic rests' is on) TablEdit will enter a 1/4
  > rest and a 1/2 rest to fill out the first measure. If you delete a
  > note, TablEdit adjusts the duration of the remaining notes according
  > to the same logic. If a note duration has been selected manually,
  > deleting notes will have no effect on the remaining notes."

  So typing two notes an eighth apart in a 4/4 bar leaves TWO EIGHTHS and
  1440 ticks of silence — not an eighth and a dotted half. The silence is
  real, and the renderer draws it: `restSpansForMeasure` +
  `restGlyphSequence` in `renderers/tablature.js` decompose every gap
  into standard rest values largest-first (1440 → a half rest then a
  quarter rest) and now draw the LEADING silence of a measure too, which
  is TablEdit's "Automatic rests". Chords in a column share the value.

- **Never recompute from the keyboard layer.** The facade does it inside
  the same `_mutate`, so one `u` takes back the note *and* the neighbour's
  new stem.
- **Pinning is session state, never format.** `state.pinnedDurations`
  (hand-set durations auto must not touch) and `state.autoEnteredDurations`
  (notes typed under auto this session — the only ones auto may touch)
  hold `durationKey(measure, tick, string)` strings and are handed to the
  facade per call. A reopened document has neither, so it is fully pinned:
  you didn't type those notes. `fixDurations` is the one-shot that ignores
  both, on request.
- Anything that needs a NUMBER must call `state.effectiveDuration()`, not
  `state.currentDuration` — under auto the latter is `null`.
- **A STEP is not a duration.** `Tab` / `Shift+Tab` / `.` / `Space` and
  auto-advance move by `entryAdvanceTicks()` — one grid slot under auto,
  the chosen duration otherwise — because under auto the grid is the
  rhythm input (plan §6). Stepping by the prediction instead walked past
  the very slots about to be typed into (an empty 2/4 bar predicts a
  dotted quarter, so `Tab` jumped a measure).
- Measure-bounded: auto never ties across a barline. OTF stores no
  rests, so the trailing silence is not IN the document — it is what the
  measure's ticks minus the written durations come to, and the renderer
  is what makes it visible. Wanting a specific length for the last note
  regardless of spacing is still the explicit-duration escape hatch
  (which pins it).
- `facade.autoDurationAt(pos)` is the single source for the prediction:
  gap to the next onset → else the preceding interval clamped to the
  barline → else the rest of the measure. `fixDurations` (`J`) and note
  entry both go through `_recomputeAuto`, so `J` cannot disagree with
  what typing would have produced.

**A refusal is SAID, not swallowed.** `editor.flashStatus(msg)` writes
into the status bar's `.status-flash` (`role="status"`, cleared after a
few seconds) and reaches the binding layer as the `onStatus` hook on
`ctx.hooks`. It exists because an atomic refusal changes nothing on
screen — a block `+` that would push a note past fret 24 is
indistinguishable from a dead key otherwise. It is a DOM node, never a
native alert: see "No native dialogs" below.

Entry-state flags the keyboard layer reads: `state.autoAdvance`
(`toggleAutoAdvance()`, emits `autoAdvanceChange`), `state.lastTech`
(TablEdit's F3 — `repeatLastAction()` re-applies it, and `'~'` there
means tie).

`pitch.js` is the pure string+fret↔MIDI module the re-string op needs; it
is a port of `tab-player.js`'s two lines, not an import of it (the facade
stays UI-free), and it returns `null` where the player guesses.

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
├── menu-bar.js        # File/Edit/Note/Play/Score/View/Help, generated from bindings.js
├── toolbar.js         # Duration / grid / articulation / text / edit / track palettes
├── popover.js         # NoteEntryPopover + AnnotationPopover + TrackNamePopover
│                      #   + ValuePromptPopover (see "No native dialogs")
├── context-menu.js    # Right-click menu
├── pitch.js           # Pure string+fret ↔ MIDI (ported from tab-player)
├── actions.js         # Document-level helpers (validate, cleanup, download)
└── recorder.js        # Record/replay of edit events
```

**One rule holds the editor together: nothing mutates the document
except `EditingFacade`.** Its undo history is a whole-document snapshot
pair per op, so anything routed through it is undoable for free — and
anything that reaches around it is silently *not*.

### No native dialogs

`window.prompt` / `confirm` / `alert` are banned from this directory, and
`docs/js/__tests__/no-native-dialogs.test.js` scans for them. They are drawn
by the BROWSER, which means: not in the DOM (so no Playwright test can drive
them, and the owner's rule is that everything a human can do must be), not in
the theme, and on iOS they take focus in a way the canvas never gets back.

Four panels cover everything the editor needs to ask, and they are siblings
on purpose — same overlay/panel chrome, Enter commits, Escape cancels, keys
are swallowed so the vim bindings never see what you typed:

| ask | panel |
|---|---|
| a note | `NoteEntryPopover` |
| placed text (`c`) | `AnnotationPopover` |
| a track's name (✏️) | `TrackNamePopover` |
| **one number** — Go to measure (`Ctrl+G`), Play ▸ Tempo… | `ValuePromptPopover` |

`ValuePromptPopover` is where the last two `prompt()` calls went. Its answer
arrives LATER (on Enter or a click), which is why `_promptForMeasure` returns
0 and dispatches `nav.goToMeasure` with a `count` from the commit callback
instead of returning a number — the binding table already understood counts
(`g12G` in the vim preset), so it needed no new entry and no async hook.

Outside the editor, the same rule reaches the two places a tab session asks
something: the edit bar's inline "Discard edits? · Discard · Keep editing"
(`work-edit.js`, with the `confirmDiscard` injection point still honoured
when a host supplies one) and the drafts list's inline "Delete this draft?"
(`drafts-view.js`).

## Related

- `docs/js/renderers/tablature.js` - TabRenderer class
- `docs/js/renderers/tab-player.js` - Playback engine
- `sources/banjo-hangout/CLAUDE.md` - OTF format details
