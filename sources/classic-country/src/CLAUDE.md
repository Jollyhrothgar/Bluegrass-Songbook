# Classic Country Parser

Converts HTML song files from classic-country-song-lyrics.com to ChordPro format.

**Stats**: 17,122 successful / 17,381 total (98.5% success rate)

## Files

```
src/
├── parser.py           # Main parser (all logic here)
├── batch_process.py    # Batch processing with threading
└── regression_test.py  # Before/after comparison testing
```

## Quick Commands

```bash
# Debug a single file
./scripts/test reparse songname

# Run debug viewer (live parsing)
./scripts/server debug_viewer
# → http://localhost:8000

# Run regression test
./scripts/test regression --name my_fix

# Batch re-parse all files
./scripts/utility batch_parse
```

## Parser Architecture

### Three-Stage Pipeline

```
HTML → StructureDetector → ContentExtractor → ChordProGenerator → .pro
```

### 1. StructureDetector

Identifies HTML pattern type:

| Type | % | Pattern |
|------|---|---------|
| `pre_plain` | 59.7% | Plain text in `<pre>` tags |
| `pre_tag` | 31.8% | `<pre>` with `<font>` tags for chords |
| `span_br` | 8.4% | Courier New `<span>` elements with `<br>` |

**Key method**: `detect_structure_type(soup) → str | None`

### 2. ContentExtractor

Pattern-specific parsing. Three methods:
- `parse_pre_plain_structure(soup)`
- `parse_pre_tag_structure(soup)`
- `parse_span_br_structure(soup)`

**Verse boundary detection** (critical logic):
```python
# 2+ consecutive blank lines = always verse boundary
if blank_count >= 2:
    start_new_paragraph()

# Single blank + chord line = verse boundary
elif ChordDetector.is_chord_line(next_line):
    start_new_paragraph()

# Single blank + lyrics = internal spacing (NOT boundary)
```

**Chord detection**: `ChordDetector.is_chord_line(line) → bool`
- Checks if line is primarily chord symbols
- Pattern: `[A-G][#b]?(?:maj|min|m|sus|dim|aug)?\d*(?:/[A-G][#b]?)?`

**Repeat handling**: Parses `"Repeat #3"` or `"Repeat #4,5"` → creates `REPEAT_VERSE_N` markers

### 3. ChordProGenerator

Converts `Song` object to ChordPro string.

**Key method**: `song_to_chordpro(song) → str`

**Two-pass algorithm for repeats**:
1. First pass: identify actual verses (skip repeat markers)
2. Second pass: output verses, expanding `REPEAT_VERSE_N` markers

**Chord insertion**: `_insert_chords_inline(lyrics, chords)`
- Inserts `[chord]` at exact character positions
- Sorts by position descending (insert right-to-left)

## Data Structures

```python
@dataclass
class Song:
    title: str
    artist: str
    composer: str
    source_html_file: str
    song_content: SongContent

@dataclass
class SongContent:
    paragraphs: List[Paragraph]
    playback_sequence: List[int]

@dataclass
class Paragraph:
    lines: List[SongLine]
    section_type: Optional[str]  # 'verse', 'chorus', 'bridge'

@dataclass
class SongLine:
    lyrics: str
    chords: List[ChordPosition]
    chords_line: Optional[str]  # For chord-only lines

@dataclass
class ChordPosition:
    chord: str      # e.g., "G7"
    position: int   # Character offset in lyric line
```

## Output Format

```chordpro
{meta: title Your Cheatin Heart}
{meta: artist Hank Williams}
{meta: writer Hank Williams}        # BUG: should be "composer" (issue #4)

{start_of_verse: Verse 1}
[G7]Your cheating [C]heart [C7]will make you [F]weep
{end_of_verse}
```

## Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| `{meta: writer}` should be `{meta: composer}` | GitHub #4 | Wrong field name |
| 259 files fail to parse | Won't fix | HTML doesn't match any pattern |
| "Tag:" directive | Low priority | Treated as lyrics |
| End anchor edge cases | Mostly fixed | Sometimes captures footer |

## Development Workflow

1. **Make changes** to `parser.py`
2. **Test immediately** with debug viewer (no rebuild needed):
   ```bash
   ./scripts/server debug_viewer
   # Refresh browser to see changes
   ```
3. **Run regression test** before committing:
   ```bash
   ./scripts/test regression --name my_fix
   ```
4. **If clean**, batch re-parse:
   ```bash
   ./scripts/utility batch_parse
   ```

## Common Pitfalls

1. **Don't break chord alignment** - Position mapping is critical
2. **Test all three parsers** - Changes often need to apply to all patterns
3. **Watch NavigableString vs Tag** - BeautifulSoup text nodes have `name=None`
4. **Repeat directives are 1-indexed** - "Repeat #1" means first verse

## Debugging Tips

**Parser not detecting structure?**
- Check if HTML has `<pre>` tags or Courier New spans
- Look for chord patterns in the HTML

**Verses merged incorrectly?**
- Check blank line count between verses
- Verify verse boundary detection rules

**Chords misaligned?**
- Check character positions in `ChordPosition` objects
- Verify fixed-width assumption holds

**Use debug viewer** at http://localhost:8000 for side-by-side HTML vs ChordPro comparison.
