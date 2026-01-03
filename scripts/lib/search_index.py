#!/usr/bin/env python3
"""
Command-line search utility for the Bluegrass Songbook index.

Usage:
    uv run python scripts/lib/search_index.py "artist:bill monroe prog:I-IV-V"
    uv run python scripts/lib/search_index.py "tag:bluegrass tag:jamfriendly -tag:classiccountry"
    uv run python scripts/lib/search_index.py "artist:ralph stanley key:G"

Supports the same query syntax as the web app:
    artist:NAME or a:NAME     - Filter by artist
    title:TEXT                - Filter by title
    lyrics:TEXT or l:TEXT     - Filter by lyrics
    composer:NAME             - Filter by composer/writer
    key:KEY or k:KEY          - Filter by key (e.g., G, Am, D)
    chord:CHORD or c:CHORD    - Filter by Nashville chord (e.g., VII, ii)
    prog:PROG or p:PROG       - Filter by progression (e.g., I-IV-V)
    tag:TAG or t:TAG          - Filter by tag (e.g., bluegrass, jamfriendly)
    -prefix:VALUE             - Exclude (e.g., -tag:classiccountry)
    plain text                - Search all fields
"""

import json
import re
import sys
from pathlib import Path


def load_index(index_path: Path) -> list[dict]:
    """Load songs from index.jsonl."""
    songs = []
    with open(index_path) as f:
        for line in f:
            line = line.strip()
            if line:
                songs.append(json.loads(line))
    return songs


def load_prefix_map() -> dict:
    """Load prefix map from shared config (ground truth for search syntax)."""
    # Try to load from shared config
    config_paths = [
        Path(__file__).parent.parent.parent / 'docs' / 'data' / 'search-syntax.json',
        Path('docs/data/search-syntax.json'),
    ]

    for config_path in config_paths:
        if config_path.exists():
            with open(config_path) as f:
                config = json.load(f)
                return config.get('prefixes', {})

    # Fallback if config not found
    return {
        'artist:': 'artist', 'a:': 'artist',
        'title:': 'title',
        'lyrics:': 'lyrics', 'l:': 'lyrics',
        'composer:': 'composer', 'writer:': 'composer',
        'key:': 'key', 'k:': 'key',
        'chord:': 'chord', 'c:': 'chord',
        'prog:': 'prog', 'p:': 'prog',
        'tag:': 'tag', 't:': 'tag',
    }


def parse_query(query: str) -> dict:
    """Parse search query into structured filters."""
    result = {
        'text_terms': [],
        'chord_filters': [],
        'progression_filter': None,
        'tag_filters': [],
        'artist_filter': None,
        'title_filter': None,
        'lyrics_filter': None,
        'composer_filter': None,
        'key_filter': None,
        'exclude_artist': None,
        'exclude_title': None,
        'exclude_lyrics': None,
        'exclude_composer': None,
        'exclude_key': None,
        'exclude_tags': [],
        'exclude_chords': [],
    }

    # Load prefixes from shared config
    prefix_map = load_prefix_map()

    # Build regex pattern
    prefixes = sorted(prefix_map.keys(), key=len, reverse=True)
    pattern = '(-?)(' + '|'.join(re.escape(p) for p in prefixes) + ')'

    # Find all prefix positions
    matches = []
    for m in re.finditer(pattern, query, re.IGNORECASE):
        matches.append({
            'prefix': m.group(2).lower(),
            'is_negative': m.group(1) == '-',
            'index': m.start(),
            'end': m.end(),
        })

    # Extract values for each prefix
    for i, match in enumerate(matches):
        prefix = match['prefix']
        is_negative = match['is_negative']
        start = match['end']
        end = matches[i + 1]['index'] if i + 1 < len(matches) else len(query)
        value = query[start:end].strip()

        if not value:
            continue

        field_type = prefix_map.get(prefix)

        if is_negative:
            if field_type == 'artist':
                result['exclude_artist'] = value.lower()
            elif field_type == 'title':
                result['exclude_title'] = value.lower()
            elif field_type == 'lyrics':
                result['exclude_lyrics'] = value.lower()
            elif field_type == 'composer':
                result['exclude_composer'] = value.lower()
            elif field_type == 'key':
                result['exclude_key'] = value.upper()
            elif field_type == 'chord':
                result['exclude_chords'].extend(c.strip() for c in value.split(',') if c.strip())
            elif field_type == 'tag':
                result['exclude_tags'].extend(t.strip() for t in value.split(',') if t.strip())
        else:
            if field_type == 'artist':
                result['artist_filter'] = value.lower()
            elif field_type == 'title':
                result['title_filter'] = value.lower()
            elif field_type == 'lyrics':
                result['lyrics_filter'] = value.lower()
            elif field_type == 'composer':
                result['composer_filter'] = value.lower()
            elif field_type == 'key':
                result['key_filter'] = value.upper()
            elif field_type == 'chord':
                result['chord_filters'].extend(c.strip() for c in value.split(',') if c.strip())
            elif field_type == 'prog':
                result['progression_filter'] = [c.strip() for c in value.split('-') if c.strip()]
            elif field_type == 'tag':
                result['tag_filters'].extend(t.strip() for t in value.split(',') if t.strip())

    # Extract general text (before first prefix)
    first_prefix_index = matches[0]['index'] if matches else len(query)
    general_text = query[:first_prefix_index].strip()
    if general_text:
        result['text_terms'] = general_text.lower().split()

    return result


