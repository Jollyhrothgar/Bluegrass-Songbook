# ChordPro Parser - Core Implementation

This directory contains the core HTML-to-ChordPro parsing logic that handles 17,381 HTML files with 98.5% success rate.

## Files in This Directory

```
src/chordpro_parser/
├── CLAUDE.md       # This file - parser architecture documentation
├── parser.py       # Main parser implementation (1000+ lines)
└── __init__.py     # Package exports
```

## Architecture: Three-Stage Pipeline

### 1. Structure Detection (`StructureDetector`)

**Purpose**: Identify which of three HTML patterns the file uses

**Method**: `detect_structure_type(soup) → str | None`

**Returns**:
- `'pre_plain'` (59.7%) - Plain `<pre>` tag with `<br>` line breaks
- `'pre_tag'` (31.8%) - `<pre>` containing `<font>` with spans/text nodes
- `'span_br'` (8.4%) - Courier New `<span>` elements with `<br>` separators
- `None` - Unparseable (causes failure)

**Detection Logic** (lines 95-114):
```python
# Look for <pre> tag
pre_tag = soup.find('pre')
if pre_tag:
    if pre_tag.find('font'):
        return 'pre_tag'      # Has nested font element
    return 'pre_plain'        # Plain pre

# Look for multiple Courier New spans
courier_spans = soup.find_all('span', style=re.compile(r'font-family:\s*Courier New'))
if len(courier_spans) > 5:
    return 'span_br'

return None  # No recognized pattern
```

### 2. Content Extraction (`ContentExtractor`)

**Purpose**: Parse HTML into structured `Song` object

**Method**: `parse(soup, structure_type, filename) → Song`

**Three Pattern-Specific Parsers**:
- `parse_span_br_structure(soup)` → `List[Paragraph]` (lines 290-386)
- `parse_pre_tag_structure(soup)` → `List[Paragraph]` (lines 388-582)
- `parse_pre_plain_structure(soup)` → `List[Paragraph]` (lines 584-756)

#### Common Parsing Flow

Each parser follows this pattern:
1. **Metadata extraction** (title, artist, composer)
2. **Line-by-line parsing** (detect chords, lyrics, repeat directives)
3. **Verse boundary detection** (segment into paragraphs)
4. **Chord alignment** (map chord positions to lyric offsets)

#### Critical: Verse Boundary Detection

**pre_plain parser** (lines 656-676) - Most sophisticated rules:

```python
# Count consecutive blank lines
if not line.strip():
    blank_count = 1
    while next line is also blank:
        blank_count += 1

    # Verse boundary rules (priority order):
    # 1. Two or more consecutive blank lines = ALWAYS verse boundary
    if blank_count >= 2:
        start_new_paragraph()

    # 2. Single blank + chord line = verse boundary
    elif ChordDetector.is_chord_line(next_line):
        start_new_paragraph()

    # 3. Single blank + lyrics = internal spacing (NOT boundary)
    else:
        continue  # Don't start new paragraph
```

**Why this matters**: The 2+ blank line rule fixed the "Blue Suede Shoes" bug where all verses were merged into one. Some songs don't have chord lines starting verses, only lyrics.

**span_br parser** (lines 357-363):
```python
# Paragraph break = two consecutive <br> tags
if item['type'] == 'br':
    if prev_was_br:
        start_new_paragraph()
    prev_was_br = True
```

**pre_tag parser** (similar to span_br but handles both `<span>` and text nodes)

#### Repeat Directive Handling

**Pattern**: `"Repeat #4,5"` or `"Repeat #3"` (case-insensitive)

**Regex**: `r'repeat\s+#?([\d,\s]+)'`

**Implementation** (same in all three parsers, e.g., lines 340-351 for span_br):
```python
repeat_match = re.search(r'repeat\s+#?([\d,\s]+)', text, re.I)
if repeat_match:
    # Parse comma-separated verse numbers
    verse_nums_str = repeat_match.group(1).replace(' ', '')
    verse_nums = [int(n) for n in verse_nums_str.split(',') if n.strip()]

    # Add repeat marker for each verse number
    for verse_num in verse_nums:
        items.append({'type': 'repeat', 'verse_num': verse_num})
```

