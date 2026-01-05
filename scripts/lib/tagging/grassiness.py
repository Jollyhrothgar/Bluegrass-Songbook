#!/usr/bin/env python3
"""
Grassiness Score - Bluegrass Standard Detection

This module computes a "grassiness score" for songs based on which bluegrass
artists have recorded them. A song covered by Bill Monroe, the Stanley Brothers,
and Del McCoury is almost certainly a bluegrass standard.

## Approach

Two-pronged detection for better coverage:

### Signal 1: Curated Artist Covers
Query recordings by known bluegrass artists (Bill Monroe, Stanley Brothers, etc.)
- High confidence: if Bill Monroe recorded it, it's bluegrass
- Weighted by artist significance

### Signal 2: MusicBrainz Bluegrass Tags
Query recordings/releases tagged "bluegrass" in MusicBrainz
- Catches songs by artists not in our curated list
- Community-sourced tagging

Both signals are cached locally for fast scoring:
1. Query ALL recordings by known bluegrass artists (one-time, cacheable)
2. Query ALL recordings/releases tagged "bluegrass" (one-time, cacheable)
3. Normalize titles for fuzzy matching
4. Match our song catalog against these caches
5. Combine scores from both signals

## Scoring Model

Artists are weighted by their significance to bluegrass:
- Tier 1 (weight 3): Bill Monroe, Flatt & Scruggs, Stanley Brothers
- Tier 2 (weight 2): Del McCoury, Tony Rice, J.D. Crowe, etc.
- Tier 3 (weight 1): Modern bluegrass artists

Score = sum(artist_weight * min(recording_count, 3))

The min(count, 3) prevents a single artist's many recordings from dominating.

## Thresholds

| Score | Classification |
|-------|----------------|
| ≥10   | Definite bluegrass standard |
| 5-9   | Likely bluegrass |
| 2-4   | Possible bluegrass (few covers) |
| 0-1   | Not bluegrass |

## Usage

```bash
# Build the bluegrass recordings cache (one-time, ~5 min)
MB_PORT=5440 uv run python grassiness.py --build-cache

# Score songs in the index using the cache
uv run python grassiness.py --score-index

# Test specific songs
uv run python grassiness.py --test
```

## Files

- `docs/data/bluegrass_recordings.json` - Cache of all bluegrass artist recordings
- `docs/data/grassiness_scores.json` - Computed scores for songs in our index
"""

import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Dict, List, Set, Tuple

# =============================================================================
# Configuration
# =============================================================================

# Era-based tier weights
# Tier 1: Founding figures (pre-1960 start) - strong bluegrass signal
# Tier 2: Classic era (1960-1989) - reliable bluegrass signal
# Tier 3: Modern era (1990+) - weaker signal (genre blending)
TIER_WEIGHTS = {
    1: 4,  # Founding era
    2: 2,  # Classic era
    3: 1,  # Modern era
}

# Artists to exclude (false positives from name matching)
EXCLUDE_ARTISTS = {
    'Buckethead',           # Experimental metal guitarist
    'Bill Evans',           # Jazz pianist (not the banjo player)
    'Jerry Garcia',         # Primarily Grateful Dead
    'Steve Earle',          # Primarily country/rock
    'Charlie Daniels',      # Primarily southern rock
    'The Charlie Daniels Band',
    'Blackberry Smoke',     # Southern rock
    'Andy Griffith',        # Actor who did some folk
    'Vince Gill',           # Primarily mainstream country
    'Dolly Parton',         # Primarily country (only a few bluegrass albums)
    'Chris Stapleton',      # Primarily country/rock
    'Josh Turner',          # Mainstream country
    'Patty Loveless',       # Mainstream country
    'Keith Whitley',        # Mainstream country (early career was bluegrass)
    'Edie Brickell',        # Pop/folk
    'Tommy Ramone',         # The Ramones
    'Railroad Earth',       # Jam band / americana
    'Old Crow Medicine Show',  # Americana (borderline)
}

