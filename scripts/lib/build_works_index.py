#!/usr/bin/env python3
"""
Build search index from works/ directory.

This replaces build_index.py as the primary index builder.
Reads work.yaml + lead-sheet.pro from each work directory and outputs index.jsonl.

Usage:
    uv run python scripts/lib/build_works_index.py
    uv run python scripts/lib/build_works_index.py --no-tags
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

import yaml

# Canonical ranks cache (loaded once)
_canonical_ranks = None

def load_canonical_ranks():
    """Load canonical ranking from cache file."""
    global _canonical_ranks
    if _canonical_ranks is None:
        cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'canonical_ranks.json'
        if cache_file.exists():
            with open(cache_file) as f:
                _canonical_ranks = json.load(f)
            print(f"Loaded {len(_canonical_ranks)} canonical ranks")
        else:
            print(f"Warning: canonical_ranks.json not found at {cache_file}")
            _canonical_ranks = {}
    return _canonical_ranks

def get_canonical_rank(title: str) -> int:
    """Get canonical rank for a song title. Higher = more popular."""
    ranks = load_canonical_ranks()
    normalized = title.lower().strip()
    return ranks.get(normalized, 0)

# Import key detection and Nashville conversion from existing build_index
from build_index import (
    detect_key,
    to_nashville,
    KEYS,
)


def parse_chordpro_content(content: str) -> dict:
    """Extract lyrics, chords, and ABC content from ChordPro content."""
    lines = content.split('\n')
    lyrics_lines = []
    chords = []
    abc_lines = []
    in_abc = False
    is_tune = False

    for line in lines:
        # Check for ABC notation start
        if line.strip().startswith('{start_of_abc'):
            in_abc = True
            continue
        if line.strip().startswith('{end_of_abc'):
            in_abc = False
            continue
        if in_abc:
            abc_lines.append(line)
            continue

        # Skip directives
        if line.strip().startswith('{'):
            continue

        # Extract chords
        for match in re.finditer(r'\[([^\]]+)\]', line):
            chord = match.group(1)
            # Skip non-chords (timing, etc.)
            if re.match(r'^[A-G]', chord):
                chords.append(chord)

        # Extract lyrics (remove chord markers)
        clean_line = re.sub(r'\[[^\]]+\]', '', line).strip()
        if clean_line:
            lyrics_lines.append(clean_line)

    lyrics = '\n'.join(lyrics_lines)
    abc_content = '\n'.join(abc_lines) if abc_lines else None

    # Detect if it's an instrumental (has ABC but minimal lyrics)
    if abc_content and len(lyrics) < 100:
        is_tune = True

    return {
        'lyrics': lyrics,
        'chords': chords,
        'abc_content': abc_content,
        'is_tune': is_tune,
    }


def extract_first_line(lyrics: str) -> str:
    """Get first non-empty line of lyrics."""
    for line in lyrics.split('\n'):
        line = line.strip()
        if line:
            return line[:100]
    return ''


def compute_group_id(title: str, artist: str, lyrics: str) -> str:
    """Compute group ID for version grouping."""
    import unicodedata

    def normalize(text: str) -> str:
        if not text:
            return ''
        # Normalize unicode
        text = unicodedata.normalize('NFKD', text)
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower()
        # Remove common suffixes
        text = re.sub(r'\s*\([^)]*\)\s*$', '', text)  # (Live), etc.
        text = re.sub(r'[^a-z0-9]', '', text)
        return text

    base = normalize(title) + '_' + normalize(artist or '')
    base_hash = hashlib.md5(base.encode()).hexdigest()[:12]

    # Lyrics hash to distinguish different songs with same title
    lyrics_norm = normalize(lyrics[:200] if lyrics else '')
    lyrics_hash = hashlib.md5(lyrics_norm.encode()).hexdigest()[:8]

    return f"{base_hash}_{lyrics_hash}"


def build_song_from_work(work_dir: Path) -> dict:
    """Build a song record from a work directory."""
    work_yaml_path = work_dir / 'work.yaml'
    lead_sheet_path = work_dir / 'lead-sheet.pro'

    if not work_yaml_path.exists():
        return None

    # Load work.yaml
    with open(work_yaml_path) as f:
        work = yaml.safe_load(f)

    # Check what parts we have
    has_lead_sheet = lead_sheet_path.exists()
    tablature_parts = []
    if work.get('parts'):
        for part in work['parts']:
            if part.get('type') == 'tablature':
                tablature_parts.append(part)

    # Must have at least a lead sheet or tablature
    if not has_lead_sheet and not tablature_parts:
        return None

    # Initialize defaults
    content = ''
    lyrics = ''
    chords = []
    key = work.get('default_key', 'G')
    mode = 'major'
    source = 'unknown'
    parsed = {'is_tune': False, 'abc_content': None}

    # Load lead sheet if present
    if has_lead_sheet:
        content = lead_sheet_path.read_text(encoding='utf-8')
        parsed = parse_chordpro_content(content)
        lyrics = parsed['lyrics']
        chords = parsed['chords']
        detected_key, mode = detect_key(chords)
        if detected_key:
            key = detected_key

    # Get provenance from parts
    if work.get('parts'):
        for part in work['parts']:
            if part.get('type') == 'lead-sheet':
                prov = part.get('provenance', {})
                source = prov.get('source', 'unknown')
                break
            elif part.get('type') == 'tablature' and source == 'unknown':
                prov = part.get('provenance', {})
                source = prov.get('source', 'unknown')

    # Convert to Nashville
    nashville_set = set()
    progression = []
    for chord in chords:
        nash = to_nashville(chord, key)
        if nash:
            nashville_set.add(nash)
            progression.append(nash)

    # Build song record
    song = {
        'id': work['id'],
        'title': work.get('title', 'Untitled'),
        'source': source,
        'first_line': extract_first_line(lyrics) if lyrics else '',
        'lyrics': lyrics[:500] if lyrics else '',
        'content': content,
        'key': key,
        'mode': mode,
        'nashville': sorted(list(nashville_set)),
        'progression': progression[:100],
    }

    # Optional fields
    if work.get('artist'):
        song['artist'] = work['artist']
    if work.get('composers') and work['composers']:
        song['composer'] = ', '.join(work['composers'])
    if work.get('tags'):
        song['tags'] = {tag: {'score': 50, 'source': 'work'} for tag in work['tags']}
    if work.get('external', {}).get('strum_machine'):
        song['strum_machine_url'] = work['external']['strum_machine']

    # Compute group_id
    song['group_id'] = compute_group_id(
        work.get('title', ''),
        work.get('artist', ''),
        lyrics
    )

    # Add chord count
    song['chord_count'] = len(nashville_set)

    # Add canonical rank (based on MusicBrainz recording counts)
    song['canonical_rank'] = get_canonical_rank(work.get('title', ''))

    # Handle instrumentals
    if parsed['is_tune'] or (tablature_parts and not lyrics):
        song['is_instrumental'] = True
    if parsed['abc_content']:
        song['abc_content'] = parsed['abc_content']

    # Add tablature parts info for frontend
    if tablature_parts:
        song['tablature_parts'] = []
        for part in tablature_parts:
            tab_info = {
                'instrument': part.get('instrument'),
                'label': part.get('label', part.get('instrument', 'Tab')),
                'file': f"data/tabs/{work['id']}-{part.get('instrument')}.otf.json"
            }
            song['tablature_parts'].append(tab_info)

    return song


def build_works_index(works_dir: Path, output_file: Path, enrich_tags: bool = True):
    """Build index from all works."""
    print(f"Scanning {works_dir}...")

    songs = []
    errors = []

    work_dirs = sorted(works_dir.iterdir())
    total = len(work_dirs)

    for i, work_dir in enumerate(work_dirs):
        if not work_dir.is_dir():
            continue

        if i % 2000 == 0 and i > 0:
            print(f"  Progress: {i}/{total}")

        try:
            song = build_song_from_work(work_dir)
            if song:
                songs.append(song)
        except Exception as e:
            errors.append((work_dir.name, str(e)))

    print(f"Processed {len(songs)} works ({len(errors)} errors)")

    if errors and len(errors) <= 10:
        print("Errors:")
        for work_id, error in errors:
            print(f"  {work_id}: {error}")

    # Tag enrichment
    if enrich_tags:
        try:
            from tag_enrichment import enrich_songs_with_tags
            songs = enrich_songs_with_tags(songs, use_musicbrainz=True)

            # Count tag stats
            tag_counts = {}
            songs_with_tags = 0
            for song in songs:
                if song.get('tags'):
                    songs_with_tags += 1
                    for tag in song['tags']:
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1

            print(f"Tagged {songs_with_tags}/{len(songs)} songs")
            if tag_counts:
                print("  Top tags:")
                for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])[:10]:
                    print(f"    {tag}: {count}")
        except ImportError as e:
            print(f"Tag enrichment not available: {e}")
        except Exception as e:
            print(f"Tag enrichment failed: {e}")

    # Strum Machine enrichment (from cache file directly, no httpx dependency)
    strum_cache_path = Path('docs/data/strum_machine_cache.json')
    if strum_cache_path.exists():
        try:
            with open(strum_cache_path) as f:
                strum_cache = json.load(f)
            strum_matches = 0
            for song in songs:
                # Skip if already has SM URL from work.yaml
                if song.get('strum_machine_url'):
                    strum_matches += 1
                    continue
                title = song.get('title', '').lower().strip()
                cached = strum_cache.get(title)
                if cached and not cached.get('_no_match') and 'url' in cached:
                    song['strum_machine_url'] = cached['url']
                    strum_matches += 1
            print(f"Strum Machine: {strum_matches}/{len(songs)} songs matched")
        except Exception as e:
            print(f"Strum Machine enrichment failed: {e}")

    # Deduplicate (by content for lead sheets, by id for tablature-only)
    seen_content = {}
    unique_songs = []
    duplicates = 0
    for song in songs:
        content = song.get('content', '')
        # Don't deduplicate tablature-only works (they have empty content)
        if not content:
            unique_songs.append(song)
            continue
        content_hash = hashlib.md5(content.encode()).hexdigest()
        if content_hash in seen_content:
            duplicates += 1
            continue
        seen_content[content_hash] = True
        unique_songs.append(song)

    songs = unique_songs
    print(f"Indexed {len(songs)} songs ({duplicates} duplicates removed)")

    # Write index
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        for song in songs:
            f.write(json.dumps(song, ensure_ascii=False) + '\n')

    print(f"Written to {output_file}")
    print(f"Size: {output_file.stat().st_size / 1024 / 1024:.1f} MB")


def main():
    parser = argparse.ArgumentParser(description='Build index from works/')
    parser.add_argument('--no-tags', action='store_true',
                        help='Skip tag enrichment')
    args = parser.parse_args()

    works_dir = Path('works')
    output_file = Path('docs/data/index.jsonl')

    if not works_dir.exists():
        print(f"Error: works/ directory not found")
        print("Run migrate_to_works.py first")
        return 1

    build_works_index(works_dir, output_file, enrich_tags=not args.no_tags)


if __name__ == '__main__':
    main()
