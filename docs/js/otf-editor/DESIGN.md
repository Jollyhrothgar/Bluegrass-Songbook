# OTF Editor

The Bluegrass Songbook's in-browser tablature editor, and a reference for the
file format it edits, OpenTabFormat (OTF).

**Status**: shipped and in use. This document is a reference, kept in step with
the code in `docs/js/otf-editor/`. Where it and the code disagree, the code is
right; please report the difference.

## What the editor is

A tab editor for bluegrass instruments that runs on a song page. You open it
from a tab that is already on the site, or start a new tab for a song, and edit
one track at a time as strings and frets.

- **Two ways in.** Click or tap a note position and use the note popover and
  toolbars, or type: every digit is a fret, and the arrow keys, selection and
  clipboard work as in a text editor.
- **Edits an existing tab.** Any OTF part on the site can be opened, changed and
  put back. A document that is only opened and read exports byte-identically;
  an edit changes only what it names.
- **New tabs.** `#new-tab` and `#work/{slug}/add-tab` build a blank multi-track
  document for a chosen set of instruments and open it, with a local draft so
  work survives a reload. `#work/{slug}/edit/{part}` opens one existing take.
- **Instruments.** Presets exist for 5-string banjo, 6-string guitar, mandolin,
  upright bass, tenor banjo and dobro (`new-otf.js`). The number of strings
  comes from each track's tuning; frets are 0 to 24 on every instrument.
  Percussion tracks are not editable here.
- **Modes.** NORMAL (navigate, enter notes, commands), VISUAL (select a region
  to copy, paste, transform) and ANNOTATION (per-note fingering and technique).
- **Playback** from the Play menu, using the site's tab player.
- **Saving.** Done applies the edit back to the song page; File > Save as…
  (Ctrl+S) is an in-page panel that writes `.tef`, `.otf.json` or plain-text
  `.txt`, opening on the format the file came from and naming what a `.tef`
  leaves out before you press Save. The File menu of a song-page session is
  Open, Import .tef (new takes only), Save as, Submit, Cancel, Done; Submit sends a tab correction or a new tab through `submit-tab.js` (a
  `pending_songs` row, then `auto-commit-song`, which commits it to `works/`).
- **Tab setup.** Score > Tab setup… is one panel (a bottom sheet on a phone) for
  what the tab is rather than what is written on it: title, composer, key, time
  signature and tempo for the whole tab; instrument, tuning and capo for the
  current track. Tuning is a preset for the instrument or Custom, one pitch box
  per string. Apply is one undo step. Every note keeps its string and fret when
  the tuning changes, so the sound follows the tuning; the panel says so when the
  track has notes. A change the notes forbid, a tuning with fewer strings than
  some notes use or a time signature some notes do not fit, is a sentence in the
  panel (the count and the first measure) and changes nothing. Time-signature
  changes at a measure stay as they are and are not editable yet.
- **Menu bar** (File, Edit, Note, Play, Score, View, Help) with every shortcut
  printed beside its item. Help > About opens this document.
- **One command surface per device.** The menus are the single list of
  commands. On a laptop the toolbar's note-length and technique buttons are
  shortcuts to Note-menu items, never commands of their own (a test fails if a
  button names a command no menu has). The song page's bottom band shows only
  Submit and Done; Open, Import .tef, Save as and Cancel are File menu items.
  On a phone (640px and narrower) the toolbar is one row (undo, redo, a note
  length picker, tie) and the menu bar is a ☰ sheet whose sections fold under
  their headings, File open to start and no key column. Cursor step, Rest,
  Advance, Ruler, technique, Effects, text and tracks are all in that sheet, and
  Delete note is in Edit. There is one zoom (the status bar's − 100 % +, also
  View > Zoom), one tempo item (Play > Tempo) and one help button (Help >
  Keyboard shortcuts).

### Design principles

