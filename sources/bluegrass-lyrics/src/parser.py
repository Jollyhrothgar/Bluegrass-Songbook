#!/usr/bin/env python3
"""
Parser for BluegrassLyrics.com HTML files.

Extracts lyrics with structure detection based on indentation.
"""

import json
import re
from pathlib import Path
from bs4 import BeautifulSoup
from dataclasses import dataclass, asdict
from typing import Optional

RAW_DIR = Path(__file__).parent.parent / "raw"
PARSED_DIR = Path(__file__).parent.parent / "parsed"
INDEX_FILE = Path(__file__).parent.parent / "song_index.json"


@dataclass
class Section:
    """A section of a song (verse, chorus, etc.)."""
    type: str  # "verse", "chorus", "unknown"
    lines: list[str]
    indented: bool = False


@dataclass
class ParsedSong:
    """Parsed song data."""
    slug: str
    title: str
    source_url: str
    raw_lyrics: str
    sections: list[dict]
    has_structure: bool  # True if we detected verse/chorus structure


def extract_lyrics(html: str) -> tuple[str, list[list[str]]]:
    """Extract title and lyrics sections from HTML.

    Returns title and list of sections, where each section is a list of lines.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Get title from <h1 class="entry-title">
    title_elem = soup.find("h1", class_="entry-title")
    title = title_elem.get_text(strip=True) if title_elem else "Unknown"

    # Get lyrics from <div class="entry-content">
    content = soup.find("div", class_="entry-content")
    if not content:
        return title, []

    sections = []
    for p in content.find_all("p"):
        # Convert <br> to newlines within this paragraph
        for br in p.find_all("br"):
            br.replace_with("\n")

        text = p.get_text()
        lines = [line for line in text.split("\n") if line.strip()]
        if lines:
            sections.append(lines)

    return title, sections


def detect_sections(html_sections: list[list[str]]) -> list[Section]:
    """Detect verse/chorus structure from indentation patterns.

    Each html_section is a <p> tag's content (list of lines).
    Indented sections are typically verses, non-indented are choruses.
    """
    sections = []

    for lines in html_sections:
        if not lines:
            continue

        # Check if first line is indented (spaces, non-breaking spaces, or tab)
        first_line = lines[0]
        # \u00a0 is non-breaking space, commonly used for indentation
        is_indented = (
            first_line.startswith("    ") or
            first_line.startswith("\t") or
            first_line.startswith("\u00a0\u00a0\u00a0") or
            first_line.startswith("   ")  # 3+ spaces
        )

        # Clean the lines (strip leading/trailing whitespace)
        clean_lines = [line.strip() for line in lines]

        # BluegrassLyrics convention: indented = chorus, non-indented = verse
        section_type = "chorus" if is_indented else "verse"

        sections.append(Section(
            type=section_type,
            lines=clean_lines,
            indented=is_indented
        ))

    return sections


def parse_song(slug: str, url: str) -> Optional[ParsedSong]:
    """Parse a downloaded song HTML file."""
    html_file = RAW_DIR / f"{slug}.html"
    if not html_file.exists():
        return None

    html = html_file.read_text(encoding="utf-8")
    title, html_sections = extract_lyrics(html)

    if not html_sections:
        return None

    sections = detect_sections(html_sections)

    # Reconstruct raw lyrics for reference
    raw_lyrics = "\n\n".join(
        "\n".join(s.lines) for s in sections
    )

    # Check if we found meaningful structure
    has_structure = len(sections) > 1 or any(s.indented for s in sections)

    return ParsedSong(
        slug=slug,
        title=title,
        source_url=url,
        raw_lyrics=raw_lyrics.strip(),
        sections=[asdict(s) for s in sections],
        has_structure=has_structure
    )


def main():
    """Parse all downloaded songs."""
    print("=" * 60)
    print("BluegrassLyrics.com Parser")
    print("=" * 60)

    # Load song index
    with open(INDEX_FILE) as f:
        index = json.load(f)

    songs = index["songs"]
    print(f"Processing {len(songs)} songs...")

    PARSED_DIR.mkdir(parents=True, exist_ok=True)

    stats = {
        "total": len(songs),
        "parsed": 0,
        "empty": 0,
        "with_structure": 0,
        "errors": 0
    }

    for song in songs:
        slug = song["slug"]
        url = song["url"]

        try:
            parsed = parse_song(slug, url)
            if parsed:
                # Save to JSON
                output_file = PARSED_DIR / f"{slug}.json"
                with open(output_file, "w") as f:
                    json.dump(asdict(parsed), f, indent=2)

                stats["parsed"] += 1
                if parsed.has_structure:
                    stats["with_structure"] += 1
            else:
                stats["empty"] += 1

        except Exception as e:
            print(f"  [ERROR] {slug}: {e}")
            stats["errors"] += 1

    print("\n" + "=" * 60)
    print("Parsing complete!")
    print(f"  Total songs: {stats['total']}")
    print(f"  Parsed: {stats['parsed']}")
    print(f"  With structure: {stats['with_structure']}")
    print(f"  Empty/skipped: {stats['empty']}")
    print(f"  Errors: {stats['errors']}")
    print("=" * 60)

    # Save stats
    stats_file = Path(__file__).parent.parent / "parse_stats.json"
    with open(stats_file, "w") as f:
        json.dump(stats, f, indent=2)


if __name__ == "__main__":
    main()
