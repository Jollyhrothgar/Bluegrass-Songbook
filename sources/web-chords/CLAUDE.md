# Web-Chords Source

325 chord pages fetched from various chord sites (Feb 2026), parsed to
ChordPro and imported to `works/` (Jul 2026).

## Status: COMPLETE (Jul 2026)

| Stage | Count |
|-------|-------|
| Raw pages fetched | 325 |
| Parsed to ChordPro | 239 |
| Rejected by the quality gate | 86 |
| New works created | 144 |
| Skipped (work already had chords) | 79 |
| Merge candidates (work exists, no chords) | 16 |

## Where it came from

`docs/data/sm_missing_vocals.json` lists 833 Strum Machine catalogue titles the
collection lacked. `scripts/lib/fetch_chords.py` searched DuckDuckGo for each,
followed whatever chord site came back, and saved the page text with a
metadata header:

```
# title: Act Naturally                     <- the Strum Machine catalogue name
# source_url: https://tabs.ultimate-guitar.com/tab/the-beatles/act-naturally-chords-816028
# fetched_at: 2026-02-01 21:42:15

<raw page text>
```

Sites represented: Ultimate Guitar (302), e-chords (14), cowboylyrics (8),
azchords (1). There is no manifest — the header *is* the manifest.

## Structure

```
web-chords/
├── raw/                   # 325 .txt pages with metadata headers
├── parsed/                # 239 .pro ChordPro lead sheets
├── src/
│   ├── parser.py          # raw -> ChordPro (+ quality gate)
│   └── works_importer.py  # parsed/*.pro -> works/
├── parse_report.json      # per-file verdicts, stats, reject reasons
├── import_report.json     # created / skipped / merge candidates
└── new_work_ids.txt       # 142 work ids — the 144 created minus the two
                           #   since-deleted suspects (see Residual risk)
```

## Commands

```bash
# Parse everything (writes parsed/*.pro + parse_report.json)
uv run python sources/web-chords/src/parser.py

# One file, ChordPro on stdout and the verdict on stderr
uv run python sources/web-chords/src/parser.py --file act-naturally.txt

# Import to works/ (never modifies an existing work)
uv run python sources/web-chords/src/works_importer.py --dry-run
uv run python sources/web-chords/src/works_importer.py

# Tests
uv run pytest tests/test_web_chords_parser.py
```

## Formats in the raw corpus

Everything is monospace chords-over-lyrics; what varies is the labelling and
the debris.

| Family | Files | Shape |
|--------|-------|-------|
| Ultimate Guitar | 302 | `[Verse 1]` / `[Chorus]` / `[Middle]` bracket markers above every stanza; sections separated by two or more blank lines |
| e-chords | 14 | `Intro:D G D A D` colon labels, `( D G D A D )` turnaround grids, stanzas separated by single blank lines |
| cowboylyrics | 8 | title/artist/album preamble, `hide ad ⨯` debris, some pages inline their chords as `(A)dreaming`, some double-space every lyric line, some are pure tablature |
| azchords | 1 | `#1.` verse numbering, `CHORUS:` labels |

Debris the parser strips: UG "PLEASE NOTE" banners, uploader credits,
`hide ad`, site URLs, chord-diagram lines (`A/E: 020001`), tablature blocks,
bar-grid furniture (`|`, `/`, `x2`), transposition cheat-sheets (`G = A`),
count-offs, signature footers after a long horizontal rule, and chart
commentary that reaches the lyric slot.

## Chord placement

Column `c` of the chord line is column `c` of the lyric line, snapped to a
word boundary (forward over whitespace, else to the nearer of the containing
word's start and the next word's start), and chords are inserted
right-to-left so an earlier insertion can't shift a later offset.

**Do not** copy `sources/classic-country`'s `map_chord_positions_to_lyrics`
here: it scales `col / len(chord_line) * len(lyric_line)`, which drifts left
whenever the chord line is padded past the end of the lyrics — the normal case,
since the last chord sits to the right of the last word. `tests/
test_web_chords_parser.py::TestChordPlacement::
test_no_column_drift_when_chord_line_is_padded` pins the correct behaviour.

## Quality gate