**Output**: Creates special paragraphs with `lyrics="REPEAT_VERSE_4"` markers

**Multi-verse support**: "Repeat #4,5" creates TWO markers: `REPEAT_VERSE_4` and `REPEAT_VERSE_5`

#### Chord Detection (`ChordDetector`)

**Purpose**: Identify if a line contains chords vs lyrics

**Method**: `is_chord_line(line) → bool` (lines 25-58)

**Logic**:
1. Ignore short lines or lines with lots of words
2. Extract potential chord tokens (uppercase sequences)
3. Check if tokens match chord patterns: `C`, `Am7`, `G/B`, `F#m`, etc.
4. Require high ratio of chord tokens to total tokens

**Chord Patterns Recognized**:
- Basic: `C`, `D`, `E`, `F`, `G`, `A`, `B`
- Sharps/flats: `C#`, `Db`
- Qualities: `Cm`, `Cmaj7`, `C7`, `Cdim`, `Caug`
- Slash chords: `C/G`, `Am/E`

#### Chord Alignment (`ChordAligner`)

**Purpose**: Map chord horizontal positions to lyric character offsets

**Method**: `align_chords_to_lyrics(chord_line, lyric_line) → List[ChordPosition]` (lines 60-84)

**How it works**:
```python
# Extract chords with their positions
chords_with_pos = []
for match in re.finditer(r'([A-G][#b]?(?:maj|min|m|dim|aug|sus)?\d*(?:/[A-G][#b]?)?)', chord_line):
    chord = match.group(0)
    position = match.start()  # Character offset in chord_line
    chords_with_pos.append(ChordPosition(chord=chord, position=position))
```

**Critical**: Position is character offset in the *chord line*, which corresponds to the *lyric line* position in fixed-width rendering.

### 3. ChordPro Generation (`ChordProGenerator`)

**Purpose**: Convert `Song` object to ChordPro format string

**Method**: `song_to_chordpro(song) → str` (lines 794-889)

#### Metadata Output (lines 800-810)
```python
output.append(f"{{title: {song.title}}}")
output.append(f"{{artist: {song.artist}}}")  # From "Recorded by"
if song.composer:
    output.append(f"{{composer: {song.composer}}}")  # From "Written by"
```

#### Repeat Directive Handling (lines 813-889)

**Two-pass algorithm**:

**Pass 1**: Identify actual verses (skip repeat markers)
```python
actual_verses = []
for para_idx in song.song_content.playback_sequence:
    paragraph = song.song_content.paragraphs[para_idx]

    if not paragraph.lines[0].lyrics.startswith("REPEAT_VERSE_"):
        actual_verses.append((para_idx, paragraph))
```

**Pass 2**: Output verses, expanding repeat markers
```python
for para_idx in playback_sequence:
    paragraph = paragraphs[para_idx]

    if paragraph.lines[0].lyrics.startswith("REPEAT_VERSE_"):
        # Extract verse number (1-indexed)
        verse_num = int(lyrics.replace("REPEAT_VERSE_", ""))

        # Find verse to repeat from actual_verses list
        if 0 < verse_num <= len(actual_verses):
            repeat_paragraph = actual_verses[verse_num - 1][1]
            output_paragraph(repeat_paragraph)  # Duplicate the verse
    else:
        output_paragraph(paragraph)  # Normal verse
```

**Why two-pass?**: Repeat markers reference verses by their *logical* position (1, 2, 3...), not their *array* position (which includes repeat markers).

#### Chord Insertion (lines 854-868)

```python
for line in paragraph.lines:
    if line.chords:
        # Build lyric line with inline chords
        result = ""
        last_pos = 0

        for chord_pos in sorted(line.chords, key=lambda c: c.position):
            # Add lyrics up to chord position
            result += line.lyrics[last_pos:chord_pos.position]
            # Insert chord
            result += f"[{chord_pos.chord}]"
            last_pos = chord_pos.position

        # Add remaining lyrics
        result += line.lyrics[last_pos:]
        output.append(result)
```

**Output**: `"[G]Hello [C]world"` (chord immediately before the syllable)

## Data Structures

