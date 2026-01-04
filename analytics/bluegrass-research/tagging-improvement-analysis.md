# Tagging Improvement Analysis

## Problem Summary

Our auto-tagging system is missing most bluegrass content because:

1. **80% of artists not in cache**: 729 of 908 artists in the index are NOT in `artist_tags.json`
2. **Bill Monroe missing**: The "Father of Bluegrass" has 46 songs but isn't tagged
3. **MusicBrainz sparsity**: Even when artists ARE in MB, bluegrass tags have low vote counts (2-4 votes)

## Current Tagging Flow

```
artist_tags.json (179 artists)
       ↓
tag_enrichment.py filters to MB_TO_TAXONOMY
       ↓
Only 24 artists with "bluegrass" tag applied
       ↓
588 songs tagged "Bluegrass"
```

## Gap Analysis: Key Bluegrass Artists

| Artist | Songs in Index | In Cache | Has BG Tag |
|--------|----------------|----------|------------|
| Bill Monroe | 46 | ❌ NO | ❌ |
| Ralph Stanley | 30 | ❌ NO | ❌ |
| J.D. Crowe | 35 | ❌ NO | ❌ |
| Doc Watson | 19 | ❌ NO | ❌ |
| Del McCoury | 14 | ❌ NO | ❌ |
| Tony Rice | 6 | ❌ NO | ❌ |
| Lester Flatt | ? | ✅ YES | ✅ |
| Earl Scruggs | ? | ✅ YES | ✅ |
| Ricky Skaggs | 135 | ✅ YES | ✅ |
| Alison Krauss | ? | ✅ YES | ✅ |

**Bill Monroe IS in MusicBrainz** with "bluegrass" tag (2 votes) - but wasn't fetched into our cache.

## Root Causes

### 1. Artist Tags Cache is Stale/Incomplete
The `artist_tags.json` was likely generated from a subset of artists, not all 908 artists in the index.

**Fix**: Run `./scripts/utility refresh-tags` to populate all artists.

### 2. MusicBrainz Tags Are Sparse for Bluegrass
Even "Bill Monroe" only has 2 votes for "bluegrass" in MusicBrainz. This is a crowdsourcing limitation.

**Fix**: Add an **authoritative bluegrass artist list** that tags artists regardless of MB votes.

### 3. No Artist Name Normalization
"Alison Krauss and Shawn Colvin" won't match "Alison Krauss" in cache lookups.

**Fix**: Implement fuzzy matching or extract primary artist names.

## Proposed Improvements

### Improvement 1: Authoritative Bluegrass Artist List

Add a static list of canonical bluegrass artists in `tag_enrichment.py`:

```python
# Artists that should ALWAYS get "Bluegrass" tag regardless of MusicBrainz
AUTHORITATIVE_BLUEGRASS_ARTISTS = {
    # First Generation (1945-1960)
    'Bill Monroe', 'Bill Monroe and the Bluegrass Boys',
    'Flatt & Scruggs', 'Lester Flatt', 'Earl Scruggs',
    'The Stanley Brothers', 'Ralph Stanley', 'Carter Stanley',
    'Jimmy Martin', 'Jim and Jesse', 'Jim & Jesse',
    'Don Reno', 'Reno & Smiley', 'The Osborne Brothers',

    # Folk Revival (1960s)
    'Doc Watson', 'The Country Gentlemen', 'Country Gentlemen',
    'The Kentucky Colonels',

    # Festival/Newgrass (1970s)
    'Tony Rice', 'J.D. Crowe', 'J.D. Crowe & the New South',
    'The Seldom Scene', 'Seldom Scene', 'New Grass Revival',
    'Sam Bush', 'John Hartford', 'Norman Blake',

    # New Traditionalists (1980s)
    'Ricky Skaggs', 'Del McCoury', 'The Del McCoury Band',
    'Keith Whitley', 'Doyle Lawson', 'Hot Rize',

    # Modern
    'Alison Krauss', 'Alison Krauss & Union Station',
    'Billy Strings', 'Molly Tuttle', 'Chris Thile',
    'Punch Brothers', 'Nickel Creek',
    'Béla Fleck', 'Bela Fleck', 'Noam Pikelny',
    'Michael Cleveland', 'Tony Trischka', 'Blue Highway',
    'The Infamous Stringdusters', 'Greensky Bluegrass',
    'Trampled by Turtles', 'The Steeldrivers',
}
```

