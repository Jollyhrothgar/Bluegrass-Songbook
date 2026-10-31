# G21, data side: orchestration checklist

The spec is `docs/plans/2026-10-30-g21-tab-annotation-lanes.md`. Its
"The contract (OTF 1.3)" section is agreed between the two sessions, and
neither side changes it alone. This file is the running state of the data
side, which the tab editor session builds:

- G21a: annotations get a track;
- G21b: typed fingering becomes fingering;
- G21d: chord kind and parser;
- the re-import;
- G21e: the chord picker in the editor.

The drawing side (G21c, plus the renderer halves of G21a and G21d) belongs to
the song-page session.

Mike, 2026-10-31:
- "1) it's yours" (the data side);
- "2) yes!" (a TablEdit print to PDF on mike-air, to find out how TablEdit
  places text above or below the staff).

## Pieces

| ID | Piece | Depends on | Model / effort | Worktree | Status | Checked |
|----|-------|-----------|----------------|----------|--------|---------|
| G21a | OTF 1.3 (`track`, `kind`, `place`); importers fill `track`; writer; editor; re-import guard `COMPARED = TAKEN` | — | Sonnet / high | `g21a-annotation-track` | dispatched 2026-10-31 | |
| G21d1 | `parseTabChord` / `parse_tab_chord` with a shared fixture; corpus report | — | Sonnet / medium | `g21d-tab-chord-parser` | done, merged into the batch (bdd0be965) | read `tab-chord.js`; parser + chord-token tests 98 ✓ / pytest 144 ✓; corpus report read: 32,249 of 45,802 texts parse (85 distinct), fingering letters, part labels and banners stay text; `(A [G])` (124) stays text, a follow-up |
| G21b + G21d2 | Importers: typed t/i/m/r/p → `note.finger`; parsed chords → `kind: "chord"`; validators check chord texts; writer keeps `finger` | G21a, G21d1 | — | — | todo | |
| re-import | `reimport_tef_tabs.py` dry run → counts to Mike → real run | all of the above | me | — | todo | |
| `place` ground truth | TablEdit 3.06 prints 5 + 3 files to PDF on mike-air; compare against the string rows | — | mike-air agent f0c557a | `mike-air:~/g21-place/` | 5 PDFs read; 3 more V2 files printing | V3 (24588, 24908, 28388, 28676): every text above, byte 7 a small nudge. V2 (1481): text drawn at its row; top row above, middle on the string line, bottom row below |
| G21e | Chord picker in the tab editor (`lead-editor/chord-menu-model.js`, `chord-menu.js` with optional callbacks) | G21d2 | — | — | todo | |

The batch branch is `feature/g21-data`, worktree `g21-data`. The pieces merge
into it.

## Log

- 2026-10-31 · Both pieces dispatched off main, after #348.
  - G21a (Sonnet high, e2e on 8341). The brief keeps it out of `renderers/`
    and the shared seams. It doesn't regenerate `parsed/` or `works/`. It
    makes the re-import baseline a `--baseline` option if hard-coded.
  - G21d1 (Sonnet medium). Parser only, built on `chords.js` `isValidChord`
    and `chord_chart.py`; fixture `tests/fixtures/tab-chord/tab-chords.json`;
    corpus report in `/tmp/g21d/`.
- 2026-10-31 · `place` test files, picked by my census of where texts sit:
  1481 FMB (V2, 4 tracks; 444 top / 107 middle / 426 bottom), 24588 (9/10/10,
  1 dy), 24908 (3 tracks, 24 bottom), 28388 (16 middle), 28676 (16 non-zero
  dy).
  - The manifest is `/tmp/g21-place/manifest.json`: measure, track and string
    within the track for every text.
  - Sent to mike-air agent f0c557a: print each to PDF into
    `~/g21-place/pdf/`, close without saving, quit.
