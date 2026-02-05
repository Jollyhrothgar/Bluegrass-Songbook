#!/usr/bin/env python3
"""
Generate ChordPro files from BluegrassLyrics + chord sources.

Outputs to chordpro/ directory with status tracking in manifest.json.
"""
import json
import re
from pathlib import Path
from datetime import datetime
import pyphen

# Syllable counter for chord placement
_hyphenator = pyphen.Pyphen(lang='en_US')


def _count_syllables(word: str) -> int:
    """Count syllables in a word using hyphenation."""
    clean = re.sub(r'[^\w]', '', word.lower())
    if not clean:
        return 0
    hyphenated = _hyphenator.inserted(clean)
    return len(hyphenated.split('-'))


def _syllables_to_word_index(words: list[str], target_syllable: int) -> int:
    """Find which word contains the target syllable (0-indexed)."""
    syllable_count = 0
    for i, word in enumerate(words):
        word_syllables = _count_syllables(word)
        if syllable_count + word_syllables > target_syllable:
            return i
        syllable_count += word_syllables
    return len(words) - 1  # Last word if exceeded

SOURCE_DIR = Path(__file__).parent
PARSED_DIR = SOURCE_DIR / "parsed"
CHORDPRO_DIR = SOURCE_DIR / "chordpro"
TMUK_DIR = SOURCE_DIR.parent / "traditional-music-uk"


def load_manifest() -> dict:
    """Load or create manifest."""
    manifest_file = SOURCE_DIR / "manifest.json"
    if manifest_file.exists():
        with open(manifest_file) as f:
            return json.load(f)
    return {"songs": {}, "updated": None}


def save_manifest(manifest: dict):
    """Save manifest."""
    manifest["updated"] = datetime.now().isoformat()
    with open(SOURCE_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)


def extract_chord_map(tmuk_lines: list[str]) -> dict[str, str]:
    """Build a map of word -> chord from TMUK lines."""
    chord_map = {}
    pattern = r'(\[[A-G][b#]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)*\])?(\S+)'

    for line in tmuk_lines:
        for match in re.finditer(pattern, line):
            chord = match.group(1)
            word = match.group(2)
            if word and chord:
                clean_word = re.sub(r'[^\w]', '', word.lower())
                if clean_word and clean_word not in chord_map:
                    chord_map[clean_word] = chord[1:-1]  # Strip []

    return chord_map


def apply_chords_to_line(bl_line: str, chord_map: dict[str, str]) -> str:
    """Apply chords from map to a BL line based on word matching."""
    words = bl_line.split()
    result = []

    for word in words:
        clean = re.sub(r'[^\w]', '', word.lower())
        chord = chord_map.get(clean)
        if chord:
            result.append(f"[{chord}]{word}")
        else:
            result.append(word)

    return ' '.join(result)


def extract_chord_pattern(lines: list[str]) -> list[list[tuple[float, str]]]:
    """Extract chord positions as relative syllable positions from chorded lines."""
    patterns = []
    chord_re = r'\[([A-G][b#]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)*)\]'

    for line in lines:
        clean = re.sub(chord_re, '', line)
        words = clean.split()
        total_syllables = sum(_count_syllables(w) for w in words)

        chords = []
        for match in re.finditer(chord_re, line):
            # Count syllables before this chord
            text_before = re.sub(chord_re, '', line[:match.start()])
            words_before = text_before.split()
            syllables_before = sum(_count_syllables(w) for w in words_before)
            # Store as relative syllable position
            rel_pos = syllables_before / max(total_syllables, 1)
            chords.append((rel_pos, match.group(1)))

        patterns.append(chords)

    return patterns


