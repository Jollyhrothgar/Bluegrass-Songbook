# G21: tab annotations in their own lanes

Fix-it item G21. Mike, 2026-10-30, looking at Foggy Mountain Breakdown's
ensemble tab:

- Right-hand roll fingering (t, i, m) goes in a lane below the notes.
- Left-hand fretting goes as numbers in a lane above the notes.
- Chord names become their own kind of note, in a lane above the measure,
  separate from free text, so they can later turn into chord diagrams with
  no extra work.
- Chords are entered with the chord picker the lyrics editor already has.
- Nothing collides.

**The litmus is that tab:** `/#work/foggy-mountain-breakdown/ensemble`, banjo
track.

## Why it collides today

Evidence comes from a read-only triage of the pipeline on 2026-10-30. I
re-checked the data myself.

1. **Nothing knows which track a text belongs to.**
   - `ensemble.otf.json` has 977 annotations, every one `{measure, tick,
     text}`, with no track and no kind.
   - Measure 2, tick 0 holds six texts from four tracks: `G`, `m`,
     `G: Lead Guitar...`, `Blank for now...`, `G: Rhythm Guitar...` and
     `G: Bass...`.
   - The `.tef` does say whose each text is: its `string_row` counts strings
     across all tracks (banjo 0–4, guitar 5–10, guitar-2 11–16, bass 17–20).
     Both importers drop it (`tef_parser/otf.py` ~1457, `tef-import/otf.js`
     ~659), although they already use it for chord diagrams.
   - `attachOtfDecorations` (`renderers/measure-timing.js`) takes no track,
     so every staff draws every track's texts. That is why each chord name
     appears 3–4 times, and why the guitar's "etc." and the bass's banner sit
     on the banjo.
2. **The fingering isn't fingering.**
   - The tab's author typed m and i as text on the banjo's bottom string row
     (426 of them).
   - None of the 796 banjo notes has `finger`, so the renderer's existing
     below-the-beams finger row has nothing to draw.
   - Across the corpus: 3,495 single-letter texts in 31 tabs.
3. **The text band is two lanes, with no room for more.**
   - The band is a fixed 32px.
   - Items are placed in array order, not tick order.
   - A third item at one spot silently overprints lane 0
     (`renderers/tablature.js` ~1189, ~1271–1294).
4. **A chord name is just text.** There is no chord kind and no link to
   `chords[]`, so nothing can turn it into a diagram. 236 tabs carry
   chord-like text, 13,439 entries, including `em`, `(em)`, `A (G)`, `A(7)`
   and `D (C)`.
5. **Left-hand fingering is drawn below the beams today**, as circled digits.
   Only 13 tabs have any; right-hand fingering appears in 86.

Scale:
- 285 multi-track tabs; 199 of them have annotations, so all 199 show other
  tracks' text.
- 91 tabs contain exact duplicates.
- 81 tabs have three or more texts at one spot.

## The pieces, in order

Each piece is a PR. Each reader-facing one waits for Mike to see Foggy
Mountain Breakdown on the real page before it merges.

### G21a: every annotation knows its track (data)

- **Schema:** OTF 1.3 adds an optional `annotations[].track` (a track id).
  It is a minor bump (`docs/schema/otf.md`) and touches the schema, both
  validators, `otf-format.js` `KEY_ORDER`, `otf_format.py` and the fixtures.
- **Importers:** both fill `track` from `string_row`, through the mapping the
  chord diagrams already use (`_diagram_track_index` / `diagramTrackIndex`).
- **Renderer:** `attachOtfDecorations(notation, otf, trackId)` keeps a
  track's own annotations. A track-less annotation (an old or hand-made file)
  draws on the first track only, not on every staff.
- **Data:** `scripts/lib/reimport_tef_tabs.py`, `--dry-run` first, with the
  counts shown to Mike before the real run.
  - It refreshes only a tab still equal to the previous importer's output.
  - It never touches a tab a reader submitted or corrected
    (`provenance.submitted_by`, `x_corrected_by`, `x_derived_from`).
