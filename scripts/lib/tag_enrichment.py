#!/usr/bin/env python3
"""
Tag enrichment for the Bluegrass Songbook.

Provides genre tagging from MusicBrainz and harmonic analysis for vibe tags.

Tag Persistence:
- MusicBrainz is only available locally (not on GitHub Actions)
- Tags are cached in docs/data/tags.json and checked into git
- Local builds update the cache with new tags
- GitHub builds read from the cache
"""

import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Optional

# Add MusicBrainz query module to path
MB_PATH = '/Users/mike/workspace/music_brainz/mb-db/scripts/lib'
if os.path.exists(MB_PATH):
    sys.path.insert(0, MB_PATH)

# Tag data file locations
TAGS_CACHE_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'tags.json'
ARTIST_TAGS_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'artist_tags.json'
GRASSINESS_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'grassiness_scores.json'


# =============================================================================
# Tag Taxonomy
# =============================================================================

# Map source genre strings (from TuneArch x_genre) to our taxonomy
SOURCE_GENRE_MAP = {
    'bluegrass': 'Bluegrass',
    'old-time': 'OldTime',
    'old time': 'OldTime',
    'oldtime': 'OldTime',
    'gospel': 'Gospel',
    'folk': 'Folk',
    'country': 'ClassicCountry',
    'western swing': 'WesternSwing',
}

# Map MusicBrainz tags to our taxonomy
MB_TO_TAXONOMY = {
    # Primary Genres
    'bluegrass': 'Bluegrass',
    'progressive bluegrass': 'Bluegrass',
    'newgrass': 'Bluegrass',

    'old-time': 'OldTime',
    'old time': 'OldTime',
    'appalachian': 'OldTime',
    'appalachian folk': 'OldTime',

    'gospel': 'Gospel',
    'christian': 'Gospel',
    'southern gospel': 'Gospel',

    'folk': 'Folk',
    'american folk': 'Folk',
    'folk rock': 'Folk',
    'singer-songwriter': 'Folk',

    'country': 'ClassicCountry',
    'classic country': 'ClassicCountry',

    # Classic Country Sub-Genres
    'honky tonk': 'HonkyTonk',
    'honky-tonk': 'HonkyTonk',

    'bakersfield sound': 'Bakersfield',

    'outlaw country': 'Outlaw',

    'western swing': 'WesternSwing',

    'nashville sound': 'NashvilleSound',
    'countrypolitan': 'NashvilleSound',

    # Outliers
    'rockabilly': 'Rockabilly',
    'rock and roll': 'Rockabilly',

    'pop': 'Pop',
    'soft rock': 'Pop',
    'adult contemporary': 'Pop',

    'jazz': 'Jazz',
    'swing': 'Jazz',
}

# Tags we allow from MusicBrainz (lowercased for matching)
ALLOWED_MB_TAGS = set(MB_TO_TAXONOMY.keys())

# Sub-genres that should also add parent genre
SUBGENRE_PARENTS = {
    'HonkyTonk': 'ClassicCountry',
    'Bakersfield': 'ClassicCountry',
    'Outlaw': 'ClassicCountry',
    'WesternSwing': 'ClassicCountry',
    'NashvilleSound': 'ClassicCountry',
}

# Complex chord patterns that indicate non-jam-friendly songs
COMPLEX_PATTERNS = [
    r'maj7', r'min7', r'm7', r'7sus', r'sus[24]',
    r'dim', r'aug', r'add\d+', r'6', r'9', r'11', r'13',
    r'/[A-G][#b]?',  # Slash chords
]


# =============================================================================
# MusicBrainz Integration
# =============================================================================

def mb_score_to_local(mb_votes: int) -> int:
    """Map MusicBrainz vote counts to our 1-100 scale.

    MB votes range from 1 to ~1000+ for popular tags.
    Logarithmic scale:
    - 1-2 votes → 30-40
    - 5-10 votes → 50-60
    - 20+ votes → 70-80
    - 100+ votes → 90+
    """
    if mb_votes <= 0:
        return 0
    # log2 scale, capped at 95
    return min(95, 30 + int(15 * math.log2(mb_votes)))