def apply_chord_pattern(lines: list[str], patterns: list[list[tuple[float, str]]]) -> list[str]:
    """Apply a chord pattern to unchored lines using relative syllable positions."""
    result = []

    for line, pattern in zip(lines, patterns):
        # Skip if line already has chords
        if '[' in line:
            result.append(line)
            continue

        if not pattern:
            result.append(line)
            continue

        words = line.split()
        total_syllables = sum(_count_syllables(w) for w in words)

        # Map relative syllable positions to word indices
        chord_at_word = {}
        for rel_pos, chord in pattern:
            target_syllable = int(rel_pos * total_syllables)
            word_idx = _syllables_to_word_index(words, target_syllable)
            chord_at_word[word_idx] = chord

        # Build result with chords
        new_words = []
        for i, word in enumerate(words):
            if i in chord_at_word:
                new_words.append(f"[{chord_at_word[i]}]{word}")
            else:
                new_words.append(word)

        result.append(' '.join(new_words))

    return result


def has_chords(lines: list[str]) -> bool:
    """Check if any line has chords."""
    return any('[' in line for line in lines)


def extract_chord_sequence(tmuk_lines: list[str]) -> list[str]:
    """Extract all chords from TMUK lines in order."""
    chord_re = r'\[([A-G][b#]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)*)\]'
    chords = []
    for line in tmuk_lines:
        for match in re.finditer(chord_re, line):
            chords.append(match.group(1))
    return chords


def extract_line_patterns_with_syllables(tmuk_lines: list[str]) -> list[tuple[int, list[tuple[float, str]]]]:
    """Extract per-line chord patterns from TMUK with syllable counts.

    Returns list of (syllable_count, [(rel_pos, chord), ...]) tuples.
    """
    patterns = []
    chord_re = r'\[([A-G][b#]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)*)\]'

    for line in tmuk_lines:
        clean = re.sub(chord_re, '', line)
        words = clean.split()
        total_syllables = sum(_count_syllables(w) for w in words)

        if total_syllables == 0:
            continue

        chords = []
        for match in re.finditer(chord_re, line):
            text_before = re.sub(chord_re, '', line[:match.start()])
            words_before = text_before.split()
            syllables_before = sum(_count_syllables(w) for w in words_before)
            rel_pos = syllables_before / max(total_syllables, 1)
            chords.append((rel_pos, match.group(1)))

        if chords:  # Only keep lines that have chords
            patterns.append((total_syllables, chords))

    return patterns


def find_best_pattern(syllable_count: int, patterns: list[tuple[int, list[tuple[float, str]]]],
                      target_chord_count: int = None) -> list[tuple[float, str]]:
    """Find the pattern with the closest syllable count and chord count.

    If target_chord_count is specified, prefer patterns that also match the chord count.
    """
    if not patterns:
        return []

    if target_chord_count is not None:
        # Score by both syllable match and chord count match
        def score(p):
            syl_diff = abs(p[0] - syllable_count)
            chord_diff = abs(len(p[1]) - target_chord_count)
            return syl_diff + chord_diff * 2  # Weight chord count more

        best_pattern = min(patterns, key=score)
    else:
        # Just match syllable count
        best_pattern = min(patterns, key=lambda p: abs(p[0] - syllable_count))

    return best_pattern[1]


def calculate_chord_density(patterns: list[tuple[int, list[tuple[float, str]]]]) -> float:
    """Calculate average chords per syllable from patterns."""
    total_syllables = sum(p[0] for p in patterns)
    total_chords = sum(len(p[1]) for p in patterns)
    if total_syllables == 0:
        return 0.25  # Default: 1 chord per 4 syllables
    return total_chords / total_syllables


