#!/usr/bin/env python3
"""
Fetch a single tune from TuneArch for GitHub Actions

Usage:
    python fetch_tune.py --tune "Salt Creek" --issue-number 42 --author username
"""

import argparse
import sys
from pathlib import Path
from datetime import date

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

    # Determine output path
    output_dir = Path(__file__).parent.parent.parent / 'sources' / 'tunearch' / 'parsed'
    output_path = save_chordpro(chordpro, output_dir, tune.metadata.title)

    print(f"Created: {output_path}")

    # Write filename for workflow to read
    Path('/tmp/tune_filename.txt').write_text(output_path.name)


if __name__ == '__main__':
    main()
