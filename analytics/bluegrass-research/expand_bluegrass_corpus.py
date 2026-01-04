#!/usr/bin/env python3
"""
Expand the bluegrass corpus through relationship-based discovery.

Strategy:
1. Start with seed corpus (golden-standard songs + authoritative artists)
2. Find all covers/versions of seed songs by other artists
3. Find artists who frequently cover bluegrass songs
4. Rank and categorize artists by their "bluegrass-ness"

Usage:
    uv run python analytics/bluegrass-research/expand_bluegrass_corpus.py
"""

import json
import re
from collections import defaultdict
from pathlib import Path

# Seed: Authoritative bluegrass artists (from Jack Tuttle + IBMA research)
SEED_ARTISTS = {
    # First Generation (1945-1960)
    'Bill Monroe', 'Bill Monroe and the Bluegrass Boys',
    'Flatt & Scruggs', 'Lester Flatt', 'Earl Scruggs',
    'The Stanley Brothers', 'Ralph Stanley', 'Carter Stanley',
    'Jimmy Martin', 'Jim and Jesse', 'Jim & Jesse',
    'Don Reno', 'Reno & Smiley', 'The Osborne Brothers',
    'The Louvin Brothers',

    # Folk Revival (1960s)
    'Doc Watson', 'The Country Gentlemen', 'Country Gentlemen',
    'The Kentucky Colonels',

    # Festival/Newgrass (1970s)
    'Tony Rice', 'J.D. Crowe', 'J.D. Crowe & the New South',
    'The Seldom Scene', 'Seldom Scene', 'New Grass Revival',
    'Sam Bush', 'John Hartford', 'Norman Blake', 'Vassar Clements',

    # New Traditionalists (1980s)
    'Ricky Skaggs', 'Del McCoury', 'The Del McCoury Band',
    'Keith Whitley', 'Doyle Lawson', 'Hot Rize', 'Vince Gill',
    'IIIrd Tyme Out',

    # Modern
    'Alison Krauss', 'Alison Krauss & Union Station',
    'Billy Strings', 'Molly Tuttle', 'Chris Thile',
    'Punch Brothers', 'Nickel Creek',
    'Béla Fleck', 'Bela Fleck', 'Noam Pikelny',
    'Michael Cleveland', 'Tony Trischka', 'Blue Highway',
    'The Infamous Stringdusters', 'Greensky Bluegrass',
    'Trampled by Turtles', 'The Steeldrivers', 'Sierra Hull',
    'Lonesome River Band', 'The Grascals', 'The Gibson Brothers',
    'Dailey & Vincent', 'Mountain Heart',
    'Authentic Unlimited', 'The Travelin\' McCourys',
}

# Seed: Canonical bluegrass songs (commonly known standards)
SEED_SONGS = {
    # These are titles that are quintessentially bluegrass
    'Blue Moon of Kentucky',
    'Foggy Mountain Breakdown',
    'Man of Constant Sorrow',
    'I\'ll Fly Away',
    'Rocky Top',
    'Blue Ridge Cabin Home',
    'Sitting on Top of the World',
    'Roll in My Sweet Baby\'s Arms',
    'Old Home Place',
    'Nine Pound Hammer',
    'Little Maggie',
    'Pretty Polly',
    'Shady Grove',
    'Cripple Creek',
    'Salty Dog Blues',
    'Blackberry Blossom',
    'Salt Creek',
    'John Hardy',
    'Lonesome Road Blues',
    'Down the Road',
    'Will the Circle Be Unbroken',
    'I Am a Man of Constant Sorrow',
    'Molly and Tenbrooks',
    'Uncle Pen',
    'In the Pines',
    'Rank Strangers',
    'How Mountain Girls Can Love',
    'Little Cabin Home on the Hill',
    'White Dove',
    'Angel Band',
}


def normalize_title(title: str) -> str:
    """Normalize song title for matching."""
    # Lowercase, remove punctuation, normalize whitespace
    title = title.lower()
    title = re.sub(r'[^\w\s]', '', title)
    title = re.sub(r'\s+', ' ', title).strip()
    return title


def normalize_artist(artist: str) -> str:
    """Normalize artist name for matching."""
    return artist.lower().strip()


def extract_primary_artist(artist: str) -> str:
    """Extract primary artist from compound names."""
    for sep in [' and ', ' & ', ' with ', ' featuring ', ' feat. ', ' ft. ']:
        if sep.lower() in artist.lower():
            return artist.split(sep)[0].strip()
    return artist


def load_index(index_path: Path) -> list[dict]:
    """Load songs from index.jsonl."""
    songs = []
    with open(index_path) as f:
        for line in f:
            if line.strip():
                songs.append(json.loads(line))
    return songs


def group_songs_by_title(songs: list[dict]) -> dict[str, list[dict]]:
    """Group songs by normalized title to find covers."""
    title_groups = defaultdict(list)
    for song in songs:
        title = song.get('title', '')
        normalized = normalize_title(title)
        if normalized:
            title_groups[normalized].append(song)
    return dict(title_groups)


