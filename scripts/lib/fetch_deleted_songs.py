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
from pathlib import Path


def fetch_deleted_songs():
    """Fetch deleted song IDs from Supabase."""
    cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'deleted_songs.json'

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')

    if not supabase_url or not supabase_key:
        print("Warning: SUPABASE_URL or SUPABASE_KEY not set, using cached deleted_songs.json")
        return load_cached_deleted_songs()

    try:
        from supabase import create_client
    except ImportError:
        print("Warning: supabase-py not installed, using cached deleted_songs.json")
        return load_cached_deleted_songs()

    try:
        client = create_client(supabase_url, supabase_key)

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

    except Exception as e:
        print(f"Warning: Failed to fetch from Supabase: {e}")
        return load_cached_deleted_songs()


def load_cached_deleted_songs():
    """Load deleted songs from cache file."""
    cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'deleted_songs.json'

    if cache_file.exists():
        with open(cache_file) as f:
            data = json.load(f)
            print(f"Loaded {len(data)} deleted songs from cache")
            return data

    print("No deleted songs cache found")
    return {}


if __name__ == '__main__':
    fetch_deleted_songs()
