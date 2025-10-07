# HTML to ChordPro Parser

Converts scraped HTML song files from classic-country-song-lyrics.com to ChordPro format.

## Features

- **Multi-pattern HTML parsing**: Handles both `span+br` and `pre+font` HTML structures
- **Accurate chord alignment**: Preserves horizontal positioning from fixed-width layouts
- **Metadata extraction**: Title, artist, composer, recorded_by
- **Paragraph segmentation**: Identifies verses, choruses, and other song sections
- **Repeat instruction parsing**: Handles "Repeat #N xM" directives
- **Comprehensive validation**: Multi-level validation with confidence scoring
- **Batch processing**: Process entire directories with progress tracking

## Components

### `parser.py`
Core parsing logic:
- `StructureDetector`: Identifies HTML structure patterns
- `HTMLNormalizer`: Cleans and normalizes whitespace
- `MetadataExtractor`: Extracts song metadata
- `ChordDetector`: Identifies and parses chord lines
- `ContentExtractor`: Main parsing engine
- `ChordProGenerator`: Generates ChordPro output

### `validator.py`
Validation framework:
- `StructuralValidator`: Checks data integrity, chord positions, playback sequences
- `ComparisonValidator`: Compares against known-good outputs
- `BatchValidator`: Generates corpus statistics

### `batch_processor.py`
Batch processing tool for processing entire directories.

## Usage

### Single File
```python
from bs4 import BeautifulSoup
from parser import StructureDetector, ContentExtractor, ChordProGenerator

with open('song.html') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

structure_type = StructureDetector.detect_structure_type(soup)
song = ContentExtractor.parse(soup, structure_type, 'song.html')
chordpro = ChordProGenerator.song_to_chordpro(song)

with open('song.pro', 'w') as f:
    f.write(chordpro)
```

### Batch Processing
```bash
# Process all HTML files in a directory
python3 batch_processor.py html/ -o output/ -j songs.jsonl

# Process with limit (for testing)
python3 batch_processor.py html/ -o output/ -l 100

# Options:
#   -o, --output-dir   Output directory for .pro files
#   -j, --jsonl        Optional JSONL file for structured data
#   -r, --report       JSON report file (default: batch_report.json)
#   -l, --limit        Limit number of files to process
```

### Validation
```python
from validator import StructuralValidator

result = StructuralValidator.validate(song)
print(f"Valid: {result.valid}")
print(f"Confidence: {result.confidence:.2%}")
print(f"Issues: {len(result.issues)}")
```

## Output Formats

### ChordPro (.pro)
Standard ChordPro format with:
- Metadata directives: `{title:}`, `{artist:}`, `{composer:}`
- Section markers: `{start_of_verse}`, `{end_of_verse}`
- Inline chords: `[G]lyric text [D7]more lyrics`

### JSONL (optional)
One JSON object per line, each containing:
```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "composer": "Writer Name",
  "recorded_by": "Recording Artist",
  "source_html_file": "original.html",
  "song_content": {
    "paragraphs": [...],
    "playback_sequence": [0, 1, 2, 3],
    "raw_repeat_instruction_text": "Repeat #3 x2"
  }
}
```

## Validation Metrics

The validator provides:
- **Confidence score** (0-100%): Overall quality assessment
- **Error count**: Critical issues (negative chord positions, invalid references)
- **Warning count**: Non-critical issues (missing metadata, unusual structure)
- **Metrics**: Paragraph count, chord coverage, chord position accuracy

### Confidence Levels
- **High (>80%)**: Ready for use
- **Medium (50-80%)**: Review recommended
- **Low (<50%)**: Manual review required

## Known Limitations

1. **HTML structure variations**: Currently handles 2 main patterns; additional patterns may exist in corpus
2. **Chord alignment**: ±1-2 character accuracy due to HTML/whitespace complexity
3. **Boilerplate filtering**: Uses heuristics that may need tuning for full corpus
4. **Metadata extraction**: Quality depends on HTML consistency

## Testing

Test with example files:
```bash
python3 parser.py              # Test parser
python3 validator.py           # Test validator
python3 batch_processor.py test_html/ -o test_output/
```

## Future Improvements

1. **Pre-analysis phase**: Discover additional HTML patterns in corpus
2. **Adaptive parsing**: Learn from failures and adjust rules
3. **Round-trip validation**: Render ChordPro and compare with original
4. **Manual review interface**: UI for reviewing low-confidence files
5. **Pattern clustering**: Group similar HTML structures automatically
