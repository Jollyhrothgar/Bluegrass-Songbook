# Bounty Hunt — wanted-songs acquisition campaign (Aug 2026)

Systematic fulfillment of the bounty board — the ledger-vouched songs the
songbook lacks. Vocals/Gospel get lyrics+chords charts; instrumentals get
tabs (handled via the Hangout TEF pipeline and other tab sources, not this
directory).

`docs/data/wanted_songs.json` is **build output**, not a hand-edited list:
`src/build_wanted.py` derives it from `docs/data/bluegrass_catalogue.json`
minus the corpus, adjusted by `curation/bounty_decisions.yaml`. Change the
list by editing the YAML and rebuilding. For the current size, read the file
rather than trusting a number here:

```bash
uv run python -c "import json; print(len(json.load(open('docs/data/wanted_songs.json'))['songs']))"
```

## Pipeline

```
docs/data/wanted_songs.json (Vocal+Gospel)
        │  src/ug_scrape.py — UG mobile API search + validation
        ▼
extractions/{slug}.json   candidate + validation evidence (every song)
raw/{slug}.txt            web-chords-format chart (accepted only)
        │  sources/web-chords/src/parser.py --raw-dir ... --out-dir ...
        ▼
parsed/{slug}.pro         quality-gated ChordPro
        │  src/stage_import.py — holds needs_review until reviewed
        ▼
staging/*.pro             validated charts only
        │  sources/web-chords/src/works_importer.py --parsed-dir staging
        ▼
works/{slug}/             new works (never overwrites existing)
```

## Validation (right song, right version)

Scraper-side, recorded in each extraction:
- **Title**: normalized match or ≥0.88 similarity, else candidate skipped.
- **Artist tiers**: `hint` (wanted-list artist hints) > `mb-recording`
  (bluegrass_recordings.json title→artist ledger, MusicBrainz-derived) >
  `bluegrass-artist` (global MB bluegrass artist set) > `traditional` >
  `unverified`.
- **Lyric overlap** vs BluegrassLyrics parsed lyrics when available:
  ≥0.35 confirms (overrides unverified artist), <0.15 rejects the chart.
- `unverified` without lyric confirmation ⇒ `needs_review: true`.

Parser-side (independent): title/URL-slug cross-check, chord validity,
debris/tab-only gates — the web-chords quality gate.

Review-side: `needs_review` charts are held by `stage_import.py` until a
knowledge-based review verdict lands in `review_decisions.json`
(`--queue` prints the pending items with lyric snippets). Pilot proof:
the queue caught Xavier Rudd's "Stoney Creek" (wrong song) and a junk
"Instrumental" wanted-entry.

## Commands

```bash
uv run python sources/bounty-hunt/src/ug_scrape.py --dry-run
uv run python sources/bounty-hunt/src/ug_scrape.py            # resumable
uv run python sources/bounty-hunt/src/stage_import.py --queue # review queue
uv run python sources/bounty-hunt/src/stage_import.py         # stage approved
uv run python sources/web-chords/src/parser.py \
    --raw-dir sources/bounty-hunt/raw \
    --out-dir sources/bounty-hunt/parsed \
    --report sources/bounty-hunt/parse_report.json
uv run python sources/web-chords/src/works_importer.py \
    --parsed-dir sources/bounty-hunt/staging \
    --report sources/bounty-hunt/import_report.json \
    --new-ids sources/bounty-hunt/new_work_ids.txt
```

Works land with `x_source web-chords` provenance (same pipeline); the
true origin is in each part's `source_url`.
