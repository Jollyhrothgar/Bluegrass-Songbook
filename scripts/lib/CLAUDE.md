# Build Scripts (scripts/lib)

Python utilities for building the search index and managing songs.

## Pipeline Overview

The build pipeline now uses **works/** as the primary data source:

```
PRIMARY (current):
                                                        ┌→ docs/data/index.jsonl    (canon rows, no content)
works/*/work.yaml + lead-sheet.pro → build_works_index.py┼→ docs/data/archive.jsonl  (indexed:false rows)
                                                        └→ docs/data/songs/{id}.pro (full ChordPro, per work)

LEGACY (migration complete):
sources/*/parsed/*.pro  →  migrate_to_works.py  →  works/
```

**The index no longer carries song content** — see
[Split Output](#split-output-lean-canon-index--archive--per-song-content).

**Key files:**
- `build_works_index.py` - PRIMARY: Builds index from works/ directory
- `work_schema.py` - Defines work.yaml schema and validation
- `curation.py` - Editorial curation registry (canonical pins, suppressions)
- `curate.py` - Convergence CLI for the curation registry
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
| **Deleted songs sync** | Scheduled CI + local | `deleted_songs.json` | `.github/workflows/sync-deleted-songs.yml` (hourly cron + manual dispatch) or `./scripts/utility sync-deleted-songs` |
| **Promoted songs sync** | Scheduled CI + local | `promoted_songs.json` | same workflow as deleted songs, or `./scripts/utility sync-promoted-songs` |
| **Tag overrides sync** | Scheduled CI + local | `tag_overrides.json` | `.github/workflows/sync-community-input.yml` (hourly cron + manual dispatch) or `./scripts/utility sync-tag-votes`; auto-applied at next index build |
| **Genre suggestions export** | Scheduled CI + local | `user_genre_suggestions.json` | same workflow as tag overrides, or `./scripts/utility export-suggestions`; review-only, never auto-applied |
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
- `docs/data/deleted_songs.json` - Soft-deleted song IDs (synced from Supabase via `fetch_deleted_songs.py`; suppressed at index build)
- `docs/data/promoted_songs.json` - Trusted-user promotions from the Bluegrass Dungeon (synced from Supabase via `fetch_promoted_songs.py`; unioned with the registry `keep:` map at index build)

## Files

```
scripts/lib/
├── build_works_index.py  # PRIMARY: Build index.jsonl from works/
├── work_schema.py        # work.yaml schema definition and validation
├── curation.py           # Editorial curation registry (curation/registry.yaml)
├── curate.py             # Curation CLI: report / pin / suppress
├── fetch_deleted_songs.py # Sync Supabase deleted_songs → deleted_songs.json cache
├── migrate_to_works.py   # Migrate sources/ → works/ structure
├── build_index.py        # LEGACY: Build index from sources/*.pro
├── build_posts.py        # Build blog posts manifest (posts.json)
├── enrich_songs.py       # Enrich .pro files (provenance, chord normalization)
├── tag_enrichment.py     # Tag enrichment (MusicBrainz + harmonic analysis)
├── query_artist_tags.py  # Optimized MusicBrainz artist tag queries
├── strum_machine.py      # Strum Machine API integration
├── fetch_tune.py         # Fetch tunes from TuneArch by URL
├── search_index.py       # Search index utilities and testing
├── add_song.py           # Add a song to manual/parsed/
├── process_pending.py    # GitHub Action: land one pending_songs row in works/
├── process_submission.py # RETIRED flow (issue-based); still imported by tests
├── process_correction.py # RETIRED flow (issue-based); kept for reference
├── dedup_scorer.py       # Is this submission already a work? (containment on lyrics)
├── dedup_works.py        # Whole-corpus duplicate detection → merge plan JSON
├── merge_works.py        # Execute a merge plan (redirects included)
├── chord_counter.py      # Chord statistics utility
├── loc_counter.py        # Lines of code counter for analytics
├── export_genre_suggestions.py  # Export genre suggestions for review
├── batch_tag_songs.py    # Batch tag songs using Claude API
├── fetch_tag_overrides.py # Fetch trusted user tag votes from Supabase
└── tagging/              # Song-level tagging system
    ├── CLAUDE.md         # Detailed docs for grassiness scoring
    ├── build_artist_database.py  # Build curated bluegrass artist database
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

## Bootstrap Timing

Bootstrap now shows elapsed time and per-stage breakdown:

```
Bootstrap complete! (45s total)
  Timing breakdown:
    - Enrichment: 12s
    - Build index: 33s
```

## Performance Notes

The build pipeline uses **pre-computed lookup dicts** to avoid O(n*m) nested loops:

| Operation | Before | After | Savings |
|-----------|--------|-------|---------|
| Strum Machine "the" matching | 17k × 52k = 884M | 52k + 17k = 69k | 12,800× faster |
| Grassiness title lookup | 17k × 56k = 952M | 56k + 17k = 73k | 13,000× faster |

These lookups are built once before the main song loop, then used for O(1) dict access.

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

Generates the three published artifacts (see [Split Output](#split-output-lean-canon-index--archive--per-song-content))
from the `works/` directory.

### What It Does

1. Scans `works/*/work.yaml` for all works
2. Reads work metadata (title, artist, composers, tags, parts)
3. Reads lead sheet content from `lead-sheet.pro`
4. Detects key and computes Nashville numbers
5. Identifies tablature parts, copies their OTFs, records each one's track count
6. Applies fuzzy grouping to merge similar titles
7. Matches to Strum Machine cache
8. Writes the canon index, the archive index, and one `.pro` per work

### Split Output: lean canon index + archive + per-song content

**Decision (Mike, 2026-07-31): phones without wifi.** `index.jsonl` had grown
to **48.8 MB / 18,388 rows** — every visitor downloaded every song's full
ChordPro before the first search could run. The row data the search actually
needs is a fraction of that, so the build now splits its output:

| Output | Contents | Size (2026-07-31) |
|--------|----------|-------------------|
| `docs/data/index.jsonl` | canon rows only (`indexed` is not `false`), no song content | **2.2 MB** (482 KB gzipped), 1,766 rows |
| `docs/data/archive.jsonl` | the `indexed: false` rows, same slim shape, `lyrics` clipped to 200 chars | 15.7 MB, 16,764 rows |
| `docs/data/songs/{id}.pro` | the FULL ChordPro for one work — canon *and* archive | 25 MB across 18,475 files |

The frontend loads `index.jsonl` at startup, fetches `songs/{id}.pro` when a
song page opens, and only touches `archive.jsonl` when it needs a row that
isn't in the canon (deep links, saved lists, arrangement groups). Archive rows
never feed search, which is why their lyrics are clipped — canon lyrics are
left at full builder width because `lyrics:` search reads them.

Row-shape changes (`write_outputs()` in `build_works_index.py`):

| Field | Change |
|-------|--------|
| `content` | **removed** → `docs/data/songs/{id}.pro` |
| `abc_content` | **removed** → still inside the `.pro` (`{start_of_abc}` block) |
| `has_content` | `true` when the work has a lead sheet; **omitted** otherwise (placeholders, tab-only works) |
| `has_abc` | `true` when the lead sheet embeds an ABC block; **omitted** otherwise |
| `tablature_parts[].tracks` | int — the OTF's PLAYABLE track count, read during the tab copy step (lets the frontend decide about the track mixer without downloading the OTF). Percussion tracks are excluded: they're neither rendered nor played, so counting them would stamp `tag:multipart` on single-instrument tabs |
| `lyrics` | unchanged on canon rows; clipped to 200 chars on archive rows |

Everything else is byte-for-byte what it was. Both `.jsonl` files inherit the
build's id sort, and `.pro` files are only rewritten when their text changed,
so repeat builds are byte-stable and quiet in `git status`. Stale
`docs/data/songs/*.pro` (renames, deletions, suppressions, a lead sheet that
went away) are pruned each build, the same way `docs/data/tabs/` is — after
the tab provenance gate, so a failed build never mutates `docs/data/`.

**Reading the corpus from Python**: `index.jsonl` alone is the canon slice.
Tools that reason about the whole corpus (`curate`, `batch_tag_songs`,
`grassiness`, `query_artist_tags --refresh`, `strum_machine --batch`, the
`analytics/bluegrass-research` scripts) read `archive.jsonl` too. The
`search_index.py` CLI deliberately matches the site — canon only — with
`--archive` to fold the pruned rows back in:

```bash
uv run python scripts/lib/search_index.py "tag:bluegrass key:G"
uv run python scripts/lib/search_index.py --archive "artist:hank williams"
```

**Local dev**: `./scripts/server` gzips `.jsonl/.json/.pro/.js/.css/.html`
for clients that send `Accept-Encoding: gzip`, so a local (or tailnet/phone)
page load measures roughly what GitHub Pages serves.

### Version Grouping

Songs are grouped by `group_id` for the version picker. The grouping algorithm:

1. **Title normalization**: Lowercase, remove accents, strip parenthetical suffixes like `(Live)`, `(C)`, `(D)`
2. **Article removal**: Remove "the", "a", "an" so "Angeline the Baker" matches "Angeline Baker"
3. **Lyrics hash**: First 200 chars of lyrics distinguish different songs with same title
4. **Fuzzy matching**: Post-processing pass merges similar titles (85% similarity threshold):
   - Handles contractions: "Lovin'" ↔ "Loving"
   - Handles plurals: "Heartache" ↔ "Heartaches"
   - Handles compound words: "Home Town" ↔ "Hometown"

### Source Priority

When determining the work's source for attribution:

1. **x_source in lead-sheet content** (highest priority) - e.g., `{meta: x_source tunearch}`
2. **Lead-sheet part provenance** from work.yaml
3. **Tablature part provenance** (fallback)

This ensures works with both a TuneArch lead sheet and a Banjo Hangout tab show "tunearch" as the source.

### Tablature Attribution & Arrangements

A work can hold several tablature arrangements of the SAME instrument. The
frontend renders that as a hierarchy: **instrument** (pill) → **arrangement**
(selector) → **tracks** (mixer). Each entry in `tablature_parts`:

```json
"tablature_parts": [{
  "instrument": "banjo",
  "file": "data/tabs/red-haired-boy-banjo-11059.otf.json",
  "source": "banjo-hangout",
  "source_id": "11059",
  "author": "schlange",
  "source_page_url": "https://www.banjohangout.org/tab/browse.asp?m=detail&v=11059",
  "author_url": "https://www.banjohangout.org/my/schlange",
  "default": true,
  "difficulty": "Intermediate",
  "tuning": "Standard Open G (gDGBD)",
  "tracks": 3
}]
```

| Field | Notes |
|-------|-------|
| `instrument` | grouping key for the instrument pill |
| `tracks` | number of tracks in the OTF (read at build time; omitted only if the OTF can't be read) |
| `file` | ALWAYS `data/tabs/{work}-{instrument}-{source_id}.otf.json` — instrument alone is no longer unique (parts with no source_id fall back to `-p{position}`) |
| `default` | exactly ONE true per instrument per work |
| `difficulty` / `tuning` | optional, from part provenance (the Hangout listing) |
| `label` | only when work.yaml sets one |

**Default arrangement** = the `tab_pins:` entry in `curation/registry.yaml`
if present, else the FIRST part listed for that instrument in `work.yaml`
(so imports keep the default they already had when alternates land later).
Resolved by `curation.apply_tab_defaults()` at build time.

```bash
./scripts/utility curate pin-tab <work-id> <instrument> <source_id>
```

Inside `works/`, the first arrangement of an instrument keeps the bare
`{instrument}.otf.json`; alternates are `{instrument}-{source_id}.otf.json`.
The copy step derives published names from the part, and deletes orphaned
`docs/data/tabs/` files (renames, deletions, re-imports) — hand-placed
fixtures that don't match the generated shape are left alone.

### Strum Machine Matching

Matches songs to Strum Machine backing tracks using cached results:

1. Normalize title (lowercase, strip parenthetical suffixes)
2. Try exact match in cache
3. Try without articles ("the", "a", "an")
4. Try matching cache keys with articles removed

This handles cases like "Angeline Baker (C)" matching "angeline the baker" in the cache.

### Usage

```bash
uv run python scripts/lib/build_works_index.py           # Full build
uv run python scripts/lib/build_works_index.py --no-tags # Skip tag enrichment
```

### Editorial Curation (curation.py / curate.py)

Works are ephemeral (regenerated from sources/), so editorial decisions live
in `curation/registry.yaml` at the repo root — not in `works/*/work.yaml`:

- **Canonical pins**: which version of a multi-version group is canonical,
  plus optional display labels for the variants
- **Suppressions**: work ids that must never come back (union'd with
  `docs/data/deleted_songs.json` at build time)

`build_works_index.py` applies the registry via `filter_suppressed()` and
`apply_curation()`, which emits stable `grp:` group ids and the
`canonical` / `variant_of` / `variant_label` fields on index rows (the
frontend's Arrangement pill reads these). Importers call `is_suppressed()`
so suppressed works are never re-created from sources.

- **Tab pins**: which tablature arrangement is the default for a given
  work + instrument (`tab_pins: {work-id: {instrument: source_id}}`)

```bash
./scripts/utility curate report                # groups without a canonical pin
./scripts/utility curate pin <canonical-id> [variant-id ...] [--label LABEL]
./scripts/utility curate suppress <work-id> --reason "..."
./scripts/utility curate pin-tab <work-id> <instrument> <source_id>
```

### Index Prune — the searchable index is the bluegrass canon

**Policy (Mike, 2026-07-31):** search and collections deliberately show only
bluegrass + bluegrass-adjacent repertoire (~1,800 songs). The other ~16,900
works are NOT deleted: they stay on disk, keep their `#work/{slug}` URLs,
stay in lists, and can be restored to search at any time.

