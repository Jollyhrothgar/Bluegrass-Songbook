#!/usr/bin/env python3
"""
Generate ChordPro files from BluegrassLyrics + chord sources.

Outputs to chordpro/ directory with status tracking in manifest.json.
"""
import json
import re
from pathlib import Path
from datetime import datetime

SOURCE_DIR = Path(__file__).parent
PARSED_DIR = SOURCE_DIR / "parsed"
CHORDPRO_DIR = SOURCE_DIR / "chordpro"
TMUK_DIR = SOURCE_DIR.parent / "traditional-music-uk"


def load_manifest() -> dict:
    """Load or create manifest."""
    manifest_file = SOURCE_DIR / "manifest.json"
    if manifest_file.exists():
        with open(manifest_file) as f:
            return json.load(f)
    return {"songs": {}, "updated": None}


def save_manifest(manifest: dict):
    """Save manifest."""
    manifest["updated"] = datetime.now().isoformat()
    with open(SOURCE_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)


def extract_chord_map(tmuk_lines: list[str]) -> dict[str, str]:
    """Build a map of word -> chord from TMUK lines."""
    chord_map = {}
    pattern = r'(\[[A-G][b#]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)*\])?(\S+)'

    for line in tmuk_lines:
        for match in re.finditer(pattern, line):
            chord = match.group(1)
            word = match.group(2)
            if word and chord:
                clean_word = re.sub(r'[^\w]', '', word.lower())
                if clean_word and clean_word not in chord_map:
                    chord_map[clean_word] = chord[1:-1]  # Strip []

    return chord_map


def apply_chords_to_line(bl_line: str, chord_map: dict[str, str]) -> str:
    """Apply chords from map to a BL line based on word matching."""
    words = bl_line.split()
    result = []

    for word in words:
        clean = re.sub(r'[^\w]', '', word.lower())
        chord = chord_map.get(clean)
        if chord:
            result.append(f"[{chord}]{word}")
        else:
            result.append(word)

    return ' '.join(result)


def generate_structured_chordpro(bl_data: dict, tmuk_chord_lines: list[str]) -> list[str]:
    """
    Generate ChordPro with proper verse/chorus structure from BluegrassLyrics,
    with chords merged from TMUK using word-level alignment.
    """
    lines = []

    # Build chord map from all TMUK lines
    chord_map = extract_chord_map(tmuk_chord_lines)

    # Output BL lyrics with structure markers and merged chords
    verse_num = 0
    for section in bl_data.get("sections", []):
        section_type = section.get("type", "verse")
        section_lines = section.get("lines", [])

        if section_type == "chorus":
            lines.append("{start_of_chorus}")
            for line in section_lines:
                lines.append(apply_chords_to_line(line, chord_map))
            lines.append("{end_of_chorus}")
        else:
            verse_num += 1
            lines.append(f"{{start_of_verse: Verse {verse_num}}}")
            for line in section_lines:
                lines.append(apply_chords_to_line(line, chord_map))
            lines.append("{end_of_verse}")

        lines.append("")  # Blank line between sections

    return lines


def generate_from_tmuk():
    """Generate ChordPro for songs matched with traditionalmusic.co.uk."""
    print("Loading TMUK fetched chords...")

    tmuk_file = TMUK_DIR / "fetched_chords.json"
    if not tmuk_file.exists():
        print("  No TMUK chords found. Run fetch_chords.py first.")
        return []

    with open(tmuk_file) as f:
        tmuk_data = json.load(f)

    print(f"  Found {len(tmuk_data['songs'])} songs with chords")

    manifest = load_manifest()
    generated = []

    for song in tmuk_data["songs"]:
        slug = song["bl_slug"]

        # Load BluegrassLyrics parsed data
        bl_file = PARSED_DIR / f"{slug}.json"
        if not bl_file.exists():
            print(f"  [SKIP] {slug} - no BL parsed data")
            continue

        with open(bl_file) as f:
            bl_data = json.load(f)

        # Generate ChordPro with structure
        chordpro = []
        chordpro.append(f"{{meta: title {bl_data['title']}}}")
        chordpro.append("{meta: artist Carter Family}")  # These are all Carter Family songs
        chordpro.append(f"{{meta: x_lyrics_source bluegrass-lyrics}}")
        chordpro.append(f"{{meta: x_lyrics_url {bl_data['source_url']}}}")
        chordpro.append(f"{{meta: x_chords_source traditional-music-uk}}")
        chordpro.append(f"{{meta: x_chords_url {song['tmuk_url']}}}")
        chordpro.append(f"{{meta: x_generated {datetime.now().strftime('%Y-%m-%d')}}}")
        chordpro.append("")

        # Add structured lyrics from BL with TMUK chords as reference
        structured_lines = generate_structured_chordpro(bl_data, song["chord_lines"])
        chordpro.extend(structured_lines)

        # Write file
        output_file = CHORDPRO_DIR / f"{slug}.pro"
        output_file.write_text("\n".join(chordpro))

        # Update manifest
        manifest["songs"][slug] = {
            "status": "ready",
            "source": "tmuk",
            "generated": datetime.now().isoformat(),
            "title": bl_data["title"],
        }

        generated.append(slug)

    save_manifest(manifest)
    print(f"Generated {len(generated)} ChordPro files")
    return generated


def main():
    print("=" * 60)
    print("BluegrassLyrics ChordPro Generator")
    print("=" * 60)

    CHORDPRO_DIR.mkdir(parents=True, exist_ok=True)

    # Generate from TMUK matches
    tmuk_generated = generate_from_tmuk()

    print()
    print(f"Total generated: {len(tmuk_generated)}")
    print(f"Output: {CHORDPRO_DIR}/")
    print()
    print("Review with: cat sources/bluegrass-lyrics/chordpro/<slug>.pro")
    print("Status in: sources/bluegrass-lyrics/manifest.json")


if __name__ == "__main__":
    main()