def apply_pattern_to_line(line: str, pattern: list[tuple[float, str]], target_chord_count: int = None,
                         chord_sequence: list[str] = None, chord_index: int = 0) -> tuple[str, int]:
    """Apply a single line's chord pattern to an unchored line.

    If target_chord_count is specified and the pattern has fewer chords,
    chords are distributed evenly using chord_sequence.

    Returns (line_with_chords, new_chord_index) to maintain chord sequence position.
    """
    if '[' in line:  # Already has chords
        return line, chord_index
    if not pattern:
        return line, chord_index

    words = line.split()
    if not words:
        return line, chord_index

    total_syllables = sum(_count_syllables(w) for w in words)
    if total_syllables == 0:
        return line, chord_index

    # Determine chord source
    if chord_sequence:
        available_chords = chord_sequence
    else:
        available_chords = [c for _, c in pattern]

    # If we need more chords than the pattern provides, distribute evenly
    pattern_chords = len(pattern)
    chord_at_word = {}

    if target_chord_count and target_chord_count > pattern_chords:
        # Distribute chords evenly based on target count
        for i in range(target_chord_count):
            # Position chord at regular intervals
            rel_pos = i / target_chord_count
            target_syllable = int(rel_pos * total_syllables)
            word_idx = _syllables_to_word_index(words, target_syllable)
            # Use chord from sequence, cycling
            chord_at_word[word_idx] = available_chords[chord_index % len(available_chords)]
            chord_index += 1
    else:
        # Use pattern positions directly
        for rel_pos, chord in pattern:
            target_syllable = int(rel_pos * total_syllables)
            word_idx = _syllables_to_word_index(words, target_syllable)
            chord_at_word[word_idx] = chord

    # Build result
    new_words = []
    for i, word in enumerate(words):
        if i in chord_at_word:
            new_words.append(f"[{chord_at_word[i]}]{word}")
        else:
            new_words.append(word)

    return ' '.join(new_words), chord_index


def generate_structured_chordpro(bl_data: dict, tmuk_chord_lines: list[str]) -> list[str]:
    """
    Generate ChordPro with proper verse/chorus structure from BluegrassLyrics,
    with chords merged from TMUK using word-level alignment.

    Uses three-pass approach:
    1. Word-level matching from TMUK chord map
    2. Section-level pattern fill (same line count)
    3. Cyclic pattern fill for remaining unchored lines
    """
    lines = []

    # Build chord map from all TMUK lines
    chord_map = extract_chord_map(tmuk_chord_lines)

    # Extract line patterns from TMUK with syllable counts for matching
    tmuk_patterns = extract_line_patterns_with_syllables(tmuk_chord_lines)

    # First pass: apply word-level chords to all sections
    sections = bl_data.get("sections", [])
    chorded_sections = []

    for section in sections:
        section_type = section.get("type", "verse")
        section_lines = section.get("lines", [])

        chorded_lines = [apply_chords_to_line(line, chord_map) for line in section_lines]
        chorded_sections.append({
            "type": section_type,
            "lines": chorded_lines,
        })

    # Second pass: pattern fill - find first chorded section of each type
    verse_pattern = None
    chorus_pattern = None

    for section in chorded_sections:
        if section["type"] == "verse" and verse_pattern is None and has_chords(section["lines"]):
            verse_pattern = extract_chord_pattern(section["lines"])
        elif section["type"] == "chorus" and chorus_pattern is None and has_chords(section["lines"]):
            chorus_pattern = extract_chord_pattern(section["lines"])

    # Apply patterns to fill gaps - apply to any section with matching line count
    for section in chorded_sections:
        if section["type"] == "verse" and verse_pattern:
            if len(section["lines"]) == len(verse_pattern):
                section["lines"] = apply_chord_pattern(section["lines"], verse_pattern)
        elif section["type"] == "chorus" and chorus_pattern:
            if len(section["lines"]) == len(chorus_pattern):
                section["lines"] = apply_chord_pattern(section["lines"], chorus_pattern)

    # Third pass: syllable-matched pattern fill for any remaining unchored lines
    # Match patterns by syllable count AND target chord density for consistency
    if tmuk_patterns:
        chord_density = calculate_chord_density(tmuk_patterns)
        # Extract full chord sequence from TMUK for cycling
        chord_sequence = extract_chord_sequence(tmuk_chord_lines)
        chord_index = 0

        for section in chorded_sections:
            new_lines = []
            for line in section["lines"]:
                if '[' not in line and line.strip():
                    # Count syllables in this line
                    words = line.split()
                    line_syllables = sum(_count_syllables(w) for w in words)
                    # Calculate target chord count based on density
                    target_chords = max(1, round(line_syllables * chord_density))
                    # Find pattern with closest syllable AND chord count
                    pattern = find_best_pattern(line_syllables, tmuk_patterns, target_chords)
                    # Apply pattern, distributing chords if needed, cycling through full chord sequence
                    new_line, chord_index = apply_pattern_to_line(
                        line, pattern, target_chords, chord_sequence, chord_index
                    )
                    new_lines.append(new_line)
                else:
                    new_lines.append(line)
            section["lines"] = new_lines

    # Output with structure markers
    verse_num = 0
    for section in chorded_sections:
        if section["type"] == "chorus":
            lines.append("{start_of_chorus}")
            lines.extend(section["lines"])
            lines.append("{end_of_chorus}")
        else:
            verse_num += 1
            lines.append(f"{{start_of_verse: Verse {verse_num}}}")
            lines.extend(section["lines"])
            lines.append("{end_of_verse}")

        lines.append("")  # Blank line between sections

    return lines


