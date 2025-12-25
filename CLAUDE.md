# Bluegrass Songbook - Project Architecture

## Overview

A two-phase project to build a searchable bluegrass/country songbook:

1. **Parser** (production-ready): Converts scraped HTML song files to ChordPro format
2. **Search Application** (working): Serverless search on GitHub Pages with key detection & transposition

**Current Status:**
- 17,053 songs parsed from classic-country-song-lyrics.com (98.5% success rate)
- Parser handles three HTML structure patterns with accurate chord alignment
- Search UI working with keyword search, chord/progression search, key detection, transposition
- Song editor with smart paste (auto-converts chord-above-lyrics format)
- Next: semantic search with embeddings

## Quick Start

```bash
# First-time setup (install deps + build index)
./scripts/bootstrap

# Start frontend server
./scripts/server
# Visit: http://localhost:8080

# Add a song you created
./scripts/utility add-song /path/to/song.pro

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
├── scripts/                     # Global app scripts
│   ├── bootstrap                # Setup + build search index
│   ├── server                   # Start dev servers
│   ├── utility                  # User utilities (add-song, etc.)
│   └── lib/                     # Python implementations
│       ├── build_index.py       # Build docs/data/index.json
│       ├── add_song.py          # Add song to manual collection
│       └── chord_counter.py     # Chord statistics
│
├── sources/                       # Song sources (self-contained)
│   ├── classic-country/
│   │   ├── raw/                 # Original HTML files (17,381)
│   │   ├── parsed/              # ChordPro .pro files (17,122)
│   │   ├── src/                 # Parser + testing code
│   │   │   ├── parser.py        # HTML → ChordPro conversion
│   │   │   ├── batch_process.py # Batch processing
│   │   │   └── regression_test.py
│   │   ├── viewer/              # Debug UI (HTML vs parsed comparison)
│   │   │   └── server.py
│   │   ├── docs/                # Source-specific documentation
│   │   │   └── QUALITY_VALIDATION.md
│   │   └── scripts/
│   │       ├── bootstrap        # Batch parse HTML files
│   │       ├── server           # Start debug_viewer
│   │       ├── test             # Regression, validate, etc.
│   │       └── utility          # batch_parse, create_spot_check
│   └── manual/
│       └── parsed/              # Hand-created .pro files
│
├── docs/                        # GitHub Pages static site
│   ├── index.html               # Search UI + Editor
│   ├── css/style.css            # Dark theme styles
│   ├── js/search.js             # Search, display, editor logic
│   └── data/index.json          # Song index (~33MB, 17K songs)
│
├── tests/                       # Test suite (pytest)
│   ├── parser/                  # Parser unit + integration tests
│   └── fixtures/                # Test HTML/pro files
│
├── pyproject.toml               # Package config + dependencies
└── pytest.ini                   # Test configuration
```

## Script Hierarchy

```bash
# Global scripts (app-level)
./scripts/bootstrap              # Setup: uv sync + build index
./scripts/bootstrap --quick      # Just rebuild index
./scripts/server                 # Start frontend (port 8080)
./scripts/utility add-song FILE  # Add song + rebuild index
./scripts/utility count-chords   # Chord statistics

# Source-specific scripts (classic-country)
./sources/classic-country/scripts/bootstrap           # Batch parse HTML
./sources/classic-country/scripts/server debug_viewer # Debug UI (HTML vs parsed)
./sources/classic-country/scripts/test regression     # Regression test
./sources/classic-country/scripts/test validate       # Statistical validation
./sources/classic-country/scripts/test reparse NAME   # Quick single-file test
./sources/classic-country/scripts/test outliers       # Find outlier files
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

### Source-Specific Structure

Each source is self-contained with its own parser, tests, and scripts:

```
sources/
├── classic-country/             # Source from classic-country-song-lyrics.com
│   ├── raw/                     # Original HTML files
│   ├── parsed/                  # Generated .pro files
│   ├── src/                     # Parser code specific to this source
│   │   ├── parser.py            # HTML patterns: pre_plain, pre_tag, span_br
│   │   ├── batch.py             # Batch processing
│   │   └── regression_test.py   # Testing tools
│   └── scripts/
│       ├── bootstrap            # Batch parse
│       └── test                 # Test commands
│
├── manual/                      # Hand-created songs
│   └── parsed/                  # Just .pro files, no parsing needed
│
└── [future-source]/             # New source would follow same pattern
    ├── raw/
    ├── parsed/
    ├── src/                     # Source-specific parser
    └── scripts/
