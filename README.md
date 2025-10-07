# HTML to ChordPro Parser

Converts scraped HTML song files from classic-country-song-lyrics.com to ChordPro format.

## Project Structure

```
.
├── src/
│   └── chordpro_parser/      # Main package
│       ├── __init__.py
│       ├── parser.py          # Core parsing logic
│       ├── validator.py       # Validation framework
│       └── batch_processor.py # Batch processing
├── examples/                  # Example input/output files
├── docs/                      # Documentation
│   ├── README.md             # This file
│   └── CLAUDE.md             # Project instructions
├── output/                    # Generated ChordPro files (gitignored)
├── html/                      # Input HTML corpus
├── chordpro_cli.py           # Command-line interface
└── requirements.txt          # Dependencies
```

## Installation

```bash
# Create virtual environment
uv venv

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
uv pip install -r requirements.txt
```

## Usage

### Command Line

```bash
# Process all HTML files in a directory
python3 chordpro_cli.py html/ -o output/

# With JSONL output
python3 chordpro_cli.py html/ -o output/ -j songs.jsonl

# Process limited number (for testing)
python3 chordpro_cli.py html/ -o output/ -l 100

# Full options
python3 chordpro_cli.py --help
```

### Python API

```python
from bs4 import BeautifulSoup
from src.chordpro_parser import (
    StructureDetector,
    ContentExtractor,
    ChordProGenerator,
    StructuralValidator
)

# Parse single file
with open('song.html') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

structure_type = StructureDetector.detect_structure_type(soup)
song = ContentExtractor.parse(soup, structure_type, 'song.html')

# Validate
result = StructuralValidator.validate(song)
print(f"Confidence: {result.confidence:.2%}")

# Generate ChordPro
chordpro = ChordProGenerator.song_to_chordpro(song)
with open('song.pro', 'w') as f:
    f.write(chordpro)
```

### Batch Processing

```python
from src.chordpro_parser import BatchProcessor

processor = BatchProcessor(
    input_dir='html/',
    output_dir='output/',
    jsonl_output='songs.jsonl'
)

stats = processor.process_batch()
processor.print_report()
processor.save_report('report.json')
```

## Features

- **Multi-pattern HTML parsing**: Handles `span+br` and `pre+font` structures
- **Accurate chord alignment**: Preserves horizontal positioning from fixed-width layouts
- **Metadata extraction**: Title, artist, composer, recorded_by
- **Paragraph segmentation**: Identifies verses, choruses, etc.
- **Repeat instructions**: Parses "Repeat #N xM" directives
- **Comprehensive validation**:
  - Structural integrity checks
  - Confidence scoring (0-100%)
  - Error and warning tracking
  - Batch statistics
- **Multiple output formats**:
  - ChordPro (.pro files)
  - JSONL (structured data)
  - JSON reports

## Validation

The validator provides confidence scores and detailed metrics:

- **High confidence (>80%)**: Ready for use
- **Medium confidence (50-80%)**: Review recommended
- **Low confidence (<50%)**: Manual review required

Validation checks:
- Metadata completeness
- Chord position accuracy
- Paragraph structure
- Playback sequence validity
- Chord coverage ratio

## Output Format

### ChordPro (.pro)
```
{title: Song Title}
{artist: Artist Name}
{composer: Writer Name}

{c: Verse 1}
{sov}
[G]Lyric line with [D7]chords inline
More lyrics [C]here
{eov}
```

### JSONL
One JSON object per line with complete song structure including paragraphs, chord positions, and playback sequences.

## Known Limitations

1. Currently handles 2 main HTML patterns; additional patterns may exist
2. Chord alignment accuracy: ±1-2 characters due to HTML complexity
3. Boilerplate filtering uses heuristics that may need corpus-specific tuning

## Testing

```bash
# Test with example files
python3 chordpro_cli.py examples/ -o output/

# Check output
ls output/
cat output/old_home_place_input.pro
```

## Development

See `docs/CLAUDE.md` for detailed project instructions and parsing requirements.
