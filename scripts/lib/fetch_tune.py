#!/usr/bin/env python3
"""
Fetch a single tune from TuneArch for GitHub Actions

Fetches tune from TuneArch and:
1. Saves to sources/tunearch/parsed/ (provenance archive)
2. Publishes to works/{slug}/ for immediate search visibility

Usage:
    python fetch_tune.py --tune "Salt Creek" --issue-number 42 --author username
"""

import argparse
import re
import sys
from pathlib import Path
from datetime import date
import yaml

# Add tunearch src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'sources' / 'tunearch' / 'src'))

from scraper import TuneArchScraper
from chordpro_generator import abc_to_chordpro, save_chordpro


def add_request_metadata(chordpro: str, issue_number: str, author: str) -> str:
    """Add request provenance metadata to ChordPro content"""
    lines = chordpro.split('\n')

    # Find insertion point (after existing metadata)
    insert_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('{meta:') or line.startswith('{key:') or line.startswith('{time:'):
            insert_idx = i + 1

    today = date.today().isoformat()
    metadata = [
        f'{{meta: x_requested_by github:{author}}}',
        f'{{meta: x_requested {today}}}',
        f'{{meta: x_request_issue {issue_number}}}',
    ]

    for j, meta_line in enumerate(metadata):
        lines.insert(insert_idx + j, meta_line)

    return '\n'.join(lines)


def generate_slug(title: str) -> str:
    """Generate a URL-safe slug from the tune title."""
    slug = title.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')
    return slug[:50]


def publish_to_works(tune, chordpro: str, author: str, issue_number: str) -> Path:
    """Publish the tune to works/ for immediate search visibility."""
    today = date.today().isoformat()
    slug = generate_slug(tune.metadata.title)

    # Extract key from ABC if available
    key = None
    if tune.abc_notation:
        match = re.search(r'^K:\s*(\w+)', tune.abc_notation, re.MULTILINE)
        if match:
            key = match.group(1)

    work_data = {
        'id': slug,
        'title': tune.metadata.title,
        'tags': ['Instrumental'],
        'parts': [{
            'type': 'lead-sheet',
            'format': 'chordpro',
            'file': 'lead-sheet.pro',
            'default': True,
            'provenance': {
                'source': 'tunearch',
                'source_url': tune.metadata.url if hasattr(tune.metadata, 'url') else None,
                'requested_by': f'github:{author}',
                'requested_at': today,
                'github_issue': int(issue_number) if issue_number.isdigit() else None,
            }
        }]
    }

    if tune.metadata.composer:
        work_data['composers'] = [tune.metadata.composer]
    if key:
        work_data['default_key'] = key

    # Create work directory
    repo_root = Path(__file__).parent.parent.parent
    work_dir = repo_root / 'works' / slug

    # Handle collision
    counter = 1
    original_slug = slug
    while work_dir.exists():
        slug = f"{original_slug}-{counter}"
        work_dir = repo_root / 'works' / slug
        work_data['id'] = slug
        counter += 1

    work_dir.mkdir(parents=True, exist_ok=True)

    # Write work.yaml
    with open(work_dir / 'work.yaml', 'w') as f:
        yaml.dump(work_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    # Write lead-sheet.pro
    (work_dir / 'lead-sheet.pro').write_text(chordpro + '\n')

    return work_dir


def main():
    parser = argparse.ArgumentParser(description='Fetch a tune from TuneArch')
    parser.add_argument('--tune', required=True, help='Tune name to fetch')
    parser.add_argument('--issue-number', required=True, help='GitHub issue number')
    parser.add_argument('--author', required=True, help='GitHub username of requester')
    args = parser.parse_args()

    # Import here to avoid issues when tunearch src isn't available
    from scraper import TuneArchScraper
    from chordpro_generator import abc_to_chordpro, save_chordpro

    scraper = TuneArchScraper()

    print(f"Fetching: {args.tune}")
    tune = scraper.fetch_tune(args.tune)

    if not tune:
        print(f"Error: Could not fetch tune '{args.tune}' from TuneArch")
        sys.exit(1)

    if not tune.abc_notation:
        print(f"Error: No ABC notation found for '{args.tune}'")
        sys.exit(1)

    # Generate ChordPro
    chordpro = abc_to_chordpro(tune)
    chordpro = add_request_metadata(chordpro, args.issue_number, args.author)

    # 1. Archive to sources/tunearch/parsed/ (provenance)
    output_dir = Path(__file__).parent.parent.parent / 'sources' / 'tunearch' / 'parsed'
    output_path = save_chordpro(chordpro, output_dir, tune.metadata.title)
    print(f"Archived to: {output_path}")

    # 2. Publish to works/ for immediate search visibility
    work_dir = publish_to_works(tune, chordpro, args.author, args.issue_number)
    print(f"Published to: {work_dir}")

    # Write slug for workflow to read (used in closing comment)
    slug = generate_slug(tune.metadata.title)
    Path('/tmp/tune_filename.txt').write_text(slug)


if __name__ == '__main__':
    main()