1. Usable by mouse and touch first, with the keyboard as the accelerator.
2. Edit the same renderer output the site displays; do not fork it.
3. Any OTF on the site can be loaded and modified.
4. Instrument-agnostic: string counts and tunings are data on the track.
5. Works on a phone or tablet: touch targets, popovers instead of native dialogs.

### Not in scope

Standard music notation, audio recording or transcription, MIDI input,
real-time collaboration.

## Keyboard

Keys are defined in one place, `docs/js/otf-editor/bindings.js`, and nowhere
else. There are two presets, `tabledit` (the default, modelled on TablEdit's
hotkeys) and `vim`, chosen from the Help menu and remembered in
`localStorage['otf-editor.preset']`. The toolbar tooltips, the menu bar, the
context menu and the `?` help overlay are all rendered from that table, so the
editor's own Help menu and `?` overlay always list the keys that are really
bound. This document does not repeat them.

## Data model

### OTF document structure

The format is written down once, in **[`docs/schema/otf.schema.json`](../../schema/otf.schema.json)**
(JSON Schema; the published spec, with its version rule), and explained in
**[`docs/schema/otf.md`](../../schema/otf.md)** (field guide, cross-field rules,
worked example). This document does not repeat them; it covers how the editor
treats the fields. The editor mutates a document only through `EditingFacade`
(`facade.js`), and `validateOTF` (`otf-validate.js`) is the JS validator for the
schema (`scripts/lib/otf_schema.py` is the Python one).

The sections below keep the editor's reading of the fields (`tech`, `fx`,
`grace`, ties, fingering, roles, durations, tracks, placed text).

**`tech`** holds the transitions: `h` hammer-on, `p` pull-off, `/` and `\`
slides, `b` the target of a bend, `x` a dead note (no pitch; the bluegrass
"chop"). The vocabulary is `TECHS` in `facade.js`; the facade throws on anything
else rather than store a symbol no renderer draws.

**`fx` and `grace` are TablEdit's own note model**, decoded from TablEdit's
files (byte layout in `docs/plans/2026-10-18-tef-feature-survey.md`). `fx` is an
unordered set stored in `FX_ORDER`, so a note may be both `brush` and
`let-ring`; an empty set is omitted, never `[]`.

- `brush` is a strummed chord (every note of the chord carries it); `roll` is an
  arpeggiated chord. Direction and speed are not decoded.
- `choke` is TablEdit's Choke effect on this note (bend up and stop). It is
  distinct from `tech: 'b'`, which marks the target of a bend.
- `muted` is TablEdit's "Muted note" (pitched, damped: palm mute). It is
  distinct from `tech: 'x'`, the dead note.
- `let-ring` is TablEdit's "Ringing note". The rest are `ghost`, `staccato`,
  `harmonic`, `artificial-harmonic`, `tap`, `vibrato`, `tremolo`,
  `bend-release` and `slap`.

`grace` hangs on the main note, as in TablEdit: a quick note on the same string,
fret `grace.f` (0..24), played just before this one and connected by `kind`
(hammer/pull, slide, ...). It has no tick or duration of its own.

**A tie is `tie: true` on the continuation note.** `renderers/tablature.js`
draws the arc from it and `tab-player.js` sustains it. `tie` and `tech` are
independent; a note can be both tied and a slide. `~` is not a technique:
`setArticulation(pos, '~')` and `insertNote({tech: '~'})` are routed to
`setTie`, and `load()` converts a legacy `~` it finds.

**Fingering** is two separate fields: `finger` (picking hand, `T I M R P`) and
`lh` (fretting hand, `0..4`). `lh: 0` is a real value; clearing is absent.

**Other facade vocabularies** (`facade.js`): `PLUCK_FINGERS`, `LH_DIGITS`,
`FX_ORDER`, `GRACE_KINDS`, fret `0..24`. Value setters throw outside them,
because anything else round-trips into a file no importer wrote and no renderer
draws.

**Roles.** `role` is the TEF importer's guess (`banjo` and `mandolin` get
`lead`, other instruments `rhythm`, drums `percussion`); the new-tab builder
writes `lead` for the first track and `rhythm` for the rest. The schema allows
`lead`, `rhythm` and `percussion` only; `EditingFacade._adopt` (run by the
constructor and by `load`, the one place a document enters the editor) turns a
legacy `backup` into `rhythm`. It is a hint, not an ordering, see below.

### Duration constants

`dur` is in ticks, `ticks_per_beat` is 480. `DURATIONS` in `state.js`:

```typescript
whole 1920, half 960, quarter 480, eighth 240, sixteenth 120,
thirtySecond 60, tripletEighth 160,
dottedHalf 1440, dottedQuarter 720, dottedEighth 360, dottedSixteenth 180
```

Dotted values need no flag; `dur` is simply the tick count. The facade clamps
durations to `MIN_DURATION` (60) .. `MAX_DURATION` (1920). With automatic
duration on, a note with no `dur` lasts until the next event, and the editor
works out the value (`state.effectiveDuration()`).

### Track name and track order

A track has no display-name field: `track.id` is the name. The renderer's
track-info row, the song page's mixer and percussion placeholder, and the
editor's track switcher all print it. The toolbar's Track section (and
Score > Rename track in the menu bar) renames and reorders tracks; there are
no key bindings for either.

**Rename edits the `id`, and `notation` is keyed by track id**, so it is a
two-part edit:

```js
tracks:   [{id: 'mandolin', ...}]   ->  [{id: 'lead mandolin', ...}]
notation: {mandolin: [...]}         ->  {'lead mandolin': [...]}
```

Changing only `tracks` loses the music from every surface and fails
`validate_otf` (`scripts/lib/process_pending.py`) with `[notation_keys]`.
`renameTrack` rebuilds `notation` in key order so the renamed key stays in its
own slot; real files do not key `notation` in `tracks[]` order, so it cannot be
rebuilt from the track list. `TrackNamePopover` refuses a blank name and a name
another track already holds. `sanitizeTrackId` keeps spaces and mixed case and
replaces `< > & " ' \` and control characters, because track ids are
interpolated into markup and used as JSON keys.