def filter_and_map_mb_tags(tags: list[tuple[str, int]]) -> dict[str, dict]:
    """Filter MusicBrainz tags to our taxonomy and map to our format.

    Args:
        tags: List of (tag_name, vote_count) from MusicBrainz

    Returns:
        Dict of {TagName: {"score": int, "source": "musicbrainz"}}
    """
    result = {}

    for tag_name, vote_count in tags:
        tag_lower = tag_name.lower()

        if tag_lower in MB_TO_TAXONOMY:
            our_tag = MB_TO_TAXONOMY[tag_lower]
            score = mb_score_to_local(vote_count)

            # Keep highest score if tag appears multiple times
            if our_tag not in result or result[our_tag]['score'] < score:
                result[our_tag] = {'score': score, 'source': 'musicbrainz'}

            # Add parent genre for sub-genres
            if our_tag in SUBGENRE_PARENTS:
                parent = SUBGENRE_PARENTS[our_tag]
                parent_score = max(score - 10, 30)  # Slightly lower score for inferred parent
                if parent not in result or result[parent]['score'] < parent_score:
                    result[parent] = {'score': parent_score, 'source': 'musicbrainz'}

    return result


# =============================================================================
# Artist Tags (Static Lookup)
# =============================================================================

_artist_tags_cache = None

def load_artist_tags() -> dict:
    """Load pre-computed artist tags from disk.

    Returns:
        Dict mapping artist_name -> list of (tag, score) tuples
    """
    global _artist_tags_cache
    if _artist_tags_cache is not None:
        return _artist_tags_cache

    if ARTIST_TAGS_FILE.exists():
        try:
            with open(ARTIST_TAGS_FILE, 'r') as f:
                _artist_tags_cache = json.load(f)
                return _artist_tags_cache
        except Exception as e:
            print(f"Warning: Could not load artist tags: {e}")

    _artist_tags_cache = {}
    return _artist_tags_cache


def get_tags_for_artist(artist_name: str) -> dict[str, dict]:
    """Get tags for an artist from the static lookup.

    Args:
        artist_name: Artist name to look up

    Returns:
        Dict of {TagName: {"score": int, "source": "musicbrainz"}}
    """
    artist_tags = load_artist_tags()
    mb_tags = artist_tags.get(artist_name, [])
    return filter_and_map_mb_tags(mb_tags)


# =============================================================================
# Tag Cache (Persistence Layer)
# =============================================================================

def load_tag_cache() -> dict:
    """Load cached tags from disk.

    Returns:
        Dict mapping song_id -> {TagName: {"score": int, "source": str}}
    """
    if TAGS_CACHE_FILE.exists():
        try:
            with open(TAGS_CACHE_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Could not load tag cache: {e}")
    return {}


def save_tag_cache(cache: dict):
    """Save tag cache to disk.

    Args:
        cache: Dict mapping song_id -> tags dict
    """
    TAGS_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TAGS_CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=2, sort_keys=True)
    print(f"Saved tag cache: {len(cache)} songs")


def get_mb_connection():
    """Get MusicBrainz database connection if available."""
    try:
        from query_tags import get_connection
        # Set port from environment (default to 5440 for our setup)
        os.environ.setdefault('MB_PORT', '5440')
        conn = get_connection()
        return conn
    except Exception as e:
        print(f"MusicBrainz connection not available: {e}")
        return None


def batch_query_mb_tags(songs: list[tuple[str, str]], min_score: int = 2) -> dict:
    """Query MusicBrainz for tags on a batch of songs.

    Args:
        songs: List of (artist, title) tuples
        min_score: Minimum MB vote count to include

    Returns:
        Dict mapping (artist, title) -> {TagName: {"score": int, "source": "musicbrainz"}}
    """
    try:
        from query_tags import query_tags_grouped
        os.environ.setdefault('MB_PORT', '5440')

        raw_results = query_tags_grouped(songs, min_score=min_score, max_tags_per_song=10)

        # Convert to our format
        mapped = {}
        for (artist, title), tags in raw_results.items():
            mapped[(artist, title)] = filter_and_map_mb_tags(tags)

        return mapped
    except Exception as e:
        print(f"MusicBrainz query failed: {e}")
        return {}


# =============================================================================
# Grassiness Scores (Bluegrass Detection)
# =============================================================================

_grassiness_cache = None

def load_grassiness_scores() -> dict:
    """Load pre-computed grassiness scores from disk.

    Returns:
        Dict mapping song_id -> {score, artist_score, tag_score, artists, title}
    """
    global _grassiness_cache
    if _grassiness_cache is not None:
        return _grassiness_cache

    if GRASSINESS_FILE.exists():
        try:
            with open(GRASSINESS_FILE, 'r') as f:
                _grassiness_cache = json.load(f)
                return _grassiness_cache
        except Exception as e:
            print(f"Warning: Could not load grassiness scores: {e}")

    _grassiness_cache = {}
    return _grassiness_cache


