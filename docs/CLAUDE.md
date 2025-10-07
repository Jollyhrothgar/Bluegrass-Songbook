# Documentation - Original Project Specification

This directory contains the original project requirements and specifications that guided the parser development.

## Files in This Directory

```
docs/
├── CLAUDE.md   # This file - documentation overview
└── README.md   # Original project specification and requirements
```

## Purpose

The `README.md` file in this directory is the **original specification** that was provided at the start of the project. It defines:

1. **Project goals** - Convert HTML song files to ChordPro format
2. **Input characteristics** - HTML structure patterns from classic-country-song-lyrics.com
3. **Output requirements** - Critical ChordPro format requirements
4. **Key challenges** - HTML variability, chord alignment, verse segmentation
5. **Development strategy** - Modular parser, iterative development approach

## Relationship to Implementation

**Specification → Implementation**:
- docs/README.md (what to build) → src/chordpro_parser/parser.py (how it was built)
- Requirements defined here were used to guide parser architecture
- Critical requirements (chord alignment, verse boundaries, repeat directives) became core features

**Current Status**:
- ✓ All critical requirements met
- ✓ 98.5% success rate achieved
- ✓ Three HTML structure types supported (pre_plain, pre_tag, span_br)
- ✓ Chord alignment preserved with character-level precision
- ✓ Verse boundaries detected using multi-rule approach
- ✓ Repeat directives handled including multi-verse syntax
- ⚠ Some edge cases remain (Tag directive, end anchor detection)

## Key Sections in README.md

### Section 1-2: Overview & Input Data
- Source: www.classic-country-song-lyrics.com
- Input: `html/` directory with 17,381 HTML files
- Fixed-width ASCII style rendering with chords above lyrics
- Common boilerplate patterns (pre-song, post-song)

### Section 3: Desired Output Format
- Primary: `.pro` ChordPro files in `output/` directory
- Metadata directives: `{title}`, `{artist}`, `{composer}`
- Chord insertion: `[C]` inline before lyric syllable
- Verse structure: `{start_of_verse}` ... `{end_of_verse}`
- Playback: Repeat directives by duplicating verse content

### Section 4: Key Challenges
- **HTML variability**: Multiple structure patterns (pre, span+br, etc.)
- **Metadata extraction**: Varied markup for title/artist/composer
- **Paragraph segmentation**: Detecting verse boundaries in different HTML structures
- **Chord alignment**: Mapping horizontal positions to character offsets
- **Repeat instructions**: Parsing and expanding "Repeat #N" directives

### Section 5: Development Strategy
- **Modular functions**: Structure detection, content extraction, ChordPro generation
- **Iterative development**: Start with most common pattern, add support for others
- **Error handling**: Robust handling of malformed HTML

### Section 6-7: Tools & What to Avoid
- **Use**: BeautifulSoup4, regex patterns
- **Avoid**: Hardcoding single HTML structure, losing chord alignment, ignoring paragraphs

## How This Relates to Current Codebase

**Original Requirement** → **Current Implementation**

1. **"Determine structural type"** → `StructureDetector.detect_structure_type()`
   - README: "Implement a strategy-based parser"
   - Code: Three parsers (span_br, pre_tag, pre_plain)

2. **"Chord-lyric alignment is paramount"** → `ChordAligner.align_chords_to_lyrics()`
   - README: "Horizontal positioning from fixed-width HTML must be accurately translated"
   - Code: Character position mapping with `ChordPosition(chord, position)`

3. **"Accurately segment into paragraphs"** → Verse boundary detection rules
   - README: "Differentiate from single line breaks between chord and lyric"
   - Code: 2+ blank lines rule, single blank + chord line rule

4. **"Repeat #N xM must be parsed"** → Repeat directive handling
   - README: "ChordPro blocks should be duplicated in output sequence"
   - Code: REPEAT_VERSE_N markers + two-pass generation algorithm

5. **"Metadata extraction"** → Title/artist/composer parsing
   - README: "Robustly extract from varied markup"
   - Code: Keyword search for "Recorded by" and "Written by"

## Deviations from Original Spec

**Intermediate JSONL format**: Not implemented
- Original spec recommended JSONL for debugging
- Current implementation uses internal dataclasses (`Song`, `Paragraph`, `SongLine`)
- Rationale: Simpler architecture, no serialization overhead

**Verse type detection**: Not fully implemented
- Spec suggested detecting chorus vs verse
- Current implementation uses generic `{start_of_verse: Verse N}`
- Rationale: HTML doesn't consistently label verse types

**Metadata format**: Simplified
- Spec suggested `{meta: Recorded By: ...}`
- Current implementation uses `{artist: ...}` for "Recorded by"
- Rationale: More standard ChordPro format

## Evolution of Understanding

**Initial assumptions** (from README.md):
- "Repeat #N xM" format (with multiplier)
- Single HTML structure pattern
- Clean verse boundaries

**Actual discoveries** (during development):
- "Repeat #N,M" format (multi-verse) also exists
- Three distinct HTML structure patterns required
- Verse boundaries complex (2+ blank lines, single blank + chord, etc.)
- NavigableString vs Tag distinction in BeautifulSoup
- End anchor sometimes captured despite detection

**Result**: Spec provided good foundation, but iterative validation revealed edge cases requiring additional sophistication.

## How to Use This Documentation

**For new contributors**:
1. Read `docs/README.md` to understand original requirements
2. Read root `CLAUDE.md` for current project status
3. Read `src/chordpro_parser/CLAUDE.md` for implementation details

**For understanding design decisions**:
- Compare requirement in `docs/README.md` with implementation in `src/chordpro_parser/parser.py`
- See how challenges described in spec were solved in code

**For proposing changes**:
- Check if change aligns with original requirements
- Update this documentation if requirements evolve
- Consider impact on 98.5% success rate

## Future Work Alignment

**Spec suggestions still pending**:
- ✗ Additional structure patterns for 259 failed files
- ✗ More sophisticated verse type detection (chorus, bridge, etc.)
- ✗ Better metadata extraction (handle more HTML variations)

**New requirements discovered**:
- ✓ Multi-verse repeat syntax ("Repeat #4,5") - now implemented
- ⚠ "Tag:" directive handling - edge case, low priority
- ⚠ End anchor edge cases - mostly resolved

## Documentation Hierarchy

```
Root CLAUDE.md           ← Start here: Project map & navigation
├── docs/CLAUDE.md       ← You are here: Original requirements
│   └── docs/README.md   ← Original detailed specification
├── src/chordpro_parser/CLAUDE.md   ← Implementation details
├── viewer/CLAUDE.md     ← Validation UI usage
└── RESULTS.md           ← Final metrics & recommendations
```

**Navigation tip**: Root CLAUDE.md has a "File Navigation Guide" section with quick links to relevant documentation for specific tasks.
