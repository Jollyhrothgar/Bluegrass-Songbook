# OTF Editor

The in-browser tablature editor for OpenTabFormat (OTF) files. It ships.
`DESIGN.md` describes what the editor does and the OTF document format; its
`interface Note` section (`fx`, `grace`) is the format reference that code
comments cite, and Help ▸ About opens it for users. Input-model plan:
`docs/plans/tab-editor-input-parity.md`.

```bash
npm test -- otf-editor          # unit tests in docs/js/__tests__/otf-editor/
npm run test:e2e -- otf-editor  # e2e/otf-editor*.spec.js (needs the server)
```

## The one rule

Nothing mutates the document except `EditingFacade` (`facade.js`). Its undo
history is a whole-document snapshot per op, so anything routed through it is
undoable for free, and anything that reaches around it is silently not.

- `state.js` wraps the facade with cursor, selection and mode.
- A facade op that has nothing to do or is out of range returns `false` and
  leaves the document and history untouched. Multi-note ops are atomic: one
  note that would leave frets 0..24 refuses the whole `+`/`-`.
- A multi-step edit is one `transact`, so one `u` undoes it.
- Value setters **throw** outside their alphabet (`PLUCK_FINGERS`,
  `LH_DIGITS`, `FX_ORDER`, `GRACE_KINDS`, fret 0..24): anything else
  round-trips into a file no importer wrote and no renderer draws. The facade
  stays importer-free, so it keeps its own copy of those lists;
  `effects-facade.test.js` asserts `FX_ORDER` equals the one exported by `docs/js/tef-import/otf.js`.
- `pitch.js` (string+fret to MIDI) copies two lines of `tab-player.js` rather
  than importing them, so the facade stays UI-free. The player maps an
  unknown tuning name to MIDI 60 (`PITCH_TO_MIDI[p] || 60`); `pitch.js` returns
  `null` instead, so an edit refuses rather than moving a note by a guess.
- `new-otf.js` (`createEmptyOTF`, `createMultiTrackOTF`) must stay pure and
  editor-free: the song page builds new takes from it, and `actions.js`
  re-exports it.

## No native dialogs

`window.prompt` / `confirm` / `alert` are banned here
(`__tests__/no-native-dialogs.test.js` scans for them): Playwright cannot drive
them, they are not themed, and on iOS they take focus the canvas never gets
back. Ask through the sibling panels in `popover.js` (Enter commits, Escape
cancels, keys are swallowed so bindings never see them): `NoteEntryPopover`,
`AnnotationPopover`, `TrackNamePopover`, `ValuePromptPopover` (one number),
`GracePopover`.

- `ValuePromptPopover` answers later, so `_promptForMeasure` returns 0 and
  dispatches `nav.goToMeasure` with a `count` from the commit callback (the
  binding table already understands counts, `g12G`).
- Say refusals out loud: `editor.flashStatus(msg)` writes the status bar's
  `.status-flash` and reaches bindings as the `onStatus` hook on `ctx.hooks`.
  An atomic refusal changes nothing on screen otherwise.
## Keys: `bindings.js` is the only place they live

`keyboard.js` is a matcher. Every behaviour is an entry in `ACTIONS`; every key
is an entry in `PRESETS.tabledit` or `PRESETS.vim` (per mode, plus `global`,
`countPrefix`, `exceptions`). Menus, tooltips and the `?` overlay render from
the table (`describe`, `keyFor`, `menuKeyFor`). Never write a key name by hand
in a toolbar, menu or tooltip.

`__tests__/otf-editor/bindings.test.js` and `menu-bar.test.js` are the fence:
every preset key maps to a real action, every action is reachable (except
`menuOnly`), no `RESERVED_CHORDS` entry (`Ctrl+T/W/N`, `F6`, ...) is bound, no
chord is both an action and a sequence prefix, every printed `<kbd>` comes from
`describe()`.

- Key strings: modifiers in the order `Ctrl+Alt+Shift+`; case decides Shift for
  letters (write modified letters lower-case, `Ctrl+z`); digits and
  `Alt+letter` come off `event.code` (macOS Option+G types a different
  character); write `Shift+3`, never `#`; sequences are space-separated.