def get_grassiness_tags(song_id: str, title: str, scores: dict = None, scores_by_title: dict = None) -> tuple[dict, int]:
    """Get bluegrass tags based on grassiness score.

    Uses song_id first, falls back to title-based lookup.

    Args:
        song_id: Song ID to look up
        title: Song title for fallback lookup
        scores: Optional pre-loaded scores dict (avoids re-loading)
        scores_by_title: Optional pre-computed title lookup dict (avoids O(n) search)

    Returns:
        Tuple of (tags_dict, grassiness_score)
        tags_dict: {TagName: {"score": int, "source": "grassiness"}}
    """
    if scores is None:
        scores = load_grassiness_scores()
    tags = {}
    grassiness = 0

    # Try song_id first
    if song_id in scores:
        grassiness = scores[song_id].get('score', 0)
    elif scores_by_title is not None:
        # Use pre-computed title lookup (O(1))
        from tagging.grassiness import normalize_title
        normalized = normalize_title(title)
        if normalized in scores_by_title:
            grassiness = scores_by_title[normalized].get('score', 0)
    else:
        # Fallback to O(n) search if no pre-computed lookup provided
        from tagging.grassiness import normalize_title
        normalized = normalize_title(title)
        for sid, data in scores.items():
            if normalize_title(data.get('title', '')) == normalized:
                grassiness = data.get('score', 0)
                break

    # Apply tags based on thresholds (derived from core artist analysis)
    # >= 50: Top 37% of core bluegrass artist recordings
    # >= 20: Top 71% of core bluegrass artist recordings
    if grassiness >= 50:
        tags['BluegrassStandard'] = {'score': 90, 'source': 'grassiness'}
        tags['Bluegrass'] = {'score': 85, 'source': 'grassiness'}
    elif grassiness >= 20:
        tags['Bluegrass'] = {'score': 70, 'source': 'grassiness'}

    return tags, grassiness


# =============================================================================
# Harmonic Analysis Tags
# =============================================================================

def has_complex_chords(chords: list[str]) -> bool:
    """Check if song has complex chord extensions."""
    for chord in chords:
        for pattern in COMPLEX_PATTERNS:
            if re.search(pattern, chord, re.IGNORECASE):
                return True
    return False


def has_flat_seven(unique_chords: set[str], key: str) -> bool:
    """Check if song has bVII chord (modal/mountain sound).

    bVII is a major chord built on the flattened 7th degree.
    In G: bVII = F
    In C: bVII = Bb
    In D: bVII = C
    """
    if not key:
        return False

    # Map keys to their bVII chord roots
    FLAT_SEVEN_MAP = {
        'G': 'F', 'C': 'Bb', 'D': 'C', 'A': 'G', 'E': 'D', 'B': 'A',
        'F': 'Eb', 'Bb': 'Ab', 'Eb': 'Db', 'Ab': 'Gb', 'Db': 'Cb',
        'Am': 'G', 'Em': 'D', 'Bm': 'A', 'F#m': 'E', 'C#m': 'B',
        'Dm': 'C', 'Gm': 'F', 'Cm': 'Bb', 'Fm': 'Eb', 'Bbm': 'Ab',
    }

    flat_seven = FLAT_SEVEN_MAP.get(key)
    if not flat_seven:
        return False

    # Check if any chord starts with the bVII root (major chord)
    for chord in unique_chords:
        if chord.startswith(flat_seven) and 'm' not in chord.lower():
            return True

    return False


def compute_harmonic_tags(chords: list[str], key: Optional[str], nashville: list[str]) -> dict[str, dict]:
    """Compute harmonic analysis tags.

    Args:
        chords: Raw chord list from song
        key: Detected key (e.g., "G", "Am")
        nashville: Unique Nashville numbers

    Returns:
        Dict of {TagName: {"score": int, "source": "harmonic"}}
    """
    tags = {}
    unique_chords = set(chords)
    unique_count = len(unique_chords)

    # Check for basic I-IV-V chords
    has_basic = any(n in ['I', 'IV', 'V', 'i', 'iv', 'v'] for n in nashville)

    # JamFriendly: ≤5 unique chords AND has basic chords
    if unique_count <= 5 and has_basic and not has_complex_chords(chords):
        tags['JamFriendly'] = {'score': 50, 'source': 'harmonic'}

    # Modal: Has bVII chord
    if has_flat_seven(unique_chords, key):
        tags['Modal'] = {'score': 75, 'source': 'harmonic'}

    # Jazzy: Has complex extensions
    if has_complex_chords(chords):
        tags['Jazzy'] = {'score': 75, 'source': 'harmonic'}
        # Remove JamFriendly if present (complex songs aren't jam-friendly)
        tags.pop('JamFriendly', None)

    return tags


