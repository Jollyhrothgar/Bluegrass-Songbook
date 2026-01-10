#!/usr/bin/env python3
"""
Process a song correction from a GitHub issue.

Reads the issue body from ISSUE_BODY environment variable,
extracts the ChordPro content and song ID, and:
1. Updates works/{id}/ for immediate visibility
2. Updates sources/ archive if found there
3. Adds to protected list

Adds correction provenance metadata:
  {meta: x_corrected_by github:username}
  {meta: x_corrected 2025-12-26}
  {meta: x_correction_issue 24}
"""

import os
import re
import sys
from datetime import date
from pathlib import Path
import yaml


def extract_chordpro(issue_body: str) -> str | None:
    """Extract ChordPro content from the issue body."""
    # Look for content between ```chordpro and ```
    match = re.search(r'```chordpro\s*\n(.*?)\n```', issue_body, re.DOTALL)
    if match:
        return match.group(1).strip()

    # Fallback: look for any code block
    match = re.search(r'```\s*\n(.*?)\n```', issue_body, re.DOTALL)
    if match:
        return match.group(1).strip()

    return None


def extract_song_id(issue_body: str) -> str | None:
    """Extract the song ID from the issue body."""
    # Look for **Song ID:** pattern
    match = re.search(r'\*\*Song ID:\*\*\s*(\S+)', issue_body)
    if match:
        return match.group(1).strip()
    return None


def add_correction_metadata(content: str, author: str, issue_number: str) -> str:
    """Add correction provenance metadata to ChordPro content.

    Inserts metadata after existing meta lines but before first section.
    """
    lines = content.split('\n')

    # Find insertion point (after existing meta lines)
    insert_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('{meta:') or line.startswith('{title:') or line.startswith('{artist:'):
            insert_idx = i + 1

    # Build metadata lines
    today = date.today().isoformat()
    metadata = [
        f'{{meta: x_corrected_by github:{author}}}',
        f'{{meta: x_corrected {today}}}',
        f'{{meta: x_correction_issue {issue_number}}}',
    ]

    # Remove any existing correction metadata (in case of re-correction)
    lines = [l for l in lines if not (
        l.startswith('{meta: x_corrected') or
        l.startswith('{meta: x_correction_issue')
    )]

    # Recalculate insert index after filtering
    insert_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('{meta:') or line.startswith('{title:') or line.startswith('{artist:'):
            insert_idx = i + 1

    # Insert new metadata
    for j, meta_line in enumerate(metadata):
        lines.insert(insert_idx + j, meta_line)

    return '\n'.join(lines)