def find_seed_songs_in_index(songs: list[dict]) -> list[dict]:
    """Find seed songs in the index."""
    normalized_seeds = {normalize_title(t) for t in SEED_SONGS}
    return [s for s in songs if normalize_title(s.get('title', '')) in normalized_seeds]


def find_seed_artist_songs(songs: list[dict]) -> list[dict]:
    """Find songs by seed artists."""
    normalized_seeds = {normalize_artist(a) for a in SEED_ARTISTS}
    result = []
    for song in songs:
        artist = song.get('artist', '')
        if normalize_artist(artist) in normalized_seeds:
            result.append(song)
        elif normalize_artist(extract_primary_artist(artist)) in normalized_seeds:
            result.append(song)
    return result


def expand_by_covers(songs: list[dict], seed_songs: list[dict]) -> dict:
    """Find artists who cover seed songs.

    Returns dict of artist -> {songs covered, total_covers, seed_song_titles}
    """
    # Get titles of seed songs
    seed_titles = {normalize_title(s.get('title', '')) for s in seed_songs}

    # Group all songs by title
    title_groups = group_songs_by_title(songs)

    # Find artists who have songs matching seed titles
    artist_covers = defaultdict(lambda: {'count': 0, 'songs': set()})

    for normalized_title, versions in title_groups.items():
        if normalized_title in seed_titles:
            for version in versions:
                artist = version.get('artist', '')
                if artist:
                    artist_covers[artist]['count'] += 1
                    artist_covers[artist]['songs'].add(version.get('title', ''))

    return dict(artist_covers)


def expand_by_artist_repertoire(songs: list[dict], seed_artist_songs: list[dict]) -> dict:
    """Find other artists who share repertoire with seed artists.

    If Artist B covers many songs that Seed Artist A also recorded,
    Artist B is likely in the bluegrass sphere.
    """
    # Get titles from seed artist songs
    seed_titles = {normalize_title(s.get('title', '')) for s in seed_artist_songs}

    # Group all songs by title
    title_groups = group_songs_by_title(songs)

    # Count how many seed titles each non-seed artist has
    artist_overlap = defaultdict(lambda: {'overlap_count': 0, 'shared_songs': set()})
    normalized_seed_artists = {normalize_artist(a) for a in SEED_ARTISTS}

    for normalized_title, versions in title_groups.items():
        if normalized_title in seed_titles:
            for version in versions:
                artist = version.get('artist', '')
                normalized_artist = normalize_artist(artist)
                # Skip seed artists
                if normalized_artist not in normalized_seed_artists:
                    artist_overlap[artist]['overlap_count'] += 1
                    artist_overlap[artist]['shared_songs'].add(version.get('title', ''))

    return dict(artist_overlap)


def rank_artists_by_bluegrass_affinity(
    songs: list[dict],
    cover_data: dict,
    overlap_data: dict
) -> list[tuple]:
    """Rank artists by their bluegrass affinity score.

    Score = (seed_song_covers * 3) + (repertoire_overlap * 2) + (is_tagged_bluegrass * 5)
    """
    # Count total songs per artist
    artist_song_counts = defaultdict(int)
    artist_has_bluegrass_tag = defaultdict(bool)

    for song in songs:
        artist = song.get('artist', '')
        if artist:
            artist_song_counts[artist] += 1
            tags = song.get('tags', {})
            if isinstance(tags, dict) and tags.get('Bluegrass'):
                artist_has_bluegrass_tag[artist] = True

    # Calculate scores
    scores = []
    all_artists = set(cover_data.keys()) | set(overlap_data.keys())
    normalized_seed_artists = {normalize_artist(a) for a in SEED_ARTISTS}

    for artist in all_artists:
        # Skip seed artists (they're already known bluegrass)
        if normalize_artist(artist) in normalized_seed_artists:
            continue

        cover_count = cover_data.get(artist, {}).get('count', 0)
        overlap_count = overlap_data.get(artist, {}).get('overlap_count', 0)
        has_tag = artist_has_bluegrass_tag.get(artist, False)
        total_songs = artist_song_counts.get(artist, 0)

        # Score formula
        score = (cover_count * 3) + (overlap_count * 2) + (5 if has_tag else 0)

        # Bonus for artists with more content
        if total_songs > 10:
            score += 2

        if score > 0:
            scores.append((
                artist,
                score,
                cover_count,
                overlap_count,
                has_tag,
                total_songs
            ))

    # Sort by score descending
    return sorted(scores, key=lambda x: -x[1])


