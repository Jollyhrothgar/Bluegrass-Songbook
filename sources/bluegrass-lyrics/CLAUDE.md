# BluegrassLyrics.com Source

Lyrics for traditional bluegrass and early country songs from [BluegrassLyrics.com](https://www.bluegrasslyrics.com/).

## Status: COMPLETE (Feb 2026)

**Permission**: Granted by site owner (Feb 2026)

764 songs imported to works/ - 494 with chords (from Ultimate Guitar), 270 lyrics-only.

## Quick Reference

```bash
# Check a generated work
cat works/<slug>/work.yaml
cat works/<slug>/lead-sheet.pro

# View original parsed data
cat sources/bluegrass-lyrics/parsed/<slug>.json
```

## Import Summary (Feb 8, 2026)

| Category | Count |
|----------|-------|
| Total songs scraped | 1,818 |
| Already in collection | 823 |
| New songs available | 995 |
| Imported with chords | 494 |
| Imported lyrics-only | 270 |
| Skipped (duplicates/low quality) | 231 |

## Pipeline

```
BluegrassLyrics.com
        │
        ▼ src/scraper.py
   raw/*.html (gitignored)
        │
        ▼ src/parser.py
   parsed/*.json (structured lyrics)
        │
        ├─────────────────────────────────┐
        ▼                                 ▼
Ultimate Guitar enrichment          Direct import
(see sources/ultimate-guitar/)      (lyrics-only)
        │                                 │
        ▼                                 ▼
   works/*/                          works/*/
   (with chords)                     (without chords)
```

## Chord Enrichment Strategy

### What Worked (Feb 2026)

1. **Ultimate Guitar Mobile API** - Scraped ~765 matching songs
   - Fuzzy matched lyrics to place chords correctly
   - 70%+ coverage threshold for "good" matches
   - See `sources/ultimate-guitar/CLAUDE.md` for details

### What Was Tried But Not Scaled

1. **TMUK Carter Family** - 65 songs with text chords
   - Good quality but limited coverage
   - Still in `chordpro/` directory

2. **Embedding-based matching** - Tested but fuzzy matching sufficient
   - Code in `sources/ultimate-guitar/embedding_match.py`

### Future Options (Not Implemented)

- **OCR for image chords** - TMUK has 172 more in image/PDF format
- **LLM chord inference** - Generate chords from lyrics + genre
- **Community contributions** - Users can add chords via edit interface

## File Structure

```
bluegrass-lyrics/
├── raw/                    # Cached HTML (gitignored)
├── parsed/                 # Structured JSON per song
│   └── *.json              # 1,818 files
├── chordpro/               # TMUK-generated ChordPro (65 files, legacy)
├── manifest.json           # Status tracking per song
├── src/
│   ├── scraper.py          # Fetch index + pages
│   ├── parser.py           # HTML to structured JSON
│   └── matcher.py          # Deduplication against works/
├── generate_chordpro.py    # Generate .pro from TMUK matches
├── song_index.json         # All 1,818 URLs
├── classification_report.json  # New vs existing breakdown
└── CLAUDE.md               # This file
```

## Parsed JSON Format

```json
{
  "slug": "cabin-home-on-the-hill",
  "title": "Cabin Home On The Hill",
  "url": "https://www.bluegrasslyrics.com/song/cabin-home-on-the-hill/",
  "sections": [
    {
      "type": "verse",
      "label": "Verse 1",
      "lines": [
        "Tonight I'm alone without you my dear",
        "It seems there's a longing for you still"
      ]
    }
  ]
}
```

## Attribution

All imported songs include source attribution:

```chordpro
{meta: x_lyrics_source bluegrass-lyrics}
{meta: x_lyrics_url https://www.bluegrasslyrics.com/song/...}
```

If enriched with UG chords, also includes:
```chordpro
{meta: x_chords_source ultimate-guitar}
{meta: x_chords_url https://tabs.ultimate-guitar.com/tab/...}
```

**Frontend display:** Shows "BluegrassLyrics.com" with link to original page.

## Known Limitations

1. **No artist metadata** - BluegrassLyrics doesn't provide artist info
2. **Section detection imperfect** - Some songs have unusual formatting
3. **Lyrics-only songs** - 270 songs imported without chords (users can add via edit)

## Related Documentation

- `sources/ultimate-guitar/CLAUDE.md` - Chord enrichment pipeline
- `docs/js/CLAUDE.md` - Frontend rendering and source attribution
- `scripts/lib/CLAUDE.md` - Index building and tagging
