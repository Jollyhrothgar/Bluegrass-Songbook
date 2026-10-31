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

## Who builds what (Mike to confirm)

- **Recommended:**
  - G21a–d to the song-page session (G19), because they are one data flow
    ending in the renderer.
  - G21e to the tab editor session, after G20.
- **Coordination:** the importers and the OTF schema sit in the tab editor
  session's area. That session confirmed on 2026-10-30 that G20 changes no
  schema and doesn't touch lanes or annotations. Each piece pings it before
  starting.

## Sequence

1. After G19c (tab dock + set lists) merges, which is in review now.
2. Then G21a → G21b → G21c → G21d.
3. G21e follows G20.
4. G19d (tidy) can slot in anywhere; it's small.
