# Grassiness Scoring System

Song-level bluegrass scoring from MusicBrainz data.

> **What it does today**: the score feeds each index row's `covering_artists`
> (and analysis notebooks). It **no longer applies genre tags** — LLM tagging
> owns that now. The threshold table below is history, not behaviour. See
> "Integration".
>
> **Where it lives**: `scripts/lib/tagging/grassiness.py`. There is no
> `scripts/lib/grassiness.py`.

## Problem

Artist-level tagging is too coarse. Dolly Parton has bluegrass albums, so all 156 of her songs were tagged as "Bluegrass" - even "9 to 5" and "Jolene". We need song-level detection.

## Solution: Grassiness Score

A numerical score (0-100+) indicating how "bluegrass" a song is, based on two signals:

### Signal 1: Curated Artist Covers (Primary)

If Bill Monroe, the Stanley Brothers, or Del McCoury recorded a song, it's probably bluegrass.

**How it works:**
1. Query MusicBrainz for all recordings by the curated bluegrass artists in
   `docs/data/bluegrass_artist_database.json` (299 on 2026-08-19 — count it
   with `jq '.artists | length' docs/data/bluegrass_artist_database.json`
   rather than trusting a number here)
2. Match against our song titles (normalized for fuzzy matching)
3. Weight by artist era. `build_artist_database.py` supplies each artist's
   `begin_year`; the tiering itself is `TIER_WEIGHTS` + `TIER_OVERRIDES` in
   `grassiness.py`:
   - **Tier 1 (×4)**: Founding figures (pre-1960) - Bill Monroe, Flatt & Scruggs, Stanley Brothers
   - **Tier 2 (×2)**: Classic era (1960-1989) - Del McCoury, Tony Rice, J.D. Crowe, Doc Watson
   - **Tier 3 (×1)**: Modern era (1990+) - Billy Strings, Punch Brothers, Molly Tuttle

### Signal 2: MusicBrainz Tags (Secondary)

Community-sourced tags catch songs by artists not in our curated list.

**How it works:**
1. Query recordings tagged "bluegrass", "newgrass", "old-time", etc.
2. Query recordings from releases (albums) with those tags
3. Add tag score (capped at +10) to the artist score

### Combined Score

```
total_score = artist_score + min(tag_score, 10)
```

## Thresholds (HISTORICAL — grassiness no longer adds tags)

⚠️ **The score does not tag anything any more.** Genre tags come from LLM
tagging (`batch_tag_songs.py` → `docs/data/llm_tags.json`); `tag_enrichment.py`
loads `grassiness_scores.json` only to build each row's `covering_artists`
("display only, not for tagging" — its own comment at `tag_enrichment.py:418`),
and the string `BluegrassStandard` does not appear in that file at all. See
"Integration" below for what the score actually feeds today.

The bands below are kept because they describe how the score is *shaped* and
what the numbers mean, not because a build applies them:

| Score | Meant (historically) | Example |
|-------|----------------------|---------|
| ≥50 | `BluegrassStandard` + `Bluegrass` | "Blue Moon of Kentucky" (161), "Old Home Place" (51) |
| 20-49 | `Bluegrass` | "Handsome Molly" (49), "Dreaming Of A Little Cabin" (38) |
| 10-19 | (borderline) | "Wagon Wheel" (10) |
| <10 | (crossover) | "Crazy" (7), "Little Sparrow" (9) |

The "at ≥20, 71% of what legends recorded qualifies" figure behind these bands
comes from the original threshold analysis and has **not** been re-verified
against the current caches.

Bucket sizes move with every re-score, so count them from the cache instead of
quoting a number here:

```bash
uv run python -c "import json,collections; d=json.load(open('docs/data/grassiness_scores.json')); print(collections.Counter('>=50' if v['score']>=50 else '20-49' if v['score']>=20 else '10-19' if v['score']>=10 else '<10' for v in d.values()))"
```

(On 2026-08-19: 209 / 487 / 749 / 4,396 across 5,841 scored works. Only works
that score above 0 appear in the cache at all — "Jolene" and "9 to 5" are not
in it.)

See `analytics/grassiness_analysis.ipynb` for visualizations and threshold analysis.

## Files

| File | Purpose |
|------|---------|
| `scripts/lib/tagging/grassiness.py` | Main scoring module (**not** `scripts/lib/grassiness.py` — there is no such file) |
| `scripts/lib/tagging/build_artist_database.py` | Builds the curated bluegrass artist database |
| `docs/data/bluegrass_artist_database.json` | The curated artist list (with `begin_year`, used for tiering) |
| `docs/data/bluegrass_recordings.json` | Cache: recordings by curated artists |
| `docs/data/bluegrass_tagged.json` | Cache: recordings with bluegrass tags |
| `docs/data/grassiness_scores.json` | Computed scores for index songs (works scoring 0 are omitted) |

All four are tracked in git so CI never needs MusicBrainz — verified with
`git ls-files docs/data/bluegrass_*.json docs/data/grassiness_scores.json`.

## Usage

The module lives in `scripts/lib/tagging/`, not `scripts/lib/`:

