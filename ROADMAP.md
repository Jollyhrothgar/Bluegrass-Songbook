# Bluegrass Songbook - Roadmap

## Vision

Build a comprehensive, searchable repository of bluegrass and country music songs in ChordPro format, aggregated from multiple sources, with powerful search and discovery tools.

## Current State (v1.0)

✅ **Classic Country Source Complete**
- 17,122 songs parsed from classic-country-song-lyrics.com (98.5% success rate)
- Three HTML structure parsers (pre_plain, pre_tag, span_br)
- Accurate chord alignment and verse boundary detection
- Multi-verse repeat directive support
- Web-based validation UI

## Target Architecture

### Repository Structure

```
Bluegrass-Songbook/
├── README.md                      # Overall project description
├── CLAUDE.md                      # Navigation & architecture
├── ROADMAP.md                     # This file
│
├── sources/                       # One subdirectory per source
│   ├── classic-country/
│   │   ├── README.md             # Source-specific info (scrape date, license, etc.)
│   │   ├── parser/               # HTML → ChordPro conversion
│   │   ├── raw/                  # Original HTML files
│   │   └── parsed/               # Converted .pro files
│   │
│   ├── ultimate-guitar/          # Future source
│   ├── chordie/                  # Future source
│   └── [other-sources]/
│
├── songbook/                      # Final aggregated collection
│   ├── sources/                    # All .pro files (deduplicated)
│   ├── metadata.db               # SQLite database for search
│   └── index.json                # Song catalog
│
├── tools/                         # Shared utilities
│   ├── aggregator.py             # Combine sources → songbook
│   ├── deduplicator.py           # Find/merge duplicates
│   ├── validator.py              # Quality checks
│   ├── indexer.py                # Build search database
│   ├── search/                   # Search engine
│   └── web_ui/                   # Browse/search interface
│
└── docs/
    ├── ADDING_SOURCES.md         # How to add new sources
    ├── SONG_FORMAT.md            # ChordPro standard
    └── CONTRIBUTING.md
```

## Phase 1: Restructure Current Code (v1.1)

**Goal:** Reorganize existing classic-country code into new multi-source architecture

**Tasks:**
- [ ] Create `sources/classic-country/` directory structure
- [ ] Move current parser to `sources/classic-country/parser/`
- [ ] Move HTML files to `sources/classic-country/raw/`
- [ ] Move output to `sources/classic-country/parsed/`
- [ ] Move viewer to `tools/web_ui/`
- [ ] Create `sources/classic-country/README.md` with source metadata
- [ ] Update all path references in code
- [ ] Update documentation (CLAUDE.md files)
- [ ] Test that everything still works

**Deliverable:** Same functionality, better organization

## Phase 2: Aggregation Pipeline (v1.2)

**Goal:** Build the aggregation layer that combines sources into a single songbook

**Tasks:**
- [ ] Create `songbook/sources/` directory
- [ ] Build `tools/aggregator.py`:
  - [ ] Copy all `sources/*/parsed/*.pro` → `songbook/sources/`
  - [ ] Normalize filenames: `artist_-_song_title.pro`
  - [ ] Add source metadata to each file: `{meta: source classic-country}`
  - [ ] Handle filename conflicts
- [ ] Create `songbook/index.json` catalog:
  ```json
  {
    "songs": [
      {
        "filename": "hank_williams_-_your_cheatin_heart.pro",
        "title": "Your Cheatin' Heart",
        "artist": "Hank Williams",
        "source": "classic-country",
        "has_chords": true
      }
    ]
  }
  ```
- [ ] Build `tools/validator.py` for quality checks:
  - [ ] Verify ChordPro syntax
  - [ ] Check for required metadata (title, artist)
  - [ ] Flag songs with potential issues

**Deliverable:** Single `songbook/` directory with all songs

## Phase 3: Deduplication (v1.3)

**Goal:** Identify and merge duplicate songs from different sources

**Tasks:**
- [ ] Build `tools/deduplicator.py`:
  - [ ] Fuzzy title/artist matching (Levenshtein distance)
  - [ ] Exact content hash matching
  - [ ] Generate duplicate candidates list
- [ ] Create deduplication UI:
  - [ ] Side-by-side comparison of duplicates
  - [ ] Choose "best" version or merge
  - [ ] Track provenance (multiple sources for same song)
- [ ] Add `{meta: sources classic-country, ultimate-guitar}` for merged songs
- [ ] Create deduplication report

**Deliverable:** Deduplicated songbook with provenance tracking

## Phase 4: Search & Discovery (v2.0)

**Goal:** Make the songbook searchable and browsable

### 4.1: Database Schema

```sql
CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    filename TEXT UNIQUE,
    title TEXT NOT NULL,
    artist TEXT,
    composer TEXT,
    sources TEXT,  -- JSON array
    has_chords BOOLEAN,
    verse_count INTEGER,
    key_signature TEXT,
    first_line TEXT,  -- For search
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE chords (
    id INTEGER PRIMARY KEY,
    song_id INTEGER REFERENCES songs(id),
    chord_name TEXT,  -- e.g., "G", "Am7"
    occurrence_count INTEGER
);

CREATE TABLE lyrics (
    id INTEGER PRIMARY KEY,
    song_id INTEGER REFERENCES songs(id),
    content TEXT  -- Full lyrics for full-text search
);

CREATE INDEX idx_title ON songs(title);
CREATE INDEX idx_artist ON songs(artist);
CREATE INDEX idx_key ON songs(key_signature);
CREATE INDEX idx_chord ON chords(chord_name);
CREATE VIRTUAL TABLE lyrics_fts USING fts5(content);
```

### 4.2: Indexer