- **Editor:** a text the tab editor adds carries its track. That is one line
  where the editor creates an annotation, coordinated with the tab editor
  session.

On its own, this removes the cross-track pile-up: the 3–4 copies of every
chord name, and the other tracks' banners and "etc." on the banjo.

### G21b: typed fingering becomes fingering (data)

- **Importers:** a text that is exactly one of t, i, m, r, p (any case), on a
  track, at a tick where that track has a note, becomes that note's `finger`.
  - When several notes sound at that tick, it goes on the note on the text's
    string row if there is one. Otherwise it stays text.
  - An unmatched letter stays text. Nothing is dropped.
- **Data:** the same re-import, with the same safety rules.
- **Proof:** write the tests first from Foggy Mountain Breakdown's 426
  letters, using a frozen copy. Report how many letters matched, corpus-wide.

### G21c: lanes (renderer)

From the top of a staff row, each lane present only when something is in it:

1. section name;
2. chords (G21d fills it; until then chord-like text stays in the text lane);
3. free text, as many lanes as the row needs. Sort by tick, never overprint,
   and size the band from what it holds;
4. the effects band (as today);
5. **left-hand fretting numbers, just above the notes** (moved up from the
   circled digits below);
6. the staff and beams;
7. **right-hand fingering below**: today's `finger` row, with G21b filling
   it.

Rules:
- **Geometry goes through `topMargin` / `rowData`.** The tab editor's cursor
  and grid share that math (`otf-editor/cursor.js`), so no ad-hoc offsets.
- **`.annotation-text` keeps its `data-measure` / `data-tick`.** The editor
  reads them.
- **The renderer is shared with the tab editor.** Tell its session before
  starting, and have the editor's own e2e suite pass unchanged.
- **The lane-assignment function gets a unit test:** no two placed items
  overlap.
- **A corpus sweep test** checks every tab in `works/` for zero overprints
  with the estimated widths.

### G21d: chords are a kind of their own (data + renderer)

- **Schema:** `annotations[].kind: "chord"`, with `text` holding the chord as
  written.
- **Parser:** one chord parser, in both Python and JS, pinned by a shared
  fixture the way G18's chord tokens are. It must accept `em`, `(em)`,
  `A (G)` (capo spelling), `A(7)`, `D (C)` and slash chords. Anything that
  doesn't parse stays text.
- **Importers:** text that parses as a chord gets `kind: "chord"`.
- **Re-import:** the same rules as G21a.
- **Drawing:** chords go in the chord lane, through `chordGlyphHtml`
  (superscript extensions), the same glyphs the lyrics and the chord chart
  use.
- **Diagrams:** when `chords[]` has fingering for that name, the existing
  diagram path (G15d3) can draw it. Generating diagrams from names alone is
  later work.

### G21e: entering chords in the tab editor (editor)

- Adding or changing a chord uses the lyrics editor's chord picker.
- The model (`lead-editor/chord-menu-model.js`) is pure and reusable as it
  is.
- The panel (`lead-editor/chord-menu.js`) needs its strip, glide and
  magnifier callbacks made optional, and its docked layout freed from the
  lyrics editor's workspace.
- Belongs to the tab editor session, after G20.

### Folded in: tuning names (renderer)

The tab editor session found this on 2026-10-30, while building G20 Tab setup.

`renderers/tablature.js` names tunings by their note letters, and four
entries don't match the tunings players mean:

| Entry | Written in the table | What players mean |
|---|---|---|
| Banjo Open D | `D-A-D-F#-A` | f#DF#AD, which reads D-A-F#-D-F# |
| Banjo C | `C-G-C-G-G` | gCGBD, which reads D-B-G-C-G |
| Banjo Open A | `D-A-E-A-A` | aEAC#E, which reads E-C#-A-E-A |
| Mandolin DADA | `E-A-D-A` | DADA |

So a tab in one of these tunings prints no name.

- **Fix:** correct the four table entries, in G21c, which already touches the
  renderer's track header.
- **Test:** each preset's pitches map to its name.

## Acceptance (the litmus)

Foggy Mountain Breakdown, ensemble, banjo track, at 390px and 1440px, on the
song page and in the tab editor:

- **Chords:** each chord name once per change, in the chord lane.
- **Text:** the banjo's own banners ("First G Foggy Lick…", the variations).
  None of the guitar's, guitar-2's or bass's.
- **Fingering:** m and i below the notes they belong to.
- **Collisions:** nothing overprints anywhere in the tab.
- **The other tracks:** the guitar track shows its own "etc." and banners.

## Who builds what (Mike, 2026-10-30)

Split by layer, so neither session edits code that sits under the other's
tests. The pieces above (a–e) stay as the order of work; each piece's data
half and drawing half belong to different sessions.

| | The tab editor session (data) | The song-page session (drawing) |
|---|---|---|
| G21a ownership | OTF 1.3 `annotations[].track`; both importers fill it from `string_row`; the `.tef` writer writes it back; the re-import (dry-run counts to Mike first); texts the editor adds carry their track | `attachOtfDecorations(notation, otf, trackId)` draws a track's own texts only; a track-less text draws on the first track |
| G21b fingering | importers turn typed t/i/m/r/p into `note.finger`; the writer keeps it; the re-import | nothing new: the renderer already draws `note.finger` (G21c moves its lane) |
| G21c lanes | — | lanes for chords, text, effects, left-hand numbers above the notes and right-hand fingering below; sized from content through `topMargin` / `rowData`; the four tuning names |
| G21d chords | OTF 1.3 `annotations[].kind`; one shared chord parser (Python and JS, pinned fixture); importers classify; the writer keeps it | the chord lane, drawn with chord glyphs |
| G21e entry | the chord picker in the tab editor | — |

**Why this split** (the song-page session's recommendation, which Mike
accepted):
- The `.tef` writer (G15f) and its round-trip gates sit directly on
  annotations: the 602-file round trip and TablEdit's own check. The session
  that built them owns any change to what they carry.
- The fields are optional, so the drawing side can start straight after G19c
  without waiting for the data.

## The contract (OTF 1.3)

Both sides build against this. Any change to it is agreed by both sessions
first.

- **`annotations[].track`** (optional string): the `id` of the track the text
  belongs to.
  - Absent means a text from before 1.3, or from a file with no track
    information.
  - The renderer draws an annotation only on its track, and a track-less one
    on the first track only.
- **`annotations[].kind`** (optional, `"text"` or `"chord"`; absent means
  `"text"`):
  - `"chord"` means `text` is a chord as written (`G`, `em`, `(em)`,
    `A (G)`, `A(7)`, `D/F#`) that the shared parser accepts.
  - The renderer draws `"chord"` in the chord lane and everything else in the
    text lanes.
  - The data side publishes the parser at an agreed path, proposed
    `docs/js/tab-chord.js` `parseTabChord(text)`, returning the parts or
    `null`. Until it exists, the renderer draws a chord's `text` as written,
    in the chord lane.
- **`note.finger`** (`T I M R P`, right hand) and **`note.lh`** (`0`–`4`,
  left hand): unchanged.
  - G21c draws `lh` as a number above the note and `finger` below it.
  - G21b fills `finger` from typed letters.
- **Version:** `otf_version` 1.3 is a minor bump (`docs/schema/otf.md`). The
  data side bumps the schema, validators, `otf-format.js` `KEY_ORDER`,
  `otf_format.py` and fixtures. The renderer reads whichever version it gets.

## Sequence

1. G19c (tab dock + set lists) is in review (#349). The tab editor session's
   G20 (#348) is in review.
2. **Drawing side**, after G19c:
   - G21c lanes and tuning names, together with G21a's renderer filter and
     G21d's chord lane;
   - all inert until the data arrives;
   - the lanes already help today on the 95 tabs that carry `finger` or `lh` (86 and 13, 4 with both).
3. **Data side**, after G20: G21a, G21b and G21d's data parts, then the
   re-import (dry run to Mike first), then G21e.
4. The litmus (Foggy Mountain Breakdown) passes once both sides are in and
   the re-import has run.
5. G19d (tidy) can slot in anywhere; it's small.