**Reorder moves `tracks[]` only** (`moveTrack`); `notation` is a keyed map and
its order means nothing. Order is what makes a track the lead:

| Consumer | Rule |
|---|---|
| `work-view.js` | lead track = the part's instrument match, else the first pitched track in `tracks[]` |
| `work-view.js` | staves are stacked, and the mixer listed, in `tracks[]` order |
| `work-edit.js` `resolveEditTrackId` | part instrument, else `role === 'lead'`, else the first pitched track (percussion is never editable) |
| `EditingFacade` / `EditorState` | default edit track is `tracks[0]` |

`role` is not the answer: the importer's guess means a TEF ensemble can have
several tracks claiming `lead`. Neither track op writes `role`.

Both ops are `EditingFacade` operations with snapshot undo, in the same history
as note edits. After any undo or redo `_reconcileTrack` checks that the current
track still exists (undoing a rename is exactly when it does not) and falls back
to the track now at the same index; otherwise the next `getNotation()` would
mint an empty measure list under the dead name. The toolbar re-reads the track
row on every `change`, so undoing a rename relabels the button.

**Phone track switcher (G20a, `track-switcher.js`).** G17 hides the toolbar's
Track row at `PHONE_MAX_WIDTH`, so on a phone with two or more tracks the track
name above the tab is a button, "mandolin ▾ 1 of 4" (`aria-haspopup`,
`aria-expanded`, 44px tall). It opens a short list of the tracks with a check on
the current one; choosing one calls `state.setTrack` and puts focus back on the
editor. Escape or a tap outside closes it. One track, or a wide screen: the
header is untouched. The header is drawn by `renderers/tablature.js`
(`renderTrackInfo`), shared with the read view, so the editor does not change
the renderer: `editor.js` calls `TrackSwitcher.decorate` on the fresh
`.track-info` from `renderer.onAfterRender`, before the cursor measures the
first row. Every redraw (rename, reorder, add, delete, undo, resize across the
breakpoint) relabels it, and the list is read from the document each time it
opens. The module is in `lazy-modules.js`.

