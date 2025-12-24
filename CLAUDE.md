# Bluegrass Songbook - Project Architecture

## Overview

A two-phase project to build a searchable bluegrass/country songbook:

1. **Parser** (production-ready): Converts scraped HTML song files to ChordPro format
2. **Search Application** (in development): Serverless semantic search on GitHub Pages

**Current Status:**
- 17,122 songs parsed from classic-country-song-lyrics.com (98.5% success rate)
- Parser handles three HTML structure patterns with accurate chord alignment
- Search application architecture defined, implementation pending

## Quick Start

```bash
# Install dependencies
uv sync

# Run batch conversion (parser)
uv run python3 batch_process.py

# Start validation UI
python3 viewer/server.py
# Visit: http://localhost:8000

# Run tests
uv run pytest
```

## Repository Structure

```
Bluegrass-Songbook/
├── CLAUDE.md                    # This file - architecture overview
├── README.md                    # User-facing documentation
├── ROADMAP.md                   # Future development phases
├── RESULTS.md                   # Parser performance metrics
│
├── src/songbook/                # Main Python package
│   ├── parser/                  # HTML → ChordPro conversion
│   │   ├── detector.py          # Structure type detection
│   │   ├── extractor.py         # Content extraction
│   │   ├── generator.py         # ChordPro generation
│   │   └── batch.py             # Batch processing
│   ├── analysis/                # Chord analysis (NEW)
│   │   ├── key_detector.py      # Detect song key from chords
│   │   └── normalizer.py        # Convert to Nashville numbers
│   └── search/                  # Search index building (NEW)
│       ├── indexer.py           # Parse .pro → metadata + lyrics
│       └── embedder.py          # Generate vector embeddings
│
├── tests/                       # Test suite
│   ├── parser/                  # Parser unit + integration tests
│   ├── analysis/                # Key detection tests
│   └── fixtures/                # Test HTML/pro files
│
├── scripts/                     # Development tools
│   ├── regression_test.py       # Before/after comparison for parser changes
│   ├── validator.py             # Statistical analysis of output
│   └── README.md                # Script documentation
│
├── viewer/                      # Manual validation web UI
│   ├── server.py                # Flask server
│   └── templates/               # HTML templates
│
├── docs/                        # GitHub Pages static site (search UI)
│   ├── index.html               # Search interface
│   ├── js/                      # Search logic + transformers.js
│   ├── css/                     # Styles
│   └── data/                    # Build output (index.json, embeddings)
│
├── songs/                       # Song data organized by source
│   └── classic-country/
│       ├── raw/                 # Original HTML files (17,381)
│       └── parsed/              # ChordPro .pro files (17,122)
│
├── pyproject.toml               # Package config + dependencies
└── pytest.ini                   # Test configuration
```

## Data Model

### Song Provenance

Each parsed file is an **arrangement** - a specific transcription from a specific source. Multiple arrangements of the same song can exist (different artists, sources, keys).

**ChordPro metadata format** (using spec-compliant `x_` prefix for custom fields):

```chordpro
{title: Your Cheatin' Heart}
{artist: Hank Williams}
{composer: Hank Williams}
{key: C}
{x_source: classic-country}
{x_source_file: yourcheatingheart.html}
{x_source_url: https://classic-country-song-lyrics.com/...}
{x_parsed: 2024-11-15}

{sov}
Your cheatin' [C]heart will make you [F]weep
...
{eov}
```

### Directory Structure by Source

```
songs/
├── classic-country/
│   ├── raw/                 # Original HTML files
│   └── parsed/              # .pro files with x_source metadata
├── ultimate-guitar/         # Future source
│   ├── raw/
│   └── parsed/
└── index.json               # Aggregated catalog (build-time generated)
```

This structure:
- Preserves provenance (which source each file came from)
- Supports multiple sources without filename conflicts
- Enables deduplication across sources at search-build time

## Parser Architecture

### Three-Stage Pipeline

```
HTML → StructureDetector → ContentExtractor → ChordProGenerator → .pro
```

1. **StructureDetector**: Identifies HTML pattern type
   - `pre_plain` (59.7%): Plain text in `<pre>` tags
   - `pre_tag` (31.8%): `<pre>` with `<font>` tags for chords
   - `span_br` (8.4%): Courier New spans with `<br>` separators

2. **ContentExtractor**: Pattern-specific parsing
   - Extracts metadata (title, artist, composer)
   - Identifies verse boundaries
   - Maps chord positions to lyric offsets
   - Handles repeat directives ("Repeat #3", "Repeat #4,5")

