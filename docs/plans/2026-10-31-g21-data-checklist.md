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
| G21d1 | `parseTabChord` / `parse_tab_chord` with a shared fixture; corpus report | — | Sonnet / medium | `g21d-tab-chord-parser` | dispatched 2026-10-31 | |
| G21b + G21d2 | Importers: typed t/i/m/r/p → `note.finger`; parsed chords → `kind: "chord"`; validators check chord texts; writer keeps `finger` | G21a, G21d1 | — | — | todo | |
| re-import | `reimport_tef_tabs.py` dry run → counts to Mike → real run | all of the above | me | — | todo | |
| `place` ground truth | TablEdit 3.06 prints 5 files to PDF on mike-air; compare against the string rows | — | mike-air agent f0c557a | `mike-air:~/g21-place/` | dispatched 2026-10-31 | |
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
