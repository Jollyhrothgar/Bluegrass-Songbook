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

## Notes, tracks and durations

`MODEL.md` beside this file holds the rules for per-note marks (fingering,
effects, grace) versus placed free text, for tracks (a track's `id` is its
name; `tracks[]` order is load-bearing), and for automatic duration (computed
inside the facade's `_mutate`, never from the keyboard layer). Read it before
changing any of them.

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