def song_has_tags(song: dict, required_tags: list[str]) -> bool:
    """Check if song has all required tags (case-insensitive)."""
    if not required_tags:
        return True

    tags = song.get('tags', {})
    if isinstance(tags, dict):
        tag_names = [t.lower() for t in tags.keys()]
    elif isinstance(tags, list):
        tag_names = [t.lower() for t in tags]
    else:
        return False

    return all(t.lower() in tag_names for t in required_tags)


def song_has_chords(song: dict, required_chords: list[str]) -> bool:
    """Check if song contains all required Nashville chords."""
    if not required_chords:
        return True

    chords = song.get('nashville', [])
    if not chords:
        return False

    return all(c in chords for c in required_chords)


def song_has_progression(song: dict, progression: list[str]) -> bool:
    """Check if song contains the progression sequence."""
    if not progression:
        return True

    sequence = song.get('progression', [])
    if not sequence:
        return False

    # Look for exact progression anywhere in sequence
    prog_len = len(progression)
    for i in range(len(sequence) - prog_len + 1):
        if sequence[i:i + prog_len] == progression:
            return True

    return False


def search(songs: list[dict], query: str) -> list[dict]:
    """Search songs using query string."""
    parsed = parse_query(query)

    results = []
    for song in songs:
        # Text search (all fields)
        if parsed['text_terms']:
            search_text = ' '.join([
                song.get('title', ''),
                song.get('artist', ''),
                song.get('composer', ''),
                song.get('lyrics', ''),
                song.get('first_line', ''),
            ]).lower()
            if not all(term in search_text for term in parsed['text_terms']):
                continue

        # Field filters (inclusion)
        if parsed['artist_filter']:
            if parsed['artist_filter'] not in (song.get('artist') or '').lower():
                continue
        if parsed['title_filter']:
            if parsed['title_filter'] not in (song.get('title') or '').lower():
                continue
        if parsed['lyrics_filter']:
            if parsed['lyrics_filter'] not in (song.get('lyrics') or '').lower():
                continue
        if parsed['composer_filter']:
            if parsed['composer_filter'] not in (song.get('composer') or '').lower():
                continue
        if parsed['key_filter']:
            if (song.get('key') or '').upper() != parsed['key_filter']:
                continue

        # Field filters (exclusion)
        if parsed['exclude_artist']:
            if parsed['exclude_artist'] in (song.get('artist') or '').lower():
                continue
        if parsed['exclude_title']:
            if parsed['exclude_title'] in (song.get('title') or '').lower():
                continue
        if parsed['exclude_lyrics']:
            if parsed['exclude_lyrics'] in (song.get('lyrics') or '').lower():
                continue
        if parsed['exclude_composer']:
            if parsed['exclude_composer'] in (song.get('composer') or '').lower():
                continue
        if parsed['exclude_key']:
            if (song.get('key') or '').upper() == parsed['exclude_key']:
                continue

        # Chord filters
        if parsed['chord_filters']:
            if not song_has_chords(song, parsed['chord_filters']):
                continue
        if parsed['exclude_chords']:
            if song_has_chords(song, parsed['exclude_chords']):
                continue

        # Progression filter
        if parsed['progression_filter']:
            if not song_has_progression(song, parsed['progression_filter']):
                continue

        # Tag filters
        if parsed['tag_filters']:
            if not song_has_tags(song, parsed['tag_filters']):
                continue
        if parsed['exclude_tags']:
            if song_has_tags(song, parsed['exclude_tags']):
                continue

        results.append(song)

    return results