# Manual tier overrides for important artists
# These override the era-based automatic tiering
TIER_OVERRIDES = {
    # Tier 1: Absolute bluegrass legends (founding era)
    'Bill Monroe': 1,
    'The Stanley Brothers': 1,
    'Ralph Stanley': 1,
    'Carter Stanley': 1,
    'Lester Flatt': 1,
    'Earl Scruggs': 1,
    'Flatt & Scruggs': 1,
    'Flatt and Scruggs': 1,
    'Foggy Mountain Boys': 1,
    'Jimmy Martin': 1,
    'Mac Wiseman': 1,
    'Don Reno': 1,
    'Red Smiley': 1,
    'The Osborne Brothers': 1,
    'Osborne Brothers': 1,
    'Jim and Jesse': 1,
    'Jim & Jesse': 1,

    # Tier 2: Classic bluegrass (1960s-1980s)
    'Doc Watson': 2,
    'The Country Gentlemen': 2,
    'The Seldom Scene': 2,
    'J.D. Crowe': 2,
    'J. D. Crowe': 2,
    'Tony Rice': 2,
    'Del McCoury': 2,
    'The Del McCoury Band': 2,
    'Ricky Skaggs': 2,
    'Doyle Lawson': 2,
    'Doyle Lawson & Quicksilver': 2,
    'New Grass Revival': 2,
    'Hot Rize': 2,
    'The Dillards': 2,
    'Kentucky Colonels': 2,
    'Clarence White': 2,
    'Roland White': 2,
    'Norman Blake': 2,
    'Vassar Clements': 2,
    'David Grisman': 2,
    'Peter Rowan': 2,
    'Sam Bush': 2,

    # Tier 3: Modern bluegrass (1990s+) - keep these at lower weight
    # because their repertoire includes more non-bluegrass material
}

# Cache for loaded artist database
_artist_database = None

# File paths
DATA_DIR = Path(__file__).parent.parent.parent.parent / 'docs' / 'data'
RECORDINGS_CACHE = DATA_DIR / 'bluegrass_recordings.json'
TAGGED_CACHE = DATA_DIR / 'bluegrass_tagged.json'
SCORES_FILE = DATA_DIR / 'grassiness_scores.json'
INDEX_FILE = DATA_DIR / 'index.jsonl'
ARTIST_DATABASE = DATA_DIR / 'bluegrass_artist_database.json'

# MusicBrainz tags that indicate bluegrass
BLUEGRASS_TAGS = [
    'bluegrass',
    'progressive bluegrass',
    'newgrass',
    'old-time',
    'appalachian',
]


def load_artist_database() -> Dict[str, int]:
    """
    Load artist database and compute tier weights.

    Returns:
        Dict mapping artist name -> tier weight
    """
    global _artist_database
    if _artist_database is not None:
        return _artist_database

    artists = {}

    # Load from database file if it exists
    if ARTIST_DATABASE.exists():
        with open(ARTIST_DATABASE) as f:
            db = json.load(f)

        for name, data in db.get('artists', {}).items():
            # Skip excluded artists
            if name in EXCLUDE_ARTISTS:
                continue

            # Check for manual override
            if name in TIER_OVERRIDES:
                tier = TIER_OVERRIDES[name]
            else:
                # Auto-tier based on era
                begin_year = data.get('begin_year')
                if begin_year is None:
                    tier = 3  # Unknown era = modern weight
                elif begin_year < 1960:
                    tier = 1  # Founding era
                elif begin_year < 1990:
                    tier = 2  # Classic era
                else:
                    tier = 3  # Modern era

            artists[name] = TIER_WEIGHTS[tier]

    # Add manual overrides that might not be in database
    for name, tier in TIER_OVERRIDES.items():
        if name not in EXCLUDE_ARTISTS:
            artists[name] = TIER_WEIGHTS[tier]

    _artist_database = artists
    return artists


