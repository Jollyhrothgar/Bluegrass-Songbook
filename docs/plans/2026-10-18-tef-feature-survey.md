# TEF feature survey: what TablEdit files hold that we don't show

2026-10-18, fix-it A15. This survey asks a different question from A12-A14. Those asked "are the notes we import right?"; this one asks "which TablEdit features do the corpus files use that never reach the reader?"

## How it was measured

There are three inventories, joined per feature.

1. **What TablEdit can express.** This comes from TablEdit 3.06's own tables, read with REA/Ghidra:
   - the string-pointer table at `0x1000f57e0`: 8 dynamics, then 20 note effects in enum order;
   - the type-name table at `0x1000f3cbc`: special components such as text, chord diagram, rest, accent and reading guide;
   - the V2 upgrade `FUN_1000459c4`, which maps V2 codes onto those types;
   - the attribute reader `FUN_10001f594`;
   - the element strings of the MusicXML exporter (`FUN_1000982f0`).

   The exporter can write only about 30 element kinds. It never writes bends, harmonics, brushes, dead notes, staccato, ghost notes or dynamics, so the export alone undercounts.
2. **What the corpus uses.** `spike/tabledit_export/feature_census.py` walks every record of all 592 corpus TEFs at the byte level and counts each named value: notes, files, and published tabs (files a `works/` part points at; 458 of the 592). Each note is also joined to TablEdit's MusicXML export of the same file and to our OTF. So a row shows both what TablEdit attaches to that note and what our converter emits for it.
3. **What our code carries.** This is an audit of every OTF field through the renderer, player, editor, ASCII renderer and index build. The findings are below, with file:line references in the PR description.

To rerun all of it (exports go to `spike/tabledit_export/out/`, which is gitignored):

```bash
uv run python spike/tabledit_export/export_corpus.py       # TablEdit, ~2 s/file, needs Accessibility
uv run python spike/tabledit_export/compare_corpus.py      # note-for-note check (548/592 today)
uv run python spike/tabledit_export/feature_census.py      # this survey's counts -> out/census.json
```

## 1. In the files, dropped by the importer

These are ranked by published tabs. "Notes" means records carrying the feature. Every row below currently converts to a plain note, or to nothing.

