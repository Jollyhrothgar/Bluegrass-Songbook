#!/usr/bin/env python3
"""
Process a song submission from a GitHub issue.

Reads the issue body from ISSUE_BODY environment variable,
extracts the ChordPro content, and:
1. Saves to sources/manual/parsed/ (raw archive)
2. Publishes to works/{slug}/ for immediate search visibility

Adds submission provenance metadata:
  {meta: x_source manual}
  {meta: x_submitted_by github:username}
  {meta: x_submitted 2025-12-26}
  {meta: x_submission_issue 26}
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


def extract_metadata(issue_body: str) -> dict:
    """Extract metadata from the issue body."""
    metadata = {}

    # Extract title
    match = re.search(r'\*\*Title:\*\*\s*(.+)', issue_body)
    if match:
        metadata['title'] = match.group(1).strip()

    # Extract artist
    match = re.search(r'\*\*Artist:\*\*\s*(.+)', issue_body)
    if match:
        artist = match.group(1).strip()
        if artist.lower() != 'unknown':
            metadata['artist'] = artist

    return metadata


def add_submission_metadata(content: str, author: str, issue_number: str) -> str:
    """Add submission provenance metadata to ChordPro content.

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
        '{meta: x_source manual}',
        f'{{meta: x_submitted_by github:{author}}}',
        f'{{meta: x_submitted {today}}}',
        f'{{meta: x_submission_issue {issue_number}}}',
    ]

    # Insert metadata
    for j, meta_line in enumerate(metadata):
        lines.insert(insert_idx + j, meta_line)

    return '\n'.join(lines)


def generate_slug(title: str) -> str:
    """Generate a URL-safe slug from the song title."""
    # Lowercase, replace spaces with hyphens, remove special chars
    slug = title.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    slug = slug.strip('-')
    # Limit length
    return slug[:50]


def generate_filename(title: str) -> str:
    """Generate a safe filename from the song title."""
    # Remove special characters, keep only alphanumeric
    safe_name = re.sub(r'[^a-z0-9]', '', title.lower())
    # Limit length
    safe_name = safe_name[:50]
    return f"{safe_name}.pro"


def extract_key_from_chordpro(content: str) -> str | None:
    """Extract key from ChordPro content."""
    match = re.search(r'\{(?:key|meta:\s*key):\s*([A-G][#b]?m?)\}', content, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def extract_composer_from_chordpro(content: str) -> str | None:
    """Extract composer from ChordPro content."""
    match = re.search(r'\{(?:composer|meta:\s*composer):\s*(.+?)\}', content, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None


def publish_to_works(slug: str, title: str, artist: str | None, chordpro: str,
                     author: str, issue_number: str, repo_root: Path) -> Path:
    """Publish the song to works/ for immediate search visibility."""
    today = date.today().isoformat()

    # Extract additional metadata from ChordPro
    key = extract_key_from_chordpro(chordpro)
    composer = extract_composer_from_chordpro(chordpro)

    # Build work.yaml structure
    work_data = {
        'id': slug,
        'title': title,
    }

    if artist:
        work_data['artist'] = artist
    if composer:
        work_data['composers'] = [composer]
    if key:
        work_data['default_key'] = key

    work_data['tags'] = []  # Will be enriched later
    work_data['parts'] = [{
        'type': 'lead-sheet',
        'format': 'chordpro',
        'file': 'lead-sheet.pro',
        'default': True,
        'provenance': {
            'source': 'manual',
            'submitted_by': f'github:{author}',
            'submitted_at': today,
            'github_issue': int(issue_number) if issue_number.isdigit() else None,
        }
    }]

    # Create work directory
    work_dir = repo_root / 'works' / slug

    # Handle collision - add suffix if needed
    counter = 1
    original_slug = slug
    while work_dir.exists():
        slug = f"{original_slug}-{counter}"
        work_dir = repo_root / 'works' / slug
        work_data['id'] = slug
        counter += 1

    work_dir.mkdir(parents=True, exist_ok=True)

    # Write work.yaml
    work_yaml_path = work_dir / 'work.yaml'
    with open(work_yaml_path, 'w') as f:
        yaml.dump(work_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    # Write lead-sheet.pro
    lead_sheet_path = work_dir / 'lead-sheet.pro'
    lead_sheet_path.write_text(chordpro + '\n')

    return work_dir


def main():
    # Get issue info from environment
    issue_body = os.environ.get('ISSUE_BODY', '')
    issue_number = os.environ.get('ISSUE_NUMBER', 'unknown')
    issue_title = os.environ.get('ISSUE_TITLE', '')
    issue_author = os.environ.get('ISSUE_AUTHOR', 'unknown')

    if not issue_body:
        print("Error: ISSUE_BODY environment variable is empty")
        sys.exit(1)

    # Extract ChordPro content
    chordpro = extract_chordpro(issue_body)
    if not chordpro:
        print("Error: Could not find ChordPro content in issue body")
        sys.exit(1)

    # Add submission provenance metadata
    chordpro = add_submission_metadata(chordpro, issue_author, issue_number)

    # Extract metadata from issue body
    metadata = extract_metadata(issue_body)

    # Try to get title from metadata, fall back to issue title
    title = metadata.get('title', '')
    if not title:
        # Parse from issue title like "Song: Title by Artist"
        match = re.match(r'Song:\s*(.+?)(?:\s+by\s+|$)', issue_title)
        if match:
            title = match.group(1).strip()
        else:
            title = f"submission_{issue_number}"

    # Get artist from metadata
    artist = metadata.get('artist')

    # Generate slug and filename
    slug = generate_slug(title)
    filename = generate_filename(title)

    # Determine paths
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent

    # 1. Save to sources/manual/parsed/ (provenance archive)
    sources_dir = repo_root / 'sources' / 'manual' / 'parsed'
    sources_path = sources_dir / filename

    # Check for existing file - add suffix if needed
    counter = 1
    original_filename = filename
    while sources_path.exists():
        base = original_filename.rsplit('.', 1)[0]
        filename = f"{base}_{counter}.pro"
        sources_path = sources_dir / filename
        counter += 1

    sources_dir.mkdir(parents=True, exist_ok=True)
    sources_path.write_text(chordpro + '\n')
    print(f"Archived to: {sources_path}")

    # 2. Publish to works/ (immediate search visibility)
    work_dir = publish_to_works(slug, title, artist, chordpro, issue_author, issue_number, repo_root)
    print(f"Published to: {work_dir}")

    print(f"Title: {title}")
    print(f"Slug: {slug}")

    # Write slug to temp file for the workflow to read
    Path('/tmp/song_filename.txt').write_text(slug)


if __name__ == '__main__':
    main()