### Improvement 2: Refresh Artist Tags Cache

Run a full refresh to populate all 908 artists:

```bash
./scripts/utility refresh-tags
```

This should query MusicBrainz for all artists currently missing.

### Improvement 3: Era-Based Tagging

Add era tags based on artist → era mapping:

```python
ARTIST_ERA_MAP = {
    'Bill Monroe': 'FirstGeneration',
    'Doc Watson': 'FolkRevival',
    'Tony Rice': 'FestivalEra',
    'Ricky Skaggs': 'NewTraditionalists',
    'Billy Strings': 'ModernBluegrass',
}
```

This enables "Browse by Era" on the landing page.

### Improvement 4: Primary Artist Extraction

For compound artist names, extract the primary artist:

```python
def extract_primary_artist(artist: str) -> str:
    """Extract primary artist from compound names.

    'Alison Krauss and Shawn Colvin' → 'Alison Krauss'
    'Ricky Skaggs & Tony Rice' → 'Ricky Skaggs'
    'Del McCoury featuring Dierks Bentley' → 'Del McCoury'
    """
    # Split on common separators
    for sep in [' and ', ' & ', ' with ', ' featuring ', ' feat. ', ' ft. ']:
        if sep in artist:
            return artist.split(sep)[0].strip()
    return artist
```

## Expected Impact

| Metric | Current | After Fix |
|--------|---------|-----------|
| Artists in cache | 179 | 908 |
| Artists with BG tag | 24 | ~80+ |
| Songs tagged "Bluegrass" | 588 | ~1,200+ |
| Bluegrass coverage | ~3% | ~7%+ |

## Implementation Order

1. **Quick win**: Add `AUTHORITATIVE_BLUEGRASS_ARTISTS` list → immediate impact
2. **Medium effort**: Run full `refresh-tags` → populates MB data for all artists
3. **Enhancement**: Add era tagging → enables landing page features
4. **Enhancement**: Add primary artist extraction → better compound name handling

## Additional Discovery: Composer-Based Expansion

Songs written by bluegrass composers, performed by other artists:

| Composer | Songs | Covered By (artists) |
|----------|-------|----------------------|
| Bill Monroe | 47 | 17 artists (Patsy Cline, Ricky Skaggs, etc.) |
| Ralph Stanley | 27 | 11 artists |
| Carter Stanley | 30 | 11 artists |
| Lester Flatt | 30 | 16 artists |
| Don Reno | 22 | 13 artists |
| Jimmy Martin | 17 | 7 artists |
| Earl Scruggs | 11 | 7 artists |

**Implementation**: Tag songs where `composer` contains bluegrass composer names.

---

## Artist Name Normalization Issues

The expansion analysis revealed variant artist names that should be linked:

| In Index | Should Match |
|----------|--------------|
| Earl Scruggs and Lester Flatt | Flatt & Scruggs |
| Lester Flatt and Earl Scruggs | Flatt & Scruggs |
| Don Reno and Red Smiley | Reno & Smiley |
| J.D. Crowe and the New South | J.D. Crowe |
| Bill Monroe and the Bluegrass Boys | Bill Monroe |

**Fix**: Add artist alias mapping in `tag_enrichment.py`:

```python
ARTIST_ALIASES = {
    'Earl Scruggs and Lester Flatt': 'Flatt & Scruggs',
    'Lester Flatt and Earl Scruggs': 'Flatt & Scruggs',
    'Don Reno and Red Smiley': 'Reno & Smiley',
    'J.D. Crowe and the New South': 'J.D. Crowe',
    'Bill Monroe and the Bluegrass Boys': 'Bill Monroe',
    # ... etc
}
```

---

## "Traditional" Artist Analysis

"Traditional" appears as artist for 526 songs with high bluegrass affinity.
These are traditional songs commonly played at bluegrass jams.

**Consider**: Create a `Traditional` category that includes these songs in the
bluegrass landing page, perhaps as "Traditional Tunes Played at Jams".

---

## Files to Modify

- `scripts/lib/tag_enrichment.py` - Add authoritative list, era mapping, aliases
- `docs/data/artist_tags.json` - Regenerate with all artists
- `analytics/bluegrass-research/analyze_bluegrass_corpus.py` - Era definitions (already done)
- `analytics/bluegrass-research/expand_bluegrass_corpus.py` - Graph expansion (created)