- `Meta` is never in the table. The matcher mirrors Cmd onto Ctrl for
  `S C X V Z Y A` and returns `null` for every other Cmd chord, so
  `Cmd+F`/`Cmd+L`/`Cmd+1` stay the browser's.
- `Tab` / `Shift+Tab` are always `preventDefault`ed in every mode, even with no
  binding; otherwise focus leaves the canvas and every later key goes elsewhere.
- Active preset: `getPreset()` / `setPreset()` in `bindings.js`,
  `localStorage['otf-editor.preset']`, default `tabledit`. Counts are opt-in per
  preset because in NORMAL every digit is a fret; a count that lands on an
  unbound sequence falls back to the last chord (so `g3w` needs no `g w`).
- `hidden: true` is a bound alias kept for muscle memory, not advertised.
  `menuOnly: true` marks an action TablEdit has no hotkey for: refused a
  binding, required to be in a menu.
- `menuKeyFor(action, preset, mode)` prints the key for the mode the menu is
  read in; a key bound only in another mode is qualified (`A, t`) or omitted
  (in NORMAL `t` is placed text, `m` a dead note).
- `FretEntry` is the one digit-to-fret rule (`f` prefix; two-digit refine: a second digit typed within `REFINE_MS` = 300 ms
in `keyboard.js` rewrites the note just placed to the two-digit fret, if it is
<= 24) for
  the canvas and the popovers. A two-digit fret is one undo step: the second
  digit rewrites the first through `facade.amendSince(mark, fn)`. A click
  or any navigation or edit key closes the refine window early.
- Where preset keys differ from TablEdit's, the preset lists them in
  `exceptions`: `c` is Choke; repeat-previous-measure is `Alt+R`; `m` stays the
  dead note `x` (a bluegrass tabber's "muted" is the chop; TablEdit's palm mute
  is `fx: 'muted'`, menu-only).
- Walking forward past the last tick appends a measure: `stepTicks()` is the
  one forward-step helper and calls `state.ensureMeasure`, so one `u` removes
  the bar.
- Code needing a number of ticks calls `state.effectiveDuration()` or
  `entryAdvanceTicks()`. `state.currentDuration` is `null` under automatic
  duration, and multiplying it gives 0.

## Per-note marks vs placed text

"Annotation" means two things:

| | per-note marks | placed free text |
|---|---|---|
| what | fingering (`finger`, `lh`), technique | "PART A", "Long Choke", "Bb6+9" |
| stored | on the note (`finger`, `lh`, `tech`) | `otf.annotations[]`, top level, `{measure, tick, text}` |
| reached by | `A` (ANNOTATION mode) | clicking the text; `t` / `T` in NORMAL (vim `c` / `C`) |
| facade | `setFingering`, `setLeftHand`, `setArticulation` | `addAnnotation`, `setAnnotationText`, `deleteAnnotation`, `findAnnotationIndex` |

Placed text is score-level and drawn above the staff by
`renderers/tablature.js`; chord names over a tab are placed text. Two entries
may share a `(measure, tick)`, so address them by index
(`state.getAnnotationAtCursor()`). Text is trimmed and a blank one is never
stored. The renderer stamps `.annotation-text` with `data-measure`/`data-tick`;
a click on it puts the cursor exactly there (mapping the click x misses, since
the words run past the one-beat reach) and a mousedown on it never starts a
drag (`_annotationFromEvent`). A document you only read round-trips
byte-identical.

**Fingering.** `finger` (picking hand, `T I M R P`) and `lh` (fretting hand,
`0..4`) are separate fields in TablEdit's vocabulary, decoded by
`sources/banjo-hangout/src/tef_parser/otf.py` from one base-6 V3 byte.

- The picking pinky is `Shift+P` in ANNOTATION mode because `p` is the pull-off
  and a pinky is the rarer mark.
- Keys toggle at the cursor and plain-set over a selection (one undo step).
- `lh: 0` is a value; clearing is `null`, compared with `?? null`.
- `c` clears fingering only; `x`/`n` clear effects. `clearFingerings` never
  touches `tech`/`tie`/`fx`/`grace`, and `clearEffectsAtCursor` never touches
  `finger`/`lh`.
