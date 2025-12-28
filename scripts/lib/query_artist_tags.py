#!/usr/bin/env python3
"""
Optimized MusicBrainz artist tag queries.

Uses indexed lookups instead of ILIKE for 100x+ speedup.
"""

import os
import psycopg2
from psycopg2.extras import execute_values
from typing import List, Tuple


# Database configuration
DB_CONFIG = {
    "dbname": os.getenv("MB_DBNAME", "musicbrainz_db"),
    "user": os.getenv("MB_USER", "musicbrainz"),
    "password": os.getenv("MB_PASSWORD", "musicbrainz"),
    "host": os.getenv("MB_HOST", "localhost"),
    "port": os.getenv("MB_PORT", "5432"),
}


def get_connection():
    """Create a database connection."""
    return psycopg2.connect(**DB_CONFIG)


def query_artist_tags_batch(
    artist_names: List[str],
    min_score: int = 2,
    max_tags_per_artist: int = 10
) -> dict:
    """
    Query tags for a batch of artists using optimized indexed lookups.

    Uses LATERAL join with the musicbrainz_unaccent index for fast lookups.

    Args:
        artist_names: List of artist names to look up
        min_score: Minimum tag vote count to include
        max_tags_per_artist: Maximum tags to return per artist

    Returns:
        Dict mapping artist_name -> list of (tag, score) tuples
    """
    if not artist_names:
        return {}

    # Optimized query using LATERAL join for indexed lookups
    query = """
    WITH input_artists AS (
        SELECT unnest(%s::text[]) as name
    ),
    matched_artists AS (
        SELECT i.name as search_name, a.id as artist_id
        FROM input_artists i
        JOIN LATERAL (
            SELECT id FROM musicbrainz.artist a
            WHERE lower(musicbrainz.musicbrainz_unaccent(a.name)) =
                  lower(musicbrainz.musicbrainz_unaccent(i.name))
            LIMIT 1
        ) a ON true
    )
    SELECT
        ma.search_name,
        t.name as tag,
        SUM(at.count) as score
    FROM matched_artists ma
    JOIN musicbrainz.artist_tag at ON at.artist = ma.artist_id
    JOIN musicbrainz.tag t ON t.id = at.tag
    GROUP BY ma.search_name, t.name
    HAVING SUM(at.count) >= %s
    ORDER BY ma.search_name, score DESC
    """

    results = {}

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (artist_names, min_score))

            current_artist = None
            current_tags = []

            for row in cur.fetchall():
                search_name, tag, score = row

                if search_name != current_artist:
                    if current_artist is not None:
                        results[current_artist] = current_tags[:max_tags_per_artist]
                    current_artist = search_name
                    current_tags = []

                current_tags.append((tag, int(score)))

            # Don't forget the last artist
            if current_artist is not None:
                results[current_artist] = current_tags[:max_tags_per_artist]

    return results


def refresh_artist_tags(output_file: str, artist_names: List[str], batch_size: int = 100):
    """
    Refresh artist tags file with optimized batch queries.

    Args:
        output_file: Path to write the artist_tags.json file
        artist_names: List of all artist names to query
        batch_size: Number of artists per batch query
    """
    import json
    import sys
    import time

    all_results = {}
    total_batches = (len(artist_names) + batch_size - 1) // batch_size
    start_time = time.time()

    for batch_num in range(total_batches):
        start_idx = batch_num * batch_size
        end_idx = min(start_idx + batch_size, len(artist_names))
        batch = artist_names[start_idx:end_idx]

        print(f"  Batch {batch_num + 1}/{total_batches} ({start_idx}-{end_idx})...", end=' ')
        sys.stdout.flush()

        try:
            batch_results = query_artist_tags_batch(batch)
            all_results.update(batch_results)
            print(f"{len(batch_results)} artists matched")
        except Exception as e:
            print(f"ERROR: {e}")

    elapsed = time.time() - start_time
    print(f"\nCompleted in {elapsed:.1f}s")
    print(f"Matched {len(all_results)}/{len(artist_names)} artists ({100*len(all_results)/len(artist_names):.0f}%)")

    # Save results
    with open(output_file, 'w') as f:
        json.dump(all_results, f, indent=2, sort_keys=True)
    print(f"Saved to {output_file}")

    return all_results


if __name__ == '__main__':
    import argparse
    import json

    parser = argparse.ArgumentParser(description='Query MusicBrainz artist tags')
    parser.add_argument('--test', action='store_true', help='Test with sample artists')
    parser.add_argument('--refresh', action='store_true', help='Refresh artist_tags.json from index')
    args = parser.parse_args()

    if args.test:
        test_artists = ['Bill Monroe', 'Hank Williams', 'Johnny Cash', 'Merle Haggard', 'Dolly Parton']
        print(f"Testing with {len(test_artists)} artists...")
        results = query_artist_tags_batch(test_artists)
        for artist, tags in results.items():
            print(f"\n{artist}:")
            for tag, score in tags[:5]:
                print(f"  {tag} ({score})")

    elif args.refresh:
        # Load unique artists from index
        from pathlib import Path

        index_file = Path('docs/data/index.jsonl')
        if not index_file.exists():
            print("Index file not found. Run build_index.py first.")
            exit(1)

        artists = set()
        with open(index_file) as f:
            for line in f:
                song = json.loads(line)
                if song.get('artist'):
                    artists.add(song['artist'])

        print(f"Found {len(artists)} unique artists in index")
        refresh_artist_tags('docs/data/artist_tags.json', list(artists))
