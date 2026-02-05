#!/usr/bin/env python3
"""
Match BluegrassLyrics songs against traditionalmusic.co.uk index.
Find songs where we can get chord data.
"""
import json
import re
from pathlib import Path
from difflib import SequenceMatcher

TMUK_DIR = Path(__file__).parent
BL_DIR = TMUK_DIR.parent / "bluegrass-lyrics"


def normalize_title(title: str) -> str:
    """Normalize title for matching."""
    title = title.lower()
    title = re.sub(r"[^\w\s]", "", title)
    title = " ".join(title.split())
    return title


def main():
    print("Loading traditionalmusic.co.uk index...")
    with open(TMUK_DIR / "song_index.json") as f:
        tmuk_index = json.load(f)

    by_title = tmuk_index["by_title"]
    print(f"TMUK songs: {tmuk_index['relevant_songs']}")

    print("\nLoading BluegrassLyrics new songs...")
    with open(BL_DIR / "classification_report.json") as f:
        bl_report = json.load(f)

    new_songs = bl_report["new_song"]
    print(f"BluegrassLyrics new songs: {len(new_songs)}")

    # Match
    matches = []
    no_match = []

    for song in new_songs:
        title = song["title"]
        norm = normalize_title(title)

        # Exact match
        if norm in by_title:
            matches.append({
                "bl_slug": song["slug"],
                "bl_title": title,
                "match_type": "exact",
                "tmuk_matches": by_title[norm]
            })
            continue

        # Fuzzy match - check for close titles
        best_match = None
        best_score = 0

        for tmuk_norm, tmuk_songs in by_title.items():
            score = SequenceMatcher(None, norm, tmuk_norm).ratio()
            if score > 0.85 and score > best_score:
                best_score = score
                best_match = (tmuk_norm, tmuk_songs, score)

        if best_match:
            matches.append({
                "bl_slug": song["slug"],
                "bl_title": title,
                "match_type": "fuzzy",
                "match_score": best_match[2],
                "tmuk_matches": best_match[1]
            })
        else:
            no_match.append({
                "bl_slug": song["slug"],
                "bl_title": title,
            })

    print(f"\nResults:")
    print(f"  Matches found: {len(matches)}")
    print(f"  No match: {len(no_match)}")

    # Breakdown by match type
    exact = [m for m in matches if m["match_type"] == "exact"]
    fuzzy = [m for m in matches if m["match_type"] == "fuzzy"]
    print(f"    Exact: {len(exact)}")
    print(f"    Fuzzy: {len(fuzzy)}")

    # Save results
    results = {
        "matches": matches,
        "no_match": no_match,
        "stats": {
            "total": len(new_songs),
            "matched": len(matches),
            "exact": len(exact),
            "fuzzy": len(fuzzy),
            "no_match": len(no_match),
        }
    }

    with open(TMUK_DIR / "bl_match_results.json", "w") as f:
        json.dump(results, f, indent=2)

    print(f"\nSaved to bl_match_results.json")

    # Show sample matches
    print("\n=== SAMPLE EXACT MATCHES ===")
    for m in exact[:10]:
        tmuk = m["tmuk_matches"][0]
        print(f"  {m['bl_title'][:40]:<40} -> {tmuk['collection']}")

    print("\n=== SAMPLE FUZZY MATCHES ===")
    for m in fuzzy[:10]:
        tmuk = m["tmuk_matches"][0]
        print(f"  {m['bl_title'][:35]:<35} ({m['match_score']:.2f}) -> {tmuk['title'][:30]}")


if __name__ == "__main__":
    main()
