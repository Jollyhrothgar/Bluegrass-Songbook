# Build Scripts (scripts/lib)

Python utilities for building the search index and managing songs.

## Files

```
scripts/lib/
├── build_index.py        # Build docs/data/index.json from .pro files
├── add_song.py           # Add a song to manual/parsed/
├── process_submission.py # GitHub Action: process song-submission issues
├── process_correction.py # GitHub Action: process song-correction issues
└── chord_counter.py      # Chord statistics utility
```

## Quick Commands

```bash
# Build/rebuild search index
python scripts/lib/build_index.py

# Add a song manually
./scripts/utility add-song /path/to/song.pro

# Count chord usage across all songs
./scripts/utility count-chords
```

## build_index.py

Generates `docs/data/index.json` from all `.pro` files.

### What It Does

1. Scans `sources/*/parsed/*.pro` for all songs
2. Parses ChordPro metadata (title, artist, composer)
3. Extracts lyrics (without chords) for search
4. **Detects key** using diatonic heuristics
5. **Converts chords to Nashville numbers** for chord search
6. Outputs unified JSON index

### Key Functions

```python
def parse_chordpro_metadata(content) -> dict:
    """Extract {meta: key value} and {key: value} directives."""

def detect_key(chords: list[str]) -> tuple[str, str]:
    """Detect key from chord list. Returns (key, mode)."""

def to_nashville(chord: str, key_name: str) -> str:
    """Convert chord to Nashville number given a key."""

def extract_lyrics(content: str) -> str:
    """Extract plain lyrics without chord markers."""
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
      "progression": ["I", "I", "IV", "V", "I"]
    }
  ]
}
```

### Key Detection Algorithm

Scores each possible key by:
1. How many song chords fit the key's diatonic scale
2. Bonus weight for tonic chord appearances
3. Tie-breaking: prefer common keys (G, C, D, A, E, Am, Em)

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
