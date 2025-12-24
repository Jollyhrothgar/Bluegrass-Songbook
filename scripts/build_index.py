#!/usr/bin/env python3
"""
Build search index from parsed .pro files

Generates docs/data/index.json with song metadata and lyrics for search.
"""

import json
import re
from pathlib import Path
from typing import Optional


def parse_chordpro_metadata(content: str) -> dict:
    """Extract metadata from ChordPro content."""
    metadata = {
        'title': None,
        'artist': None,
        'composer': None,
    }

    # Match {meta: key value} directives (our format)
    for match in re.finditer(r'\{meta:\s*(\w+)\s+([^}]+)\}', content):
        key = match.group(1).lower()
        value = match.group(2).strip()
        if key in metadata:
            metadata[key] = value

    # Also match standard {key: value} directives
    for match in re.finditer(r'\{(title|artist|composer):\s*([^}]+)\}', content):
        key = match.group(1).lower()
        value = match.group(2).strip()
        if key in metadata and metadata[key] is None:
            metadata[key] = value

    return metadata


def extract_lyrics(content: str) -> str:
    """Extract plain lyrics (without chords) from ChordPro content."""
    lines = []
    in_verse = False

    for line in content.split('\n'):
        line = line.strip()

        # Skip directives
        if line.startswith('{') and line.endswith('}'):
            if line == '{sov}':
                in_verse = True
            elif line == '{eov}':
                in_verse = False
            continue

        # Skip empty lines
        if not line:
            continue

        # Remove chord markers [G], [Am7], etc.
        clean_line = re.sub(r'\[[^\]]+\]', '', line)
        clean_line = clean_line.strip()

        if clean_line:
            lines.append(clean_line)

    return '\n'.join(lines)


def get_first_line(lyrics: str) -> str:
    """Get first non-empty line of lyrics."""
    for line in lyrics.split('\n'):
        line = line.strip()
        if line and len(line) > 10:
            return line[:100]
    return ''


def build_index(parsed_dir: Path, output_file: Path):
    """Build search index from all .pro files."""
    songs = []

    pro_files = sorted(parsed_dir.glob('*.pro'))
    print(f"Processing {len(pro_files)} files...")

    for i, pro_file in enumerate(pro_files):
        if i % 1000 == 0:
            print(f"  {i}/{len(pro_files)}...")

        try:
            content = pro_file.read_text(encoding='utf-8')
        except Exception as e:
            print(f"  Error reading {pro_file.name}: {e}")
            continue

        metadata = parse_chordpro_metadata(content)
        lyrics = extract_lyrics(content)
        first_line = get_first_line(lyrics)

        # Skip songs without title
        if not metadata['title']:
            continue

        songs.append({
            'id': pro_file.stem,
            'title': metadata['title'],
            'artist': metadata['artist'],
            'composer': metadata['composer'],
            'first_line': first_line,
            'lyrics': lyrics[:500],  # First 500 chars for search
            'content': content,  # Full ChordPro content for display
        })

    print(f"Indexed {len(songs)} songs")

    # Write index
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump({'songs': songs}, f, ensure_ascii=False)

    print(f"Written to {output_file}")
    print(f"Size: {output_file.stat().st_size / 1024 / 1024:.1f} MB")


def main():
    parsed_dir = Path('songs/classic-country/parsed')
    output_file = Path('docs/data/index.json')

    build_index(parsed_dir, output_file)


if __name__ == '__main__':
    main()