| # | Feature | Notes / records | Files | Published tabs | Frontend support today | Notes |
|---|---|---|---|---|---|---|
| 1 | **Free text, V2 files** (TablEdit type 0x39 via V2 code 0x1d) | 22,330 | 305 | 237 | **yes**: `annotations` are drawn | We import text only from V3 files (64 files). TablEdit's export of the same text breaks down as: chord names 16,571 items in 283 files; picking letters typed as text (T/I/M) 4,138 in 39 files; section labels ("Part A", "Ending") 1,113 in 206 files; other 2,151. The count per file matches the export exactly in 268 of 297 files. |
| 2 | **Brush (strum)**, effect 5 (plus 153 as a second effect) | 20,199 | 196 | 174 | no | Whole strummed chords. Direction is not established (see open questions). |
| 3 | **Dead notes, V2 files**, effect 15 | 20,029 | 84 | 65 | **yes**: `tech: 'x'` is drawn as × and played damped | V3 dead notes are already imported (1,000 notes, 5 files). The V2 path never sets `x`. |
| 4 | **Ringing / let ring** (attribute 1, plus 133 as a second effect) | 3,138 | 95 | 77 | no | |
| 5 | **Grace notes** (V2 fret-byte flag 0x40, V3 type bit 0x40) | 388 | 69 | 54 | no | The flag sits on the main note. The grace's own fret and kind are in V2 effect2 / V3 byte 7 (bits 0-4 fret, bits 5-7 kind: slide 279, hammer/pull 109). We keep the main note and lose the grace. TablEdit's export has 2× these counts (one per staff) in 44 files. |
| 6 | **Choke**, effect 4 | 358 | 64 | 50 | no | Distinct from `b`. Our bend heuristic catches some chokes only when the next note on the string is tied. |
| 7 | **Chord diagrams** (type 0x35, V2 0x1c/0x5c/0x9c) | 1,942 | 58 | 46 | **yes (G15d3)**: `chords[]` + `chord_diagrams[]`, drawn as a box above the staff | Each is an index into the chord table (V3 header 0x58; V2: count at offset 236, records after the text table). 31 of these files also export `<harmony>` chord symbols. 1,938 anchors in 57 files are on disk here. |
| 8 | **Roll (arpeggio)**, effect 14 | 1,114 | 39 | 37 | no | |
| 9 | **Stroke / fingering marks** with no note (type 0x3e) | 2,992 | 53 | 36 | partly: `finger` exists on notes | Same encoding as a note's fingering byte, standing alone. |
| 10 | **Staccato** (attribute 7) | 3,517 | 52 | 35 | no | V2 effect2 = 0x07 under fret flag 0x80. Under flag 0x00, 0x07 is the unexplained case `_parse_v2` drops (see corrections). |
| 11 | **Ghost notes** (attribute 4, plus 5 as a second effect) | 893 | 27 | 23 | no | |
| 12 | **Bend; bend and release**, effects 12/13 | 152 / 33 | 14 / 9 | 12 / 6 | partly: `b` on the target note | The bend amount is not imported. Bend-and-release is not distinguished. |
| 13 | **Dynamics**, 8 levels per note (cell byte 5, bits 5-7) | every note | 235 vary it | 200 vary it | no | The player plays every note at one volume. Most notes are level `p` (270,587); 235 files mix levels, e.g. accented melody over quieter backup. |
| 14 | **Harmonics**, natural/artificial (effects 6/7 and as second effects) | 81 | 16 | 13 | no | |
| 15 | **Tempo changes** (type 0xfe) | 58 | 21 | 17 | no | OTF has one tempo per document. 19 of the files are V2 files whose byte equals the V3 type byte; the V2 mapping is not in the upgrade table, so it is less certain. |
| 16 | **Tremolo; muted** (effects 11/8) | 441 / 368 | 6 / 9 | 6 / 6 | no | |
| 17 | **MIDI patch changes** (type 0x7e) | 77 | 14 | 13 | no | |
| 18 | **Repeat barlines with no reading list** (type 0xb7 "reading guide": flag 0x40 = start, 0x80 = end) | 618 | 123 | 110 | yes, via `reading_list` | Most of these files also have a reading list, which we import. **7 files (5 published) have repeats only as barlines**, so they render and play with no repeats: 10613 Gold Rush, 11655 Brilliancy, 21937, 22933, 24211, 24212, fiddle 834. |
| 19 | Voices: upper/lower (effect bits 0x20/0x30) | 14,050 | 41 | 32 | no | Stem direction in standard notation. Little value for tab. |
| 20 | Explicit rests (type 0x33, V2 bare 0x1a) | 7,299 | 115 | 84 | rests are drawn from gaps | They matter only for voices and hidden rests. Low value. |
| 21 | Rare: vibrato 2, tapping 1, slap 6, tremolo bar 5, lyrics 1 file (60 syllables), crescendo/accent 2, line/beam/stem layout marks | — | ≤ 15 | ≤ 13 | no | |

These are already imported and match TablEdit:
- notes, durations, ties, triplet timing;
- hammer-on, pull-off and slide;
- V3 dead notes;
- picking-hand and fretting-hand fingering (78 + 19 published tabs);
- time-signature changes, reading lists, V3 text, tuning, capo, tempo;
- drum-track detection.

## 2. In the OTF, not used by the site

