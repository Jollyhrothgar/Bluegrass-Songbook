#!/usr/bin/env python3
"""
Fetch soft-deleted songs from Supabase and save to cache file.

This is run locally to sync the deleted_songs table to a cache file
that the build process can use without needing Supabase credentials.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... uv run python scripts/lib/fetch_deleted_songs.py

Or via the utility script:
    ./scripts/utility sync-deleted-songs
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from supabase_client import connect, fetch_failed  # noqa: E402


def fetch_deleted_songs():
    """Fetch deleted song IDs from Supabase."""
    cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'deleted_songs.json'

    client = connect('deleted songs')

    try:

        # Fetch all deleted songs
        result = client.table('deleted_songs').select('song_id, deleted_at, reason').execute()

        deleted = {}
        for row in result.data:
            deleted[row['song_id']] = {
                'deleted_at': row['deleted_at'],
                'reason': row.get('reason')
            }

        # Save to cache file
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_file, 'w') as f:
            json.dump(deleted, f, indent=2)

        print(f"Fetched {len(deleted)} deleted songs, saved to {cache_file}")
        return deleted

    except Exception as exc:                       # noqa: BLE001
        fetch_failed('deleted songs', exc)



if __name__ == '__main__':
    fetch_deleted_songs()
