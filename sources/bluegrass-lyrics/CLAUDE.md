# BluegrassLyrics.com Source

Lyrics for traditional bluegrass and early country songs from [BluegrassLyrics.com](https://www.bluegrasslyrics.com/).

## Status: SCRAPED - CHORD ENRICHMENT IN PROGRESS

**Permission**: Granted by site owner (Feb 2026)

## Quick Reference

```bash
# View a generated ChordPro file
cat sources/bluegrass-lyrics/chordpro/<slug>.pro

# Check manifest for status
cat sources/bluegrass-lyrics/manifest.json | jq '.songs["<slug>"]'

# Regenerate ChordPro from TMUK matches
uv run python sources/bluegrass-lyrics/generate_chordpro.py
```

## Current State

| Metric | Count |
|--------|-------|
| Total songs scraped | 1,818 |
| Already in our collection | 823 |
| **New songs to add** | **995** |

### Chord Enrichment Progress

| Source | Songs | Status | Location |
|--------|-------|--------|----------|
| TMUK Carter Family (text) | 65 | **ChordPro generated** | `chordpro/*.pro` |
| TMUK other (image/PDF) | 172 | Needs OCR | - |
| No external match | 659 | Needs LLM or other sources | - |
| Fuzzy matches | 99 | Needs verification | - |

### File Structure

```
bluegrass-lyrics/
├── raw/                # Cached HTML (gitignored)
├── parsed/             # Structured JSON per song (intermediate)
├── chordpro/           # Generated ChordPro files (reviewable)
│   └── *.pro           # 65 files from TMUK match
├── manifest.json       # Status tracking per song
├── src/
│   ├── scraper.py      # Fetch index + pages
│   ├── parser.py       # HTML to structured JSON
│   └── matcher.py      # Deduplication against works/
├── generate_chordpro.py  # Generate .pro from sources
├── song_index.json     # All 1,819 URLs
├── classification_report.json  # 995 new songs
└── CLAUDE.md           # This file
```

## Workflow

### Review ChordPro
```bash
# List ready files
cat manifest.json | jq '[.songs | to_entries[] | select(.value.status=="ready")] | length'

# View a file
cat chordpro/sinking-in-the-lonesome-sea.pro

# Mark as approved (edit manifest.json, change status to "approved")
```

### Merge to Works
```bash
# TODO: Create merge script
uv run python sources/bluegrass-lyrics/merge_to_works.py
```

## Chord Enrichment Strategy

### Currently Working
1. **TMUK Carter Family** - 65 songs with text chords ✓

### Next Up
2. **Discover more sources** - Search for specific song titles
3. **OCR for image chords** - TMUK has 172 more in image/PDF format
4. **LLM inference** - For remaining 659 with no external match

### OCR Options to Research
- Tesseract (free, open source)
- Claude Vision (could parse chord sheet images)
- Google Cloud Vision (high quality, has cost)
- Music-specific OCR (may exist for chord/tab recognition)

### LLM Inference Approach
- Key doesn't matter (transposition is easy)
- Chord progression is the value (I-IV-V patterns)
- Test: Generated correct progression, wrong key
- Need batch testing before scale

## Known Limitations

1. **Current ChordPro uses TMUK lyrics** - Not BL lyrics merged with TMUK chords
   - Harder merge problem (lyrics don't match exactly)
   - TMUK chords are authoritative, BL lyrics are often better

2. **No artist metadata** - BluegrassLyrics doesn't provide artist info
   - Could enrich from MusicBrainz or manual entry

## Attribution

Every generated file includes:
```chordpro
{meta: x_lyrics_source bluegrass-lyrics}
{meta: x_lyrics_url https://www.bluegrasslyrics.com/song/...}
{meta: x_chords_source traditional-music-uk}
{meta: x_chords_url http://www.traditionalmusic.co.uk/...}
```