### Placed text (`annotations`)

"Annotation" means two things. ANNOTATION mode edits per-note marks (fingering,
technique), stored on the note. The document's top-level `annotations` array is
free text placed at a spot in the score:

```json
"annotations": [
  {"measure": 1, "tick": 0,   "text": "Press F-12 to play whole tune from beginning."},
  {"measure": 4, "tick": 960, "text": "PART A"},
  {"measure": 7, "tick": 0,   "text": "Bb6+9"}
]
```

Section banners, playing notes and chord names all live in this one array. TEF
import produces them, `renderers/tablature.js` draws them above the staff
(positioned by `tick`, stacked in lanes when they overlap), and they travel with
the document on submission.

Placed text is edited in NORMAL mode, from a key binding, the toolbar's Text
section, or by clicking the text. Facade operations: `addAnnotation`,
`setAnnotationText`, `deleteAnnotation`, `findAnnotationIndex`.

- Text is trimmed, and an empty text deletes: a blank label can never be clicked
  or found again, so none is stored.
- Two annotations may share one `(measure, tick)`, so they are addressed by
  index, not position.
- Reach is one beat: editing at the cursor hits a label within a beat of it, and
  adds one otherwise. The status bar's `Text:` field names the label that would
  be hit.
- Adds splice into score order without reordering existing entries; edits mutate
  one entry in place.
- Edits share the one undo history with note edits.

## Behaviour worth knowing

- **One writer.** Nothing mutates the document except `EditingFacade`. Undo is a
  whole-document snapshot per operation; `transact` groups a compound edit into
  one undo step and rolls back on error.
- **Multi-note operations are atomic.** If one note in a selection would leave
  frets 0..24, the whole operation is refused and the status bar says so.
- **No native dialogs.** `prompt`, `confirm` and `alert` are not used (Playwright
  cannot drive them, they are unthemed, and on iOS they take focus the canvas
  never gets back). Questions are asked through the panels in `popover.js`.
- **Time signatures.** Measure arithmetic is time-signature aware
  (`renderers/measure-timing.js`), so tunes with mid-tune changes in
  `metadata.time_signature_changes` are not corrupted by edits.
- **Dynamics are menu-only.** Note > Dynamics sets `fff` to `pp` on the note or
  selection, or "Track default" to clear it; a track's own level is
  `tracks[].dyn` and a note stores `dyn` only when it differs. The status bar
  shows `Dyn:` only for such a note. Playback scales by TablEdit's velocity
  ratio (`127 - 16 * code`); nothing is drawn on the staff.
- **A bend is two notes.** Note > Effects > bend (or bend and release) on the
  bent note also marks the next note on that string as the bend's target
  (`tech: 'b'`). The amount is the fret difference, drawn as ½, full, 1½, 2, so
  you change it by editing the target's fret; there is no amount control.
  Turning the bend off unmarks the target, in the same undo step.
- **Forward step appends.** Moving past the last tick of the last measure adds a
  measure, as part of the same undo step.

## Open questions

1. **Reading list authoring.** `reading_list` (repeat structure) is carried
   through edits, and measure insert and delete shift its ranges, but the editor
   has no way to create or change one.
2. **Edit conflicts.** If a tab changes on the server while someone is editing
   it, nothing detects or merges that; the later submission is simply a new
   correction.

## References

- `docs/js/otf-editor/CLAUDE.md`: working notes on the code and its invariants
- `docs/plans/tab-editor-input-parity.md`: the input model behind `bindings.js`
- `docs/plans/2026-10-18-tef-feature-survey.md`: TEF source of `fx` and `grace`
- `sources/banjo-hangout/src/tef_parser/otf.py`: the OTF writer
- `docs/js/renderers/tablature.js`, `docs/js/renderers/tab-player.js`: how a
  document is drawn and played
