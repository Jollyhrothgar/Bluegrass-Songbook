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

## Multi-Site (Hangout Network)

The pipeline in `src/` is shared by the sibling Hangout sites. Every site
is one entry in `src/site_config.py` (`SITES`), and every CLI takes
`--site` (default `banjo-hangout`, so existing invocations are unchanged):

```bash
uv run python sources/banjo-hangout/src/batch_import.py stats --site mandolin-hangout
uv run python sources/banjo-hangout/src/batch_convert.py --site flatpicker-hangout
```

| Site | base_url | Instrument | Data dir |
|------|----------|-----------|----------|
| banjo-hangout | https://www.banjohangout.org | banjo | `sources/banjo-hangout/` |
| mandolin-hangout | **pending recon** | mandolin | `sources/mandolin-hangout/` |
| flatpicker-hangout | **pending recon** | guitar | `sources/flatpicker-hangout/` |

Each site owns its `tab_catalog.json`, `raw/`, `downloads/` and `parsed/`
— tab ids are only unique within a site. Scanning a site whose `base_url`
is still `None` fails with a clear error; fill in the domain to enable it.

**Instrument detection**: the part's `instrument:` and the OTF filename
come from the converted OTF's tracks (`site_config.resolve_instrument`),
not from the site — the first melodic track wins, a file that doesn't
lead with the site's instrument and has 2+ melodic tracks is `ensemble`,
and detection failure falls back to the site's instrument. So a banjo tab
with guitar/bass backup stays `banjo.otf.json`, while a tenor-banjo or
guitar arrangement posted on Banjo Hangout lands as
`tenor-banjo.otf.json` / `guitar.otf.json`.

**Multiple arrangements per instrument**: the duplicate check is on the
arrangement's identity — its `source_id` — not on the instrument. A work
can hold several banjo tabs (the frontend groups instrument →
arrangement → tracks). The first arrangement of an instrument keeps the
bare `{instrument}.otf.json`; alternates land as
`{instrument}-{source_id}.otf.json`. Which one shows by default is
editorial: `./scripts/utility curate pin-tab <work> <instrument>
<source_id>`, defaulting to the first part listed in work.yaml.

**Strict-instrument gate**: on the sibling sites (mandolin/flatpicker/
fiddle/reso) a conversion only imports when the detected instrument is the
site's own or `ensemble` — otherwise a reso dobro written as
`6-string-guitar`, or an instrument-less TEF defaulting to banjo, would be
filed under the wrong instrument. Banjo Hangout is exempt: it genuinely
hosts tenor-banjo, guitar and ensemble arrangements.

`import --no-new-works` restricts a run to enriching existing works (used
by arrangement-promotion passes, where minting new works needs its own
title/curation review).

Known gap: `tef_parser` defaults an instrument-less TEF to a 5-string
banjo track, so such files import as `banjo` on any site. Teaching
`tef_to_otf` a default-instrument argument is deferred (the parser is
locked by golden tests against the JS port).

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
│   ├── site_config.py        # Per-site config + instrument resolution
│   ├── scraper.py            # Hangout HTTP client
│   ├── catalog.py            # Tab catalog management (one per site)
│   ├── converter.py          # TEF → OTF pipeline
│   └── batch_import.py       # CLI for batch operations (--site)
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

| Tier | Source | ~Count | Notes |
|------|--------|--------|-------|
| 1-5 | Curated tune list | 50 | Essential jam tunes - **done** (100 converted, 24 skipped V3) |
| 6-10 | Curated tune list | 47 | Common session tunes - not yet fetched |
| 11-20 | Curated tune list | 106 | Extended standards - not yet fetched |
| 25 | Existing instrumental works | 545 | Works already tagged Instrumental - not yet fetched |
| 30 | All works needing banjo tab | 16,700 | Any work without a banjo tab part - not yet fetched |

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
      source_id: '11059'             # BH tab detail id - REQUIRED for re-downloads
      source_url: https://www.banjohangout.org/tab/browse.asp?m=detail&v=11059
      author: "UserName"
      difficulty: "Intermediate"     # optional, from the listing
      tuning: "Standard Open G (gDGBD)"  # optional, from the listing
      imported_at: "2025-01-03"
```

`source_id` is also the **arrangement identity**: it's what distinguishes
two banjo tabs on one work, what the published
`docs/data/tabs/{work}-{instrument}-{source_id}.otf.json` filename is keyed
on, and what `curate pin-tab` names.

## Download URLs

TEF files are hosted on `hangoutstorage.com`, not directly on banjohangout.org.
Two filename shapes exist, and **neither number is the tab id**:

```
older:  .../storage/tabs/{letter}/{slug}-{attachment_id}.tef
newer:  .../storage/tabs/{letter}/tab-{slug}-{tab_id}-{timestamp}.tef
```

⚠️ **The number in an older-shape filename is a per-file ATTACHMENT id in a
different namespace than the tab id.** Tab `10545` ("Arkansas Traveler")
ships `arkansas_traveller-426.tef`, `arkansas_traveler-428.gtp` and
`arkansas_traveller-427.mid` — three attachment ids under one tab. Across
the banjo-hangout catalog, attachment ids run 29–2999 while tab ids run
10216–29391; they never collide.

Example:
- Tab detail id: 11059 (from the listing href `browse.asp?m=detail&v=11059`)
- Title: "Red Haired Boy"
- URL: `https://www.hangoutstorage.com/banjohangout.org/storage/tabs/r/red_haired_boy-1687.tef` (1687 = attachment id)

So **never re-derive a tab id from a filename**. The converter records the id
it used in the OTF's `x_source.source_id`, and `build_works_index`'s
provenance gate compares that against `work.yaml`'s
`provenance.source_id` — two recorded ids, no regex. Download URLs must
always be scraped from the detail page href, never templated.

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
