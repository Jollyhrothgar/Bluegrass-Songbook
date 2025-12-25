#!/usr/bin/env python3
"""
Process a song correction from a GitHub issue.

Reads the issue body from ISSUE_BODY environment variable,
extracts the ChordPro content and song ID, overwrites the existing file,
and adds it to the protected list.
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


def extract_song_id(issue_body: str) -> str | None:
    """Extract the song ID from the issue body."""
    # Look for **Song ID:** pattern
    match = re.search(r'\*\*Song ID:\*\*\s*(\S+)', issue_body)
    if match:
        return match.group(1).strip()
    return None


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


def main():
    # Get issue body from environment
    issue_body = os.environ.get('ISSUE_BODY', '')
    issue_number = os.environ.get('ISSUE_NUMBER', 'unknown')

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

    # Determine paths
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    output_path = repo_root / 'sources' / 'classic-country' / 'parsed' / f'{song_id}.pro'
    protected_file = repo_root / 'sources' / 'classic-country' / 'protected.txt'

    # Check if original file exists
    if not output_path.exists():
        print(f"Warning: Original file {output_path} does not exist, creating new file")

    # Write the corrected content
    output_path.write_text(chordpro + '\n')
    print(f"Updated: {output_path}")

    # Add to protected list
    add_to_protected_list(song_id, protected_file)

    # Write song ID to temp file for the workflow to read
    Path('/tmp/corrected_song_id.txt').write_text(song_id)

    print(f"Song ID: {song_id}")
    print("Correction applied successfully!")


if __name__ == '__main__':
    main()
