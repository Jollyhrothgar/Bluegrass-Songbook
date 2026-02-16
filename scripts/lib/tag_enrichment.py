#!/usr/bin/env python3
"""
Tag enrichment for the Bluegrass Songbook.

Primary source: LLM-generated tags from llm_tags.json (Claude Batch API)
Secondary: Harmonic analysis for JamFriendly, Modal, Jazzy
Fallback: MusicBrainz artist tags (only if llm_tags.json missing)

Tag overrides from trusted user votes exclude incorrect tags.
Grassiness scores provide covering_artists data for display.
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
ARTIST_TAGS_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'artist_tags.json'
GRASSINESS_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'grassiness_scores.json'
TAG_OVERRIDES_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'tag_overrides.json'
LLM_TAGS_FILE = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'llm_tags.json'


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

    # Rock (for non-country covers)
    'rock': 'Rock',
    'alternative': 'Rock',
    'alternative rock': 'Rock',
    'punk': 'Rock',
    'punk rock': 'Rock',
    'indie': 'Rock',
    'indie rock': 'Rock',
    'grunge': 'Rock',
    'metal': 'Rock',
    'hard rock': 'Rock',
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


# =============================================================================
# Tag Overrides (Trusted User Votes)
# =============================================================================

_tag_overrides_cache = None

def load_tag_overrides() -> dict:
    """Load tag overrides from trusted user votes.

    Returns:
        Dict mapping song_id -> [list of tags to exclude]
    """
    global _tag_overrides_cache
    if _tag_overrides_cache is not None:
        return _tag_overrides_cache

    if TAG_OVERRIDES_FILE.exists():
        try:
            with open(TAG_OVERRIDES_FILE, 'r') as f:
                data = json.load(f)
                _tag_overrides_cache = data.get('exclude', {})
                return _tag_overrides_cache
        except Exception as e:
            print(f"Warning: Could not load tag overrides: {e}")

    _tag_overrides_cache = {}
    return _tag_overrides_cache


# =============================================================================
# LLM Tags (Primary Tag Source)
# =============================================================================

_llm_tags_cache = None

def load_llm_tags() -> dict:
    """Load LLM-generated tags from disk.

    Returns:
        Dict mapping song_id -> [list of tag names]
    """
    global _llm_tags_cache
    if _llm_tags_cache is not None:
        return _llm_tags_cache

    if LLM_TAGS_FILE.exists():
        try:
            with open(LLM_TAGS_FILE, 'r') as f:
                _llm_tags_cache = json.load(f)
                return _llm_tags_cache
        except Exception as e:
            print(f"Warning: Could not load LLM tags: {e}")

    _llm_tags_cache = {}
    return _llm_tags_cache


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

    Primary source: LLM-generated tags from llm_tags.json
    Secondary: Harmonic analysis for JamFriendly, Modal, Jazzy
    Also: Tag overrides from trusted user votes

    Args:
        songs: List of song dicts with 'id', 'artist', 'title', 'content', 'key', 'nashville'
        use_musicbrainz: Ignored (kept for API compatibility).

    Returns:
        Same list with 'tags' field added to each song
    """
    # Load LLM tags (primary source)
    llm_tags = load_llm_tags()
    llm_tagged = 0
    songs_tagged = 0

    if llm_tags:
        print(f"  LLM tags: {len(llm_tags)} songs in llm_tags.json")
    else:
        print("  Warning: No LLM tags found, falling back to MusicBrainz")
        # Fall back to old behavior if no LLM tags
        artist_tags = load_artist_tags()

    # Pre-load grassiness scores for covering_artists data (display only, not for tagging)
    scores = load_grassiness_scores()
    from tagging.grassiness import normalize_title, get_bluegrass_artists
    artist_tier_weights = get_bluegrass_artists()

    # Prominence order for sorting (famous bluegrass founders first as tiebreaker)
    PROMINENCE_ORDER = {
        'Bill Monroe': 0,
        'Bill Monroe & His Blue Grass Boys': 1,
        'The Stanley Brothers': 2,
        'Stanley Brothers': 3,
        'Ralph Stanley': 4,
        'Carter Stanley': 5,
        'Lester Flatt': 6,
        'Earl Scruggs': 7,
        'Flatt & Scruggs': 8,
        'Flatt and Scruggs': 9,
    }

    def artist_sort_key(artist_data):
        """Sort by: earliest year first, then tier weight (descending), then prominence.

        artist_data can be:
        - dict with 'name' and 'year' keys (new format)
        - string (old format, no year data)
        """
        if isinstance(artist_data, dict):
            name = artist_data.get('name', '')
            year = artist_data.get('year', 9999)
        else:
            name = artist_data
            year = 9999

        tier_weight = artist_tier_weights.get(name, 0)
        prominence = PROMINENCE_ORDER.get(name, 1000)
        return (year, -tier_weight, prominence, name.lower())

    scores_by_title = {}
    for data in scores.values():
        norm_title = normalize_title(data.get('title', ''))
        if norm_title and norm_title not in scores_by_title:
            scores_by_title[norm_title] = data

    # Load trusted user tag overrides (downvotes)
    tag_overrides = load_tag_overrides()
    if tag_overrides:
        print(f"  Tag overrides: {len(tag_overrides)} songs with exclusions from trusted user votes")

    # Process each song
    for song in songs:
        # Seed with existing tags from work.yaml (source: 'work')
        tags = {k: v for k, v in song.get('tags', {}).items()
                if isinstance(v, dict) and v.get('source') == 'work'}
        song_id = song.get('id', '')
        title = song.get('title', '')

        # PRIMARY: Get genre tags from LLM (overrides work.yaml tags)
        if llm_tags and song_id in llm_tags:
            for tag_name in llm_tags[song_id]:
                tags[tag_name] = {'score': 80, 'source': 'llm'}
            llm_tagged += 1
        elif not llm_tags:
            # Fallback to MusicBrainz if no LLM tags file
            artist = song.get('artist', '')
            if artist and artist in artist_tags:
                mb_tags = artist_tags[artist]
                mapped_tags = filter_and_map_mb_tags(mb_tags)
                tags.update(mapped_tags)

        # Add harmonic analysis tags (JamFriendly, Modal, Jazzy)
        if song.get('content'):
            from build_index import extract_chords
            chords = extract_chords(song['content'])
            harmonic_tags = compute_harmonic_tags(
                chords,
                song.get('key'),
                song.get('nashville', [])
            )
            # Merge - harmonic tags supplement LLM tags
            for tag, data in harmonic_tags.items():
                if tag not in tags:
                    tags[tag] = data

        # Add Instrumental tag for tunes (has ABC notation, minimal lyrics)
        if song.get('is_instrumental') and 'Instrumental' not in tags:
            tags['Instrumental'] = {'score': 90, 'source': 'content'}

        # Add covering artists from grassiness data (for search and display only)
        covering_artists_raw = []
        if song_id in scores:
            covering_artists_raw = scores[song_id].get('artists', [])
        else:
            normalized = normalize_title(title)
            if normalized in scores_by_title:
                covering_artists_raw = scores_by_title[normalized].get('artists', [])

        if covering_artists_raw:
            # Deduplicate by artist name
            seen = set()
            unique_artists = []
            for a in covering_artists_raw:
                # Handle both new format (dict) and old format (string)
                name = a.get('name') if isinstance(a, dict) else a
                if name and name not in seen:
                    seen.add(name)
                    unique_artists.append(a)

            # Sort by: earliest year, tier weight (desc), prominence, alphabetically
            unique_artists.sort(key=artist_sort_key)

            # Extract just names for the index (frontend expects list of strings)
            song['covering_artists'] = [
                a.get('name') if isinstance(a, dict) else a
                for a in unique_artists
            ]

        # Remove excluded tags (from work.yaml exclude_tags field)
        exclude_tags = song.get('exclude_tags', [])
        for tag in exclude_tags:
            if tag in tags:
                del tags[tag]
        if 'exclude_tags' in song:
            del song['exclude_tags']

        # Remove tags downvoted by trusted users (from tag_overrides.json)
        db_exclude_tags = tag_overrides.get(song_id, [])
        for tag in db_exclude_tags:
            if tag in tags:
                del tags[tag]

        song['tags'] = tags
        if tags:
            songs_tagged += 1

    print(f"  LLM tagged: {llm_tagged} songs")

    return songs


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Tag enrichment utilities')
    parser.add_argument('--stats', action='store_true',
                        help='Show tag cache statistics')
    args = parser.parse_args()

    if args.stats:
        llm_tags = load_llm_tags()
        print(f"LLM tags: {len(llm_tags)} songs")
        tag_counts = {}
        for song_id, tags in llm_tags.items():
            for tag in tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        print("Top tags:")
        for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])[:15]:
            print(f"  {tag}: {count}")

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