Mechanism: `curation/index_prune.csv` lists work ids that
`apply_index_prune()` stamps `indexed: false` at build time. A row is
exempt if it is user-origin (`USER_SOURCES` or `submitted_by` — user
contributions are never pruned) or has a registry `keep:` entry.

How the current keep set was decided: see **`curation/INDEX_DECISIONS.md`**
(the full decision record — self-contained, with every data source as an
in-repo path). Short version: a 2026-07-23 MusicBrainz cover-coverage rule,
then a 2026-07-31 two-of-three-ledgers rule, then a manual title-by-title
review (163 rescues, reasons in `registry.yaml` `keep:`). The MusicBrainz
coverage snapshot the decisions used is vendored at
`curation/decision-data/site_index_scored.csv` — no local database needed to
re-analyze or reverse any of it.

Restoring songs later:

```bash
# one song back on the index
./scripts/utility curate unprune <work-id> --reason "why it belongs"
./scripts/bootstrap --quick

# in bulk: remove rows from curation/index_prune.csv (or add keep:
# entries in curation/registry.yaml), then rebuild
```

### Deleted/Promoted-Songs Sync

Admin soft-deletes land in the Supabase `deleted_songs` table; trusted-user
promotions from the Bluegrass Dungeon land in `promoted_songs`. The
`Sync Deleted + Promoted Songs` workflow
(`.github/workflows/sync-deleted-songs.yml`, hourly cron + manual dispatch)
writes both to the committed caches (`docs/data/deleted_songs.json`,
`docs/data/promoted_songs.json`) and its commit triggers a rebuild + deploy,
so UI deletes and promotions actually stick. A promotion has the same effect
as `curate unprune` but lives in the JSON cache instead of `registry.yaml`;
if a promoted work was also deleted, deletion wins (the build warns).
Manual fallback:

```bash
./scripts/utility sync-deleted-songs    # runs fetch_deleted_songs.py
./scripts/utility sync-promoted-songs   # runs fetch_promoted_songs.py
git add docs/data/deleted_songs.json docs/data/promoted_songs.json
git commit -m "Sync deleted/promoted songs"
```

### Output Format

One row per work in `index.jsonl` (canon) or `archive.jsonl` (pruned). The
ChordPro itself lives beside them in `docs/data/songs/{id}.pro`:

```json
{
  "id": "blue-moon-of-kentucky",
  "title": "Blue Moon of Kentucky",
  "artist": "Patsy Cline",
  "composers": ["Bill Monroe"],
  "key": "C",
  "tags": ["ClassicCountry", "JamFriendly"],
  "has_content": true,
  "tablature_parts": [
    {"instrument": "banjo", "file": "data/tabs/...", "tracks": 3}
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
    provenance: dict    # Source info (source, source_id, source_file,
                        # author, difficulty, tuning, imported_at)

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

### Validation

`validate_work(work)` returns a list of problems (empty = valid). Several
tablature parts may share an `instrument` — they're alternate arrangements
— but `(instrument, provenance.source_id)` must be unique within a work,
and part filenames must not repeat.

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

### Tag Sources (Priority Order)

1. **LLM tags** (primary) - Genre tags from Claude batch API (`llm_tags.json`)
2. **Harmonic analysis** - Vibe tags computed from chord content:
   - `JamFriendly`: ≤5 unique chords, has I-IV-V, no complex extensions
   - `Modal`: Has bVII chord (e.g., F in key of G)
   - `Jazzy`: Has 7th, 9th, dim, aug, or slash chords
3. **MusicBrainz artist tags** (fallback) - Only used if LLM tags unavailable
4. **Trusted user overrides** - Downvotes from trusted users exclude bad tags

### Data Files

| File | Purpose |
|------|---------|
| `docs/data/llm_tags.json` | LLM-generated tags (primary source, checked into git) |
| `docs/data/tag_overrides.json` | Trusted user tag exclusions (checked into git) |
| `docs/data/artist_tags.json` | Cached MusicBrainz artist tags (fallback) |

### Build Workflow

Tags are applied automatically during every index build:

| Where | What happens |
|-------|--------------|
| **Local or CI** | `tag_enrichment.py` reads `llm_tags.json` → applies genre tags |
| **Local or CI** | Harmonic analysis runs → applies vibe tags (JamFriendly, Modal) |
| **Local or CI** | `tag_overrides.json` exclusions remove bad tags |

**Normal flow**: LLM tags are pre-computed and checked into git. CI uses them directly.

**Re-tagging all songs** (local only, requires Anthropic API key):

```bash
# Submit batch job (takes ~2 hours to process)
uv run python scripts/lib/batch_tag_songs.py

