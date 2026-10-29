# The tab document model: marks, placed text, tracks, automatic duration

Read before changing fingering, effects, grace notes, placed text, tracks, or
how note durations are computed. The editor's other rules (the facade, keys,
selection, menus) are in `CLAUDE.md` beside this file; the OTF format itself
is `docs/schema/otf.schema.json` (field guide: `docs/schema/otf.md`).

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

- A track is as long as the DOCUMENT (`getMeasureCount` = max over all tracks),
  and a track with no `notation` key is valid and editable: the editor draws
  empty bars for it, and only `getOrCreateMeasure` ever creates the key. Reading
  (`getNotation`, switching tracks) writes nothing.
- Score > Add track… appends an instrument's empty track (`makeTrack`, no
  `notation` key); Score > Delete track… (`deleteTrack`, one undo step) refuses
  the last pitched track and, in a correction, the take's own track
  (`protectedTrackId`). Both ask in `TrackPopover`, never a native dialog.
- `notation` is keyed by track id, so a rename rebuilds it in key order with
  the renamed key back in place. Never rebuild it from `tracks[]`: real files'
  key order differs (Banjo Hangout tab 27493, fixture
  `docs/data/tabs/27493_tef.otf.json`, used by `facade-27493.test.js`: `notation`
  keys are guitar/bass/banjo/mandolin, `tracks[]` is guitar/bass/mandolin/banjo). Dropping a key makes `validate_otf`
  (`scripts/lib/process_pending.py`) reject `[notation_keys]`.
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