These pages reconstruct canonical bluegrass repertoire, so a wrong chart is
worse than no chart. Rejected files are reported in `parse_report.json` and
never written to `parsed/`.

| Reason | Count | Meaning |
|--------|-------|---------|
| `title-mismatch` | 67 | the page the search engine returned is a different song |
| `duplicate` | 10 | two catalogue entries resolved to the same page |
| `no-lyrics-instrumental` | 5 | chord grid with no lyrics (fiddle-tune backing chart) |
| `tab-only` | 4 | tablature, no chord symbols |
| `low-chord-validity` | 0 | under 60% of chord-slot tokens parse as chords |

### How title verification works

The header title is the Strum Machine catalogue name; the URL slug is the page
the fetcher actually landed on. Agreement between the two is the only evidence
the right song came back. A file passes if any of:

1. the concatenated significant tokens agree ≥90% (`Good Night Irene` vs
   `goodnight-irene`, `Ground Hog` vs `groundhog`);
2. ≥70% of the requested tokens appear on the page **and** the first one does;
3. ≥70% token overlap **and** ≥85% concatenated agreement;
4. the page's whole title sits inside the catalogue's with the extra words in
   *front* (`Going Across the Sea` for the page's `Across the Sea`);
5. the catalogue appended an attribution — the page's title is the head of the
   catalogue's, the tail is ≥2 words and neither opens nor follows a function
   word (`Fox on the Run` + `Bill Emerson`).

Three traps this was built to avoid, all of which produced wrong charts:

* **Circular evidence.** Shortening the title to match the slug and then
  scoring it against that slug passed `Big Country Jimmy Martin` as the band
  Big Country's `In a Big Country`. Verification runs on the unshortened title;
  the shortening is display-only and happens after.
* **Same title plus one word.** `Box Elder` + `Beetles` is Pavement,
  `Crazy Finger` + `Blues` is the Grateful Dead, `Black Velvet` + `Waltz` is
  Alannah Myles, `Hound Dog` + `Blues` is Elvis. Hence the ≥2-word tail in (5)
  and the 0.70 (not 0.67) floor in (2).
* **Mid-title splits.** `Charlie Brooks` + `and Nellie Adair` and
  `Going Down to` + `Cairo` are single titles the page truncated.

### Residual risk

A page whose title genuinely matches but whose *song* differs cannot be caught
from the slug. `parse_report.json`'s `review` list flags the 8 emitted files
where the catalogue's attribution disagrees with the page's artist — usually a
cover (Larry Sparks doing a Carter Family song), occasionally a collision.
The two known suspects, `black-diamond` (page artist Kiss) and `goodbye-girls`
(page artist Bread), **have since been removed**: both appear in
`import_report.json`'s `created_works` but neither exists in `works/` nor in
`new_work_ids.txt` — which is exactly why that file lists 142 ids and the
report says 144 created.

## Import policy

`works_importer.py` never modifies an existing work. Titles are matched
exactly-normalized first (accents folded, apostrophes closed up, `Cuckoo, The`
read as `The Cuckoo`), then article-insensitively.

* existing work whose lead sheet already has chords → skipped
* existing work that is lyrics-only or has no lead sheet → reported as a merge
  candidate, untouched
* otherwise → new work, `provenance.source: web-chords`,
  `imported_at: '2026-07-31'`, `source_url` recorded per song

New works carry **no tags**: the build pipeline derives `JamFriendly`/`Modal`
from the chords and LLM tagging assigns genre. Asserting a genre at import
would be inventing metadata the page never had.

Every created id was checked against `curation/registry.yaml` `suppressed:`,
`docs/data/deleted_songs.json` and `curation/index_prune.csv` — no collisions,
so all 144 index as `indexed: true`. `curation/` was not edited.

## Attribution

`docs/js/song-view.js` renders these as "Original chord chart" linking to the
per-song `x_source_url`.

## Related

- `scripts/lib/fetch_chords.py` — the fetcher
- `docs/data/sm_missing_vocals.json` — the 833-title gap list
- `sources/bluegrass-lyrics/CLAUDE.md` — the other scraped-lyrics import
- `sources/banjo-hangout/src/works_importer.py` — the importer this follows