def get_bluegrass_artists() -> Dict[str, int]:
    """
    Get the bluegrass artist -> weight mapping.

    Uses the artist database if available, otherwise falls back to
    manual overrides only.
    """
    return load_artist_database()


# =============================================================================
# Title Normalization (for fuzzy matching)
# =============================================================================

def normalize_title(title: str) -> str:
    """
    Normalize a song title for matching.

    - Lowercase
    - Remove accents
    - Remove punctuation except apostrophes
    - Normalize whitespace
    - Remove common prefixes/suffixes
    """
    if not title:
        return ''

    # Lowercase
    text = title.lower()

    # Normalize unicode (remove accents)
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')

    # Remove parenthetical suffixes like "(Live)" or "(Instrumental)"
    text = re.sub(r'\s*\([^)]*\)\s*$', '', text)

    # Remove quotes
    text = text.replace('"', '').replace("'", '')

    # Keep only alphanumeric and spaces
    text = re.sub(r'[^a-z0-9\s]', '', text)

    # Normalize whitespace
    text = ' '.join(text.split())

    # Remove common prefixes
    text = re.sub(r'^(the|a|an)\s+', '', text)

    return text.strip()


def normalize_artist(artist: str) -> str:
    """Normalize artist name for matching."""
    if not artist:
        return ''

    text = artist.lower()
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')

    # Handle "& " vs " and "
    text = text.replace(' & ', ' and ')

    # Remove "the " prefix
    text = re.sub(r'^the\s+', '', text)

    # Keep only alphanumeric and spaces
    text = re.sub(r'[^a-z0-9\s]', '', text)
    text = ' '.join(text.split())

    return text.strip()


# =============================================================================
# MusicBrainz Queries
# =============================================================================

def get_db_connection():
    """Get MusicBrainz database connection."""
    import psycopg2

    return psycopg2.connect(
        dbname=os.getenv("MB_DBNAME", "musicbrainz_db"),
        user=os.getenv("MB_USER", "musicbrainz"),
        password=os.getenv("MB_PASSWORD", "musicbrainz"),
        host=os.getenv("MB_HOST", "localhost"),
        port=os.getenv("MB_PORT", "5432"),
    )


def fetch_artist_recordings(artist_names: List[str]) -> Dict[str, List[Tuple[str, int]]]:
    """
    Fetch all recordings by the given artists from MusicBrainz.

    Returns:
        Dict mapping normalized_title -> [(artist_name, count), ...]
    """
    if not artist_names:
        return {}

    query = """
    WITH artist_ids AS (
        SELECT a.id, a.name
        FROM musicbrainz.artist a
        WHERE a.name = ANY(%s)
    )
    SELECT
        r.name as recording_name,
        ai.name as artist_name,
        COUNT(*) as recording_count
    FROM artist_ids ai
    JOIN musicbrainz.artist_credit_name acn ON acn.artist = ai.id
    JOIN musicbrainz.artist_credit ac ON acn.artist_credit = ac.id
    JOIN musicbrainz.recording r ON r.artist_credit = ac.id
    GROUP BY r.name, ai.name
    ORDER BY r.name
    """

    results = {}

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (artist_names,))

            for row in cur.fetchall():
                recording_name, artist_name, count = row
                normalized = normalize_title(recording_name)
                if not normalized:
                    continue

                if normalized not in results:
                    results[normalized] = []
                results[normalized].append((artist_name, int(count)))

    return results


