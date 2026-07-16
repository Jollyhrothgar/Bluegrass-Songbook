#!/usr/bin/env python3
"""
Build a searchable index from traditionalmusic.co.uk URL lists.
Focus on bluegrass, country, folk, and gospel collections.
"""
import json
import re
from pathlib import Path
from urllib.parse import unquote

SOURCE_DIR = Path(__file__).parent
RELEVANT_COLLECTIONS = {
    "top-bluegrass-chords",
    "country-music",
    "folk-song-lyrics",
    "country-gospel-chords",
    "old-time-music",
    "johnny-cash",
    "carter-family-songs",
    "gospel-songs-chords",
    "gospel-songs-chords2",
    "american-ballads-and-folk-songs",
    "folk-music-guitar-tab",
    "hank-williams",
    "dolly-parton",
    "willie-nelson",
}


def extract_title_from_url(url: str) -> tuple[str, str, str] | None:
    """Extract collection, slug, and title from URL."""
    # Pattern: /collection-name/song-name.htm
    match = re.search(r"traditionalmusic\.co\.uk/([^/]+)/([^/]+)\.html?$", url)
    if not match:
        return None

    collection = match.group(1)
    filename = match.group(2)

    # Skip index pages and non-song pages
    if filename in ("index", "sitemap") or filename.startswith("index"):
        return None

    # Clean up filename to get title
    title = unquote(filename)
    title = title.replace("_", " ").replace("-", " ")
    # Remove common suffixes
    title = re.sub(r"\s*(chords?|lyrics?|tab)\s*$", "", title, flags=re.I)
    title = re.sub(r"\s+", " ", title).strip()

    return collection, filename, title


def normalize_title(title: str) -> str:
    """Normalize title for matching."""
    title = title.lower()
    title = re.sub(r"[^\w\s]", "", title)
    title = " ".join(title.split())
    return title


def main():
    print("Building index from URL lists...")

    # Load all URLs
    all_urls = []
    for urlfile in SOURCE_DIR.glob("urllist*.txt"):
        with open(urlfile) as f:
            all_urls.extend(line.strip() for line in f if line.strip())

    print(f"Total URLs: {len(all_urls)}")

    # Extract song info, filter to relevant collections
    songs = []
    by_collection = {}

    for url in all_urls:
        result = extract_title_from_url(url)
        if not result:
            continue

        collection, filename, title = result

        # Track all collections
        by_collection[collection] = by_collection.get(collection, 0) + 1

        # Only index relevant collections
        if collection not in RELEVANT_COLLECTIONS:
            continue

        songs.append({
            "url": url,
            "collection": collection,
            "filename": filename,
            "title": title,
            "norm_title": normalize_title(title),
        })

    print(f"Songs from relevant collections: {len(songs)}")

    # Build lookup by normalized title
    by_title = {}
    for song in songs:
        norm = song["norm_title"]
        if norm not in by_title:
            by_title[norm] = []
        by_title[norm].append(song)

    print(f"Unique normalized titles: {len(by_title)}")

    # Save index
    index = {
        "total_urls": len(all_urls),
        "relevant_songs": len(songs),
        "unique_titles": len(by_title),
        "songs": songs,
        "by_title": by_title,
    }

    with open(SOURCE_DIR / "song_index.json", "w") as f:
        json.dump(index, f, indent=2)

    print(f"Saved index to song_index.json")

    # Summary of relevant collections
    print("\nRelevant collections:")
    for coll in sorted(RELEVANT_COLLECTIONS):
        count = sum(1 for s in songs if s["collection"] == coll)
        if count > 0:
            print(f"  {coll}: {count}")


if __name__ == "__main__":
    main()
