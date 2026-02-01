#!/usr/bin/env python3
"""
Fetch tag overrides from trusted user votes in Supabase.

Trusted users' downvotes are treated as authoritative - those tags
should be excluded from the song during index build.

Usage:
    uv run python scripts/lib/fetch_tag_overrides.py

Output:
    docs/data/tag_overrides.json
"""

import json
import os
import sys
from pathlib import Path

# Output file
OUTPUT_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'tag_overrides.json'

def fetch_tag_overrides():
    """Fetch trusted user tag downvotes from Supabase."""

    # Get Supabase credentials from environment
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY')

    if not supabase_url or not supabase_key:
        print("Warning: SUPABASE_URL or SUPABASE_KEY not set, using cached tag_overrides.json")
        return None

    try:
        from supabase import create_client
    except ImportError:
        print("Warning: supabase-py not installed, using cached tag_overrides.json")
        return None

    try:
        client = create_client(supabase_url, supabase_key)

        # Query: get all downvotes (vote_value = -1) from trusted users
        response = client.rpc('get_trusted_tag_overrides').execute()

        if response.data:
            return response.data

        # Fallback: direct query if RPC doesn't exist
        # Get trusted user IDs
        trusted_response = client.table('trusted_users').select('user_id').execute()
        trusted_ids = [r['user_id'] for r in trusted_response.data]

        if not trusted_ids:
            print("No trusted users found")
            return []

        # Get downvotes from trusted users
        votes_response = client.table('tag_votes') \
            .select('song_id, tag_name') \
            .in_('user_id', trusted_ids) \
            .eq('vote_value', -1) \
            .execute()

        return votes_response.data

    except Exception as e:
        print(f"Warning: Could not fetch from Supabase: {e}")
        return None


def main():
    print("Fetching tag overrides from trusted user votes...")

    overrides = fetch_tag_overrides()

    if overrides is None:
        # Use existing cache
        if OUTPUT_FILE.exists():
            with open(OUTPUT_FILE) as f:
                data = json.load(f)
            print(f"Using cached tag_overrides.json ({len(data.get('exclude', {}))} songs with exclusions)")
            return
        else:
            overrides = []

    # Convert to {song_id: [excluded_tags]} format
    exclude_by_song = {}
    for vote in overrides:
        song_id = vote['song_id']
        tag_name = vote['tag_name']

        if song_id not in exclude_by_song:
            exclude_by_song[song_id] = []

        # Normalize tag name to match our taxonomy (e.g., 'bluegrassstandard' -> 'BluegrassStandard')
        normalized_tag = normalize_tag_name(tag_name)
        if normalized_tag and normalized_tag not in exclude_by_song[song_id]:
            exclude_by_song[song_id].append(normalized_tag)

    # Save to file
    output = {
        'exclude': exclude_by_song,
        '_comment': 'Auto-generated from trusted user tag votes. Do not edit manually.',
        '_source': 'scripts/lib/fetch_tag_overrides.py'
    }

    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2, sort_keys=True)

    print(f"Saved {len(exclude_by_song)} songs with tag exclusions to {OUTPUT_FILE}")
    for song_id, tags in sorted(exclude_by_song.items()):
        print(f"  {song_id}: -{', '.join(tags)}")


def normalize_tag_name(tag_name: str) -> str:
    """Normalize a tag name from the database to match our taxonomy."""
    # Map lowercase DB tags to proper case
    tag_map = {
        'bluegrass': 'Bluegrass',
        'bluegrassstandard': 'BluegrassStandard',
        'classiccountry': 'ClassicCountry',
        'oldtime': 'OldTime',
        'gospel': 'Gospel',
        'folk': 'Folk',
        'honkytonk': 'HonkyTonk',
        'outlaw': 'Outlaw',
        'rockabilly': 'Rockabilly',
        'pop': 'Pop',
        'jazz': 'Jazz',
        'jamfriendly': 'JamFriendly',
        'modal': 'Modal',
        'instrumental': 'Instrumental',
        'waltz': 'Waltz',
        'nashvillesound': 'NashvilleSound',
        'westernswing': 'WesternSwing',
        'bakersfield': 'Bakersfield',
    }

    normalized = tag_name.lower().replace('-', '').replace('_', '').replace(' ', '')
    return tag_map.get(normalized, tag_name.title())


if __name__ == '__main__':
    main()
