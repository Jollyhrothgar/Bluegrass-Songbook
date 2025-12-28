# BluegrassLyrics.com Source

Lyrics for traditional bluegrass and early country songs from [BluegrassLyrics.com](https://www.bluegrasslyrics.com/).

## Status: PENDING PERMISSION

Awaiting response from site owner before scraping.

## Site Analysis

- **Content**: Lyrics only (no chords)
- **Focus**: Traditional bluegrass, early country, old-time
- **Size**: 1000s of songs (211 Bill Monroe songs alone)
- **Format**: Clean HTML, WordPress-based
- **URL pattern**: `https://www.bluegrasslyrics.com/song/{title-with-hyphens}/`
- **Organization**: Alphabetical index, artist folios, thematic collections

### Artist Folios Available
- Bill Monroe (211 songs)
- Flatt and Scruggs
- Stanley Brothers
- Jimmy Martin
- Larry Sparks

### Collections
- Bluegrass Gospel Songs
- Brother Duets
- Early Country
- Old Time Songs

## Gap Analysis

Using MusicBrainz bluegrass repertoire data (`mb_bluegrass_repertoire.jsonl`):

| Metric | Count |
|--------|-------|
| MB bluegrass repertoire | 2,455 songs |
| Already in songbook | 794 (32%) |
| Missing | 1,661 (68%) |
| Likely traditional/folk | 137 |

### Top Missing Traditional Songs

```
15 artists | Cumberland Gap
12 artists | Wild Bill Jones
11 artists | Lee Highway Blues
11 artists | Fire on the Mountain
11 artists | Cluck Old Hen
10 artists | Foggy Mountain Breakdown
10 artists | Sweet Georgia Brown
 9 artists | Cannonball Blues
 8 artists | Handsome Molly
 7 artists | Soldier's Joy
```

## Implementation Plan (if approved)

1. **Scraper**: Fetch lyrics from individual song pages
2. **Parser**: Extract lyrics, title, any metadata
3. **Chord inference**: Use existing harmonic analysis to add basic chords
4. **Output**: ChordPro .pro files with `x_source: bluegrass-lyrics`

### Proposed Structure

```
bluegrass-lyrics/
├── src/
│   ├── scraper.py          # HTTP client with rate limiting
│   ├── parser.py           # HTML to lyrics extraction
│   └── song_list.py        # Songs to fetch (from MB gap analysis)
├── parsed/                  # Output .pro files
├── raw/                     # Cached HTML (gitignored)
└── mb_bluegrass_repertoire.jsonl  # Gap analysis data
```

## Other Sources Evaluated

| Source | Verdict | Notes |
|--------|---------|-------|
| Ultimate Guitar | ❌ Skip | ToS prohibits scraping, aggressive anti-bot |
| Flatpicker Hangout | ❌ Skip | Only 332 tabs, binary formats (TablEdit, PowerTab) |
| Mudcat/Digital Tradition | ⚠️ Maybe | Folk lyrics, needs more research |
| Jack Tuttle | ❌ N/A | Site structure unclear, couldn't assess |

## Copyright Considerations

- Chord progressions are not copyrightable
- Lyrics ARE copyrighted (even for traditional songs if verses are original)
- Safest: Pre-1928 songs, truly traditional verses, instrumentals
- Site describes itself as "traditional" bluegrass - likely more permissive
