# Golden Standard Source

86 curated bluegrass standards from Ryan Schindler's Golden Standard bluegrass fakebook.

## Pipeline

```bash
# Parse raw file into individual ChordPro files
uv run python sources/golden-standard/parse_songs.py

# Add version metadata for songs that overlap with classic-country
uv run python sources/golden-standard/add_version_metadata.py

# Analyze structure of parsed songs
uv run python sources/golden-standard/analyze_structure.py
```

## Structure

```
golden-standard/
├── raw/golden_standard.txt     # Source: 86 songs with {new_song} delimiters
├── parsed/                     # 86 individual .pro files
├── parse_songs.py              # Raw → ChordPro (section expansion, verse detection)
├── add_version_metadata.py     # Marks 44 overlapping songs as alternate versions
└── analyze_structure.py        # Reports on section marker usage
```

## Processing Details

**parse_songs.py** transforms raw ChordPro with shorthand into standardized format:
- Splits on `{new_song}` separator
- Expands short directives: `{soc}` → `{start_of_chorus}`, `{eov}` → `{end_of_verse}`, etc.
- Converts metadata: `{title: X}` → `{meta: title X}`
- Auto-detects verse boundaries for unmarked content blocks
- Adds provenance: `x_source golden-standard`, `x_submitted_by github:Jollyhrothgar`

**add_version_metadata.py** identifies 44 songs overlapping with classic-country and marks them:
- `{meta: x_version_label Golden Standard}`
- `{meta: x_version_type alternate}`
- `{meta: x_book The Golden Standard by Ryan Schindler}`