| Gap | Where | Effect |
|---|---|---|
| **Eighth- and quarter-note triplets get no bracket.** | `renderers/tablature.js` `detectTripletGroups`: it accepts only three onsets 70-90 ticks apart, which is a 16th triplet. | Eighth triplets (160 ticks) never show a "3", including ones typed in the editor. TablEdit marks tuplets in 153 corpus files. OTF has no tuplet flag, so spacing is the only signal. |
| **Hammer-ons and pull-offs are re-picked.** | `renderers/tab-player.js` checks only `/ \ x b`. | `h`/`p` sound like fresh picks at full volume. Only slides glide. |
| **`capo` is not used by the player.** | `tab-player.js` never reads it. The renderer only labels it. | Possibly correct. TablEdit's export spells pitch as tuning + fret with the capo left out (75,886 of 76,067 notes in 228 capo tracks). Whether TablEdit frets count from the nut or from the capo is an open question. A TablEdit MIDI export of one capo file would settle it. |
| **Section names are lost on repeat edits.** | `otf-editor/facade.js` `_setSequence` rebuilds `reading_list` without `name`. | Editing any repeat drops "A part" / "B part" labels. |
| **`\` (slide down) shows as a stray backslash.** | `tablature.js` fallback | The importer never emits it, but the editor and player accept it. |
| Never read by the frontend | `tracks[].lines`, `metadata.composer` | |

`finger`, `lh` and `annotations` are drawn but not played, as intended.

## 3. Corrections to what the code and docs say

- **V2 fret-byte flag 0x80 means "effect2 holds a note attribute"**: ringing, staccato, ghost, a second effect, or a layout code (exclude from beaming, no stem, ottava). It does not mean "accompaniment-pattern note" (`reader.py` comment at the effect2 == 0x07 filter). The rule that keeps those notes is right; the explanation is wrong.
- **Effect2 0x07 is staccato under flag 0x80.** The tab-debug skill's "0x07 = chord overlay" holds only for flag 0x00. There the byte lands in V3 byte 7, and TablEdit's meaning for it is unresolved. Dropping those notes is still oracle-consistent.
- **The effect enum is `byte6 & 0x0f`** (V2 `effect1 & 0x0f`):
  - bits 4-5 are the voice (0x20 upper, 0x30 lower);
  - bits 6-7 are the enharmonic spelling (0x40 sharp, 0x80 flat).

  `compute_articulations_v3` masks with `0x1f`. That is harmless today because no corpus value has bit 4 alone, but `0x0f` is TablEdit's mask.
- **Special-component types are compared on the full byte** (0x35 chord diagram vs 0x75 scale diagram vs 0xf5 special character), not on `& 0x3f`. Our reader skips all of them, so nothing is mis-imported.

## 4. Open questions

- Brush direction (up/down) and strum speed: where TablEdit stores them is not found yet. They may be in the voice bits or V3 byte 9.
- V3 byte 7 on ordinary notes (6 notes) and V2 effect2 under flag 0x00 (the dropped 0x07 records): unresolved.
- Whether the capo transposes playback (above).
- Track record bytes +10, +15, +16 bits 8-14 and +18: possibly volume and pan; unresolved.
- The meaning of the "percussion" special type (0x78, V2 0xde, 1,839 records in 35 files) beyond its name.

## 5. Proposed order

These are quick wins first, then features by reach. Every one needs TDD against TablEdit's export or a named byte from the decompile, like A12-A14.

**Status 2026-10-18:** 1, 2, 3, 4, 6 and 7 are done on `feature/tef-import-gaps` (the schema decision for 6 is `note.fx`, see DESIGN.md). 5 is deferred: the reading guide (0xb7) also carries endings and codas, and expanding its start/end pairs by standard repeat rules reproduces only 14 of 71 real reading lists. 8 and 9 are open.

1. **V2 dead notes → `x`** (S). The renderer and player already support it. Covers 65 published tabs.
2. **V2 text → `annotations`** (S-M). The renderer already draws them. Covers 237 published tabs, most of them chord names over the tab. Splitting chord names from labels is a display decision for Mike.
3. **Eighth/quarter triplet brackets** (S). This is a renderer fix, and it also helps tabs typed in the editor.
4. **Hammer/pull legato playback** (S).
5. **Repeat barlines when there is no reading list** (S). 5 published tabs.
6. **Note attributes in OTF** (M): brush, ringing, staccato, ghost, choke, roll, harmonics, tremolo. These need one schema decision (a `fx` list on the note?) plus drawing and playback for each. Brush alone covers 174 published tabs, ringing 77.
7. **Grace notes** (M): OTF field, renderer and player. 54 published tabs.
8. **Chord diagrams** (M). 46 published tabs.
9. **Dynamics → velocity** (S-M) and **tempo changes** (M, needs an OTF field).
