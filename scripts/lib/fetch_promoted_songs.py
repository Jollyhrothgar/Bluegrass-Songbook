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
from pathlib import Path


def fetch_promoted_songs():
    """Fetch promoted song IDs from Supabase."""
    cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'promoted_songs.json'

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')

    if not supabase_url or not supabase_key:
        print("Warning: SUPABASE_URL or SUPABASE_KEY not set, using cached promoted_songs.json")
        return load_cached_promoted_songs()

    try:
        from supabase import create_client
    except ImportError:
        print("Warning: supabase-py not installed, using cached promoted_songs.json")
        return load_cached_promoted_songs()

    try:
        client = create_client(supabase_url, supabase_key)

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

    except Exception as e:
        print(f"Warning: Failed to fetch from Supabase: {e}")
        return load_cached_promoted_songs()


def load_cached_promoted_songs():
    """Load promoted songs from cache file."""
    cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'promoted_songs.json'

    if cache_file.exists():
        with open(cache_file) as f:
            data = json.load(f)
            print(f"Loaded {len(data)} promoted songs from cache")
            return data

    print("No promoted songs cache found")
    return {}


if __name__ == '__main__':
    fetch_promoted_songs()
