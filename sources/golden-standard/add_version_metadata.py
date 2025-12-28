#!/usr/bin/env python3
"""
Add version metadata to golden-standard songs.

For songs that overlap with classic-country, mark them as alternate versions.
For all songs, add clear provenance referencing Ryan Schindler's Golden Standard book.
"""

import re
from pathlib import Path

# Songs that overlap with classic-country (normalized titles)
OVERLAPPING_TITLES = {
    "a hundred years from now",
    "angel band",
    "any old time",
    "big spike hammer",
    "blue moon of kentucky",
    "blue night",
    "blue ridge cabin home",
    "carolina in the pines",
    "carolina star",
    "columbus stockade blues",
    "crawdad song",
    "dark hollow",
    "deep elem blues",
    "dim lights thick smoke",
    "faded love",
    "footprints in the snow",
    "freeborn man",
    "ginseng sullivan",
    "gotta travel on",
    "hand me down my walking cane",
    "hello city limits",
    "how mountain girls can love",
    "i havent seen mary in years",
    "i wonder where you are tonight",
    "ill fly away",
    "ill never shed another tear",
    "in the pines",
    "john henry",
    "katy daley",
    "kentucky waltz",
    "last thing on my mind",
    "little cabin home on the hill",
    "little maggie",
    "lonesome road blues",
    "long journey home",
    "man of constant sorrow",
    "mountain dew",
    "my little georgia rose",
    "my little girl in tennessee",
    "new river train",
    "nine pound hammer",
    "ocean of diamonds",
    "old home place",
    "one more night",
    "rocky top",
    "salty dog blues",
    "shady grove",
    "stone walls and steel bars",
    "this land is your land",
    "tom dooley",
    "toy heart",
    "walk on boy",
    "way downtown",
    "wayfaring stranger",
    "what a waste of good corn liquor",
    "whiskey",
    "why you been gone so long",
    "will the circle be unbroken",
    "your love is like a flower",
}


def normalize_title(title: str) -> str:
    """Normalize title for comparison."""
    return re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()


def process_song(filepath: Path) -> None:
    """Add version metadata to a song file."""
    content = filepath.read_text(encoding="utf-8")
    lines = content.split("\n")

    # Extract title
    title = None
    for line in lines:
        match = re.match(r"\{meta: title (.+)\}", line)
        if match:
            title = match.group(1)
            break

    if not title:
        print(f"Warning: No title found in {filepath.name}")
        return

    normalized = normalize_title(title)
    is_overlap = normalized in OVERLAPPING_TITLES

    # Find where to insert version metadata (after x_submission_issue line)
    new_lines = []
    inserted = False

    for i, line in enumerate(lines):
        new_lines.append(line)

        # Insert after x_submission_issue
        if not inserted and "{meta: x_submission_issue 33}" in line:
            # Add book reference for all songs
            new_lines.append("{meta: x_book The Golden Standard by Ryan Schindler}")

            # Add version metadata only for overlapping songs
            if is_overlap:
                new_lines.append("{meta: x_version_label Golden Standard}")
                new_lines.append("{meta: x_version_type alternate}")
                new_lines.append("{meta: x_version_notes From Ryan Schindler's Golden Standard bluegrass fakebook}")

            inserted = True

    if not inserted:
        print(f"Warning: Could not find insertion point in {filepath.name}")
        return

    # Write back
    filepath.write_text("\n".join(new_lines), encoding="utf-8")

    status = "overlap/alternate" if is_overlap else "unique"
    print(f"Updated: {filepath.name} ({status})")


def main():
    parsed_dir = Path(__file__).parent / "parsed"

    overlap_count = 0
    unique_count = 0

    for filepath in sorted(parsed_dir.glob("*.pro")):
        content = filepath.read_text()
        title_match = re.search(r"\{meta: title (.+)\}", content)
        if title_match:
            normalized = normalize_title(title_match.group(1))
            if normalized in OVERLAPPING_TITLES:
                overlap_count += 1
            else:
                unique_count += 1

        process_song(filepath)

    print(f"\nSummary:")
    print(f"  Overlapping songs (marked as alternate): {overlap_count}")
    print(f"  Unique songs: {unique_count}")
    print(f"  Total: {overlap_count + unique_count}")


if __name__ == "__main__":
    main()
