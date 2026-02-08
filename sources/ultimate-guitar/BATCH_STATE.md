# UG Batch Extraction State

## How to Continue

### 1. Run Overnight Scraper (Recommended - No Browser Needed)

Uses the UG mobile API (reverse-engineered from the Android app). No CAPTCHAs, no browser.

```bash
# Run the scraper (can run for hours)
uv run python sources/ultimate-guitar/scrape_overnight.py

# Or with a limit
uv run python sources/ultimate-guitar/scrape_overnight.py --limit 100

# Dry run to see what would be scraped
uv run python sources/ultimate-guitar/scrape_overnight.py --dry-run

# Test the API with one search
uv run python sources/ultimate-guitar/scrape_overnight.py --test
```

The scraper:
- Uses UG's mobile API (no browser, no CAPTCHAs)
- Filters out songs already in `works/` and `raw_extractions/`
- Uses respectful rate limiting (1-3s delays, batch pauses)
- Saves raw extractions to `raw_extractions/{slug}.json`
- Can be interrupted with Ctrl+C and resumed later
- Saves progress to `scrape_progress.json`

### 2. Run Merges (autonomous, no browser needed)

```bash
# Merge all extracted songs with BL lyrics
uv run python sources/ultimate-guitar/run_merges.py

# Results saved to sources/ultimate-guitar/results/
```

### 3. Review Results

```bash
# Check coverage stats
for f in sources/ultimate-guitar/results/*.json; do
  slug=$(basename "$f" .json)
  coverage=$(jq -r '.metrics.coverage' "$f")
  echo "$slug: $coverage"
done

# View a merged ChordPro
jq -r '.chordpro' sources/ultimate-guitar/results/angel-band.json
```

Coverage guidelines:
- **>70%**: Good to use
- **40-70%**: Review manually, may need chord propagation
- **<40%**: Significant lyric differences, consider skipping

---

## Current Progress
- **Raw extractions saved**: 9 songs in `raw_extractions/`
- **Songs needing chords**: ~1,202 (run scraper with --dry-run to see exact list)

## Files Created
- `scrape_overnight.py` - API-based scraper (no browser)
- `merge.py` - Merge UG chords with BL lyrics (fuzzy line matching)
- `run_merges.py` - Batch merge processor
- `raw_extractions/*.json` - Extracted UG content ready for merging

## UG Content Format

The mobile API returns content in BBCode-style format:
```
[Verse]
[tab][ch]A[/ch]
Each day I'll do (each day I'll do)[/tab]
[tab]    [ch]D[/ch]    [ch]A[/ch]
A golden deed(a golden deed)[/tab]
```

The merge script parses this to extract chord positions.

## Key Learnings
1. **Mobile API avoids CAPTCHAs**: The web scraper got hit with CAPTCHAs immediately; the mobile API works
2. API key formula: `MD5(device_id + date:hour + "createLog()")`
3. Filter against works/ before extracting (avoid duplicates)
4. Use 0.7 match threshold for fuzzy line matching
5. Word-boundary snapping for clean chord placement
6. Songs with echo parts "(like this)" have lower match rates
7. Traditional songs often have multiple lyric versions - expect some low matches

## Credits
API reverse engineering based on https://github.com/Pilfer/ultimate-guitar-scraper