def build_recordings_cache(output_file: Path = RECORDINGS_CACHE) -> Dict:
    """
    Build cache of all bluegrass artist recordings.

    This is the expensive operation (~5 min) that only needs to run occasionally.
    """
    import time

    bluegrass_artists = get_bluegrass_artists()
    print(f"Fetching recordings for {len(bluegrass_artists)} bluegrass artists...")
    start = time.time()

    artist_names = list(bluegrass_artists.keys())

    # Query in batches to avoid memory issues
    batch_size = 20
    all_recordings = {}

    for i in range(0, len(artist_names), batch_size):
        batch = artist_names[i:i + batch_size]
        print(f"  Batch {i // batch_size + 1}/{(len(artist_names) + batch_size - 1) // batch_size}: {batch[0]}...")

        recordings = fetch_artist_recordings(batch)
        for title, artists in recordings.items():
            if title not in all_recordings:
                all_recordings[title] = []
            all_recordings[title].extend(artists)

    elapsed = time.time() - start
    print(f"Fetched {len(all_recordings)} unique titles in {elapsed:.1f}s")

    # Save cache
    cache = {
        'recordings': all_recordings,
        'artists': bluegrass_artists,
        'version': 2,
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(cache, f)

    print(f"Saved to {output_file}")
    return cache


def load_recordings_cache(cache_file: Path = RECORDINGS_CACHE) -> Dict[str, List[Tuple[str, int]]]:
    """Load the bluegrass recordings cache."""
    if not cache_file.exists():
        raise FileNotFoundError(
            f"Recordings cache not found at {cache_file}. "
            "Run with --build-cache first."
        )

    with open(cache_file) as f:
        cache = json.load(f)

    return cache.get('recordings', {})


def fetch_tagged_recordings(tags: List[str] = BLUEGRASS_TAGS) -> Dict[str, int]:
    """
    Fetch all recordings tagged with bluegrass-related tags.

    Returns:
        Dict mapping normalized_title -> tag_score (sum of tag votes)
    """
    query = """
    SELECT
        r.name as recording_name,
        SUM(rt.count) as tag_score
    FROM musicbrainz.recording r
    JOIN musicbrainz.recording_tag rt ON rt.recording = r.id
    JOIN musicbrainz.tag t ON t.id = rt.tag
    WHERE lower(t.name) = ANY(%s)
    GROUP BY r.name
    HAVING SUM(rt.count) >= 1
    """

    results = {}

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, ([t.lower() for t in tags],))

            for row in cur.fetchall():
                recording_name, score = row
                normalized = normalize_title(recording_name)
                if not normalized:
                    continue

                # Keep highest score if title appears multiple times
                if normalized not in results or results[normalized] < score:
                    results[normalized] = int(score)

    return results


def fetch_tagged_releases(tags: List[str] = BLUEGRASS_TAGS) -> Dict[str, int]:
    """
    Fetch all recordings from releases tagged with bluegrass-related tags.

    This catches songs from albums tagged as bluegrass even if the
    individual recording isn't tagged.

    Returns:
        Dict mapping normalized_title -> tag_score
    """
    query = """
    SELECT
        r.name as recording_name,
        MAX(rgt.count) as tag_score
    FROM musicbrainz.recording r
    JOIN musicbrainz.track t ON t.recording = r.id
    JOIN musicbrainz.medium m ON t.medium = m.id
    JOIN musicbrainz.release rel ON m.release = rel.id
    JOIN musicbrainz.release_group rg ON rel.release_group = rg.id
    JOIN musicbrainz.release_group_tag rgt ON rgt.release_group = rg.id
    JOIN musicbrainz.tag tag ON tag.id = rgt.tag
    WHERE lower(tag.name) = ANY(%s)
    GROUP BY r.name
    HAVING MAX(rgt.count) >= 1
    """

    results = {}

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, ([t.lower() for t in tags],))

            for row in cur.fetchall():
                recording_name, score = row
                normalized = normalize_title(recording_name)
                if not normalized:
                    continue

                if normalized not in results or results[normalized] < score:
                    results[normalized] = int(score)

    return results


