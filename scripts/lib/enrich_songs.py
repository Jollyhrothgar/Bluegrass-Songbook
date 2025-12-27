#!/usr/bin/env python3
"""
Enrich parsed .pro files with provenance metadata and normalized chord patterns.

This is Stage 2 of the song processing pipeline:
  Stage 1: Parse (HTML → raw ChordPro)
  Stage 2: Enrich (add provenance, normalize chords) ← THIS
  Stage 3: Build Index (all .pro → index.json)

Enrichment includes:
- Adding x_source provenance metadata
- Normalizing chord patterns within sections (ensuring consistent chord counts)

Files in protected.txt are skipped (human corrections are authoritative).
"""

import argparse
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass
class Section:
    """A song section (verse, chorus, bridge, etc.)."""
    section_type: str  # 'verse', 'chorus', 'bridge', etc.
    label: str  # 'Verse 1', 'Chorus', etc.
    lines: list[str]
    start_line_num: int  # Line number in the file


@dataclass
class ParsedSong:
    """A parsed ChordPro song file."""
    metadata_lines: list[str]  # Lines before first section
    sections: list[Section]
    trailing_lines: list[str]  # Lines after last section


def extract_chords_from_line(line: str) -> list[tuple[int, str]]:
    """Extract chords and their positions from a line.

    Returns list of (position, chord) tuples.
    Position is the character index in the lyrics (without chord markers).
    """
    chords = []
    clean_pos = 0

    for match in re.finditer(r'\[([^\]]+)\]', line):
        # Position in clean line (without chord markers processed so far)
        chord_start = match.start()
        # Count how many chord markers came before this one
        preceding_text = line[:chord_start]
        preceding_chords_len = sum(len(m.group(0)) for m in re.finditer(r'\[([^\]]+)\]', preceding_text))
        clean_pos = chord_start - preceding_chords_len
        chords.append((clean_pos, match.group(1)))

    return chords


def get_section_chord_sequence(section: Section) -> list[str]:
    """Get the ordered list of all chords in a section."""
    chords = []
    for line in section.lines:
        for _, chord in extract_chords_from_line(line):
            chords.append(chord)
    return chords


def section_starts_with_chord(section: Section) -> bool:
    """Check if the section's first line starts with a chord at position 0."""
    if not section.lines:
        return False
    first_line = section.lines[0]
    return first_line.startswith('[')


def get_first_chord(section: Section) -> str | None:
    """Get the first chord in a section."""
    for line in section.lines:
        chords = extract_chords_from_line(line)
        if chords:
            return chords[0][1]
    return None


def is_pickup_phrase(line: str, threshold: int = 15) -> bool:
    """Check if a line is a pickup phrase.

    A pickup phrase has a chord within the first `threshold` characters
    but not at position 0. Example: "Let us [F]sit down" - the "Let us"
    is a pickup before the chord change.

    We don't want to add a chord at position 0 for these lines because
    the pickup is intentional.
    """
    if not line or line.startswith('['):
        return False

    # Find first chord position
    match = re.search(r'\[([^\]]+)\]', line)
    if not match:
        return False

    # If chord appears within threshold, it's likely a pickup
    return match.start() < threshold


def add_first_chord_to_section(section: Section, chord: str) -> Section:
    """Add a chord at position 0 of the first line if it doesn't have one.

    Skips if:
    - Section already starts with a chord
    - First line is a pickup phrase (chord within first 15 chars)
    """
    if not section.lines or section_starts_with_chord(section):
        return section

    first_line = section.lines[0]

    # Don't add chord to pickup phrases
    if is_pickup_phrase(first_line):
        return section

    new_lines = section.lines.copy()
    new_lines[0] = f'[{chord}]' + new_lines[0]

    return Section(
        section_type=section.section_type,
        label=section.label,
        lines=new_lines,
        start_line_num=section.start_line_num
    )


def parse_section_header(line: str) -> tuple[str, str] | None:
    """Parse a section header like {start_of_verse: Verse 1}.

    Returns (section_type, label) or None.
    """
    # Match {start_of_TYPE} or {start_of_TYPE: LABEL}
    match = re.match(r'\{start_of_(\w+)(?::\s*([^}]+))?\}', line)
    if match:
        section_type = match.group(1).lower()
        label = match.group(2).strip() if match.group(2) else section_type.title()
        return section_type, label
    return None


def is_section_end(line: str) -> bool:
    """Check if line is a section end marker."""
    return bool(re.match(r'\{end_of_\w+\}', line))