```

## Parser Architecture (classic-country)

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
sources/*/parsed/*.pro → build_index.py → docs/data/index.json
```

The build script (`scripts/lib/build_index.py`):
- Parses all .pro files from all sources
- Extracts metadata, lyrics, chords
- Detects key using diatonic heuristics
- Converts chords to Nashville numbers
- Outputs unified JSON index

### Frontend (Static, GitHub Pages)

| Feature | Status |
|---------|--------|
| Keyword search (title, artist, lyrics) | ✅ Working |
| Chord search (Nashville numbers) | ✅ Working |
| Progression search | ✅ Working |
| Key detection & display | ✅ Working |
| Transposition | ✅ Working |
| Song editor with smart paste | ✅ Working |
| Favorites | ✅ Working |
| Semantic "vibe" search | 🔜 Planned |

## Development Workflow

### Parser Changes (classic-country)

```bash
# 1. Make changes to parser
vim sources/classic-country/src/parser.py

# 2. Run regression test
./sources/classic-country/scripts/test regression --name my_fix

# 3. Review comparison report for regressions

# 4. If clean, validate with debug viewer
./sources/classic-country/scripts/server debug_viewer

# 5. Rollback if needed
git checkout HEAD -- sources/classic-country/parsed/
```

### Adding a New Song (Manual)

```bash
# Create your .pro file, then:
./scripts/utility add-song ~/Downloads/my_song.pro

# Or skip index rebuild if adding multiple:
./scripts/utility add-song song1.pro --skip-index-rebuild
./scripts/utility add-song song2.pro --skip-index-rebuild
./scripts/bootstrap --quick  # Rebuild once at the end
```

### Adding a New Source

1. Create `sources/<source-name>/` with `raw/`, `parsed/`, `src/`, `scripts/` dirs
2. Implement parser in `src/parser.py` for the source's HTML structure
3. Create `scripts/bootstrap` and `scripts/test` following classic-country pattern
4. Run batch processing
5. Run `./scripts/bootstrap --quick` to rebuild global index

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

**Search Build (planned):**
- `sentence-transformers` - Embedding generation
- `numpy` - Vector operations

**Development:**
- `pytest` - Testing
- `uv` - Package management

## File Navigation

| I want to... | Go to... |
|--------------|----------|
| Understand the classic-country parser | `sources/classic-country/src/parser.py` |
| Build search index | `scripts/lib/build_index.py` |
| Modify search UI | `docs/js/search.js` |
| Run regression tests | `./sources/classic-country/scripts/test regression` |
| Debug parser output | `./sources/classic-country/scripts/server debug_viewer` |
| Add a manual song | `./scripts/utility add-song` |
| See performance results | `RESULTS.md` |
| See future roadmap | `ROADMAP.md` |

## Next Steps

**Working:**
- Keyword search (title, artist, lyrics)
- Chord/progression search with Nashville numbers
- Key detection and transposition
- Song editor with smart paste
- Dark theme, mobile-friendly UI

**TODO:**
1. **Compress index.json** - Currently 33MB, could gzip to ~5MB
2. **Semantic search** - Add embeddings with `all-MiniLM-L6-v2` and transformers.js
3. **Deploy to GitHub Pages** - Configure repo settings
4. **Metrics infrastructure** - RESULTS.md contains parser metrics but needs rethinking now that parsed files are checked in. Consider git-diff based validation: compare parsed output against committed baseline, run heuristics on changes.
