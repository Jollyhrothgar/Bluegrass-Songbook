# Banjo Hangout Source

Banjo tablature from [Banjo Hangout](https://www.banjohangout.org/tab/).

## Current Status

| Metric | Value |
|--------|-------|
| Priority tabs in catalog | 124 (tier 1-5 essential tunes) |
| Successfully converted | 100 |
| Skipped (V3 unsupported) | 24 |
| Works with full provenance | 100 |

## Next Steps: Adding More Tunes

### Expand to more priority tiers

```bash
# Tier 6-10: Common session tunes (~47 more titles)
uv run python sources/banjo-hangout/src/batch_import.py scan --priority --max-priority 10

# Download and convert new tabs
uv run python sources/banjo-hangout/src/batch_import.py download
uv run python sources/banjo-hangout/src/batch_convert.py

# Rebuild search index
./scripts/bootstrap --quick
```

### Priority tier reference

| Tier | Description | ~Count |
|------|-------------|--------|
| 1-5 | Essential jam tunes (done) | 50 |
| 6-10 | Common session tunes | 47 |
| 11-20 | Extended standards | 106 |
| 25 | Existing instrumental works | 545 |
| 30 | All works needing banjo tab | 16,700 |

### V3 format support (24 skipped files)

The parser supports V2 and one V3 variant. Some V3 files lack the 'debt' marker and produce empty notation. To add support:
1. Check `conversion_log.json` for skipped files
2. Analyze the V3 binary structure in `tef_parser/reader.py`
3. The V3 parser exists but needs the alternate variant handled

## Overview

- **Content**: 9,270+ banjo tabs in TEF (TablEdit) format
- **Metadata**: genre, style, tuning, key, difficulty
- **Attribution**: All tabs include source_url and author from Banjo Hangout

## Structure

```
banjo-hangout/
├── src/
│   ├── tef_parser/           # TEF binary parser - REUSABLE for other instruments
│   │   ├── reader.py         # Binary file reader (V2 and V3 formats)
│   │   └── otf.py            # TEF to OTF conversion
│   ├── scraper.py            # Banjo Hangout HTTP client
│   ├── catalog.py            # Tab catalog management
│   ├── converter.py          # TEF → OTF pipeline
│   └── batch_import.py       # CLI for batch operations
├── raw/                      # Cached HTML (gitignored)
├── downloads/                # Downloaded TEF files (gitignored)
└── tab_catalog.json          # Tracks fetch/conversion status
```

## Usage

```bash
# Priority scan: fetch only tabs matching our curated tune list (tier 1-5 = essential)
uv run python sources/banjo-hangout/src/batch_import.py scan --priority --max-priority 5

# Download pending TEF files
uv run python sources/banjo-hangout/src/batch_import.py download --limit 50

# Convert TEF → OTF with validation and logging
uv run python sources/banjo-hangout/src/batch_import.py convert --limit 50

# Import converted tabs to works/ directory
uv run python sources/banjo-hangout/src/batch_import.py import --limit 50

# Show catalog statistics
uv run python sources/banjo-hangout/src/batch_import.py stats

# Show priority list statistics
uv run python sources/banjo-hangout/src/batch_import.py priorities
```

## Priority-Based Scanning (Avoiding 9000+ Tab Full Scrape)

Banjo Hangout has 9,270+ tabs. Instead of downloading everything, we prioritize:

### Priority Tiers

| Tier | Source | Count | Notes |
|------|--------|-------|-------|
| 1-5 | Curated tune list | ~50 | Essential jam tunes (Old Joe Clark, Salt Creek, etc.) |
| 6-10 | Curated tune list | ~47 | Common session tunes |
| 11-20 | Curated tune list | ~106 | Extended standards |
| 25 | Existing instrumental works | ~545 | Works we already have that are tagged Instrumental |
| 30 | Works needing banjo tab | ~16,700 | Any work without a banjo tab part |

### Curated Tune List

The priority list references `sources/tunearch/src/tune_list.py` as a **reference for what tunes are important** - this is NOT importing from tunearch (which handles ABC notation). It's just using the same curated list of ~200 popular bluegrass/old-time instrumentals to guide which BH tabs to download first.

### Priority Workflow

```bash
# 1. Show what's prioritized
uv run python sources/banjo-hangout/src/batch_import.py priorities

# 2. Scan with priority filter (only essential tier 1-5 tunes)
uv run python sources/banjo-hangout/src/batch_import.py scan --priority --max-priority 5

# 3. Or scan wider (tiers 1-10 = common jam tunes)
uv run python sources/banjo-hangout/src/batch_import.py scan --priority --max-priority 10

# 4. Download and convert as usual
uv run python sources/banjo-hangout/src/batch_import.py download
uv run python sources/banjo-hangout/src/batch_import.py convert
uv run python sources/banjo-hangout/src/batch_import.py import
```

### Matching Logic

- `priority_list.py` normalizes titles (removes "- banjo tab", "(arr.)", etc.)
- Matches BH tab titles against priority titles
- Only adds to catalog if priority <= max-priority threshold

## Metadata Pipeline

### Scraped from Banjo Hangout Page

The scraper extracts metadata from each tab's listing:

| Field | Example | Notes |
|-------|---------|-------|
| title | "Red Haired Boy" | Display title |
| author | "schlange" | BH username who uploaded |
| genre | "Bluegrass" | → maps to tags |
| style | "Scruggs" | → maps to tags |
| key | "G" | Musical key |
| tuning | "Open G" | Banjo tuning |
| difficulty | "Intermediate" | Skill level |

### TEF File Metadata

The TEF binary also contains metadata (often lower quality):

| Field | Notes |
|-------|-------|
| v2_title | Often has null bytes, file extensions, or just numbers |
| v2_composer | Rarely populated |
| time_signature | e.g., "2/4", "4/4" |
| format_version | "v2" or "v3" |

### Fallback Strategy

When creating work.yaml, use this priority:

1. **Title**: Prefer BH scraped title, fall back to TEF title if BH is empty
2. **Author**: Always use BH author (TEF rarely has composer)
3. **Tags**: Map BH genre/style to songbook tags
4. **Provenance**: Include both BH metadata and TEF metadata for debugging

### Logging Parser Failures

`batch_convert.py` creates `conversion_log.json`:

```json
{
  "summary": {"success": 265, "skipped": 66, "error": 0},
  "files": [
    {"tef_id": "12345", "status": "success", "slug": "red-haired-boy", ...},
    {"tef_id": "67890", "status": "skipped", "error": "Empty notation (0 events) - format: v3", ...}
  ]
}
```

Skipped reasons:
- Empty notation (V3 format variant without 'debt' marker - unsupported)
- Invalid title (nulls, just numbers, too short)

## Conversion Logs & Failure Tracking

### Where to find failures

| File | Contents |
|------|----------|
| `sources/banjo-hangout/conversion_log.json` | Detailed conversion results with status, errors, metadata |
| `sources/banjo-hangout/tab_catalog.json` | Catalog with status per tab (pending/downloaded/error) |

### Viewing conversion failures

```bash
# Show all skipped files and reasons
uv run python3 -c "
import json
log = json.loads(open('sources/banjo-hangout/conversion_log.json').read())
print(f\"Summary: {log['summary']}\")
print('\\nSkipped files:')
for f in log['files']:
    if f['status'] == 'skipped':
        print(f\"  {f['tef_id']}: {f['error']}\")
"

# Show conversion errors (parsing failures)
uv run python3 -c "
import json
log = json.loads(open('sources/banjo-hangout/conversion_log.json').read())
for f in log['files']:
    if f['status'] == 'error':
        print(f\"{f['tef_id']}: {f['error']}\")
"
```

### Log file structure

```json
{
  "timestamp": "2026-01-04T...",
  "summary": {"success": 100, "skipped": 24, "error": 0},
  "files": [
    {
      "tef_id": "12345",
      "status": "success",
      "slug": "arkansas-traveler",
      "title": "Arkansas Traveler",
      "title_source": "catalog",
      "tags": ["Instrumental", "Bluegrass", "Scruggs"],
      "events": 222,
      "tef_metadata": {"format_version": "v2", "time_signature": "2/4", ...},
      "catalog_metadata": {"author": "Yohansen", "genre": "Bluegrass", ...}
    },
    {
      "tef_id": "67890",
      "status": "skipped",
      "error": "Empty notation (0 events) - format: v3"
    }
  ]
}
```

## Catalog Status Values

- `pending` - Tab discovered, not yet downloaded
- `downloaded` - TEF file downloaded
- `converted` - Converted to OTF format
- `matched` - Matched to existing work
- `imported` - Created as new work
- `skipped` - Non-TEF format or error
- `error` - Conversion or import failed

## Provenance Tracking

All imported tabs maintain full provenance:

```yaml
parts:
  - type: tablature
    instrument: banjo
    format: otf
    file: banjo.otf.json
    provenance:
      source: banjo-hangout
      source_id: '1687'              # BH tab ID - REQUIRED for re-downloads
      source_url: https://www.hangoutstorage.com/banjohangout.org/storage/tabs/r/red_haired_boy-1687.tef
      author: "UserName"
      imported_at: "2025-01-03"
```

## Download URLs

TEF files are hosted on `hangoutstorage.com`, not directly on banjohangout.org:

```
https://www.hangoutstorage.com/banjohangout.org/storage/tabs/{letter}/{filename}-{id}.tef
```

Example:
- Tab ID: 1687
- Title: "Red Haired Boy"
- URL: `https://www.hangoutstorage.com/banjohangout.org/storage/tabs/r/red_haired_boy-1687.tef`

## File Naming in downloads/

Downloaded files use two naming patterns:
- `{id}.tef` - manual downloads
- `{id}_tef.tef` - batch downloads from scraper

## Debugging TEF Parsing Issues

**See skill**: `.claude/skills/tab-debug/SKILL.md` for comprehensive debugging workflow including:
- TEF binary format reference (V2 vs V3, marker types, effect bytes)
- Step-by-step debugging process
- Common issues and fixes (empty notation, wrong articulations, ties, triplets)
- Code snippets for inspecting raw bytes

### Recent Parser Fixes (2026-01)

| Issue | Fix | File |
|-------|-----|------|
| Fingering annotations (0x0c) added to fret | Exclude effect2=0x0c from high-fret calculation | reader.py:1013 |
| Liberty D-tuning parsed as gDGBD | Parse tuning note names from TEF text as fallback | reader.py |
| Slides showing as hammer-ons | Check effect1=0x03 before 0x01 | otf.py |
| Slurs not rendering for close notes | Fixed slur rendering for closely-spaced notes | tablature.js |

### Multi-Track Ensemble Support

Some TEF files have multiple instruments (guitar, bass, mandolin, banjo). These are imported with `instrument: ensemble`:

```yaml
parts:
  - type: tablature
    instrument: ensemble  # Not just "banjo"
    format: otf
    file: ensemble.otf.json
```

The frontend shows a **track mixer** for selecting which instruments to display/solo.

## Tag Mapping

### Genres
| Banjo Hangout | Songbook Tag |
|---------------|--------------|
| Bluegrass | Bluegrass |
| Old-Time | OldTime |
| Folk | Folk |
| Gospel | Gospel |
| Blues | Blues |

### Styles
| Banjo Hangout | Songbook Tag |
|---------------|--------------|
| Scruggs | Scruggs |
| Melodic | Melodic |
| Clawhammer | Clawhammer |

## Rate Limiting

- 1.5 second delay between requests
- Respectful User-Agent header
- Cached HTML to avoid re-fetching

## Related Sources

This design supports other Hangout sites:
- Mandolin Hangout
- Flatpicker Hangout
- Fiddle Hangout
