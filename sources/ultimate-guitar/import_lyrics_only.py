#!/usr/bin/env python3
"""
Import songs that didn't get good chord matches - just lyrics from BL.

Usage:
    uv run python sources/ultimate-guitar/import_lyrics_only.py
    uv run python sources/ultimate-guitar/import_lyrics_only.py --dry-run
"""
import argparse
import json
import re
from datetime import date
from pathlib import Path

RESULTS_DIR = Path(__file__).parent / "results"
BL_DIR = Path(__file__).parent.parent / "bluegrass-lyrics" / "parsed"
WORKS_DIR = Path(__file__).parent.parent.parent / "works"


def count_words(text: str) -> int:
    clean = re.sub(r'\[.*?\]', '', text)
    return len(clean.split())


def has_chord_line(line: dict) -> bool:
    return '[' in line.get('text', '')


def has_good_section(data: dict, min_words: int = 20, min_match: float = 0.85) -> bool:
    for section in data.get('sections', []):
        lines = section.get('lines', [])
        if not lines:
            continue
        section_text = ' '.join(line['text'] for line in lines)
        word_count = count_words(section_text)
        if word_count < min_words:
            continue
        good_chord_lines = sum(1 for line in lines
                               if has_chord_line(line) and
                                  line.get('match_score', 0) >= min_match)
        if good_chord_lines >= 2:
            return True
    return False


def was_already_imported(data: dict) -> bool:
    """Check if song was imported with chords."""
    cov = data['metrics']['coverage']
    if cov >= 0.70:
        return True
    return has_good_section(data)


def generate_chordpro_from_bl(bl_data: dict, bl_url: str) -> str:
    """Generate ChordPro from BL structured data (lyrics only, no chords)."""
    lines = []
    lines.append(f"{{meta: title {bl_data['title']}}}")
    lines.append(f"{{meta: x_lyrics_source bluegrass-lyrics}}")
    lines.append(f"{{meta: x_lyrics_url {bl_url}}}")
    lines.append("")

    for section in bl_data.get('sections', []):
        section_type = section.get('type', 'verse')
        if section_type == 'chorus':
            lines.append("{start_of_chorus}")
        else:
            lines.append(f"{{start_of_{section_type}}}")

        for line in section.get('lines', []):
            lines.append(line)

        if section_type == 'chorus':
            lines.append("{end_of_chorus}")
        else:
            lines.append(f"{{end_of_{section_type}}}")

        lines.append("")

    return '\n'.join(lines)


def create_work_yaml(slug: str, title: str, source_url: str) -> str:
    """Generate work.yaml content."""
    today = date.today().isoformat()

    yaml_lines = [
        f"id: {slug}",
        f"title: {title}",
        "parts:",
        "  - type: lead-sheet",
        "    format: chordpro",
        "    file: lead-sheet.pro",
        "    default: true",
        "    provenance:",
        "      source: bluegrass-lyrics",
        f"      source_url: {source_url}",
        f"      imported_at: '{today}'",
    ]

    return '\n'.join(yaml_lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description="Import lyrics-only songs to works/")
    parser.add_argument("--dry-run", action="store_true",
                       help="Show what would be done without doing it")
    args = parser.parse_args()

    imported = 0
    skipped_exists = 0
    skipped_already = 0
    skipped_no_bl = 0

    for result_file in sorted(RESULTS_DIR.glob("*.json")):
        with open(result_file) as f:
            data = json.load(f)

        # Skip if already imported with chords
        if was_already_imported(data):
            skipped_already += 1
            continue

        slug = data['bl_slug']
        work_dir = WORKS_DIR / slug

        if work_dir.exists():
            skipped_exists += 1
            continue

        # Get BL source data
        bl_file = BL_DIR / f"{slug}.json"
        if not bl_file.exists():
            print(f"SKIP {slug}: no BL file")
            skipped_no_bl += 1
            continue

        with open(bl_file) as f:
            bl_data = json.load(f)

        if args.dry_run:
            print(f"WOULD CREATE {slug} (lyrics only)")
            imported += 1
            continue

        # Create work directory
        work_dir.mkdir(parents=True, exist_ok=True)

        # Generate ChordPro from BL (lyrics only)
        chordpro = generate_chordpro_from_bl(bl_data, data['bl_url'])

        # Write work.yaml
        work_yaml = create_work_yaml(slug, bl_data['title'], bl_data['source_url'])
        (work_dir / "work.yaml").write_text(work_yaml)

        # Write lead-sheet.pro
        (work_dir / "lead-sheet.pro").write_text(chordpro)

        print(f"CREATED {slug} (lyrics only)")
        imported += 1

    print()
    print(f"Imported: {imported}")
    print(f"Skipped (already exists): {skipped_exists}")
    print(f"Skipped (imported with chords): {skipped_already}")
    print(f"Skipped (no BL file): {skipped_no_bl}")

    if not args.dry_run and imported > 0:
        print()
        print("Run ./scripts/bootstrap --quick to rebuild the index")


if __name__ == "__main__":
    main()
