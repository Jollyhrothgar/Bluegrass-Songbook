#!/usr/bin/env python3
"""
Process a song submission from a GitHub issue.

Reads the issue body from ISSUE_BODY environment variable,
extracts the ChordPro content, and saves it to sources/manual/parsed/
"""

import os
import re
import sys
from pathlib import Path


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


def generate_filename(title: str) -> str:
    """Generate a safe filename from the song title."""
    # Remove special characters, keep only alphanumeric
    safe_name = re.sub(r'[^a-z0-9]', '', title.lower())
    # Limit length
    safe_name = safe_name[:50]
    return f"{safe_name}.pro"


def main():
    # Get issue body from environment
    issue_body = os.environ.get('ISSUE_BODY', '')
    issue_number = os.environ.get('ISSUE_NUMBER', 'unknown')
    issue_title = os.environ.get('ISSUE_TITLE', '')

    if not issue_body:
        print("Error: ISSUE_BODY environment variable is empty")
        sys.exit(1)

    # Extract ChordPro content
    chordpro = extract_chordpro(issue_body)
    if not chordpro:
        print("Error: Could not find ChordPro content in issue body")
        sys.exit(1)

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

    # Generate filename
    filename = generate_filename(title)

    # Determine output path
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    output_dir = repo_root / 'sources' / 'manual' / 'parsed'
    output_path = output_dir / filename

    # Check for existing file - add suffix if needed
    counter = 1
    original_filename = filename
    while output_path.exists():
        base = original_filename.rsplit('.', 1)[0]
        filename = f"{base}_{counter}.pro"
        output_path = output_dir / filename
        counter += 1

    # Save the file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(chordpro + '\n')

    print(f"Created: {output_path}")
    print(f"Title: {title}")
    print(f"Filename: {filename}")

    # Write filename to temp file for the workflow to read
    Path('/tmp/song_filename.txt').write_text(filename)


if __name__ == '__main__':
    main()
