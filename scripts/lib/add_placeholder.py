#!/usr/bin/env python3
"""
Create a placeholder work in works/ directory.

A placeholder is a work with metadata but no lead sheet or tablature content.
It appears in search and can be added to lists, but has no playable content yet.

Usage:
    uv run python scripts/lib/add_placeholder.py "Rebecca" --artist "Jim Mills" --key B --tags Bluegrass,Instrumental
    uv run python scripts/lib/add_placeholder.py "Ground Hog" --notes "Traditional old-time tune"
"""

import argparse
import sys
from pathlib import Path

import yaml

# Import slugify from work_schema (same directory)
sys.path.insert(0, str(Path(__file__).parent))
from work_schema import slugify


def create_placeholder(title: str, artist: str = None, key: str = None,
                       composers: list[str] = None, tags: list[str] = None,
                       notes: str = None, youtube: str = None,
                       strum_machine: str = None,
                       works_dir: Path = None) -> Path:
    """Create a placeholder work directory with work.yaml.

    Returns the path to the created work directory.
    """
    if works_dir is None:
        works_dir = Path(__file__).parent.parent.parent / 'works'

    slug = slugify(title)
    work_dir = works_dir / slug

    # Handle slug collision
    counter = 1
    original_slug = slug
    while work_dir.exists():
        slug = f"{original_slug}-{counter}"
        work_dir = works_dir / slug
        counter += 1

    # Build work.yaml data
    work_data = {'id': slug, 'title': title}
    if artist:
        work_data['artist'] = artist
    if composers:
        work_data['composers'] = composers
    if key:
        work_data['default_key'] = key
    if tags:
        work_data['tags'] = tags
    work_data['status'] = 'placeholder'
    if notes:
        work_data['notes'] = notes

    # External links
    ext = {}
    if youtube:
        ext['youtube'] = youtube
    if strum_machine:
        ext['strum_machine'] = strum_machine
    if ext:
        work_data['external'] = ext

    work_data['parts'] = []

    # Create directory and write work.yaml
    work_dir.mkdir(parents=True, exist_ok=True)
    with open(work_dir / 'work.yaml', 'w') as f:
        yaml.dump(work_data, f, default_flow_style=False,
                  allow_unicode=True, sort_keys=False)

    return work_dir


def main():
    parser = argparse.ArgumentParser(
        description='Create a placeholder work (metadata stub with no content)'
    )
    parser.add_argument('title', help='Song title')
    parser.add_argument('--artist', help='Artist name')
    parser.add_argument('--key', help='Default key (e.g., G, Am, Bb)')
    parser.add_argument('--composers', help='Comma-separated composer names')
    parser.add_argument('--tags', help='Comma-separated tags (e.g., Bluegrass,Instrumental)')
    parser.add_argument('--notes', help='Community-visible notes about the song')
    parser.add_argument('--youtube', help='YouTube URL')
    parser.add_argument('--strum-machine', help='Strum Machine URL')
    parser.add_argument('--skip-index-rebuild', action='store_true',
                        help='Skip rebuilding the search index after adding')
    args = parser.parse_args()

    composers = [c.strip() for c in args.composers.split(',')] if args.composers else None
    tags = [t.strip() for t in args.tags.split(',')] if args.tags else None

    work_dir = create_placeholder(
        title=args.title,
        artist=args.artist,
        key=args.key,
        composers=composers,
        tags=tags,
        notes=args.notes,
        youtube=args.youtube,
        strum_machine=args.strum_machine,
    )

    print(f"Created placeholder: {work_dir.name}")
    print(f"  -> {work_dir / 'work.yaml'}")

    if not args.skip_index_rebuild:
        import subprocess
        print("\nRebuilding search index...")
        repo_root = Path(__file__).parent.parent.parent
        result = subprocess.run(
            ['uv', 'run', 'python3', 'scripts/lib/build_works_index.py'],
            cwd=repo_root
        )
        if result.returncode != 0:
            print("Warning: Index rebuild failed")
            sys.exit(1)
    else:
        print("\nSkipped index rebuild (--skip-index-rebuild)")
        print("Run './scripts/bootstrap --quick' to rebuild later")


if __name__ == '__main__':
    main()
