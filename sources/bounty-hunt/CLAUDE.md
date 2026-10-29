# Bounty Hunt

Campaign (Aug 2026) to fill the bounty board: songs in the canonical
bluegrass catalogue (`docs/data/bluegrass_catalogue.json`, built by
`src/build_catalogue.py` from MusicBrainz recordings by bluegrass artists) that the
songbook lacks. Vocal and Gospel entries got lyrics-and-chords charts from this
directory; instrumentals got tabs from `src/tef_bounty.py`, which maps them to the
Hangout TEF catalogs and imports through `sources/banjo-hangout/src/works_importer.py`
(`src/tunearch_bounty.py` reports TuneArch matches).

Status: the pipeline ran and the board build is complete (`CLEANUP-PLAN.md`). No work cites `bounty-hunt` as a source: charts land as
`source: web-chords` with the real origin in each part's `source_url`.

`docs/data/wanted_songs.json` is build output. `src/build_catalogue.py` (local,
MusicBrainz) produces `docs/data/bluegrass_catalogue.json`; `src/build_wanted.py`
subtracts the corpus and applies `curation/bounty_decisions.yaml`. Change the list
by editing the YAML and rebuilding.

## Chart pipeline

`src/ug_scrape.py` searches the Ultimate Guitar mobile API for each wanted
Vocal/Gospel title and writes `extractions/<slug>.json` (candidate plus
validation evidence) and, for accepted charts, `raw/<slug>.txt` in web-chords
format. `sources/web-chords/src/parser.py` then applies its quality gate to
`parsed/`. `src/stage_import.py` copies validated charts to `staging/`, holding
`needs_review` ones until `review_decisions.json` has a verdict. Then
`sources/web-chords/src/works_importer.py` creates works and never overwrites.
`mcb_fetch.py` and the `*_mcb*` files are a second batch: charts from mattcbruno.com's
song library (public Google Docs listed in `mcb_manifest.json`) instead of Ultimate
Guitar, parsed by the same web-chords parser;
`bl_fallback.py` imports lyrics-only charts from `sources/bluegrass-lyrics/parsed`.

Validation in `ug_scrape.py`: title match (normalized, or similarity 0.88 or
more); artist tiers `hint` > `mb-recording` > `bluegrass-artist` > `traditional`
> `unverified`; lyric overlap against the BluegrassLyrics text (0.35 or more
confirms, under 0.15 rejects). `unverified` with no lyric confirmation sets
`needs_review`.

```bash
uv run python sources/bounty-hunt/src/ug_scrape.py --dry-run
uv run python sources/bounty-hunt/src/ug_scrape.py             # resumable
uv run python sources/bounty-hunt/src/stage_import.py --queue  # pending review items with snippets
uv run python sources/bounty-hunt/src/stage_import.py          # stage approved
uv run python sources/web-chords/src/parser.py --raw-dir sources/bounty-hunt/raw \
    --out-dir sources/bounty-hunt/parsed --report sources/bounty-hunt/parse_report.json
uv run python sources/web-chords/src/works_importer.py --parsed-dir sources/bounty-hunt/staging \
    --report sources/bounty-hunt/import_report.json --new-ids sources/bounty-hunt/new_work_ids.txt
```

The wanted-list size is in the file: `len(json.load(open('docs/data/wanted_songs.json'))['songs'])`.
