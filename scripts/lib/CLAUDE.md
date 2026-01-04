# Build Scripts (scripts/lib)

Python utilities for building the search index and managing songs.

## Pipeline Overview

The build pipeline now uses **works/** as the primary data source:

```
PRIMARY (current):
works/*/work.yaml + lead-sheet.pro  →  build_works_index.py  →  index.jsonl

LEGACY (migration complete):
sources/*/parsed/*.pro  →  migrate_to_works.py  →  works/
```

**Key files:**
- `build_works_index.py` - PRIMARY: Builds index from works/ directory
- `work_schema.py` - Defines work.yaml schema and validation
- `build_index.py` - LEGACY: Builds from sources/ (kept for reference)

## Local vs CI Operations

Some operations require external APIs/databases and only run locally. Others run everywhere.

| Operation | Where | Cache File | Notes |
|-----------|-------|------------|-------|
| **Build index** | Everywhere | - | Core build, always runs |
| **Harmonic analysis** | Everywhere | - | Computes JamFriendly, Modal tags from chords |
| **MusicBrainz tags** | Local only | `artist_tags.json` | Requires local MB database on port 5440 |
| **Grassiness scores** | Local only | `bluegrass_recordings.json`, `bluegrass_tagged.json` | Song-level bluegrass detection |
| **Strum Machine URLs** | Local only | `strum_machine_cache.json` | API rate limited (10 req/sec) |
| **TuneArch fetch** | Local only | - | Fetches new instrumentals |

**How caching works:**
1. Run local command to populate cache (e.g., `refresh-tags`, `strum-machine-match`)
2. Commit the cache file to git
3. CI reads cache during build - no external API calls

**Cache files (commit these after updating):**
- `docs/data/artist_tags.json` - MusicBrainz artist → genre mappings
- `docs/data/strum_machine_cache.json` - Song title → Strum Machine URL mappings
- `docs/data/bluegrass_recordings.json` - Recordings by curated bluegrass artists
- `docs/data/bluegrass_tagged.json` - Recordings with MusicBrainz bluegrass tags
- `docs/data/grassiness_scores.json` - Computed grassiness scores per song

## Files

```
scripts/lib/
├── build_works_index.py  # PRIMARY: Build index.jsonl from works/
├── work_schema.py        # work.yaml schema definition and validation
├── migrate_to_works.py   # Migrate sources/ → works/ structure
├── build_index.py        # LEGACY: Build index from sources/*.pro
├── enrich_songs.py       # Enrich .pro files (provenance, chord normalization)
├── tag_enrichment.py     # Tag enrichment (MusicBrainz + harmonic analysis)
├── query_artist_tags.py  # Optimized MusicBrainz artist tag queries
├── strum_machine.py      # Strum Machine API integration
├── add_song.py           # Add a song to manual/parsed/
├── process_submission.py # GitHub Action: process song-submission issues
├── process_correction.py # GitHub Action: process song-correction issues
├── chord_counter.py      # Chord statistics utility
└── tagging/              # Song-level tagging system
    ├── CLAUDE.md         # Detailed docs for grassiness scoring
    └── grassiness.py     # Bluegrass detection based on covers/tags
```

## Quick Commands

```bash
# Full pipeline: build index from works/
./scripts/bootstrap --quick

# Build index with tag refresh (local only, requires MusicBrainz)
./scripts/bootstrap --quick --refresh-tags

# Add a song manually
./scripts/utility add-song /path/to/song.pro

# Count chord usage across all songs
./scripts/utility count-chords

# Refresh tags from MusicBrainz (LOCAL ONLY - requires MB database)
./scripts/utility refresh-tags

# Match songs to Strum Machine (LOCAL ONLY - ~30 min for 17k songs)
./scripts/utility strum-machine-match
```

## enrich_songs.py

Enriches `.pro` files with provenance metadata and normalized chord patterns.

### What It Does

1. **Adds provenance metadata** (`x_source`, `x_source_file`, `x_enriched`)
2. **Normalizes chord patterns** within sections of the same type
3. **Skips protected files** (human corrections are authoritative)

### Chord Pattern Normalization

Ensures consistent chord counts across verses/choruses of the same type:

```
Before:                          After:
Verse 1: [G]Your cheating...     Verse 1: [G]Your cheating...
Verse 2: When tears come...      Verse 2: [G]When tears come...
                                          ↑ Added from canonical
```

Algorithm:
1. Group sections by type (verse, chorus, etc.)
2. Find canonical section (most chords, starts with chord)
3. For sections missing first chord, add canonical's first chord

### Usage

```bash
# Enrich all sources
uv run python scripts/lib/enrich_songs.py

# Dry run (show what would change)
uv run python scripts/lib/enrich_songs.py --dry-run

# Single source only
uv run python scripts/lib/enrich_songs.py --source classic-country

# Single file (for testing)
uv run python scripts/lib/enrich_songs.py --file path/to/song.pro
```

### Protected Files

Files listed in `sources/{source}/protected.txt` are skipped. These are human-corrected files that should not be auto-modified.

---

## build_works_index.py (PRIMARY)

Generates `docs/data/index.jsonl` from the `works/` directory.

### What It Does

1. Scans `works/*/work.yaml` for all works
2. Reads work metadata (title, artist, composers, tags, parts)
3. Reads lead sheet content from `lead-sheet.pro`
4. Detects key and computes Nashville numbers
5. Identifies tablature parts and includes their paths
6. Outputs unified JSON index

### Usage

```bash
uv run python scripts/lib/build_works_index.py           # Full build
uv run python scripts/lib/build_works_index.py --no-tags # Skip tag enrichment
```

### Output Format

```json
{
  "id": "blue-moon-of-kentucky",
  "title": "Blue Moon of Kentucky",
  "artist": "Patsy Cline",
  "composers": ["Bill Monroe"],
  "key": "C",
  "tags": ["ClassicCountry", "JamFriendly"],
  "content": "{meta: title...}[full ChordPro]",
  "tablature_parts": [
    {"type": "tablature", "instrument": "banjo", "path": "data/tabs/..."}
  ]
}
```

---

## work_schema.py

Defines the `work.yaml` schema and validation.

### Work Schema

```python
@dataclass
class Part:
    type: str           # 'lead-sheet', 'tablature', 'abc-notation'
    format: str         # 'chordpro', 'opentabformat', 'abc'
    file: str           # Relative path to file
    default: bool       # Is this the default part?
    instrument: str     # Optional: 'banjo', 'fiddle', 'guitar'
    provenance: dict    # Source info (source, source_file, imported_at)

