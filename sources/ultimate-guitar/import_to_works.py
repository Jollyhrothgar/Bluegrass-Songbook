#!/usr/bin/env python3
"""
Import merged UG+BL songs to works/ directory.

Usage:
    uv run python sources/ultimate-guitar/import_to_works.py
    uv run python sources/ultimate-guitar/import_to_works.py --dry-run
    uv run python sources/ultimate-guitar/import_to_works.py --song <slug>
"""
import argparse
import json
import re
from datetime import date
from pathlib import Path

RESULTS_DIR = Path(__file__).parent / "results"
WORKS_DIR = Path(__file__).parent.parent.parent / "works"


def count_words(text: str) -> int:
    """Count words excluding chord markers."""
    clean = re.sub(r'\[.*?\]', '', text)
    return len(clean.split())


def has_chord_line(line: dict) -> bool:
    """Check if line has chords."""
    return '[' in line.get('text', '')


def has_good_section(data: dict, min_words: int = 20, min_match: float = 0.85) -> bool:
    """Check if song has at least one section with good chord matches."""
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


def is_eligible(data: dict) -> bool:
    """Check if song should be imported."""
    cov = data['metrics']['coverage']
    if cov >= 0.70:
        return True
    return has_good_section(data)


def create_work_yaml(data: dict) -> str:
    """Generate work.yaml content."""
    today = date.today().isoformat()

    yaml_lines = [
        f"id: {data['bl_slug']}",
        f"title: {data['title']}",
        "parts:",
        "  - type: lead-sheet",
        "    format: chordpro",
        "    file: lead-sheet.pro",
        "    default: true",
        "    provenance:",
        "      source: ultimate-guitar",
        f"      source_url: {data['ug_url']}",
        f"      imported_at: '{today}'",
    ]

    return '\n'.join(yaml_lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description="Import merged songs to works/")
    parser.add_argument("--dry-run", action="store_true",
                       help="Show what would be done without doing it")
    parser.add_argument("--song", type=str,
                       help="Import single song by slug")
    args = parser.parse_args()

    # Get files to process
    if args.song:
        files = [RESULTS_DIR / f"{args.song}.json"]
        if not files[0].exists():
            print(f"ERROR: No result for {args.song}")
            return
    else:
        files = sorted(RESULTS_DIR.glob("*.json"))

    imported = 0
    skipped = 0

    for result_file in files:
        with open(result_file) as f:
            data = json.load(f)

        if not is_eligible(data):
            skipped += 1
            continue

        slug = data['bl_slug']
        work_dir = WORKS_DIR / slug

        if work_dir.exists():
            print(f"SKIP {slug}: already exists")
            skipped += 1
            continue

        if args.dry_run:
            cov = data['metrics']['coverage']
            print(f"WOULD CREATE {slug} (coverage: {cov:.0%})")
            imported += 1
            continue

        # Create work directory
        work_dir.mkdir(parents=True, exist_ok=True)

        # Write work.yaml
        work_yaml = create_work_yaml(data)
        (work_dir / "work.yaml").write_text(work_yaml)

        # Write lead-sheet.pro
        (work_dir / "lead-sheet.pro").write_text(data['chordpro'])

        cov = data['metrics']['coverage']
        print(f"CREATED {slug} (coverage: {cov:.0%})")
        imported += 1

    print()
    print(f"Imported: {imported}")
    print(f"Skipped: {skipped}")

    if not args.dry_run and imported > 0:
        print()
        print("Run ./scripts/bootstrap --quick to rebuild the index")


if __name__ == "__main__":
    main()