**Tasks:**
- [ ] Build `tools/indexer.py`:
  - [ ] Parse ChordPro files for metadata
  - [ ] Extract all chords used
  - [ ] Detect key signature (most common chord)
  - [ ] Count verses
  - [ ] Populate database
- [ ] Handle updates (re-index changed files)
- [ ] Build incremental indexer (don't re-process unchanged files)

### 4.3: Search Engine

**Tasks:**
- [ ] Build `tools/search/engine.py`:
  - [ ] Search by title/artist (exact + fuzzy)
  - [ ] Search by lyrics (full-text)
  - [ ] Search by chords used: "songs with G, C, D"
  - [ ] Search by key signature
  - [ ] Filter by source
  - [ ] Sort by relevance/title/artist
- [ ] CLI search tool: `python tools/search.py "blue moon"`

**Deliverable:** Fast, powerful search across entire songbook

## Phase 5: Web Interface (v2.1)

**Goal:** Beautiful, usable web UI for browsing and searching

**Tasks:**
- [ ] Expand `tools/web_ui/`:
  - [ ] Home page with search bar
  - [ ] Browse by artist (alphabetical index)
  - [ ] Browse by title
  - [ ] Browse by source
  - [ ] Song detail page:
    - [ ] ChordPro source (monospace)
    - [ ] Rendered HTML view (formatted)
    - [ ] Transpose controls (+/- semitones)
    - [ ] Print button
  - [ ] Search results page
  - [ ] Advanced search filters
- [ ] Responsive design (mobile-friendly)
- [ ] Bookmark/favorite songs
- [ ] Export to PDF

**Deliverable:** Professional songbook website

## Phase 6: Additional Sources (v3.0+)

**Goal:** Add more sources to grow the songbook

### Potential Sources

1. **Ultimate Guitar** (ultimate-guitar.com)
   - Pros: Massive collection, community-contributed
   - Cons: Requires scraping, variable quality
   - Legal: Check ToS, may need API

2. **Chordie** (chordie.com)
   - Pros: Good bluegrass/country coverage
   - Cons: Aggregator (links to other sites)

3. **Public Domain Songs** (pre-1926)
   - Pros: No copyright issues
   - Cons: Need to create ChordPro from scratch

4. **User Contributions**
   - Pros: Community growth
   - Cons: Need moderation, quality control

### Process for Each Source

1. Create `sources/[name]/` directory
2. Write source-specific parser
3. Document source in README.md (license, attribution, scrape date)
4. Run parser → `sources/[name]/parsed/`
5. Run aggregator to merge into songbook
6. Run deduplicator
7. Re-index database

**Tasks per source:**
- [ ] Research legal/ToS considerations
- [ ] Build scraper (if needed)
- [ ] Build parser
- [ ] Test on sample
- [ ] Run full conversion
- [ ] Aggregate and deduplicate
- [ ] Update documentation

## Phase 7: Advanced Features (v4.0+)

### 7.1: Auto-Transposition
- [ ] Transpose songs to any key
- [ ] Store multiple keys per song
- [ ] "Capo calculator" (capo position for desired key)

### 7.2: Chord Diagrams
- [ ] Generate chord diagrams (guitar, banjo, mandolin)
- [ ] Fingering suggestions
- [ ] Alternative voicings

### 7.3: Setlist Builder
- [ ] Drag-and-drop songs into setlists
- [ ] Save/share setlists
- [ ] Export setlist as PDF songbook
- [ ] Print-optimized layout (2 columns, condensed)

### 7.4: Practice Tools
- [ ] Chord progression analyzer
- [ ] "Songs in the key of G"
- [ ] "Songs using these chords: G, C, D"
- [ ] Difficulty rating (chord complexity)

### 7.5: Mobile App
- [ ] Offline access to songbook
- [ ] Sync favorites/setlists
- [ ] Built-in tuner/metronome

### 7.6: Collaboration
- [ ] User accounts
- [ ] Submit corrections/improvements
- [ ] Review/approval workflow
- [ ] Version history (git-backed)

## Design Principles

### 1. Source Isolation
- Each source has its own parser
- Sources are independent (update one without affecting others)
- Original files preserved in `sources/*/raw/`

### 2. Single Source of Truth
- `songbook/` is the canonical collection
- All tools work from `songbook/`
- Regenerate `songbook/` by re-running aggregator

### 3. Traceability
- Every song knows its source(s)
- Provenance tracked in metadata
- Can trace back to original HTML

### 4. Extensibility
- Easy to add new sources
- Shared tools in `tools/`
- Clear documentation for contributors

### 5. Data Portability
- `songbook/sources/` is just .pro files (standard format)
- SQLite database is easily exported
- Can rebuild index from .pro files anytime

## Success Metrics

- **v1.x**: 17,000+ songs from classic-country source
- **v2.0**: Searchable database with <100ms query time
- **v3.0**: 50,000+ songs from multiple sources
- **v4.0**: Active user community contributing songs

## Timeline (Estimated)

- **Phase 1**: 1-2 days (restructure)
- **Phase 2**: 3-5 days (aggregation)
- **Phase 3**: 5-7 days (deduplication)
- **Phase 4**: 1-2 weeks (search/database)
- **Phase 5**: 2-3 weeks (web UI)
- **Phase 6**: Ongoing (per source: 1-2 weeks each)
- **Phase 7**: Ongoing (feature-by-feature)

## Next Immediate Steps

1. Review and approve this roadmap
2. Start Phase 1: Restructure into `sources/classic-country/`
3. Create `ADDING_SOURCES.md` guide
4. Set up GitHub Projects board for task tracking

---

**Note**: This is a living document. Update as priorities and requirements evolve.