### Song (lines 758-774)
```python
@dataclass
class Song:
    title: str
    artist: str
    composer: str
    source_file: str
    song_content: SongContent
```

### SongContent (lines 776-780)
```python
@dataclass
class SongContent:
    paragraphs: List[Paragraph]
    playback_sequence: List[int]  # Indices into paragraphs array
```

### Paragraph (lines 782-785)
```python
@dataclass
class Paragraph:
    lines: List[SongLine]
```

### SongLine (lines 787-791)
```python
@dataclass
class SongLine:
    lyrics: str
    chords: List[ChordPosition]  # Chord objects with positions
```

### ChordPosition (lines 19-23)
```python
@dataclass
class ChordPosition:
    chord: str       # e.g., "G7"
    position: int    # Character offset in lyric line
```

## Key Implementation Details

### NavigableString vs Tag (pre_tag parser, line 468)

**Problem**: BeautifulSoup's `NavigableString` (text nodes) have a `name` attribute set to `None`

**Bug**: Original code used `if hasattr(child, 'name'):` which caught BOTH tags AND text nodes

**Fix**:
```python
if hasattr(child, 'name') and child.name:  # Must be non-None
    # Handle Tag elements (<br>, <span>)
else:
    # Handle NavigableString (text nodes)
```

**Impact**: Fixed files like "allieverwantedtodolyricschords.html" that had text content directly in `<font>` (not in `<span>`)

### End Anchor Detection (lines 651-654, 537-540, etc.)

**Purpose**: Stop parsing at footer boilerplate

**Pattern**: `"If you want to change the "Key" on any song"`

**Implementation**:
```python
if 'key' in line.lower() and 'on any song' in line.lower():
    break  # Stop processing
```

**Note**: Some edge cases still capture this text (known limitation)

### Metadata Extraction (lines 596-613, 405-415, etc.)

**Skip metadata lines during paragraph parsing**:
```python
if ('recorded by' in line.lower() or
    'written by' in line.lower() or
    len(line) > 150):  # Likely boilerplate
    continue
```

**Extract at parse time** (lines 587-594):
```python
# Extract title from <pre> content first line
first_line = clean_lines[0] if clean_lines else ""
title = first_line.strip()

# Look for "Recorded by" and "Written by"
for line in clean_lines[:20]:  # Check first 20 lines
    if 'recorded by' in line.lower():
        artist = extract_after_keyword(line, 'recorded by')
    if 'written by' in line.lower():
        composer = extract_after_keyword(line, 'written by')
```

## Performance Characteristics

**Structure Distribution**:
- pre_plain: 10,227 files (59.7%)
- pre_tag: 5,450 files (31.8%)
- span_br: 1,445 files (8.4%)

**Processing Speed**: 45.4 files/second (16 threads, ThreadPoolExecutor in batch_process.py)

**Success Rate**: 98.5% (17,122/17,381 files)

**Failure Mode**: All 259 failures are "Could not determine structure type"

## Testing & Validation

**Validation approach**: See `viewer/CLAUDE.md` for details on the web-based validation UI

**Quality evolution**:
- First sample: 50% correct (5/10)
- Second sample: 70% correct (7/10)
- Third sample: 100% correct (10/10)

**Key fixes that improved quality**:
1. 2+ blank line verse boundary rule
2. NavigableString detection fix
3. Multi-verse repeat syntax support

## Common Pitfalls When Modifying

1. **Don't break chord alignment** - Position mapping is critical for musical accuracy
2. **Test all three parsers** - Changes to one pattern often need to apply to all three
3. **Validate with spot-checks** - Use `create_new_spot_check.py` and viewer
4. **Watch for edge cases** - "Tag:", end anchor, multi-verse repeats
5. **Remember 1-indexing** - Repeat directives use 1-indexed verse numbers, not 0-indexed array positions

## Future Improvements

1. **Handle "Tag:" directive** - Detect and treat as special marker (not lyrics)
2. **Better end anchor detection** - More sophisticated pattern to avoid false positives
3. **Bridge/Instrumental directives** - Detect and use `{start_of_bridge}`, etc.
4. **Failed file patterns** - Analyze 259 failures for additional HTML structures
