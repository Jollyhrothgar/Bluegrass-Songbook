# Web-Chords Source

Chord pages fetched from various chord sites (Feb 2026), parsed to ChordPro and
imported to `works/` (Jul 2026).

Status: finished. 415 works cite `source: web-chords`: the 144 from this import
plus the later bounty-hunt imports (`sources/bounty-hunt/`), which reuse this
parser and importer. Of 325 raw pages, 239 parsed and 86 were rejected by the
quality gate. Of the 239, 144 became new works, 79 were skipped because the work
already had chords, and 16 are merge candidates (work exists with no chords,
left untouched).

## Origin

`scripts/lib/fetch_chords.py` searched DuckDuckGo for each of the 833 Strum
Machine titles in `docs/data/sm_missing_vocals.json` and saved whatever chord
page came back. Each `raw/*.txt` starts with a `# title:` (the catalogue name),
`# source_url:` and `# fetched_at:` header. There is no other manifest. Sites:
Ultimate Guitar (302), e-chords (14), cowboylyrics (8), azchords (1).
`raw/` and `parsed/` are tracked.

## Commands

```bash
uv run python sources/web-chords/src/parser.py                    # raw -> parsed/*.pro + parse_report.json
uv run python sources/web-chords/src/parser.py --file act-naturally.txt   # one file, verdict on stderr
uv run python sources/web-chords/src/works_importer.py --dry-run
uv run python sources/web-chords/src/works_importer.py            # never modifies an existing work
uv run pytest tests/test_web_chords_parser.py
```

`parser.py` also takes `--raw-dir`, `--out-dir` and `--report`, and
`works_importer.py` takes `--parsed-dir`, `--report` and `--new-ids`;
`sources/bounty-hunt` relies on these.

## Rules worth keeping

- Chord placement: column `c` of the chord line maps to column `c` of the lyric
  line, snapped to a word boundary, inserted right to left. Do not reuse
  `sources/classic-country`'s `map_chord_positions_to_lyrics`; it scales by line
  length and drifts left when the chord line is padded. A test in
  `tests/test_web_chords_parser.py` pins this.
- Quality gate: a wrong chart is worse than none, so rejects go to
  `parse_report.json` and never reach `parsed/`. Reasons: `title-mismatch` (67),
  `duplicate` (10), `no-lyrics-instrumental` (5), `tab-only` (4),
  `low-chord-validity` (`chord_validity()` in `src/parser.py`: of the tokens on chord-shaped lines, under `MIN_CHORD_VALIDITY` = 60% pass `is_chord_token`).
- Title verification compares the catalogue title to the URL slug of the page the
  search landed on; that is the only evidence it is the right song. Always verify
  on the unshortened title (shortening first scored a title against itself and
  passed the wrong "Big Country" song). Same-title-plus-one-word pages (a Pavement
  "Box Elder" for the Beetles' title) are why the rules require a tail of two or
  more words. The matching rules are in the parser's docstrings.
- Residual risk: a page with the right title but a different song passes the gate.
  `parse_report.json`'s `review` list flags emitted files whose page artist
  disagrees with the catalogue attribution. `black-diamond` and `goodbye-girls`
  were removed this way, which is why `new_work_ids.txt` has 142 ids against 144
  created in `import_report.json`.
- Import policy: existing works are never modified. New works get
  `provenance.source: web-chords`, a per-song `source_url`, and no tags (the
  build derives JamFriendly/Modal, and LLM tagging assigns genre).
- The frontend shows these as "Original chord chart" linking `x_source_url`
  (`sourceDisplayNames` in `docs/js/song-view.js`).
