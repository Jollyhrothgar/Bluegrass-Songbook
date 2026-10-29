# TuneArch Source

ABC notation for fiddle tunes and instrumentals from
[The Traditional Tune Archive](https://tunearch.org/), stored as ChordPro files
with an embedded `{start_of_abc}` block.

Status: finished import; 438 works cite `source: tunearch`. `parsed/` holds 560 `.pro`
files (tracked); `raw/` is a gitignored HTML cache; `tune_catalog.json` records
fetch status. `src/tune_list.py` is the curated list of instrumentals (`TUNE_LIST`)
the batch fetch walks.

```bash
uv run python sources/tunearch/src/batch_fetch.py --tune "Salt Creek"
uv run python sources/tunearch/src/batch_fetch.py --limit 10
uv run python sources/tunearch/src/batch_fetch.py --search "bluegrass reel" --limit 20
./scripts/bootstrap --quick        # rebuild the index afterwards
```

- Charts carry `x_source tunearch`, `x_type instrumental`, `x_rhythm` and
  `x_tunearch_url` (the frontend links it as "TuneArch.org").
- `src/scraper.py` waits 1 second between requests and caches HTML in `raw/`.
  Keep both when re-running.
- ABC lives inside the lead sheet, so the index exposes it as `has_abc`, not as a
  separate part (see root `CLAUDE.md`).
