#!/usr/bin/env python3
"""
Matcher for BluegrassLyrics.com songs against existing works.

Compares scraped songs to the 17,500+ works in the collection.
"""

import json
import re
import unicodedata
from pathlib import Path
from dataclasses import dataclass, asdict
from difflib import SequenceMatcher

PARSED_DIR = Path(__file__).parent.parent / "parsed"
WORKS_DIR = Path(__file__).parent.parent.parent.parent / "works"
OUTPUT_DIR = Path(__file__).parent.parent


@dataclass
class MatchResult:
    """Result of matching a song against existing works."""
    slug: str
    title: str
    match_type: str  # "exact_slug", "normalized_title", "lyrics_match", "no_match"
    matched_work: str | None
    confidence: float
    recommendation: str  # "skip", "new_song", "new_version", "review"
    notes: str = ""


def normalize_text(text: str) -> str:
    """Normalize text for matching."""
    # Lowercase
    text = text.lower()
    # Remove accents/diacritics
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    # Remove punctuation except spaces
    text = re.sub(r"[^\w\s]", "", text)
    # Collapse whitespace
    text = " ".join(text.split())
    return text


def normalize_slug(title: str) -> str:
    """Convert title to slug format for matching."""
    text = normalize_text(title)
    return text.replace(" ", "-")


def get_first_n_lines(lyrics: str, n: int = 4) -> str:
    """Get first N non-empty lines of lyrics."""
    lines = [l.strip() for l in lyrics.split("\n") if l.strip()]
    return "\n".join(lines[:n])


def lyrics_similarity(lyrics1: str, lyrics2: str) -> float:
    """Calculate similarity between two lyrics strings."""
    # Normalize both
    norm1 = normalize_text(lyrics1)
    norm2 = normalize_text(lyrics2)

    # Use SequenceMatcher for similarity
    return SequenceMatcher(None, norm1, norm2).ratio()


def load_existing_works() -> dict:
    """Load existing works for matching.

    Returns dict: normalized_slug -> {slug, title, first_lines}
    """
    print("Loading existing works...")
    works = {}

    for work_dir in WORKS_DIR.iterdir():
        if not work_dir.is_dir():
            continue

        slug = work_dir.name
        work_yaml = work_dir / "work.yaml"
        lead_sheet = work_dir / "lead-sheet.pro"

        # Get title from work.yaml if it exists
        title = slug.replace("-", " ").title()
        if work_yaml.exists():
            try:
                import yaml
                with open(work_yaml) as f:
                    data = yaml.safe_load(f)
                    if data and "title" in data:
                        title = data["title"]
            except:
                pass

        # Get first lines from lead sheet if it exists
        first_lines = ""
        if lead_sheet.exists():
            try:
                content = lead_sheet.read_text()
                # Strip ChordPro markup
                content = re.sub(r"\[.*?\]", "", content)  # Remove chords
                content = re.sub(r"\{.*?\}", "", content)  # Remove directives
                first_lines = get_first_n_lines(content, 6)
            except:
                pass

        norm_slug = normalize_slug(title)
        works[norm_slug] = {
            "slug": slug,
            "title": title,
            "first_lines": first_lines,
            "norm_title": normalize_text(title)
        }
        # Also index by actual slug
        works[slug] = works[norm_slug]

    print(f"Loaded {len(set(w['slug'] for w in works.values()))} unique works")
    return works


def match_song(parsed_song: dict, existing_works: dict) -> MatchResult:
    """Match a parsed song against existing works."""
    slug = parsed_song["slug"]
    title = parsed_song["title"]
    raw_lyrics = parsed_song["raw_lyrics"]

    norm_title = normalize_text(title)
    norm_slug = normalize_slug(title)

    # 1. Exact slug match
    if slug in existing_works:
        return MatchResult(
            slug=slug,
            title=title,
            match_type="exact_slug",
            matched_work=existing_works[slug]["slug"],
            confidence=1.0,
            recommendation="skip",
            notes="Exact slug match in existing works"
        )

    # 2. Normalized title match
    if norm_slug in existing_works:
        work = existing_works[norm_slug]
        return MatchResult(
            slug=slug,
            title=title,
            match_type="normalized_title",
            matched_work=work["slug"],
            confidence=0.95,
            recommendation="skip",
            notes=f"Title match: '{title}' -> '{work['title']}'"
        )

    # 3. Fuzzy title match
    first_lines = get_first_n_lines(raw_lyrics, 4)
    best_match = None
    best_score = 0.0

    for norm_key, work in existing_works.items():
        # Title similarity
        title_sim = SequenceMatcher(None, norm_title, work["norm_title"]).ratio()

        if title_sim > 0.8:
            # High title similarity - check lyrics too
            if work["first_lines"]:
                lyrics_sim = lyrics_similarity(first_lines, work["first_lines"])
                combined = (title_sim * 0.4) + (lyrics_sim * 0.6)
            else:
                combined = title_sim

            if combined > best_score:
                best_score = combined
                best_match = work

    if best_match and best_score > 0.85:
        return MatchResult(
            slug=slug,
            title=title,
            match_type="fuzzy_match",
            matched_work=best_match["slug"],
            confidence=best_score,
            recommendation="skip" if best_score > 0.95 else "review",
            notes=f"Fuzzy match ({best_score:.2f}): '{title}' -> '{best_match['title']}'"
        )

    if best_match and best_score > 0.7:
        return MatchResult(
            slug=slug,
            title=title,
            match_type="possible_match",
            matched_work=best_match["slug"],
            confidence=best_score,
            recommendation="review",
            notes=f"Possible match ({best_score:.2f}): '{title}' -> '{best_match['title']}'"
        )

    # 4. No match - new song
    return MatchResult(
        slug=slug,
        title=title,
        match_type="no_match",
        matched_work=None,
        confidence=0.0,
        recommendation="new_song",
        notes="No matching work found"
    )


def main():
    """Match all parsed songs against existing works."""
    print("=" * 60)
    print("BluegrassLyrics.com Matcher")
    print("=" * 60)

    # Load existing works
    existing_works = load_existing_works()

    # Load parsed songs
    parsed_files = list(PARSED_DIR.glob("*.json"))
    print(f"Matching {len(parsed_files)} parsed songs...")

    results = []
    stats = {
        "total": len(parsed_files),
        "skip": 0,
        "new_song": 0,
        "review": 0,
        "new_version": 0
    }

    for pf in parsed_files:
        with open(pf) as f:
            parsed = json.load(f)

        result = match_song(parsed, existing_works)
        results.append(asdict(result))
        stats[result.recommendation] += 1

    # Save results
    results_file = OUTPUT_DIR / "match_results.json"
    with open(results_file, "w") as f:
        json.dump({
            "total": len(results),
            "stats": stats,
            "results": results
        }, f, indent=2)

    print(f"\nSaved results to {results_file}")

    # Summary
    print("\n" + "=" * 60)
    print("Matching complete!")
    print(f"  Total songs: {stats['total']}")
    print(f"  Skip (already have): {stats['skip']}")
    print(f"  New songs: {stats['new_song']}")
    print(f"  Need review: {stats['review']}")
    print("=" * 60)

    # Save classification report
    report = {
        "skip": [r for r in results if r["recommendation"] == "skip"],
        "new_song": [r for r in results if r["recommendation"] == "new_song"],
        "review": [r for r in results if r["recommendation"] == "review"],
    }

    report_file = OUTPUT_DIR / "classification_report.json"
    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Classification report saved to {report_file}")


if __name__ == "__main__":
    main()