def categorize_discovered_artists(ranked_artists: list[tuple]) -> dict:
    """Categorize artists by their bluegrass affinity."""
    categories = {
        'high_affinity': [],      # Score >= 10: Very likely bluegrass
        'medium_affinity': [],    # Score 5-9: Likely plays bluegrass
        'low_affinity': [],       # Score 1-4: Some bluegrass connection
    }

    for artist, score, covers, overlap, has_tag, total in ranked_artists:
        entry = {
            'artist': artist,
            'score': score,
            'seed_covers': covers,
            'repertoire_overlap': overlap,
            'already_tagged': has_tag,
            'total_songs': total
        }

        if score >= 10:
            categories['high_affinity'].append(entry)
        elif score >= 5:
            categories['medium_affinity'].append(entry)
        else:
            categories['low_affinity'].append(entry)

    return categories


def print_report(songs: list[dict]):
    """Run expansion and print report."""
    print("=" * 70)
    print("BLUEGRASS CORPUS EXPANSION ANALYSIS")
    print("=" * 70)

    # Find seed content
    seed_songs = find_seed_songs_in_index(songs)
    seed_artist_songs = find_seed_artist_songs(songs)

    print(f"\n📊 SEED CORPUS")
    print(f"   Seed artists defined: {len(SEED_ARTISTS)}")
    print(f"   Seed song titles defined: {len(SEED_SONGS)}")
    print(f"   Seed songs found in index: {len(seed_songs)}")
    print(f"   Songs by seed artists in index: {len(seed_artist_songs)}")

    # Expansion 1: Who covers seed songs?
    print(f"\n📈 EXPANSION 1: Artists covering seed songs")
    cover_data = expand_by_covers(songs, seed_songs)
    print(f"   Artists with seed song covers: {len(cover_data)}")

    # Expansion 2: Who shares repertoire with seed artists?
    print(f"\n📈 EXPANSION 2: Artists sharing repertoire with seed artists")
    overlap_data = expand_by_artist_repertoire(songs, seed_artist_songs)
    print(f"   Artists with repertoire overlap: {len(overlap_data)}")

    # Rank and categorize
    print(f"\n🏆 RANKED DISCOVERED ARTISTS")
    ranked = rank_artists_by_bluegrass_affinity(songs, cover_data, overlap_data)
    categories = categorize_discovered_artists(ranked)

    print(f"\n   HIGH AFFINITY (score ≥ 10) - Very likely bluegrass:")
    for entry in categories['high_affinity'][:15]:
        tag_mark = "🏷️" if entry['already_tagged'] else "  "
        print(f"   {tag_mark} {entry['artist']:35} score={entry['score']:3} "
              f"covers={entry['seed_covers']:2} overlap={entry['repertoire_overlap']:2} "
              f"songs={entry['total_songs']}")

    print(f"\n   MEDIUM AFFINITY (score 5-9) - Likely plays bluegrass:")
    for entry in categories['medium_affinity'][:15]:
        tag_mark = "🏷️" if entry['already_tagged'] else "  "
        print(f"   {tag_mark} {entry['artist']:35} score={entry['score']:3} "
              f"covers={entry['seed_covers']:2} overlap={entry['repertoire_overlap']:2} "
              f"songs={entry['total_songs']}")

    # Summary
    print(f"\n" + "=" * 70)
    print("SUMMARY: Artists to consider adding to bluegrass corpus")
    print("=" * 70)

    high_not_tagged = [e for e in categories['high_affinity'] if not e['already_tagged']]
    medium_not_tagged = [e for e in categories['medium_affinity'] if not e['already_tagged']]

    print(f"\n   High affinity, NOT currently tagged 'Bluegrass': {len(high_not_tagged)}")
    for entry in high_not_tagged[:10]:
        print(f"      {entry['artist']} ({entry['total_songs']} songs, score {entry['score']})")

    print(f"\n   Medium affinity, NOT currently tagged 'Bluegrass': {len(medium_not_tagged)}")
    for entry in medium_not_tagged[:10]:
        print(f"      {entry['artist']} ({entry['total_songs']} songs, score {entry['score']})")

    # Output data for further analysis
    output = {
        'seed_stats': {
            'seed_artists': len(SEED_ARTISTS),
            'seed_songs': len(SEED_SONGS),
            'seed_songs_in_index': len(seed_songs),
            'seed_artist_songs_in_index': len(seed_artist_songs),
        },
        'discovered_artists': {
            'high_affinity': categories['high_affinity'],
            'medium_affinity': categories['medium_affinity'],
            'low_affinity': categories['low_affinity'][:50],  # Limit low affinity
        },
        'recommendations': {
            'add_to_bluegrass_tag': [e['artist'] for e in high_not_tagged],
            'consider_for_bluegrass': [e['artist'] for e in medium_not_tagged],
        }
    }

    # Save to JSON
    output_path = Path(__file__).parent / 'expansion_results.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"\n📁 Full results saved to: {output_path}")


def main():
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    index_path = repo_root / "docs" / "data" / "index.jsonl"

    if not index_path.exists():
        print(f"Index not found at {index_path}")
        return

    songs = load_index(index_path)
    print_report(songs)


if __name__ == "__main__":
    main()
