# Grassiness Scoring System

Automated detection of bluegrass songs using MusicBrainz data.

## Problem

Artist-level tagging is too coarse. Dolly Parton has bluegrass albums, so all 156 of her songs were tagged as "Bluegrass" - even "9 to 5" and "Jolene". We need song-level detection.

## Solution: Grassiness Score

A numerical score (0-100+) indicating how "bluegrass" a song is, based on two signals:

### Signal 1: Curated Artist Covers (Primary)

If Bill Monroe, the Stanley Brothers, or Del McCoury recorded a song, it's probably bluegrass.

**How it works:**
1. Query MusicBrainz for all recordings by 292 curated bluegrass artists
2. Match against our song titles (normalized for fuzzy matching)
3. Weight by artist era (from `build_artist_database.py`):
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

## Thresholds

Thresholds were empirically determined by analyzing what % of core bluegrass artist catalogs pass each threshold. At ≥20, 71% of what legends recorded qualifies.

| Score | Tag Added | Count | Example |
|-------|-----------|-------|---------|
| ≥50 | `BluegrassStandard` + `Bluegrass` | 205 songs | "Blue Moon of Kentucky" (161) |
| 20-49 | `Bluegrass` | 501 songs | "Old Home Place" (22) |
| 10-19 | (borderline) | 750 songs | "Wagon Wheel" (10) |
| <10 | (crossover) | 4,420 songs | "Jolene" (10), "9 to 5" (1) |

See `analytics/grassiness_analysis.ipynb` for visualizations and threshold analysis.

## Files

| File | Purpose |
|------|---------|
| `grassiness.py` | Main scoring module |
| `docs/data/bluegrass_recordings.json` | Cache: recordings by curated artists |
| `docs/data/bluegrass_tagged.json` | Cache: recordings with bluegrass tags |
| `docs/data/grassiness_scores.json` | Computed scores for index songs |

## Usage

```bash
# Build caches (requires MusicBrainz database, ~22s total)
MB_PORT=5440 uv run python scripts/lib/grassiness.py --build-all

# Score the index (uses cached data, ~1s)
uv run python scripts/lib/grassiness.py --score-index

# Test specific songs
uv run python scripts/lib/grassiness.py --test

# Look up a title
uv run python scripts/lib/grassiness.py --lookup "Wagon Wheel"
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

| Song | Score | Expected | Result |
|------|-------|----------|--------|
| Blue Moon of Kentucky | 88 | High | ✓ |
| Foggy Mountain Breakdown | 56 | High | ✓ |
| Rocky Top | 44 | High | ✓ |
| Roll in My Sweet Baby's Arms | 104 | High | ✓ |
| Jolene | 10 | Low | ✓ |
| 9 to 5 | ~1 | Low | ✓ |
| Crazy (Patsy Cline) | 0 | Low | ✓ |
| Your Cheatin' Heart | 1 | Low | ✓ |
| Silver Dagger (Dolly's bluegrass) | 3 | Medium | ✓ |
| Little Sparrow (Dolly's bluegrass) | 9 | Medium | ✓ |

## Future Improvements

1. **Fuzzy matching**: Use edit distance for slight title variations
2. **More artists**: Expand curated list based on analysis
3. **Era weighting**: Newer recordings might indicate a "standard"
4. **Exclude covers**: Don't count covers by non-bluegrass artists
5. **Album detection**: Identify bluegrass albums and tag all songs

## Integration

The grassiness score is integrated into the build pipeline:

1. **Index build** (`tag_enrichment.py`): Adds `BluegrassStandard` and `Bluegrass` tags based on score thresholds
2. **Homepage collections** (`docs/js/collections.js`):
   - "Bluegrass Standards" collection uses `tag:BluegrassStandard` (205 songs)
   - "All Bluegrass" collection uses `tag:Bluegrass` (1,199 songs)
3. **Song metadata**: Each song gets a `grassiness` field with its numeric score

## Dependencies

- MusicBrainz database (local PostgreSQL, port 5440)
- psycopg2 for database queries
- Caches are committed to git so CI doesn't need MusicBrainz access
