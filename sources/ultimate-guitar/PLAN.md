# Ultimate Guitar Chord Scraping - Plan

## Goal

Automate searching Ultimate Guitar for songs in our BluegrassLyrics collection that lack chords, extract the chord data, and merge it with our existing lyrics.

## Current State

- **1,818** songs scraped from BluegrassLyrics (lyrics only)
- **65** songs have chords (from traditionalmusic.co.uk)
- **1,753** songs need chord sources

## Approach

Use Chrome DevTools MCP to simulate real browser behavior, avoiding bot detection while extracting chord data at a respectful rate.

**Key Insight**: Reuse existing `cleanUltimateGuitarPaste()` and `editorConvertToChordPro()` from `docs/js/editor.js` rather than building new parsers. The extraction pipeline stores raw chord-above-lyrics content that can be processed through these existing handlers.

## Phase 1: Prototype (Manual Testing) ✅ COMPLETE

### 1.1 Single Song Extraction ✅
- [x] Navigate to a known UG chord page (Darling Corey, Will The Circle Be Unbroken)
- [x] Extract chord/lyric content from page via JavaScript
- [x] Store in raw format (chord-above-lyrics) for paste handler compatibility
- [x] Validate extraction quality

**Files created:**
- `parser.py` - Converts UG format to ChordPro (backup, not primary)
- `extractor.py` - MCP-based extraction using Python MCP SDK
- `merge.py` - Merge UG chords with BL lyrics using fuzzy line matching

### 1.2 Search Flow ✅
- [x] Search for song title with URL: `?title=...&type=300` (Chords filter)
- [x] Extract results via compact JavaScript (avoids large snapshots)
- [x] Select best match: prefer Traditional/Carter Family artists, exact title match
- [x] Skip "Pro" versions automatically

**Key findings:**
- Search URL pattern: `https://www.ultimate-guitar.com/search.php?title={title}&type=300`
- Results extraction via `evaluate_script` much more efficient than full snapshots
- Artist preference order: Carter Family > Misc Traditional > Traditional > others

### 1.3 Merge Logic ✅
- [x] Match UG lyrics to BL lyrics (fuzzy matching with 0.7 threshold)
- [x] Line-level matching (not section-level) - handles UG mislabeled sections
- [x] Word-boundary chord snapping for clean ChordPro output
- [x] Handles curly vs straight quotes, minor lyric variations

**Files created:**
- `merge.py` - Full merge pipeline (parse UG, match to BL, generate ChordPro)

**Tested songs:**
- Katy Daley: 100% match scores
- Little Rosewood Casket: 0.74-1.00 match scores (handles lyric variations)
- Handsome Molly: Validated against manual submission

## Phase 2: Batch Processing Script

### 2.1 Script Structure
```
sources/ultimate-guitar/
├── PLAN.md              # This file
├── extractor.py         # MCP-based extraction using Python mcp SDK
├── parser.py            # Backup ChordPro converter (frontend handles this)
├── merge.py             # Merge UG chords with BL lyrics
├── batch.py             # Batch processor with rate limiting
├── results/             # Merged ChordPro + metrics (one JSON per song)
└── batch_progress.json  # Progress tracking (auto-generated)
```

### 2.1.1 Rate Limiting (Anti-Detection)
- **Human-like delays**: 2-7 seconds between songs (triangular distribution)
- **Batch pauses**: 30-60 second break every 10 songs
- **Real browser**: Chrome DevTools MCP uses actual Chrome, not HTTP requests
- **Resumable**: Progress saved after each song

```bash
# Process 10 songs (default)
uv run python sources/ultimate-guitar/batch.py

# Preview without requests
uv run python sources/ultimate-guitar/batch.py --dry-run

# Resume interrupted batch
uv run python sources/ultimate-guitar/batch.py --resume --limit 50
```

### 2.2 Extraction Approach

**Option A: MCP Python SDK** (current implementation)
- Uses `mcp` package from PyPI to call Chrome DevTools MCP
- Requires Chrome running with `--remote-debugging-port=9222`
- Can run from Claude Code or standalone

**Option B: Manual paste workflow**
- Navigate to UG pages manually or with MCP
- Copy content (Cmd+A, Cmd+C)
- Paste into song editor - existing `cleanUltimateGuitarPaste()` handles conversion

### 2.3 Extraction Logic
JavaScript in browser extracts:
- Song title, artist from page header
- Tuning, capo from metadata
- Raw content (chord lines above lyrics) from main content area
- Filters out footer/rating/comment sections

### 2.4 Output Format (Raw Storage)
```json
{
  "bl_slug": "darling-corey",
  "title": "Darling Corey",
  "artist": "Misc Traditional",
  "ug_url": "https://tabs.ultimate-guitar.com/tab/...",
  "tuning": "E A D G B E",
  "capo": null,
  "raw_content": "[Verse]\nG\nWake up, wake up darlin Corey\n...",
  "extracted_at": "2026-02-07T..."
}
```

The `raw_content` is in chord-above-lyrics format, which `editorConvertToChordPro()` handles.

## Phase 3: Integration with ChordPro Generator

### 3.1 Merge Pipeline
1. Load UG extracted chords
2. Load BL parsed lyrics
3. Match sections by type and line similarity
4. Apply chord positions using existing syllable-based logic
5. Generate ChordPro with dual attribution

### 3.2 Attribution
```chordpro
{meta: x_lyrics_source bluegrass-lyrics}
{meta: x_lyrics_url https://www.bluegrasslyrics.com/song/...}
{meta: x_chords_source ultimate-guitar}
{meta: x_chords_url https://tabs.ultimate-guitar.com/tab/...}
```

## Technical Considerations

### Rate Limiting
- 1 request per 2-3 seconds minimum
- Add random jitter (1-5 seconds)
- Pause between batches (every 50 songs, wait 5 minutes)
- Run during off-peak hours if possible

### Error Handling
- No search results → log and skip
- Multiple artist versions → prefer "Misc Traditional", "Traditional", or exact BL title match
- Page load timeout → retry once, then skip
- Rate limited (429) → pause for 10 minutes, retry

### Match Quality
- Compare first verse lyrics (fuzzy match)
- Threshold: 70% similarity to accept match
- Log borderline cases for manual review

### MCP Python SDK Integration
Using the official `mcp` package from PyPI:

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool("navigate_page", {"url": "..."})
        result = await session.call_tool("evaluate_script", {"function": "..."})
```

Can run standalone or within Claude Code. Requires Chrome with remote debugging enabled.

## Success Metrics

- **Coverage**: Target 50%+ of remaining 1,753 songs
- **Quality**: 90%+ of extracted chords are usable
- **Match Rate**: 80%+ accurate song matches

## Risks

1. **Bot detection**: UG may block if patterns detected
   - Mitigation: Real browser, human-like delays, vary user agent

2. **Structure mismatch**: UG and BL lyrics differ significantly
   - Mitigation: Use flexible syllable-based matching, log failures

3. **Legal/TOS**: Web scraping may violate UG terms
   - Mitigation: Personal use, respectful rate limiting, attribution

## Next Steps

1. [x] Create `sources/ultimate-guitar/` directory structure
2. [x] Prototype single-song extraction with DevTools MCP
3. [x] Build extraction script using MCP Python SDK
4. [ ] Run on 10 test songs, validate quality
5. [ ] Integrate with generate_chordpro.py to merge chords with BL lyrics
6. [ ] Scale to full collection with monitoring
