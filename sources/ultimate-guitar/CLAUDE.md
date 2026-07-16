# Ultimate Guitar Chord Scraper

Chord extraction from Ultimate Guitar's mobile API to enrich BluegrassLyrics.com songs.

## Status: COMPLETE (Feb 2026)

Successfully scraped ~765 songs from UG and merged chords with BL lyrics. 494 songs with good chord coverage imported to works/.

## Architecture

```
BluegrassLyrics.com (lyrics)     Ultimate Guitar (chords)
         │                                │
         ▼                                ▼
   parsed/*.json                   raw_extractions/*.json
         │                                │
         └──────────────┬─────────────────┘
                        │
                        ▼ merge.py
                   results/*.json
                   (merged ChordPro + metrics)
                        │
                        ▼ import_to_works.py
                   works/*/
                   (work.yaml + lead-sheet.pro)
```

## Key Files

| File | Purpose |
|------|---------|
| `scrape_overnight.py` | UG Mobile API scraper (runs standalone) |
| `merge.py` | Merge UG chords with BL lyrics using fuzzy matching |
| `import_to_works.py` | Import eligible songs to works/ directory |
| `import_lyrics_only.py` | Import BL songs without chords |
| `run_merges.py` | Batch run merges on all scraped songs |

## UG Mobile API

We use the UG mobile API (reverse-engineered from Android app) rather than web scraping:

**Advantages over web scraping:**
- No browser needed (pure HTTP requests)
- No CAPTCHAs or bot detection
- Faster and more reliable
- Can run overnight unattended

**API Details:**
```
Base URL: https://api.ultimate-guitar.com/api/v1
User-Agent: UGT_ANDROID/4.11.1 (Pixel; 8.1.0)
Auth: MD5 hash of device_id + date + secret
```

**Key endpoints:**
- `/tab/search` - Search by song title
- `/tab/info` - Get full tab content

**Rate limiting:**
- 1-3 seconds between requests (random)
- 30-60 second pause every 20 songs
- Respectful delays even though API tolerates more

## Merge Algorithm

The merge process (`merge.py`) combines BL lyrics with UG chords:

1. **Parse UG content** - Extract chord-above-lyrics format into structured lines
2. **Fuzzy line matching** - Match each UG line to best BL line (0.7+ threshold)
3. **Chord position transfer** - Apply chord positions to BL lyrics
4. **Word boundary snapping** - Snap chords to word starts for clean output

**Match scoring:**
- `coverage` - Percentage of BL lines that got chords
- `match_score` per line - How well UG/BL lyrics matched

**Eligibility for import:**
- Coverage >= 70% OR
- At least one section with 20+ words and 2+ well-matched chord lines (0.85+)

## Commands

```bash
# Scrape chords from UG (runs until done or interrupted)
uv run python sources/ultimate-guitar/scrape_overnight.py

# Limit to N songs
uv run python sources/ultimate-guitar/scrape_overnight.py --limit 100

# Run merge on all scraped songs
uv run python sources/ultimate-guitar/run_merges.py

# Import eligible songs to works/
uv run python sources/ultimate-guitar/import_to_works.py

# Import lyrics-only songs (no chord match)
uv run python sources/ultimate-guitar/import_lyrics_only.py

# Dry run any command
uv run python <script>.py --dry-run
```

## Data Directories

| Directory | Contents |
|-----------|----------|
| `raw_extractions/` | Raw UG API responses (JSON) |
| `results/` | Merged ChordPro + quality metrics |
| `scrape_progress.json` | Resume state for scraper |

## Attribution

Generated ChordPro files include dual attribution:
```chordpro
{meta: x_lyrics_source bluegrass-lyrics}
{meta: x_lyrics_url https://www.bluegrasslyrics.com/song/...}
{meta: x_chords_source ultimate-guitar}
{meta: x_chords_url https://tabs.ultimate-guitar.com/tab/...}
```

**IMPORTANT:** In the frontend, Ultimate Guitar is never shown as source. It displays as:
- "BluegrassLyrics.com" (for lyrics attribution)
- "Community Contribution" (for chord attribution)

This is enforced in `docs/js/song-view.js` and `docs/js/work-view.js`.

## Quality Metrics

From the Feb 2026 import:

| Metric | Value |
|--------|-------|
| Songs scraped from UG | ~765 |
| Good chord coverage (>=70%) | 494 |
| At least one good section | ~100 more |
| Total imported with chords | 494 |
| Imported lyrics-only | 270 |

## Session History (Feb 8, 2026)

1. Ran overnight scraper on ~765 BL songs needing chords
2. Merged chords with BL lyrics using fuzzy matching
3. Imported 494 songs with good chord coverage
4. Imported 270 songs as lyrics-only (for future chord addition)
5. Fixed source attribution (BL as source, not UG)
6. Matched against Strum Machine (+147 new matches)
7. Ran LLM batch tagging for genre tags
8. Total: 764 new songs added to collection (18,359 total)

## Known Limitations

1. **Fuzzy matching imperfect** - Some chord placements may be slightly off when lyrics differ
2. **UG quality varies** - Some UG tabs have errors or simplified chords
3. **No artist metadata** - BL doesn't provide artist info, inherited from UG search
4. **Rate limiting conservative** - Could go faster but being respectful

## Legal/Ethical Notes

- Personal/educational use
- Respectful rate limiting
- Attribution preserved
- Not redistributing raw UG content