# =============================================================================
# Main Enrichment Function
# =============================================================================

def enrich_songs_with_tags(songs: list[dict], use_musicbrainz: bool = True) -> list[dict]:
    """Add tags to a list of song dicts.

    Uses artist-based tagging from pre-computed artist_tags.json plus
    harmonic analysis for vibe tags.

    Args:
        songs: List of song dicts with 'id', 'artist', 'title', 'content', 'key', 'nashville'
        use_musicbrainz: Ignored (kept for API compatibility). Uses artist_tags.json.

    Returns:
        Same list with 'tags' field added to each song
    """
    # Load artist tags (fast - single file load)
    artist_tags = load_artist_tags()
    artists_found = 0
    songs_tagged = 0

    # Pre-load grassiness scores and build title lookup (avoids O(n*m) nested loop)
    scores = load_grassiness_scores()
    from tagging.grassiness import normalize_title, get_bluegrass_artists
    artist_tier_weights = get_bluegrass_artists()  # {artist_name: tier_weight} for sorting
    scores_by_title = {}
    for data in scores.values():
        norm_title = normalize_title(data.get('title', ''))
        if norm_title and norm_title not in scores_by_title:
            scores_by_title[norm_title] = data

    # Process each song
    for song in songs:
        tags = {}

        # Get genre tags from artist lookup
        artist = song.get('artist', '')
        if artist and artist in artist_tags:
            mb_tags = artist_tags[artist]
            mapped_tags = filter_and_map_mb_tags(mb_tags)
            tags.update(mapped_tags)
            artists_found += 1

        # Add harmonic analysis tags
        if song.get('content'):
            from build_index import extract_chords
            chords = extract_chords(song['content'])
            harmonic_tags = compute_harmonic_tags(
                chords,
                song.get('key'),
                song.get('nashville', [])
            )
            # Merge - harmonic tags don't override genre tags
            for tag, data in harmonic_tags.items():
                if tag not in tags:
                    tags[tag] = data

        # Add Instrumental tag for tunes (has ABC notation, minimal lyrics)
        if song.get('is_instrumental'):
            tags['Instrumental'] = {'score': 90, 'source': 'content'}

        # Add genre tags from source metadata (e.g., TuneArch x_genre)
        if song.get('source_genres'):
            for genre in song['source_genres'].split(','):
                genre_lower = genre.strip().lower()
                if genre_lower in SOURCE_GENRE_MAP:
                    our_tag = SOURCE_GENRE_MAP[genre_lower]
                    if our_tag not in tags:
                        tags[our_tag] = {'score': 70, 'source': 'metadata'}

        # Add grassiness-based bluegrass tags
        song_id = song.get('id', '')
        title = song.get('title', '')
        grassiness_tags, grassiness_score = get_grassiness_tags(song_id, title, scores, scores_by_title)
        for tag, data in grassiness_tags.items():
            # Grassiness can override artist-based tags with higher confidence
            if tag not in tags or data['score'] > tags[tag].get('score', 0):
                tags[tag] = data
        if grassiness_score > 0:
            song['grassiness'] = grassiness_score

        # Add covering artists from grassiness data (for search and display)
        # Use same lookup strategy as get_grassiness_tags: ID first, then title fallback
        covering_artists_raw = []
        if song_id in scores:
            covering_artists_raw = scores[song_id].get('artists', [])
        else:
            # Use pre-computed title lookup
            normalized = normalize_title(title)
            if normalized in scores_by_title:
                covering_artists_raw = scores_by_title[normalized].get('artists', [])

        # Dedupe and sort by tier weight (higher tier = more important bluegrass artist)
        if covering_artists_raw:
            seen = set()
            unique_artists = []
            for a in covering_artists_raw:
                if a not in seen:
                    seen.add(a)
                    unique_artists.append(a)
            # Sort by tier weight (descending) - founding artists first, then classic, then modern
            unique_artists.sort(key=lambda a: -artist_tier_weights.get(a, 0))
            song['covering_artists'] = unique_artists

        song['tags'] = tags
        if tags:
            songs_tagged += 1

    print(f"  Artist lookups: {artists_found} found in artist_tags.json")

    return songs


def find_songs_needing_tags(songs: list[dict]) -> list[dict]:
    """Find songs that need MusicBrainz tag lookup.

    Args:
        songs: List of song dicts with 'id', 'artist', 'title'

    Returns:
        List of songs not in cache that have an artist
    """
    tag_cache = load_tag_cache()
    needing_tags = []

    for song in songs:
        song_id = song.get('id', '')
        if song_id not in tag_cache and song.get('artist'):
            needing_tags.append(song)

    return needing_tags