def build_tagged_cache(output_file: Path = TAGGED_CACHE) -> Dict:
    """
    Build cache of recordings/releases tagged as bluegrass.
    """
    import time

    print(f"Fetching bluegrass-tagged recordings...")
    start = time.time()

    # Get recording-level tags
    print("  Querying recording tags...")
    recording_tags = fetch_tagged_recordings()
    print(f"    Found {len(recording_tags)} recordings with bluegrass tags")

    # Get release-level tags (songs from bluegrass albums)
    print("  Querying release group tags...")
    release_tags = fetch_tagged_releases()
    print(f"    Found {len(release_tags)} recordings from bluegrass releases")

    # Merge: take max score from either source
    all_tagged = {}
    for title, score in recording_tags.items():
        all_tagged[title] = score
    for title, score in release_tags.items():
        if title not in all_tagged or all_tagged[title] < score:
            all_tagged[title] = score

    elapsed = time.time() - start
    print(f"Total: {len(all_tagged)} unique bluegrass-tagged titles in {elapsed:.1f}s")

    # Save cache
    cache = {
        'tagged': all_tagged,
        'tags_used': BLUEGRASS_TAGS,
        'version': 1,
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(cache, f)

    print(f"Saved to {output_file}")
    return cache


def load_tagged_cache(cache_file: Path = TAGGED_CACHE) -> Dict[str, int]:
    """Load the bluegrass-tagged recordings cache."""
    if not cache_file.exists():
        return {}  # Optional cache

    with open(cache_file) as f:
        cache = json.load(f)

    return cache.get('tagged', {})


# =============================================================================
# Scoring
# =============================================================================

def compute_grassiness(
    title: str,
    recordings_cache: Dict[str, List[Tuple[str, int]]],
    tagged_cache: Dict[str, int] = None
) -> Tuple[int, List[str], int]:
    """
    Compute grassiness score for a song title.

    Uses two signals:
    1. Curated artist covers (high confidence)
    2. MusicBrainz bluegrass tags (broader coverage)

    Returns:
        Tuple of (artist_score, list of bluegrass artists, tag_score)
    """
    normalized = normalize_title(title)
    if not normalized:
        return 0, [], 0

    # Signal 1: Artist covers
    artists = recordings_cache.get(normalized, [])
    artist_score = 0
    bluegrass_artists_found = []

    artist_weights = get_bluegrass_artists()
    for artist_name, count in artists:
        weight = artist_weights.get(artist_name, 0)
        if weight > 0:
            artist_score += weight * min(count, 3)
            bluegrass_artists_found.append(artist_name)

    # Signal 2: MusicBrainz tags
    tag_score = 0
    if tagged_cache:
        tag_score = tagged_cache.get(normalized, 0)

    return artist_score, bluegrass_artists_found, tag_score


def combined_score(artist_score: int, tag_score: int) -> int:
    """
    Combine artist and tag scores into a single grassiness score.

    Artist score is weighted higher (direct evidence).
    Tag score provides a boost for songs with community tagging.
    """
    # Artist score is primary (0-100+ range)
    # Tag score provides a boost (typically 1-10 range)
    return artist_score + min(tag_score, 10)


def score_index(
    index_file: Path = INDEX_FILE,
    recordings_cache: Dict = None,
    tagged_cache: Dict = None,
    output_file: Path = SCORES_FILE
) -> Dict[str, Dict]:
    """
    Score all songs in the index.

    Returns:
        Dict mapping song_id -> {score, artist_score, tag_score, artists, title}
    """
    if recordings_cache is None:
        recordings_cache = load_recordings_cache()
    if tagged_cache is None:
        tagged_cache = load_tagged_cache()

    print(f"Scoring songs from {index_file}...")
    print(f"  Using {len(recordings_cache)} artist recordings")
    print(f"  Using {len(tagged_cache)} tagged recordings")

    scores = {}
    total = 0
    with_artist_score = 0
    with_tag_score = 0

    with open(index_file) as f:
        for line in f:
            song = json.loads(line)
            total += 1

            title = song.get('title', '')
            song_id = song.get('id', '')

            if not title or not song_id:
                continue

            artist_score, artists, tag_score = compute_grassiness(
                title, recordings_cache, tagged_cache
            )
            total_score = combined_score(artist_score, tag_score)

            if total_score > 0:
                if artist_score > 0:
                    with_artist_score += 1
                if tag_score > 0:
                    with_tag_score += 1

                scores[song_id] = {
                    'score': total_score,
                    'artist_score': artist_score,
                    'tag_score': tag_score,
                    'artists': artists,
                    'title': title,
                }

    print(f"Scored {total} songs:")
    print(f"  {with_artist_score} with artist covers")
    print(f"  {with_tag_score} with bluegrass tags")
    print(f"  {len(scores)} total with grassiness > 0")

    # Save scores
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(scores, f, indent=2)

    print(f"Saved to {output_file}")

    return scores


# =============================================================================
# CLI
# =============================================================================

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(
        description='Compute grassiness scores for bluegrass detection',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--build-cache', action='store_true',
                        help='Build bluegrass artist recordings cache from MusicBrainz')
    parser.add_argument('--build-tagged', action='store_true',
                        help='Build bluegrass-tagged recordings cache from MusicBrainz')
    parser.add_argument('--build-all', action='store_true',
                        help='Build both caches')
    parser.add_argument('--score-index', action='store_true',
                        help='Score songs in the index using the caches')
    parser.add_argument('--test', action='store_true',
                        help='Test with sample songs')
    parser.add_argument('--lookup', type=str,
                        help='Look up grassiness for a specific title')

    args = parser.parse_args()

    if args.build_cache or args.build_all:
        build_recordings_cache()

    if args.build_tagged or args.build_all:
        build_tagged_cache()

    if args.score_index:
        scores = score_index()

        # Show top scores
        print("\nTop 30 bluegrass standards:")
        sorted_scores = sorted(scores.items(), key=lambda x: -x[1]['score'])
        for song_id, data in sorted_scores[:30]:
            artists = ', '.join(data['artists'][:3])
            if len(data['artists']) > 3:
                artists += f" +{len(data['artists']) - 3}"
            a_score = data.get('artist_score', data['score'])
            t_score = data.get('tag_score', 0)
            print(f"  {data['score']:3d} (a:{a_score:2d} t:{t_score:2d}) | {data['title'][:35]:<35} | {artists}")

    elif args.test:
        recordings = load_recordings_cache()
        tagged = load_tagged_cache()

        test_songs = [
            "Blue Moon of Kentucky",
            "Foggy Mountain Breakdown",
            "Rocky Top",
            "Jolene",
            "Ring of Fire",
            "Your Cheatin' Heart",
            "Roll in My Sweet Baby's Arms",
            "Man of Constant Sorrow",
            "Silver Dagger",  # Dolly's bluegrass album
            "Little Sparrow",  # Dolly's bluegrass album
        ]

        print("Testing grassiness scores:\n")
        print(f"{'Title':<35} | {'Total':>5} | {'Artist':>6} | {'Tag':>4} | Artists")
        print("-" * 90)
        for title in test_songs:
            artist_score, artists, tag_score = compute_grassiness(title, recordings, tagged)
            total = combined_score(artist_score, tag_score)
            artist_str = ', '.join(artists[:3]) if artists else '-'
            print(f"{title:<35} | {total:>5} | {artist_score:>6} | {tag_score:>4} | {artist_str}")

    elif args.lookup:
        recordings = load_recordings_cache()
        tagged = load_tagged_cache()
        artist_score, artists, tag_score = compute_grassiness(args.lookup, recordings, tagged)
        total = combined_score(artist_score, tag_score)
        print(f"Title: {args.lookup}")
        print(f"Normalized: {normalize_title(args.lookup)}")
        print(f"Total Score: {total}")
        print(f"  Artist Score: {artist_score}")
        print(f"  Tag Score: {tag_score}")
        print(f"Artists: {', '.join(artists) if artists else 'none'}")

    elif not (args.build_cache or args.build_tagged or args.build_all):
        parser.print_help()