```bash
# Build caches (requires MusicBrainz database, ~22s total)
MB_PORT=5440 uv run python scripts/lib/tagging/grassiness.py --build-all

# Or one cache at a time
MB_PORT=5440 uv run python scripts/lib/tagging/grassiness.py --build-cache
MB_PORT=5440 uv run python scripts/lib/tagging/grassiness.py --build-tagged

# Score the index (uses cached data, ~1s)
uv run python scripts/lib/tagging/grassiness.py --score-index
```

⚠️ **`--test` and `--lookup` are currently BROKEN** (verified 2026-08-19).
Both crash printing their results with
`TypeError: sequence item 0: expected str instance, tuple found` — the CLI
`', '.join(artists)` at `grassiness.py:810` and `:823` still assumes the old
list-of-strings artist format, but the scorer now returns `(name, year)`
tuples. `--lookup` prints the score before it dies; `--test` prints nothing.
Read `docs/data/grassiness_scores.json` directly until that is fixed.

```bash
# Intended usage (crashes today — see above)
uv run python scripts/lib/tagging/grassiness.py --test
uv run python scripts/lib/tagging/grassiness.py --lookup "Wagon Wheel"
```

## Title Normalization

Titles are normalized before matching:
- Lowercase
- Remove accents (é → e)
- Remove parenthetical suffixes like "(Live)"
- Remove punctuation except apostrophes
- Remove leading articles ("The", "A")

Example: "The Grass Is Blue (Live Version)" → "grass is blue"

## Validation Results

Scores below are read out of `docs/data/grassiness_scores.json` on
**2026-08-19**; they move whenever the caches are rebuilt. Re-read them with
`jq '.["<work-id>"].score' docs/data/grassiness_scores.json` (the `--lookup`
CLI is broken, see Usage above).

| Song | Work id | Score | Expected | Result |
|------|---------|-------|----------|--------|
| Blue Moon of Kentucky | `blue-moon-of-kentucky` | 161 | High | ✓ |
| Roll In My Sweet Baby's Arms | `roll-in-my-sweet-baby-s-arms` | 160 | High | ✓ |
| Foggy Mountain Breakdown | `foggy-mountain-breakdown` | 124 | High | ✓ |
| Rocky Top | `rocky-top` | 98 | High | ✓ |
| Old Home Place | `old-home-place` | 51 | High | ✓ |
| Wagon Wheel | `wagon-wheel` | 10 | Borderline | ✓ |
| Little Sparrow (Dolly's bluegrass) | `little-sparrow` | 9 | Medium | ✓ |
| Crazy (Patsy Cline) | `crazy` | 7 | Low | ✓ |
| Jolene / 9 to 5 / Your Cheatin' Heart / Silver Dagger | — | absent | Low | ✓ (score 0 works are never written to the cache) |

## Future Improvements

1. **Fuzzy matching**: Use edit distance for slight title variations
2. **More artists**: Expand curated list based on analysis
3. **Era weighting**: Newer recordings might indicate a "standard"
4. **Exclude covers**: Don't count covers by non-bluegrass artists
5. **Album detection**: Identify bluegrass albums and tag all songs

## Integration

What the score actually feeds today:

1. **Covering artists** (`tag_enrichment.py`, the ONLY consumer in the build):
   `load_grassiness_scores()` supplies each row's `covering_artists` — which
   bluegrass artists recorded the song, sorted by tier/prominence — for search
   (`covering:`) and for display under the title. It does **not** add tags.
   Ambiguous titles are skipped unless the song's own artist is a known
   bluegrass artist, so the wrong legend isn't attributed to the wrong song.
2. **Analysis** — `analytics/grassiness_analysis.ipynb` and the
   `analytics/bluegrass-research/` scripts.

Genre tagging moved to the LLM path: `batch_tag_songs.py` writes
`docs/data/llm_tags.json` (which is where `BluegrassStandard` and `Bluegrass`
now come from), `tag_enrichment.py` applies it, and `tag_overrides.json`
subtracts trusted-user downvotes. See "Tag System" in `scripts/lib/CLAUDE.md`.

3. **Homepage collections** (`docs/js/collections.js`) read the resulting tags:
   - "Bluegrass Standards" collection uses `tag:BluegrassStandard`
   - "All Bluegrass" collection uses `tag:Bluegrass`

   Collection sizes are a property of the last build, not of this file. After
   `./scripts/bootstrap --quick`, count them:

   ```bash
   uv run python -c "import json; rows=[json.loads(l) for l in open('docs/data/index.jsonl')]; print(sum('BluegrassStandard' in (r.get('tags') or []) for r in rows), sum('Bluegrass' in (r.get('tags') or []) for r in rows))"
   ```
4. **Index rows carry no `grassiness` field.** The score stays in
   `docs/data/grassiness_scores.json`; what reaches a row is
   `covering_artists` (953 of 2,462 canon rows on 2026-08-19). Verify with
   `grep -c grassiness docs/data/index.jsonl` — it is 0.

## Dependencies

- MusicBrainz database (local PostgreSQL, port 5440)
- psycopg2 for database queries
- Caches are committed to git so CI doesn't need MusicBrainz access
