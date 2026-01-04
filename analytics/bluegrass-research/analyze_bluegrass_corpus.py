#!/usr/bin/env python3
"""
Analyze the song index to identify bluegrass content by era and category.

This script reads the index.jsonl and categorizes songs based on:
1. Artist era (First Generation, Folk Revival, etc.)
2. Tags (Bluegrass, JamFriendly, Gospel, etc.)
3. Golden Standard collection

Usage:
    uv run python analytics/bluegrass-research/analyze_bluegrass_corpus.py
"""

import json
from collections import defaultdict
from pathlib import Path

# Era definitions based on Jack Tuttle's bluegrass history
ERA_ARTISTS = {
    "Pre-Bluegrass (1920s-1945)": [
        "The Carter Family", "Carter Family", "Jimmie Rodgers",
        "The Monroe Brothers", "Charlie Monroe", "Uncle Dave Macon",
    ],
    "First Generation (1945-1960)": [
        "Bill Monroe", "Bill Monroe & His Blue Grass Boys",
        "Flatt & Scruggs", "Lester Flatt", "Earl Scruggs",
        "The Stanley Brothers", "Stanley Brothers", "Ralph Stanley", "Carter Stanley",
        "Jimmy Martin", "Jim & Jesse", "Jim and Jesse",
        "Don Reno", "Reno & Smiley", "Reno and Smiley",
        "The Osborne Brothers", "Osborne Brothers", "Bobby Osborne", "Sonny Osborne",
        "The Louvin Brothers", "Louvin Brothers",
    ],
    "Folk Revival (1960s)": [
        "Doc Watson", "The Country Gentlemen", "Country Gentlemen",
        "Bill Keith", "Clarence White", "The Kentucky Colonels", "Kentucky Colonels",
        "New Lost City Ramblers",
    ],
    "Festival/Newgrass (1970s)": [
        "Tony Rice", "J.D. Crowe", "J. D. Crowe", "J.D. Crowe & The New South",
        "The Seldom Scene", "Seldom Scene", "New Grass Revival",
        "Sam Bush", "John Hartford", "Norman Blake", "Vassar Clements",
        "The Dillards", "Dillards",
    ],
    "New Traditionalists (1980s)": [
        "Ricky Skaggs", "Marty Stuart", "Keith Whitley", "Vince Gill",
        "Del McCoury", "The Del McCoury Band", "Del McCoury Band",
        "Doyle Lawson", "Doyle Lawson & Quicksilver",
        "IIIrd Tyme Out", "Hot Rize",
    ],
    "Modern (1990s+)": [
        "Alison Krauss", "Alison Krauss & Union Station", "Union Station",
        "Nickel Creek", "Chris Thile", "The Infamous Stringdusters", "Infamous Stringdusters",
        "Punch Brothers", "Trampled by Turtles", "The Steeldrivers", "Steeldrivers",
        "Billy Strings", "Molly Tuttle", "Sierra Hull",
        "Noam Pikelny", "Béla Fleck", "Bela Fleck",
        "Michael Cleveland", "Michael Cleveland & Flamekeeper",
        "Tony Trischka", "Blue Highway",
        "The Grascals", "Grascals", "Lonesome River Band",
        "Mountain Heart", "Dailey & Vincent", "The Gibson Brothers", "Gibson Brothers",
        "Greensky Bluegrass", "Yonder Mountain String Band",
        "Railroad Earth", "Leftover Salmon",
        "Authentic Unlimited", "The Travelin' McCourys",
    ],
}

# Country artists who cover bluegrass (edge cases)
COUNTRY_CROSSOVER = [
    "Dolly Parton", "Emmylou Harris", "Patsy Cline", "Loretta Lynn",
    "Willie Nelson", "Merle Haggard", "George Jones",
]


def load_index(index_path: Path) -> list[dict]:
    """Load songs from index.jsonl."""
    songs = []
    with open(index_path) as f:
        for line in f:
            if line.strip():
                songs.append(json.loads(line))
    return songs


def normalize_artist(artist: str) -> str:
    """Normalize artist name for matching."""
    return artist.lower().strip()


def categorize_by_era(songs: list[dict]) -> dict[str, list[dict]]:
    """Categorize songs by bluegrass era."""
    era_songs = defaultdict(list)

    # Build normalized lookup
    artist_to_era = {}
    for era, artists in ERA_ARTISTS.items():
        for artist in artists:
            artist_to_era[normalize_artist(artist)] = era

    for song in songs:
        artist = song.get("artist", "")
        normalized = normalize_artist(artist)

        if normalized in artist_to_era:
            era = artist_to_era[normalized]
            era_songs[era].append(song)

    return dict(era_songs)


