# Corpus Gap Analysis

## Current Sources

| Source | Count | What it is |
|--------|-------|------------|
| classic-country | 17,046 | Scraped lyrics/chords site (country-heavy) |
| tunearch | 503 | Fiddle tunes (ABC notation) |
| golden-standard | 86 | Hand-curated bluegrass standards |
| manual | 9 | Individual additions |
| tef-import | 2 | Tabledit imports |

**Key insight**: We have ONE lyrics source and ONE tune source. Gaps are structural.

---

## Gap Categories

### 1. Artist Gaps (missing or thin coverage)

**Completely missing:**
- Sam Bush
- Béla Fleck
- Chris Thile
- Jim & Jesse (as combined entity)

**Thin coverage (<5 songs):**
- Billy Strings (1 song)
- Hot Rize (1 song)
- Carter Stanley (1 song)
- New Grass Revival (2 songs)

**Why**: classic-country source was country-focused, not bluegrass-focused.

### 2. Instrumental Gaps

**Missing banjo instrumentals:**
- Earl's Breakdown
- Flint Hill Special
- Raw Hide
- Blue Grass Breakdown
- Foggy Mountain Chimes
- Ground Speed
- Fireball Mail

**Missing fiddle standards:**
- Whiskey Before Breakfast
- Billy in the Lowground
- Saint Anne's Reel
- Cluck Old Hen
- Big Sciota
- Beaumont Rag
- Done Gone

**Why**: TuneArch is fiddle-centric. No banjo tab source scraped yet.

### 3. Format Gaps

| Format | Current | Potential sources |
|--------|---------|-------------------|
| Lyrics + chords | 17k | Covered |
| Fiddle tunes (ABC) | 503 | thesession.org has 30k+ |
| Banjo tabs | ~0 | banjohangout, banjo-tabs.com |
| Mandolin tabs | ~0 | mandolincafe (1,948), mandolintab.net (10k) |
| Guitar tabs | ~0 | Various |

---

## Gap Identification Methods

### Method 1: Canonical List Comparison

Compare against authoritative lists:
- IBMA award winners (do we have their songs?)
- Jack Tuttle's essential artists
- Festival headliner set lists
- Jam session "must know" lists

```python
CANONICAL_ARTISTS = ['Bill Monroe', 'Sam Bush', ...]
for artist in CANONICAL_ARTISTS:
    count = count_songs_by_artist(artist)
    if count < 5:
        print(f"GAP: {artist} only has {count} songs")
```

### Method 2: Standard Tune Checklist

Known fiddle tune standards that every collection should have:

```python
FIDDLE_STANDARDS = [
    'Salt Creek', 'Blackberry Blossom', 'Whiskey Before Breakfast',
    'Red Haired Boy', 'Soldier\'s Joy', 'Billy in the Lowground',
    ...
]
missing = [t for t in FIDDLE_STANDARDS if t not in our_titles]
```

### Method 3: MusicBrainz Recording Count

For artists we have, compare our song count to MusicBrainz recording count:

```sql
-- How many Bill Monroe recordings exist vs what we have?
SELECT COUNT(*) FROM recording r
JOIN artist_credit ac ON r.artist_credit = ac.id
JOIN artist_credit_name acn ON ac.id = acn.artist_credit
JOIN artist a ON acn.artist = a.id
WHERE a.name = 'Bill Monroe';
```

If MusicBrainz shows 500 recordings and we have 46, we're missing ~90%.

### Method 4: Cross-Reference External Sources

Without scraping, we can note known corpus sizes:
- Banjo Hangout: "thousands" of tabs
- Mandolin Cafe: 1,948 tunes (closed archive)
- thesession.org: 30,000+ Irish/folk tunes
- TaterJoe's: Unknown size, bluegrass-focused

---

## Priority Gaps

Based on user value (bluegrass musicians wanting to learn):

| Priority | Gap | Why it matters |
|----------|-----|----------------|
| **HIGH** | Banjo instrumentals | Core bluegrass, zero coverage |
| **HIGH** | Sam Bush, Béla Fleck, Chris Thile | Major artists, complete gaps |
| **MEDIUM** | More fiddle tunes | Good coverage but not exhaustive |
| **MEDIUM** | Mandolin tabs | Instrument-specific need |
| **LOW** | More country songs | Already have 17k |

---

## Gap Filling Strategy

### Option A: Targeted Manual Curation
- Create "must have" list of ~100 missing songs/tunes
- Hand-add from public domain sources
- High quality, low volume

### Option B: Source Scraping
- Build parsers for banjohangout, mandolincafe, etc.
- High volume, requires cleanup
- Legal/ToS considerations

### Option C: Community Contribution
- Enable user submissions
- Already have GitHub issue workflow
- Slow but sustainable

### Option D: Hybrid
- Scrape what we can (public domain tunes)
- Curate a "bluegrass standards" list manually
- Enable submissions for the rest

---

## Tracking Gaps Over Time

Could add to build pipeline:

```python
# In build script, output gap report
def gap_report():
    missing_artists = check_canonical_artists()
    missing_tunes = check_standard_tunes()

    with open('docs/data/gaps.json', 'w') as f:
        json.dump({
            'missing_artists': missing_artists,
            'missing_tunes': missing_tunes,
            'last_checked': datetime.now().isoformat()
        }, f)
```

This makes gaps visible without manual checking.