def generate_from_tmuk():
    """Generate ChordPro for songs matched with traditionalmusic.co.uk."""
    print("Loading TMUK fetched chords...")

    tmuk_file = TMUK_DIR / "fetched_chords.json"
    if not tmuk_file.exists():
        print("  No TMUK chords found. Run fetch_chords.py first.")
        return []

    with open(tmuk_file) as f:
        tmuk_data = json.load(f)

    print(f"  Found {len(tmuk_data['songs'])} songs with chords")

    manifest = load_manifest()
    generated = []

    for song in tmuk_data["songs"]:
        slug = song["bl_slug"]

        # Load BluegrassLyrics parsed data
        bl_file = PARSED_DIR / f"{slug}.json"
        if not bl_file.exists():
            print(f"  [SKIP] {slug} - no BL parsed data")
            continue

        with open(bl_file) as f:
            bl_data = json.load(f)

        # Generate ChordPro with structure
        chordpro = []
        chordpro.append(f"{{meta: title {bl_data['title']}}}")
        chordpro.append("{meta: artist Carter Family}")  # These are all Carter Family songs
        chordpro.append(f"{{meta: x_lyrics_source bluegrass-lyrics}}")
        chordpro.append(f"{{meta: x_lyrics_url {bl_data['source_url']}}}")
        chordpro.append(f"{{meta: x_chords_source traditional-music-uk}}")
        chordpro.append(f"{{meta: x_chords_url {song['tmuk_url']}}}")
        chordpro.append(f"{{meta: x_generated {datetime.now().strftime('%Y-%m-%d')}}}")
        chordpro.append("")

        # Add structured lyrics from BL with TMUK chords as reference
        structured_lines = generate_structured_chordpro(bl_data, song["chord_lines"])
        chordpro.extend(structured_lines)

        # Write file
        output_file = CHORDPRO_DIR / f"{slug}.pro"
        output_file.write_text("\n".join(chordpro))

        # Update manifest
        manifest["songs"][slug] = {
            "status": "ready",
            "source": "tmuk",
            "generated": datetime.now().isoformat(),
            "title": bl_data["title"],
        }

        generated.append(slug)

    save_manifest(manifest)
    print(f"Generated {len(generated)} ChordPro files")
    return generated


def main():
    print("=" * 60)
    print("BluegrassLyrics ChordPro Generator")
    print("=" * 60)

    CHORDPRO_DIR.mkdir(parents=True, exist_ok=True)

    # Generate from TMUK matches
    tmuk_generated = generate_from_tmuk()

    print()
    print(f"Total generated: {len(tmuk_generated)}")
    print(f"Output: {CHORDPRO_DIR}/")
    print()
    print("Review with: cat sources/bluegrass-lyrics/chordpro/<slug>.pro")
    print("Status in: sources/bluegrass-lyrics/manifest.json")


if __name__ == "__main__":
    main()
