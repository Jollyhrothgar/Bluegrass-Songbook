#!/usr/bin/env python3
"""
Migrate all songs from index.jsonl to works/ directory structure.

This creates the new works/ artifact repository:
- Each song becomes a work directory: works/{work-id}/
- Contains work.yaml (metadata) + lead-sheet.pro (content)
- Preserves provenance information from x_source metadata

Usage:
    uv run python scripts/lib/migrate_to_works.py
    uv run python scripts/lib/migrate_to_works.py --dry-run
    uv run python scripts/lib/migrate_to_works.py --limit 10
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

from work_schema import Work, Part, Provenance, ExternalLinks, slugify


def load_index(index_path: Path) -> list[dict]:
    """Load songs from index.jsonl."""
    songs = []
    with open(index_path) as f:
        for line in f:
            line = line.strip()
            if line:
                songs.append(json.loads(line))
    return songs


def load_strum_machine_cache(cache_path: Path) -> dict:
    """Load Strum Machine URL cache."""
    if not cache_path.exists():
        return {}
    with open(cache_path) as f:
        return json.load(f)


def extract_metadata_from_content(content: str) -> dict:
    """Extract x_* metadata from ChordPro content."""
    meta = {}
    for match in re.finditer(r'\{meta:\s*(\w+)\s+([^\}]+)\}', content):
        key = match.group(1)
        value = match.group(2).strip()
        meta[key] = value
    return meta


def generate_work_id(song_id: str, title: str) -> str:
    """Generate a URL-safe work ID."""
    # Use title-based slug for readability
    slug = slugify(title)
    if not slug:
        slug = slugify(song_id)
    if not slug:
        slug = 'untitled'
    return slug


def song_to_work(song: dict, sm_cache: dict) -> Work:
    """Convert an index song entry to a Work object."""
    # Extract metadata from content
    content_meta = extract_metadata_from_content(song.get('content', ''))

    # Generate work ID from title
    work_id = generate_work_id(song['id'], song.get('title', song['id']))

    # Build provenance
    provenance = Provenance(
        source=song.get('source', content_meta.get('x_source', 'unknown')),
        source_file=content_meta.get('x_source_file'),
        imported_at=str(date.today()),
    )

    # Build external links
    sm_url = song.get('strum_machine_url')
    external = None
    if sm_url:
        external = ExternalLinks(strum_machine=sm_url)

    # Build part
    part = Part(
        type='lead-sheet',
        format='chordpro',
        file='lead-sheet.pro',
        default=True,
        provenance=provenance,
    )

    # Build work
    work = Work(
        id=work_id,
        title=song.get('title', 'Untitled'),
        artist=song.get('artist'),
        composers=[song['composer']] if song.get('composer') else [],
        default_key=song.get('key'),
        default_tempo=song.get('tempo'),
        time_signature=song.get('time_signature'),
        tags=list(song.get('tags', {}).keys()) if isinstance(song.get('tags'), dict) else song.get('tags', []),
        external=external,
        parts=[part],
        group_id=song.get('group_id'),
    )

    return work


def migrate_songs(
    index_path: Path,
    sm_cache_path: Path,
    works_dir: Path,
    dry_run: bool = False,
    limit: int = None,
) -> dict:
    """Migrate all songs to works/ directory."""

    print(f"Loading index from {index_path}...")
    songs = load_index(index_path)
    print(f"  Loaded {len(songs)} songs")

    print(f"Loading Strum Machine cache from {sm_cache_path}...")
    sm_cache = load_strum_machine_cache(sm_cache_path)
    print(f"  Loaded {len(sm_cache)} cached entries")

    if limit:
        songs = songs[:limit]
        print(f"  Limited to {limit} songs")

    # Track ID mappings for redirects
    id_mapping = {}  # old_song_id -> work_id

    # Track work IDs to handle collisions
    work_id_counts = {}

    migrated = 0
    skipped = 0
    errors = []

    for i, song in enumerate(songs):
        if i % 1000 == 0 and i > 0:
            print(f"  Progress: {i}/{len(songs)} ({migrated} migrated, {skipped} skipped)")

        try:
            # Convert to work
            work = song_to_work(song, sm_cache)

            # Handle work ID collisions by appending number
            base_id = work.id
            if base_id in work_id_counts:
                work_id_counts[base_id] += 1
                work.id = f"{base_id}-{work_id_counts[base_id]}"
            else:
                work_id_counts[base_id] = 0

            # Track mapping
            id_mapping[song['id']] = work.id

            if dry_run:
                migrated += 1
                continue

            # Create work directory
            work_dir = works_dir / work.id
            work_dir.mkdir(parents=True, exist_ok=True)

            # Write work.yaml
            work_yaml_path = work_dir / 'work.yaml'
            work_yaml_path.write_text(work.to_yaml())

            # Write lead-sheet.pro
            pro_path = work_dir / 'lead-sheet.pro'
            pro_path.write_text(song.get('content', ''))

            migrated += 1

        except Exception as e:
            errors.append((song.get('id', 'unknown'), str(e)))
            skipped += 1

    print(f"\nMigration complete:")
    print(f"  Migrated: {migrated}")
    print(f"  Skipped: {skipped}")
    print(f"  Errors: {len(errors)}")

    if errors and len(errors) <= 10:
        print("\nErrors:")
        for song_id, error in errors:
            print(f"  {song_id}: {error}")

    return id_mapping


def main():
    parser = argparse.ArgumentParser(description='Migrate songs to works/ directory')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done')
    parser.add_argument('--limit', type=int, help='Limit number of songs to migrate')
    parser.add_argument('--output-mapping', type=Path, default=Path('docs/data/id_mapping.json'),
                        help='Output path for ID mapping file')
    args = parser.parse_args()

    # Paths
    base_dir = Path(__file__).parent.parent.parent
    index_path = base_dir / 'docs' / 'data' / 'index.jsonl'
    sm_cache_path = base_dir / 'docs' / 'data' / 'strum_machine_cache.json'
    works_dir = base_dir / 'works'

    if not index_path.exists():
        print(f"Error: Index file not found: {index_path}")
        sys.exit(1)

    print(f"Migrating songs to {works_dir}")
    if args.dry_run:
        print("  (DRY RUN - no files will be created)")

    id_mapping = migrate_songs(
        index_path=index_path,
        sm_cache_path=sm_cache_path,
        works_dir=works_dir,
        dry_run=args.dry_run,
        limit=args.limit,
    )

    # Save ID mapping
    if not args.dry_run:
        mapping_path = base_dir / args.output_mapping
        mapping_path.parent.mkdir(parents=True, exist_ok=True)
        with open(mapping_path, 'w') as f:
            json.dump(id_mapping, f, indent=2)
        print(f"\nID mapping saved to {mapping_path}")
        print(f"  {len(id_mapping)} mappings")


if __name__ == '__main__':
    main()