def format_song(song: dict, verbose: bool = False) -> str:
    """Format a song for display."""
    title = song.get('title', 'Unknown')
    artist = song.get('artist', 'Unknown')
    key = song.get('key', '?')

    # Get tags
    tags = song.get('tags', {})
    if isinstance(tags, dict):
        tag_list = list(tags.keys())[:3]
    elif isinstance(tags, list):
        tag_list = tags[:3]
    else:
        tag_list = []

    tag_str = ', '.join(tag_list) if tag_list else ''

    # Get Nashville chords
    nashville = song.get('nashville', [])
    chord_str = ', '.join(nashville) if nashville else ''

    if verbose:
        lines = [f"{title} - {artist} ({key})"]
        if tag_str:
            lines.append(f"  Tags: {tag_str}")
        if chord_str:
            lines.append(f"  Chords: {chord_str}")
        if song.get('first_line'):
            lines.append(f"  \"{song['first_line']}\"")
        return '\n'.join(lines)
    else:
        tag_part = f" [{tag_str}]" if tag_str else ""
        return f"{title} - {artist} ({key}){tag_part}"


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description='Search the Bluegrass Songbook index',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('query', nargs='?', default='', help='Search query')
    parser.add_argument('-n', '--limit', type=int, default=20, help='Max results (default: 20)')
    parser.add_argument('-v', '--verbose', action='store_true', help='Show more details')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    parser.add_argument('--count', action='store_true', help='Only show count')
    parser.add_argument('--index', type=Path, default=Path('docs/data/index.jsonl'),
                        help='Path to index.jsonl')

    args = parser.parse_args()

    # Find index file
    index_path = args.index
    if not index_path.exists():
        # Try relative to script
        script_dir = Path(__file__).parent.parent.parent
        index_path = script_dir / 'docs' / 'data' / 'index.jsonl'

    if not index_path.exists():
        print(f"Error: Index file not found at {index_path}", file=sys.stderr)
        sys.exit(1)

    songs = load_index(index_path)

    if not args.query:
        print(f"Loaded {len(songs):,} songs from index")
        print("\nExample queries:")
        print("  artist:bill monroe prog:I-IV-V")
        print("  tag:bluegrass tag:jamfriendly -tag:classiccountry")
        print("  artist:ralph stanley key:G")
        print("  artist:flatt and scruggs")
        print("  chord:VII tag:modal")
        return

    results = search(songs, args.query)

    if args.count:
        print(len(results))
        return

    if args.json:
        output = [
            {
                'id': s.get('id'),
                'title': s.get('title'),
                'artist': s.get('artist'),
                'key': s.get('key'),
                'tags': list(s.get('tags', {}).keys()) if isinstance(s.get('tags'), dict) else s.get('tags', []),
                'nashville': s.get('nashville', []),
            }
            for s in results[:args.limit]
        ]
        print(json.dumps(output, indent=2))
        return

    print(f"Found {len(results):,} songs\n")

    for song in results[:args.limit]:
        print(format_song(song, args.verbose))
        if args.verbose:
            print()


if __name__ == '__main__':
    main()