def categorize_by_tag(songs: list[dict]) -> dict[str, list[dict]]:
    """Categorize songs by tag."""
    tag_songs = defaultdict(list)

    for song in songs:
        tags = song.get("tags", {})
        if isinstance(tags, dict):
            for tag, value in tags.items():
                if value:  # Tag is True
                    tag_songs[tag].append(song)
        elif isinstance(tags, list):
            for tag in tags:
                tag_songs[tag].append(song)

    return dict(tag_songs)


def find_crossover_artists(songs: list[dict]) -> list[dict]:
    """Find songs by country artists who cover bluegrass."""
    crossover = []
    normalized_crossover = {normalize_artist(a) for a in COUNTRY_CROSSOVER}

    for song in songs:
        artist = song.get("artist", "")
        if normalize_artist(artist) in normalized_crossover:
            crossover.append(song)

    return crossover


def print_report(songs: list[dict]):
    """Print analysis report."""
    print("=" * 70)
    print("BLUEGRASS CORPUS ANALYSIS")
    print("=" * 70)
    print(f"\nTotal songs in index: {len(songs):,}")

    # By Era
    print("\n" + "-" * 70)
    print("SONGS BY BLUEGRASS ERA (Jack Tuttle's Timeline)")
    print("-" * 70)

    era_songs = categorize_by_era(songs)
    era_total = 0
    for era in ERA_ARTISTS.keys():
        count = len(era_songs.get(era, []))
        era_total += count
        if count > 0:
            print(f"  {era}: {count:,} songs")
            # Sample artists
            artists = set(s.get("artist", "Unknown") for s in era_songs.get(era, [])[:20])
            print(f"    Artists: {', '.join(sorted(artists)[:5])}")

    print(f"\n  TOTAL from bluegrass artists: {era_total:,} songs")

    # By Tag
    print("\n" + "-" * 70)
    print("SONGS BY TAG")
    print("-" * 70)

    tag_songs = categorize_by_tag(songs)
    for tag in ["Bluegrass", "JamFriendly", "Gospel", "Instrumental", "Modal", "ClassicCountry"]:
        count = len(tag_songs.get(tag, []))
        print(f"  {tag}: {count:,} songs")

    # Crossover Artists
    print("\n" + "-" * 70)
    print("COUNTRY CROSSOVER (not primarily bluegrass)")
    print("-" * 70)

    crossover = find_crossover_artists(songs)
    artist_counts = defaultdict(int)
    for song in crossover:
        artist_counts[song.get("artist", "Unknown")] += 1

    for artist, count in sorted(artist_counts.items(), key=lambda x: -x[1]):
        print(f"  {artist}: {count:,} songs")

    # Landing Page Categories
    print("\n" + "=" * 70)
    print("PROPOSED LANDING PAGE CATEGORIES")
    print("=" * 70)

    print("\n1. BLUEGRASS STANDARDS")
    bluegrass_tagged = len(tag_songs.get("Bluegrass", []))
    print(f"   - Songs tagged 'Bluegrass': {bluegrass_tagged:,}")
    print(f"   - Songs from bluegrass-era artists: {era_total:,}")
    print(f"   - Combined (unique): estimate TBD")

    print("\n2. BY ERA (Browse Bluegrass History)")
    for era in ERA_ARTISTS.keys():
        count = len(era_songs.get(era, []))
        if count > 0:
            print(f"   - {era}: {count:,}")

    print("\n3. JAM-FRIENDLY CLASSICS")
    jam_friendly = len(tag_songs.get("JamFriendly", []))
    classic_country = len(tag_songs.get("ClassicCountry", []))
    print(f"   - JamFriendly tag: {jam_friendly:,}")
    print(f"   - ClassicCountry tag: {classic_country:,}")

    print("\n4. FIDDLE TUNES & INSTRUMENTALS")
    instrumental = len(tag_songs.get("Instrumental", []))
    print(f"   - Instrumental tag: {instrumental:,}")

    print("\n5. GOSPEL BLUEGRASS")
    gospel = len(tag_songs.get("Gospel", []))
    print(f"   - Gospel tag: {gospel:,}")

    print("\n" + "=" * 70)


def main():
    # Find the index file
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    index_path = repo_root / "docs" / "data" / "index.jsonl"

    if not index_path.exists():
        print(f"Index not found at {index_path}")
        print("Run ./scripts/bootstrap --quick first")
        return

    songs = load_index(index_path)
    print_report(songs)


if __name__ == "__main__":
    main()