- No toolbar palette; the status bar shows what is set, and touch users use the
  note popover's Fingering row.
- Double-clicking a note opens the popover as an edit; Insert rewrites it in one
  `transact`. `_placeNote` replaces whatever is on the string, so fingering
  must be re-applied in that same step or `u` costs two presses.

**Effects and grace.** `note.fx` is a set stored in `FX_ORDER`, omitted when
empty (never `[]`); `note.grace` is `{f: 0..24, kind?}`. `tech` keeps the
transitions (`h p / \ x`, and `b` = bend target); everything else is `fx`.

- Every fx key is a toggle. Over a selection: all notes already have it means
  off, otherwise on for all (`setRangeEffect(..., 'toggle')`, one undo step).
  `F3` / vim `.` re-apply (on, never off); only an effect turned on is
  remembered (`state.lastTech = 'fx:<name>'`).
- A grace follows its main note: `+`/`-` move it by the same frets, and
  `moveNoteToString` keeps its fret offset, refusing if it would leave 0..24.
- Drawing is `renderers/tablature.js`'s job.

## Tracks

A track has no display-name field: its `id` is what the stave, the song page
mixer and the switcher print. Rename therefore edits the id
(`renameTrack(trackId, newId)`), and reorder moves `tracks[]` only
(`moveTrack`). UI is the toolbar's Track section and Score > Rename track; no
key bindings.

- `notation` is keyed by track id, so a rename rebuilds it in key order with
  the renamed key back in place. Never rebuild it from `tracks[]`: real files'
  key order differs (Banjo Hangout tab 27493, fixture
  `docs/data/tabs/27493_tef.otf.json`, used by `facade-27493.test.js`: `notation`
  keys are guitar/bass/banjo/mandolin, `tracks[]` is guitar/bass/mandolin/banjo). Dropping a key makes `validate_otf`
  (`scripts/lib/process_pending.py`) reject "track X: no notation".