3. **ChordProGenerator**: Output generation
   - Inserts `[chord]` at precise lyric positions
   - Wraps verses in `{sov}`/`{eov}` markers
   - Adds metadata headers

### Key Technical Details

**Verse Boundary Detection:**
- 2+ consecutive blank lines = always verse boundary
- Single blank + chord line = verse boundary
- Single blank + lyrics = internal spacing (not boundary)

**Chord Alignment:**
- Preserves exact horizontal positioning from fixed-width HTML
- Maps chord character positions to lyric character offsets
- Critical for musical accuracy

## Search Application Architecture

### Build Pipeline (Python, runs locally)

```
songs/*/parsed/*.pro → Indexer → Key Detector → Normalizer → Embedder → docs/data/
```

| Component | Purpose |
|-----------|---------|
| `indexer.py` | Parse .pro files, extract metadata + lyrics + chords |
| `key_detector.py` | Infer song key using diatonic heuristics |
| `normalizer.py` | Convert chords to Nashville numbers (1, 4, 5, etc.) |
| `embedder.py` | Generate lyrics embeddings with `all-MiniLM-L6-v2` |
| `export.py` | Create compressed JSON database for frontend |

**Key Detection Algorithm:**
```python
DIATONIC = {
    'G': ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'],
    'C': ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'],
    # ... all 12 keys
}

def detect_key(chords: list[str]) -> tuple[str, float]:
    """Returns (key, confidence) based on diatonic fit."""
    roots = [normalize_to_triad(c) for c in chords]
    scores = {key: sum(1 for c in roots if c in scale) / len(roots)
              for key, scale in DIATONIC.items()}
    best = max(scores, key=scores.get)
    return best, scores[best]
```

### Frontend (Static, GitHub Pages)

| Feature | Implementation |
|---------|----------------|
| Semantic "vibe" search | Transformers.js + pre-computed embeddings |
| Lyric keyword search | Client-side string matching |
| Progression search | Match normalized chord sequences |

**Output files in `docs/data/`:**
- `index.json`: Song metadata, lyrics snippets, normalized progressions
- `embeddings.bin`: Pre-computed vectors (compressed)

## Development Workflow

### Parser Changes (Requires Regression Testing)

```bash
# 1. Make changes to parser
# 2. Run regression test
python3 scripts/regression_test.py --name <change_description>

# 3. Review comparison report for regressions
# 4. If clean, validate with spot-check
uv run python3 create_new_spot_check.py
python3 viewer/server.py

# 5. Rollback if needed
git checkout HEAD -- songs/classic-country/parsed/
```

### Running Tests

```bash
# All tests
uv run pytest

# Parser tests only
uv run pytest tests/parser/

# With coverage
uv run pytest --cov=src/songbook
```

### Adding a New Source

1. Create `songs/<source-name>/raw/` and add HTML files
2. Create parser for new HTML structure (or reuse existing)
3. Run batch processing with `--source <source-name>`
4. Validate with viewer
5. Rebuild search index

## Quality Metrics

**Parser Performance (classic-country source):**
- 17,122 successful / 17,381 total (98.5%)
- 259 failures (malformed HTML)
- 45+ files/second (16 threads)

**Validation History:**
- Sample 1: 5/10 correct (50%)
- Sample 2: 7/10 correct (70%)
- Sample 3: 10/10 correct (100%)

## Known Limitations

1. **"Tag:" Directive**: Treated as lyrics, not special marker
2. **259 Failed Files**: HTML doesn't match any supported pattern
3. **Key Detection**: Diatonic heuristic may miss modulations/borrowed chords
4. **Chord Position**: ±1-2 character accuracy in complex layouts

## Dependencies

**Core:**
- `beautifulsoup4` - HTML parsing
- `flask` - Validation UI server

**Search Build (new):**
- `sentence-transformers` - Embedding generation
- `numpy` - Vector operations

**Development:**
- `pytest` - Testing
- `uv` - Package management

## File Navigation

| I want to... | Go to... |
|--------------|----------|
| Understand the parser | `src/songbook/parser/` |
| Modify chord detection | `src/songbook/analysis/key_detector.py` |
| Add search features | `src/songbook/search/` |
| Run regression tests | `scripts/regression_test.py` |
| Validate output manually | `viewer/server.py` |
| See original requirements | `docs/CLAUDE.md` |
| See performance results | `RESULTS.md` |
| See future roadmap | `ROADMAP.md` |