def refresh_missing_tags(songs: list[dict], batch_size: int = 500) -> dict:
    """Query MusicBrainz for songs missing from cache.

    Args:
        songs: List of song dicts with 'id', 'artist', 'title'
        batch_size: Number of songs to process per batch

    Returns:
        Dict of new tags added to cache
    """
    import sys

    tag_cache = load_tag_cache()
    needing_lookup = find_songs_needing_tags(songs)

    if not needing_lookup:
        print("All songs are already in cache.")
        return {}

    print(f"Found {len(needing_lookup)} songs needing MusicBrainz lookup...")
    sys.stdout.flush()

    # Process in batches with progress
    all_new_tags = {}
    total_batches = (len(needing_lookup) + batch_size - 1) // batch_size

    for batch_num in range(total_batches):
        start_idx = batch_num * batch_size
        end_idx = min(start_idx + batch_size, len(needing_lookup))
        batch = needing_lookup[start_idx:end_idx]

        print(f"  Batch {batch_num + 1}/{total_batches} ({start_idx}-{end_idx})...", end=' ')
        sys.stdout.flush()

        # Query MusicBrainz for this batch
        query_pairs = [(s.get('artist', ''), s.get('title', '')) for s in batch]
        try:
            mb_results = batch_query_mb_tags(query_pairs)
        except Exception as e:
            print(f"ERROR: {e}")
            continue

        # Update cache with results
        batch_tags = 0
        for song in batch:
            song_id = song.get('id', '')
            key = (song.get('artist', ''), song.get('title', ''))
            if key in mb_results:
                tag_cache[song_id] = {'mb_tags': mb_results[key]}
                all_new_tags[song_id] = mb_results[key]
                batch_tags += 1
            else:
                # Mark as checked (empty dict means no MB tags found)
                tag_cache[song_id] = {'mb_tags': {}}

        print(f"{batch_tags} tags found")
        sys.stdout.flush()

        # Save cache after each batch
        save_tag_cache(tag_cache)

    print(f"\nTotal: Added tags for {len(all_new_tags)} songs")
    return all_new_tags


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Tag enrichment utilities')
    parser.add_argument('--list-missing', action='store_true',
                        help='List songs missing from tag cache')
    parser.add_argument('--refresh-missing', action='store_true',
                        help='Query MusicBrainz for songs missing from cache')
    parser.add_argument('--stats', action='store_true',
                        help='Show tag cache statistics')
    args = parser.parse_args()

    if args.stats:
        cache = load_tag_cache()
        print(f"Tag cache: {len(cache)} songs")
        tag_counts = {}
        songs_with_tags = 0
        for song_id, data in cache.items():
            mb_tags = data.get('mb_tags', {})
            if mb_tags:
                songs_with_tags += 1
                for tag in mb_tags:
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1
        print(f"Songs with MB tags: {songs_with_tags}")
        print("Top tags:")
        for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])[:10]:
            print(f"  {tag}: {count}")

    elif args.list_missing or args.refresh_missing:
        # Load songs from index
        from pathlib import Path
        import json

        index_file = Path('docs/data/index.jsonl')
        if not index_file.exists():
            print("Index file not found. Run build_index.py first.")
            exit(1)

        songs = []
        with open(index_file) as f:
            for line in f:
                songs.append(json.loads(line))

        if args.list_missing:
            missing = find_songs_needing_tags(songs)
            print(f"Songs missing from cache: {len(missing)}")
            for song in missing[:20]:
                print(f"  {song.get('artist', 'Unknown')} - {song.get('title', 'Unknown')}")
            if len(missing) > 20:
                print(f"  ... and {len(missing) - 20} more")

        elif args.refresh_missing:
            refresh_missing_tags(songs)

    else:
        # Default: test with sample songs
        test_songs = [
            {
                'id': 'test1',
                'title': 'Blue Moon of Kentucky',
                'artist': 'Bill Monroe',
                'content': '[G]Blue moon of [C]Kentucky keep on [G]shining',
                'key': 'G',
                'nashville': ['I', 'IV'],
            },
            {
                'id': 'test2',
                'title': 'Your Cheatin Heart',
                'artist': 'Hank Williams',
                'content': '[G]Your cheatin [C]heart will make you [G]weep',
                'key': 'G',
                'nashville': ['I', 'IV'],
            },
        ]

        enriched = enrich_songs_with_tags(test_songs)
        for song in enriched:
            print(f"\n{song['artist']} - {song['title']}:")
            for tag, data in song.get('tags', {}).items():
                print(f"  {tag}: {data}")