def add_to_protected_list(song_id: str, protected_file: Path) -> bool:
    """Add song ID to protected.txt if not already present."""
    # Read existing entries
    existing = set()
    if protected_file.exists():
        with open(protected_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    existing.add(line)

    # Check if already protected
    if song_id in existing:
        print(f"Song {song_id} already in protected list")
        return False

    # Add to file
    with open(protected_file, 'a') as f:
        f.write(f"{song_id}\n")
    print(f"Added {song_id} to protected list")
    return True


def extract_metadata_from_chordpro(content: str) -> dict:
    """Extract metadata from ChordPro content."""
    metadata = {}

    # Title
    match = re.search(r'\{(?:title|meta:\s*title):\s*(.+?)\}', content, re.IGNORECASE)
    if match:
        metadata['title'] = match.group(1).strip()

    # Artist
    match = re.search(r'\{(?:artist|meta:\s*artist):\s*(.+?)\}', content, re.IGNORECASE)
    if match:
        metadata['artist'] = match.group(1).strip()

    # Key
    match = re.search(r'\{(?:key|meta:\s*key):\s*([A-G][#b]?m?)\}', content, re.IGNORECASE)
    if match:
        metadata['key'] = match.group(1)

    # Composer
    match = re.search(r'\{(?:composer|meta:\s*composer):\s*(.+?)\}', content, re.IGNORECASE)
    if match:
        metadata['composer'] = match.group(1).strip()

    return metadata


def update_work(song_id: str, chordpro: str, author: str, issue_number: str, repo_root: Path) -> Path | None:
    """Update or create work in works/ directory."""
    work_dir = repo_root / 'works' / song_id
    today = date.today().isoformat()

    if work_dir.exists():
        # Update existing work
        work_yaml_path = work_dir / 'work.yaml'
        lead_sheet_path = work_dir / 'lead-sheet.pro'

        # Update the lead sheet
        lead_sheet_path.write_text(chordpro + '\n')

        # Update work.yaml with correction info if it exists
        if work_yaml_path.exists():
            with open(work_yaml_path, 'r') as f:
                work_data = yaml.safe_load(f)

            # Update metadata from corrected ChordPro
            meta = extract_metadata_from_chordpro(chordpro)
            if meta.get('title'):
                work_data['title'] = meta['title']
            if meta.get('artist'):
                work_data['artist'] = meta['artist']
            if meta.get('key'):
                work_data['default_key'] = meta['key']

            # Add correction info to provenance
            if work_data.get('parts'):
                for part in work_data['parts']:
                    if part.get('type') == 'lead-sheet':
                        if not part.get('provenance'):
                            part['provenance'] = {}
                        part['provenance']['corrected_by'] = f'github:{author}'
                        part['provenance']['corrected_at'] = today
                        part['provenance']['correction_issue'] = int(issue_number) if issue_number.isdigit() else None

            with open(work_yaml_path, 'w') as f:
                yaml.dump(work_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        print(f"Updated work: {work_dir}")
        return work_dir
    else:
        # Create new work from correction
        meta = extract_metadata_from_chordpro(chordpro)
        title = meta.get('title', song_id)

        work_data = {
            'id': song_id,
            'title': title,
        }
        if meta.get('artist'):
            work_data['artist'] = meta['artist']
        if meta.get('composer'):
            work_data['composers'] = [meta['composer']]
        if meta.get('key'):
            work_data['default_key'] = meta['key']

        work_data['tags'] = []
        work_data['parts'] = [{
            'type': 'lead-sheet',
            'format': 'chordpro',
            'file': 'lead-sheet.pro',
            'default': True,
            'provenance': {
                'source': 'correction',
                'corrected_by': f'github:{author}',
                'corrected_at': today,
                'correction_issue': int(issue_number) if issue_number.isdigit() else None,
            }
        }]

        work_dir.mkdir(parents=True, exist_ok=True)

        with open(work_dir / 'work.yaml', 'w') as f:
            yaml.dump(work_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        (work_dir / 'lead-sheet.pro').write_text(chordpro + '\n')

        print(f"Created work: {work_dir}")
        return work_dir


def main():
    # Get issue info from environment
    issue_body = os.environ.get('ISSUE_BODY', '')
    issue_number = os.environ.get('ISSUE_NUMBER', 'unknown')
    issue_author = os.environ.get('ISSUE_AUTHOR', 'unknown')

    if not issue_body:
        print("Error: ISSUE_BODY environment variable is empty")
        sys.exit(1)

    # Extract song ID
    song_id = extract_song_id(issue_body)
    if not song_id:
        print("Error: Could not find Song ID in issue body")
        sys.exit(1)

    # Extract ChordPro content
    chordpro = extract_chordpro(issue_body)
    if not chordpro:
        print("Error: Could not find ChordPro content in issue body")
        sys.exit(1)

    # Add correction provenance metadata
    chordpro = add_correction_metadata(chordpro, issue_author, issue_number)

    # Determine paths - check all source directories for existing file
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    sources_dir = repo_root / 'sources'

    # Search for existing file in all source directories
    output_path = None
    protected_file = None
    source_name = None

    for source_dir in sources_dir.iterdir():
        if not source_dir.is_dir():
            continue
        parsed_dir = source_dir / 'parsed'
        if not parsed_dir.exists():
            continue
        candidate = parsed_dir / f'{song_id}.pro'
        if candidate.exists():
            output_path = candidate
            protected_file = source_dir / 'protected.txt'
            source_name = source_dir.name
            break

    # Default to manual if not found (new submissions go to manual)
    if output_path is None:
        output_path = sources_dir / 'manual' / 'parsed' / f'{song_id}.pro'
        protected_file = sources_dir / 'manual' / 'protected.txt'
        source_name = 'manual'
        print(f"Warning: Original file not found, creating in {source_name}")
    else:
        print(f"Found existing file in source: {source_name}")

    # 1. Update sources/ archive
    output_path.write_text(chordpro + '\n')
    print(f"Updated source: {output_path}")

    # Add to protected list
    add_to_protected_list(song_id, protected_file)

    # 2. Update/create work in works/ for immediate visibility
    work_dir = update_work(song_id, chordpro, issue_author, issue_number, repo_root)

    # Write song ID to temp file for the workflow to read
    Path('/tmp/corrected_song_id.txt').write_text(song_id)

    print(f"Song ID: {song_id}")
    print("Correction applied successfully!")


if __name__ == '__main__':
    main()
