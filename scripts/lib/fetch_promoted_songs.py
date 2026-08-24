#!/usr/bin/env python3
"""
Fetch promoted songs from Supabase and save to cache file.

Trusted users promote archived (index-pruned) works back into the main
index from the Bluegrass Dungeon UI. This syncs the promoted_songs table
to a cache file that the build process unions with the registry keep list,
without needing Supabase credentials at build time.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... uv run python scripts/lib/fetch_promoted_songs.py

Or via the utility script:
    ./scripts/utility sync-promoted-songs
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from supabase_client import connect, fetch_failed  # noqa: E402


def fetch_promoted_songs():
    """Fetch promoted song IDs from Supabase."""
    cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'promoted_songs.json'

    client = connect('promoted songs')

    try:

        # Fetch all promoted songs
        result = client.table('promoted_songs').select('song_id, promoted_at, reason').execute()

        promoted = {}
        for row in result.data:
            promoted[row['song_id']] = {
                'promoted_at': row['promoted_at'],
                'reason': row.get('reason')
            }

        # Save to cache file
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, 'w') as f:
            json.dump(promoted, f, indent=2)

        print(f"Fetched {len(promoted)} promoted songs, saved to {cache_file}")
        return promoted

    except Exception as exc:                       # noqa: BLE001
        fetch_failed('promoted songs', exc)



if __name__ == '__main__':
    fetch_promoted_songs()
