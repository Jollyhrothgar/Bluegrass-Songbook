#!/usr/bin/env python3
"""
Export genre suggestions from Supabase to version-controlled JSON.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... uv run python scripts/lib/export_genre_suggestions.py

The output file (docs/data/user_genre_suggestions.json) should be committed to git
so that the data is available for offline builds and analysis.
"""

import json
import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

# Output file location
OUTPUT_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'user_genre_suggestions.json'


def write_output(output):
    """Write the export, keeping `exported_at` stable when nothing else moved.

    The hourly Sync Community Input workflow commits whatever this writes.
    A fresh `exported_at` on every run made the file differ every hour even
    when Supabase had returned identical data, so the workflow's
    `git diff --staged --quiet` guard never fired and main collected a no-op
    commit (and a CI run) every hour. Carrying the previous timestamp forward
    on an unchanged payload makes the file byte-identical, so the guard works.

    `exported_at` now means "when the data last changed" rather than "when the
    script last ran", which is the more useful of the two. fetch_tag_overrides
    sidesteps this by writing no timestamp at all.
    """
    try:
        previous = json.loads(OUTPUT_FILE.read_text())
    except (FileNotFoundError, ValueError):
        previous = None

    if previous is not None:
        stale = {k: v for k, v in previous.items() if k != 'exported_at'}
        fresh = {k: v for k, v in output.items() if k != 'exported_at'}
        if stale == fresh:
            output = dict(output, exported_at=previous.get('exported_at', output['exported_at']))

    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2, sort_keys=True)


def export_suggestions():
    """Export all genre suggestions from Supabase to JSON."""
    # Get credentials from environment
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables required")
        print("")
        print("You can find these in your Supabase project settings:")
        print("  - SUPABASE_URL: Project URL")
        print("  - SUPABASE_SERVICE_ROLE_KEY: service_role key (NOT anon key)")
        sys.exit(1)

    try:
        from supabase import create_client
    except ImportError:
        print("Error: supabase package not installed")
        print("Run: uv add supabase")
        sys.exit(1)

    print("Connecting to Supabase...")
    client = create_client(supabase_url, supabase_key)

    # Fetch all suggestions
    print("Fetching genre suggestions...")
    response = client.table('genre_suggestions').select('*').execute()
    rows = response.data

    if not rows:
        print("No suggestions found.")
        # Still write empty file for consistency
        output = {
            'exported_at': datetime.utcnow().isoformat() + 'Z',
            'total_suggestions': 0,
            'unique_tags': 0,
            'unique_songs': 0,
            'songs': {},
            'tag_totals': {}
        }
        write_output(output)
        print(f"Wrote empty file to {OUTPUT_FILE}")
        return

    # Aggregate by song_id -> tag -> count
    suggestions_by_song = {}
    tag_counts = Counter()

    for row in rows:
        song_id = row['song_id']
        tag = row['raw_tag']

        if song_id not in suggestions_by_song:
            suggestions_by_song[song_id] = Counter()
        suggestions_by_song[song_id][tag] += 1
        tag_counts[tag] += 1

    # Convert Counters to dicts for JSON serialization
    output = {
        'exported_at': datetime.utcnow().isoformat() + 'Z',
        'total_suggestions': len(rows),
        'unique_tags': len(tag_counts),
        'unique_songs': len(suggestions_by_song),
        'songs': {sid: dict(counts) for sid, counts in suggestions_by_song.items()},
        'tag_totals': dict(tag_counts.most_common(100))
    }

    # Write to file
    write_output(output)

    print(f"Exported {len(rows)} suggestions for {len(suggestions_by_song)} songs")
    print(f"Unique tags: {len(tag_counts)}")
    print("")
    print("Top 10 tags:")
    for tag, count in tag_counts.most_common(10):
        print(f"  {count:4d}x  {tag}")
    print("")
    print(f"Wrote to {OUTPUT_FILE}")


if __name__ == '__main__':
    export_suggestions()