- 2026-10-31 · G21d1 back (bdd0be965).
  - Parts are `{chord, optional, shape, ext}` or null: "em" → Em; "(em)" →
    optional; "A (G)" → shape G; "A(7)" → ext 7.
  - Built on `isValidChord`. A lowercase root counts only as a minor; a bare
    "o" quality (Go, Do) and A1–B2 (part labels) are refused.
  - Shape sent to the G19 session.
- 2026-10-31 · TablEdit PDFs, first 5 (mike-air; TablEdit quit, inputs
  unchanged).
  - **V3:** all texts are drawn above the staff whatever their row: 24908's
    row-5 chord names, 28388's row-4 names, 24588's row-5 "G". Byte 7 = 10
    (28676) nudges the text by a few points.
  - **V2, FMB 1481:** text sits at its string row. Chord names on row 1 are
    above, the guitar's "etc." on row 4 is on that string line, and the
    banjo's m/i on row 5 are below the staff.
  - Asked for 3 more V2 files (15127, with lyrics on the middle and bottom
    rows; 967, with 92 bottom-row texts; 2992, with 6 tracks) before writing
    the importer rule.
- 2026-10-31 · TablEdit PDFs, rounds 2–4 (mike-air). **"Above or below" is a
  stored flag, not the string row.**
  - Tennessee Waltz (15127) puts its lyrics on rows 4 and 5, and they print
    above. Blackberry Blossom (967) puts 92 chord names on the bottom row,
    and they print above too.
  - In V2 the flag is text-record byte 4. Its low bits (3 or 5) look like
    style. The high bits, against TablEdit's printout:
    - `0x00`: above. 16,306 records in 280 files.
    - `0x20`: below the staff. 4,140 records in 33 files: FMB's m/i
      (`0x23`) and Brilliancy's "Part A:" (m2).
    - `0x60`: on the staff near its string. 342 records in 15 files: FMB's
      guitar "etc." (`0x63`) and Fire on the Mountain's "-P" (m17).
    - `0x40`: prints above like `0x00`. 174 records in 7 files, e.g. Over
      the Waterfall m9.
  - V3: record byte 9 is 0x03 on almost every text, and no corpus V3 text
    has 0x20 or 0x40. But writing 0x23, 0x63 or 0x43 into byte 9 of
    Temperance Reel (m1, m3, m5) changed nothing; all three still print
    above. So V3 encodes "below" elsewhere, or not at all.
  - Next: have TablEdit save FMB 1481 and Brilliancy 11655 as V3 copies, and
    read how it encodes their below texts. The writer only writes V3.
  - Agreed with the G19 session:
    - `0x20` → `place: "below"`; everything else → absent (above).
    - The writer restores the original byte.
    - `track` and `place` are independent.
  - Told the G21a agent: no last-row placement for "below"; texts go on the
    track's first row or keep their original row.
- 2026-10-31 · **V3 encoding found.** TablEdit saved FMB 1481 and Brilliancy
  11655 as V3 copies (`/tmp/g21-place/v3/`). Placement is record byte 11:
  - `0` above (457 FMB texts, 53 Brilliancy);
  - `1` below (FMB's 426 m/i, Brilliancy's 3 "Part A:");
  - `3` on the staff (FMB's 88 "etc." and 6 others).
  - Byte 9 is style (3).
  - So V2 byte 4 bits 5–6 carry the same value. `2` prints above
    (Westphalia's 29 texts are at 2). V3 files have them too (21627: 16; 28162: 114). My "207 in 21627" was the corpus-wide count for that byte pattern; the G21a agent caught it.
  - Rule sent to the G21a agent: the importers set `"below"` iff the value
    is 1; the writer keeps the original byte, else writes 1 or 0; `place`
    round-trips.
  - Contract wording proposed to the G19 session; I edit the spec in the
    G21a PR.
  - mike-air: all inputs unchanged (md5); TablEdit quit. Scratch files are in
    `mike-air:~/g21-place/`.