# Check status
uv run python scripts/lib/batch_tag_songs.py --status <batch_id>

# Fetch results when complete
uv run python scripts/lib/batch_tag_songs.py --results <batch_id>

# Rebuild index and commit
./scripts/bootstrap --quick
git add docs/data/llm_tags.json && git commit -m "Refresh LLM tags"
```

**Syncing trusted user votes** (local only, requires Supabase credentials):

```bash
./scripts/utility sync-tag-votes
git add docs/data/tag_overrides.json && git commit -m "Sync tag overrides"
```

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

## process_pending.py — the live contribution path

Called by `.github/workflows/process-pending.yml` on the `pending-commit`
repository_dispatch that `auto-commit-song` (or the hourly reconciler) fires.

**Trigger**: any logged-in user saves a song in the editor. The row lands in
Supabase `pending_songs` (live in the overlay in seconds); the edge function
classifies the change and dispatches; this script makes it durable.

**Env**: `PENDING_ROW_ID`, `PENDING_MODE`, `PENDING_WORK_ID`, `PENDING_ACTOR`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Process**:
1. `GET /rest/v1/pending_songs?id=eq.<row>` (urllib — no SDK in the write path)
2. Hand the dispatched mode to `works_writer`:
   - `create` → `create_work(on_collision='suffix')`
   - `update` → `update_part` on the default lead sheet
   - `fork` → `fork_to_arrangement`, `x_version_*` from the submitter identity
3. The workflow commits, pushes with rebase-retry, then marks the row
   `github_committed`.

**Idempotence**: every part written carries
`provenance.source_id = pending:<row id>:<content sha>`. A replayed dispatch
finds the marker and no-ops; a genuine re-edit changes the sha and applies.
The mode is decided server-side in `supabase/functions/_shared/pending-dispatch.ts`
— the client cannot claim "update" on somebody else's chart.

## process_submission.py / process_correction.py — RETIRED

The GitHub-issue content flow (`process-song-submission.yml`,
`process-song-correction.yml`, `create-song-issue`) was retired in phase 2b:
with additive-instant there is nothing for a review queue to review. These
modules no longer run in CI. `publish_to_works` is still imported by
`tests/test_curation.py` as a works_writer caller fixture.

## dedup_scorer.py — is this submission already a work?

Per-submission duplicate check. `dedup_works.py` is unchanged and still does the
other job (whole-corpus merge plans); this one answers a single incoming chart.

**Containment, not Jaccard.** The metric is `|A ∩ B| / |smaller side|` over
**full** normalized lyric *word sets*. A lyrics-only scrape is nearly a subset of
a fuller submission, and Jaccard punishes exactly that size gap. Word sets are
also order-independent, which matters: the `how-long-blues` pair (issue #208)
orders chorus and verse differently, and `dedup_works.py` — first 300 chars, in
order — scored it **0.043** against a 0.5 threshold. It scores **0.886** here.

**Signal order: lyrics > title > chords.**

- Lyrics decide the match. Nothing else does.
- Title only *narrows* candidates (inverted index over title words, then
  `SequenceMatcher`), because titles collide constantly.
- Chords are **not** a matching signal — half the canon is I-IV-V in G. Chord
  *presence* picks the outcome: existing lyrics-only + incoming with chords is an
  **enrichment**, not a duplicate. Composer is not a signal either (12 of 19,228
  works have one).

**Outcomes**: `enrich` / `duplicate` / `arrangement-candidate` / `no-match`.
Only `enrich` is ever marked `auto_actionable`, and only above 0.85 — adding
chords to a lyrics-only work cannot destroy anything.

**Instrumentals never fall back to title silently.** With no usable lyrics on
either side the verdict carries `low_confidence=True` plus a warning, needs a
0.95+ title match before it will even name a candidate, and is never
auto-actionable.

**Cost**: the title index reads only the head of each `work.yaml` (~1.2s for 19k
works, once per process, lazily). Lyrics are read **only** for works that survive
title narrowing, and are memoized — a query is ~10-30ms after the index is warm.

```bash
uv run python scripts/lib/dedup_scorer.py how-long-blues how-long-blues-1
uv run python scripts/lib/dedup_scorer.py --scan submission.pro --json
```

Tests: `tests/test_dedup_scorer.py` (fixtures in `tests/fixtures/dedup/`, with
provenance in the module docstring).

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