def parse_song(content: str) -> ParsedSong:
    """Parse a ChordPro file into structured sections."""
    lines = content.split('\n')

    metadata_lines = []
    sections = []
    trailing_lines = []

    current_section = None
    section_lines = []
    in_section = False

    for i, line in enumerate(lines):
        # Check for section start
        header = parse_section_header(line)
        if header:
            section_type, label = header
            in_section = True
            current_section = (section_type, label, i)
            section_lines = []
            continue

        # Check for section end
        if is_section_end(line):
            if current_section:
                sections.append(Section(
                    section_type=current_section[0],
                    label=current_section[1],
                    lines=section_lines,
                    start_line_num=current_section[2]
                ))
            in_section = False
            current_section = None
            section_lines = []
            continue

        # Add line to appropriate container
        if in_section:
            section_lines.append(line)
        elif not sections:
            metadata_lines.append(line)
        else:
            trailing_lines.append(line)

    return ParsedSong(
        metadata_lines=metadata_lines,
        sections=sections,
        trailing_lines=trailing_lines
    )


def normalize_section_type(section_type: str) -> str:
    """Normalize section type for grouping."""
    # Group similar types together
    if section_type in ('verse', 'v'):
        return 'verse'
    if section_type in ('chorus', 'c', 'refrain'):
        return 'chorus'
    if section_type in ('bridge', 'b'):
        return 'bridge'
    return section_type


def normalize_chord_patterns(song: ParsedSong) -> ParsedSong:
    """Normalize chord patterns within sections of the same type.

    For each section type (verse, chorus, etc.):
    1. Find the section with the most chords (canonical)
    2. For sections missing the first chord, add it from the canonical

    This ensures consistent chord counts for the "show first chords" feature.
    """
    # Group sections by normalized type
    sections_by_type: dict[str, list[tuple[int, Section]]] = {}
    for i, section in enumerate(song.sections):
        norm_type = normalize_section_type(section.section_type)
        if norm_type not in sections_by_type:
            sections_by_type[norm_type] = []
        sections_by_type[norm_type].append((i, section))

    # Process each type group
    new_sections = list(song.sections)

    for norm_type, indexed_sections in sections_by_type.items():
        if len(indexed_sections) < 2:
            continue

        # Find canonical section (most chords, and starts with chord)
        canonical = None
        canonical_chord_count = 0

        for _, section in indexed_sections:
            chords = get_section_chord_sequence(section)
            if len(chords) > canonical_chord_count and section_starts_with_chord(section):
                canonical = section
                canonical_chord_count = len(chords)

        if not canonical:
            # No section starts with a chord, skip normalization
            continue

        canonical_first_chord = get_first_chord(canonical)
        if not canonical_first_chord:
            continue

        # Normalize other sections
        for idx, section in indexed_sections:
            if section is canonical:
                continue

            if not section_starts_with_chord(section):
                # Add the canonical's first chord
                new_sections[idx] = add_first_chord_to_section(section, canonical_first_chord)

    return ParsedSong(
        metadata_lines=song.metadata_lines,
        sections=new_sections,
        trailing_lines=song.trailing_lines
    )


def has_provenance_metadata(content: str) -> bool:
    """Check if the file already has provenance metadata."""
    return '{meta: x_source' in content or '{x_source:' in content


def add_provenance_metadata(song: ParsedSong, source_name: str, source_file: str) -> ParsedSong:
    """Add provenance metadata to the song."""
    new_metadata = song.metadata_lines.copy()

    # Find insertion point (after existing meta lines, before empty line)
    insert_idx = 0
    for i, line in enumerate(new_metadata):
        if line.startswith('{meta:') or line.startswith('{title:') or line.startswith('{artist:'):
            insert_idx = i + 1

    # Add provenance metadata
    today = date.today().isoformat()
    provenance_lines = [
        f'{{meta: x_source {source_name}}}',
        f'{{meta: x_source_file {source_file}}}',
        f'{{meta: x_enriched {today}}}',
    ]

    for j, prov_line in enumerate(provenance_lines):
        new_metadata.insert(insert_idx + j, prov_line)

    return ParsedSong(
        metadata_lines=new_metadata,
        sections=song.sections,
        trailing_lines=song.trailing_lines
    )


def song_to_chordpro(song: ParsedSong) -> str:
    """Convert a ParsedSong back to ChordPro format."""
    lines = []

    # Metadata
    lines.extend(song.metadata_lines)

    # Sections
    for i, section in enumerate(song.sections):
        # Section header
        if section.label:
            lines.append(f'{{start_of_{section.section_type}: {section.label}}}')
        else:
            lines.append(f'{{start_of_{section.section_type}}}')

        # Section content
        lines.extend(section.lines)

        # Section footer
        lines.append(f'{{end_of_{section.section_type}}}')

        # Add blank line between sections (but not after the last one)
        if i < len(song.sections) - 1:
            lines.append('')

    # Trailing content
    lines.extend(song.trailing_lines)

    return '\n'.join(lines)


