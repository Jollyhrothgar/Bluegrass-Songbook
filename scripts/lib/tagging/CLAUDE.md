# Grassiness scoring (scripts/lib/tagging)

Song-level "how bluegrass is this" score from MusicBrainz data. The module is
`scripts/lib/tagging/grassiness.py` (there is no `scripts/lib/grassiness.py`).

What the score does today: it feeds each index row's `covering_artists` /
`covering_years` and the analysis notebooks. It does not apply genre tags.
LLM tagging owns genre tags (`batch_tag_songs.py` -> `docs/data/llm_tags.json`,
see "Tag system" in `scripts/lib/CLAUDE.md`).

## How the score is built

1. Artist covers: every recording by the curated artists in
   `docs/data/bluegrass_artist_database.json` is matched to our titles
   (normalized: lowercase, no accents, no parenthetical suffix, no leading
   article, punctuation other than apostrophes removed). Each is weighted by
   the artist's era from `begin_year` (set by `build_artist_database.py`);
   tiers are `TIER_WEIGHTS` plus `TIER_OVERRIDES` in `grassiness.py`.
2. MusicBrainz tags: recordings tagged "bluegrass", "newgrass", "old-time"
   (directly or through their release) add a tag score capped at +10.
3. `total = artist_score + min(tag_score, 10)`.

Works that score 0 are not written to `grassiness_scores.json`, so "Jolene"
is absent by design. Inspect one score with
`jq '.["<work-id>"].score' docs/data/grassiness_scores.json`, or score a title
live with `--lookup`.

## Commands

All are run from the repo root. The caches are tracked in git, so CI never
needs MusicBrainz; `./scripts/utility refresh-musicbrainz` runs the rebuild
steps in order (and the other MusicBrainz caches).

```bash
MB_PORT=5440 uv run python scripts/lib/tagging/grassiness.py --build-all   # or --build-cache / --build-tagged
uv run python scripts/lib/tagging/grassiness.py --score-index              # cached data only
uv run python scripts/lib/tagging/grassiness.py --lookup "Wagon Wheel"
uv run python scripts/lib/tagging/grassiness.py --test
```

Rebuilding needs the local MusicBrainz database (psycopg2, `uv sync --extra
analytics`). `MB_PORT` defaults to 5432 in the code, so set it to 5440.

## Files

| File | Purpose |
|------|---------|
| `grassiness.py` | Scoring |
| `build_artist_database.py` | Builds the curated artist list |
| `verify_artists.py` | Confirms each work's scraped `artist` recorded the title (not a grassiness signal; feeds `covering_artists`) |
| `docs/data/bluegrass_artist_database.json` | Curated artists with `begin_year` |
| `docs/data/bluegrass_recordings.json`, `bluegrass_tagged.json` | Caches of the two MusicBrainz queries |
| `docs/data/grassiness_scores.json` | Computed scores |
| `docs/data/verified_artists.json` | `{work_id: {name, year}}` for confirmed scraped artists |

## Where the score is consumed

- `tag_enrichment.py` (`load_grassiness_scores`, `merge_covering_artists`) is
  the only consumer in the build. `covering_artists` lists the bluegrass artists
  who recorded the song, sorted by first recording year then tier. A title is ambiguous when works sharing a normalized
  title have under 40% overlap in the stemmed first 20 lyric words (decided in
  `tag_enrichment.py` during the index build); those are skipped unless the song's own artist is a known bluegrass artist.
  `merge_covering_artists` also adds the work's scraped `artist` when
  `verified_artists.json` confirms it. The frontend shows this as "Recorded by:
  Bill Monroe (1947), ..." and searches it. An unconfirmed scraped artist is
  never shown or searched.
- Index rows carry no `grassiness` field (`grep -c grassiness
  docs/data/index.jsonl` is 0).
- Homepage collections (`docs/js/collections.js`) use the LLM-derived tags
  `BluegrassStandard` and `Bluegrass`, not this score.
- `analytics/grassiness_analysis.py` and `analytics/bluegrass-research/`.

## Gotchas

- `format_artists` renders the scorer's `(name, earliest_year)` tuples as
  `Bill Monroe (1947)` and prints no year for `UNKNOWN_YEAR` (9999, a sort-last
  sentinel, not a date). Joining those tuples as strings crashed `--test` and
  `--lookup`; `tests/test_grassiness.py` pins it.
- Reference scores (they move on every rebuild): "Foggy Mountain Breakdown" 124,
  "Old Home Place" 51, "Wagon Wheel" 10, "Crazy" 7.