@dataclass
class Work:
    id: str             # Slug (e.g., 'blue-moon-of-kentucky')
    title: str
    artist: str
    composers: list[str]
    default_key: str
    tags: list[str]
    parts: list[Part]
```

---

## build_index.py (LEGACY)

Generates `docs/data/index.jsonl` from all `.pro` files in `sources/`.

### What It Does

1. Scans `sources/*/parsed/*.pro` for all songs
2. Parses ChordPro metadata (title, artist, composer, version fields)
3. Extracts lyrics (without chords) for search
4. **Detects key** using diatonic heuristics
5. **Converts chords to Nashville numbers** for chord search
6. **Computes group_id** for song version grouping
7. **Deduplicates** exact duplicates (same content hash)
8. Outputs unified JSON index

### Key Functions

```python
def parse_chordpro_metadata(content) -> dict:
    """Extract {meta: key value} and {key: value} directives.
    Includes version fields: x_version_label, x_version_type, etc."""

def detect_key(chords: list[str]) -> tuple[str, str]:
    """Detect key from chord list. Returns (key, mode)."""

def to_nashville(chord: str, key_name: str) -> str:
    """Convert chord to Nashville number given a key."""

def extract_lyrics(content: str) -> str:
    """Extract plain lyrics without chord markers."""

def normalize_for_grouping(text: str) -> str:
    """Normalize text for grouping comparison.
    Lowercases, removes accents, strips common suffixes."""

def compute_group_id(title: str, artist: str) -> str:
    """Compute base group ID from normalized title + artist."""

def compute_lyrics_hash(lyrics: str) -> str:
    """Hash first 200 chars of normalized lyrics.
    Used to distinguish different songs with same title."""
```

### Output Format

```json
{
  "songs": [
    {
      "id": "songfilename",
      "title": "Song Title",
      "artist": "Artist Name",
      "composer": "Writer Name",
      "first_line": "First line of lyrics...",
      "lyrics": "Lyrics for search (500 chars)",
      "content": "Full ChordPro content",
      "key": "G",
      "mode": "major",
      "nashville": ["I", "IV", "V"],
      "progression": ["I", "I", "IV", "V", "I"],
      "group_id": "abc123def456_12345678",
      "chord_count": 3,
      "version_label": "Simplified",
      "version_type": "simplified",
      "arrangement_by": "John Smith"
    }
  ]
}
```

### Version Grouping

Songs are grouped by `group_id`, which combines:
1. **Base hash**: MD5 of normalized title + artist
2. **Lyrics hash**: MD5 of first 200 chars of normalized lyrics

This ensures songs with the same title but different lyrics (different songs) get different group_ids, while true versions (same lyrics, different arrangements) share a group_id.

### Deduplication

Exact duplicates (identical content) are removed at build time. The first occurrence is kept.

### Key Detection Algorithm

Scores each possible key by:
1. How many song chords fit the key's diatonic scale
2. Bonus weight for tonic chord appearances
3. Tie-breaking: prefer common keys (G, C, D, A, E, Am, Em)

---

## Tag System

Tags are added to songs during index build via `tag_enrichment.py`.

### Tag Taxonomy

| Category | Tags |
|----------|------|
| **Genre** | Bluegrass, ClassicCountry, OldTime, Gospel, Folk, HonkyTonk, Outlaw, Rockabilly, etc. |
| **Vibe** | JamFriendly, Modal, Jazzy |
| **Structure** | Instrumental, Waltz |

### Tag Sources

1. **MusicBrainz artist tags** - Genre tags from crowdsourced artist data
2. **Harmonic analysis** - Vibe tags computed from chord content:
   - `JamFriendly`: ≤5 unique chords, has I-IV-V, no complex extensions
   - `Modal`: Has bVII chord (e.g., F in key of G)
   - `Jazzy`: Has 7th, 9th, dim, aug, or slash chords

### Data Files

| File | Purpose |
|------|---------|
| `docs/data/artist_tags.json` | Cached MusicBrainz artist tags (checked into git) |
| `docs/data/tags.json` | Song-level tag cache |

### Build Workflow

Tags are applied automatically during every index build (local and CI):

| Where | What happens |
|-------|--------------|
| **Local or CI** | `build_index.py` reads `artist_tags.json` → applies genre tags |
| **Local or CI** | Harmonic analysis runs → applies vibe tags (JamFriendly, Modal) |
| **Local only** | `refresh-tags` queries MusicBrainz → updates `artist_tags.json` |

**Normal flow**: Just push `.pro` files. CI rebuilds index with tags from cached `artist_tags.json`.

**Adding new artists**: If songs have artists not in `artist_tags.json`, run locally:

```bash
# Requires local MusicBrainz database on port 5440
./scripts/utility refresh-tags
git add docs/data/artist_tags.json && git commit -m "Refresh artist tags"
```

This updates the cache, which CI then uses for future builds.

### query_artist_tags.py

Optimized MusicBrainz queries using LATERAL joins with indexed lookups:

```python
# Query tags for artists (0.9s for 900 artists)
from query_artist_tags import query_artist_tags_batch
results = query_artist_tags_batch(['Bill Monroe', 'Hank Williams'])
# Returns: {'Bill Monroe': [('bluegrass', 45), ('country', 12), ...], ...}
```

---

## add_song.py

Adds a `.pro` file to `sources/manual/parsed/` and rebuilds index.

```bash
./scripts/utility add-song ~/Downloads/my_song.pro
./scripts/utility add-song song.pro --skip-index-rebuild
```

## process_submission.py / process_correction.py

Called by GitHub Actions when issues are approved.

**Trigger**: Issue labeled `song-submission` + `approved` (or `song-correction`)

**Process**:
1. Extract ChordPro from issue body (```chordpro block)
2. Extract song ID from issue body
3. Write to `sources/manual/parsed/{id}.pro`
4. Add to `protected.txt` (for corrections)
5. Rebuild index
6. Commit changes

## Metadata Parsing

The build script handles both formats:

```python
# Our format
{meta: title Song Name}
{meta: artist Artist}

# Standard ChordPro format
{title: Song Name}
{artist: Artist}
```

Both are extracted and normalized.

## Adding a New Source

To add songs from a new source:

1. Create `sources/{source-name}/parsed/` directory
2. Add `.pro` files there
3. Run `./scripts/bootstrap --quick` to rebuild index

The build script automatically scans all `sources/*/parsed/` directories.