def load_protected_list(protected_file: Path) -> set[str]:
    """Load the list of protected song IDs."""
    protected = set()
    if not protected_file.exists():
        return protected

    with open(protected_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                protected.add(line)

    return protected


def enrich_song(filepath: Path, source_name: str, add_provenance: bool = True) -> tuple[str, bool]:
    """Enrich a single .pro file.

    Currently only adds provenance metadata. Chord normalization was removed
    because it incorrectly modified pickup phrases and songs with multiple
    verse patterns (see issue #25 discussion).

    Returns (new_content, was_modified).
    """
    content = filepath.read_text(encoding='utf-8')

    # Only add provenance if requested and not already present
    if add_provenance and not has_provenance_metadata(content):
        song = parse_song(content)
        song = add_provenance_metadata(song, source_name, filepath.name)
        new_content = song_to_chordpro(song)
        return new_content, True

    return content, False


def enrich_source(source_dir: Path, source_name: str, dry_run: bool = False) -> dict:
    """Enrich all songs from a source directory.

    Returns statistics about what was processed.
    """
    parsed_dir = source_dir / 'parsed'
    protected_file = source_dir / 'protected.txt'

    if not parsed_dir.exists():
        print(f"Parsed directory not found: {parsed_dir}")
        return {'total': 0, 'modified': 0, 'skipped': 0, 'protected': 0}

    protected = load_protected_list(protected_file)

    stats = {'total': 0, 'modified': 0, 'skipped': 0, 'protected': 0}

    pro_files = sorted(parsed_dir.glob('*.pro'))
    print(f"Processing {len(pro_files)} files from {source_name}...")

    for i, filepath in enumerate(pro_files):
        if i % 1000 == 0 and i > 0:
            print(f"  {i}/{len(pro_files)}...")

        stats['total'] += 1
        song_id = filepath.stem

        # Skip protected files
        if song_id in protected:
            stats['protected'] += 1
            continue

        try:
            new_content, was_modified = enrich_song(filepath, source_name)

            if was_modified:
                if not dry_run:
                    filepath.write_text(new_content, encoding='utf-8')
                stats['modified'] += 1
            else:
                stats['skipped'] += 1

        except Exception as e:
            print(f"  Error processing {filepath.name}: {e}")
            stats['skipped'] += 1

    return stats


def main():
    parser = argparse.ArgumentParser(
        description='Enrich parsed .pro files with provenance and normalized chords'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be changed without modifying files'
    )
    parser.add_argument(
        '--source',
        type=str,
        help='Process only this source (e.g., "classic-country")'
    )
    parser.add_argument(
        '--file',
        type=Path,
        help='Process a single file (for testing)'
    )

    args = parser.parse_args()

    if args.file:
        # Single file mode
        if not args.file.exists():
            print(f"File not found: {args.file}")
            return

        new_content, was_modified = enrich_song(args.file, 'manual')
        if was_modified:
            if args.dry_run:
                print("Would modify file. New content:")
                print(new_content)
            else:
                args.file.write_text(new_content, encoding='utf-8')
                print(f"Modified: {args.file}")
        else:
            print(f"No changes needed: {args.file}")
        return

    # Define all sources
    sources_dir = Path('sources')
    sources = [
        ('classic-country', sources_dir / 'classic-country'),
        ('manual', sources_dir / 'manual'),
    ]

    # Filter to requested source if specified
    if args.source:
        sources = [(name, path) for name, path in sources if name == args.source]
        if not sources:
            print(f"Unknown source: {args.source}")
            return

    # Process each source
    total_stats = {'total': 0, 'modified': 0, 'skipped': 0, 'protected': 0}

    for source_name, source_path in sources:
        if not source_path.exists():
            print(f"Source not found: {source_path}")
            continue

        print(f"\n=== {source_name} ===")
        stats = enrich_source(source_path, source_name, dry_run=args.dry_run)

        for key in total_stats:
            total_stats[key] += stats[key]

        print(f"  Total: {stats['total']}")
        print(f"  Modified: {stats['modified']}")
        print(f"  Skipped (no changes): {stats['skipped']}")
        print(f"  Protected (user-corrected): {stats['protected']}")

    print(f"\n=== Summary ===")
    print(f"Total files: {total_stats['total']}")
    print(f"Modified: {total_stats['modified']}")
    print(f"Skipped: {total_stats['skipped']}")
    print(f"Protected: {total_stats['protected']}")

    if args.dry_run:
        print("\n(Dry run - no files were actually modified)")


if __name__ == '__main__':
    main()