- Duplicate ids are refused (popover disables Save; facade throws as backstop).
  `sanitizeTrackId` strips `< > & " ' \` and control characters because the
  renderer puts a track id into innerHTML unescaped.
- Undo of a rename re-points the facade (`_reconcileTrack`, after every history
  swap); a stale `trackId` makes the next `getNotation()` mint an empty bucket.
- Order is load-bearing: work-view takes the lead as the first pitched track
  unless the part names one, `resolveEditTrackId` and `EditingFacade` fall back
  to `tracks[0]`, and the song page stacks staves in `tracks[]` order. `role`
  is not lead-ness (it is the TEF importer's instrument guess; red-haired-boy
  has three tracks claiming `lead`), and `tablature_parts[].tracks` in the index
  is a count. Neither op touches them.

## The selection is a rectangle

A selection has a width (ticks) and a height (strings). No op may touch strings
outside the block.

- `state.selectionRange()` returns `{startAbs, endAbs, strings}`; every range op
  is built from it. Height comes from the two endpoints, never from tick
  normalization.
- Every facade range op takes `{strings}`. A new range op's state wrapper must
  pass them, or it silently acts on a full column.
- Paste keeps each note's own string.
- `fixDurations` is the exception: its column rule reads every string, so
  `fixDurationsInSelection` honours ticks and ignores height.
- `Ctrl+A` (`select.all`) is the whole tab, current track only. Edit > Select
  measure (`select.measure`) is one measure. Placed text is in no selection.
- A selection's end slot runs to the next grid line, or to the barline in a
  measure's last slot (`state.slotEndAbs`), so a note typed at a finer step is
  inside Ctrl+A and can be deleted.
- Grabbing a selection to move it must be inside the band, not just the tick
  range. The highlight and the dashed move preview are clipped to the band
  (`selectionBand`, `cursor.js`).

## Automatic duration

`state.currentDuration === null` is TablEdit's automatic duration. The facade
computes it inside the same `_mutate` as the edit (`autoDurationAt`,
`_recomputeAuto`), so one `u` takes back the note and its neighbour's new stem.
Never recompute from the keyboard layer.

- A note with a later onset in its measure takes the gap to that onset on any
  string of the track (column rule). A note's duration is not the gap to the next onset on its own string,
  though that is the obvious rule: it would make every 5th-string note of a roll a dotted quarter, and the
  corpus writes rolls as eighths (95,702 banjo notes: eighths 63.6%, dotted
  quarters 0.1%).
- The measure's last sounding column takes the preceding interval
  (`lastColumnDuration`), clamped at the barline; a lone column fills to the
  barline. Two eighths in a 4/4 bar leave 1440 ticks of silence, which the
  renderer draws (`restSpansForMeasure`, `restGlyphSequence`). OTF stores no
  rests; auto never ties across a barline.
- Pinning is session state, never format. `state.pinnedDurations` (hand-set;
  auto must not touch) and `state.autoEnteredDurations` (typed under auto this
  session; the only ones auto may touch) hold `durationKey(measure, tick,
  string)` strings. A reopened document has neither, so it is fully pinned.
  `fixDurations` (`J`) ignores both.
- A step is not a duration: `Tab`, `.`, `Space` and auto-advance move by
  `entryAdvanceTicks()` (one grid slot under auto), because under auto the grid
  is the rhythm input.

## Toolbar, menus, zoom

- `menu-bar.js` (`EditorMenuBar`) builds its menus at runtime from the `MENUS`
  tree. An `{action}` item names an action and gets its
  key from `menuKeyFor`; a `{hook}` item calls a callback that `OTFEditor` (`editor.js`) lists in
  the `hooks` object it gives `new EditorMenuBar({...})`, and a hook missing
  there means the item is not drawn. The popup
  hangs off `<body>` (fixed) because `.otf-editor` has `overflow: hidden`. No
  `Alt+letter` mnemonics. `updateLayout()` reconciles to the current width
  instead of diffing against the last.
- Options the host passes to `new OTFEditor(...)` (`work-edit.js` does): `fileActions: [{label, run, disabled?,
  action?}]` (default Download OTF), and `hostTransport: true` when the song
  page's bottom band already shows play/stop/BPM.
- Palette outlines mean different things: `.active` (filled) is the entry state
  for the next note; `.reflects-note` is what the note under the cursor already
  is (an outline, never a border-width change); `.predicts-next` (dashed) is the
  live auto-duration prediction, under `Auto` only; `.pending` (orange) is a
  technique armed by clicking on an empty slot.
- The note popover's technique row is `toolbar.js`'s `ARTICULATION_BUTTONS` via
  `POPOVER_TECHS`, not a second list. The tie carries `'~'` and is disabled with
  a reason when `facade.tiePredecessor` finds none.
- The cursor step is not a zoom (fix-it item A20): it changes where the cursor
  and clicks land and what the ruler draws, never measure width. Steps closer
  than `MIN_RULER_SPACING_PX` (`cursor.js`) stay in the DOM but draw only the
  coarsest multiple that fits. Do not derive `measureWidthFloor` from the step.
- Horizontal zoom (fix-it item A21): `state.horizontalZoom` (`H_ZOOM_LEVELS`;
  view state, no history). Each measure is at least `zoom x` its zoom-1 width
  (`measureWidthFloor`, rows from `_baseMeasuresPerRow`); a measure wider than
  the canvas scrolls the canvas (`.editor-renderer .stave-row svg { max-width:
  none }`), so overlays use its `scrollLeft`. Entry never reads the zoom.

## Driving it from a script: `editor.automation`

`document.querySelector('.otf-editor').__otfEditor.automation` (`automation.js`)
serves Playwright, unit tests and a live-site browser session: `press('1 2')`
(real keydowns through the table), `exec(actionId)`, `actions()`, `doc()`,
`cursor()`, `setCursor(...)`, `history()`, `layout()` (what is drawn, in client
px) and `check()` (`layoutViolations(layout())`, `[]` when sane).

`check()` measures against the barlines, because notes, ruler and cursor share
one tick-to-x mapping and so always agree with each other; the bug class is that
mapping drifting off the bar (fix-it item A17).
`e2e/otf-editor-invariants.spec.js` runs it after every key of a seeded random
walk. Every consumer reads `noteX0 + noteOffset + tick / ticks * noteW`
(`renderers/tablature.js`); do not add per-measure centering.
