#!/usr/bin/env python3
"""
Parse the golden_standard.txt file and split into individual ChordPro files.

This script:
1. Reads the raw file containing multiple songs separated by {new_song}
2. Converts metadata format from {title: X} to {meta: title X}
3. Expands short section directives ({soc} -> {start_of_chorus})
4. Adds provenance metadata for issue #33
5. Writes each song to a separate .pro file
"""

import re
from pathlib import Path


def sanitize_filename(title: str) -> str:
    """Convert a title to a valid filename."""
    # Remove or replace invalid characters
    sanitized = title.lower()
    sanitized = re.sub(r"['\"]", "", sanitized)  # Remove quotes
    sanitized = re.sub(r"[^a-z0-9]+", "", sanitized)  # Keep only alphanumeric
    return sanitized


def convert_metadata_line(line: str) -> str:
    """Convert old-style metadata to new {meta: key value} format."""
    # Pattern: {key: value} -> {meta: key value}
    # But keep {key: X}, {time: X}, {tempo: X}, {capo: X} as-is
    standalone_directives = {"key", "time", "tempo", "capo"}

    match = re.match(r"\{(\w+):\s*(.+?)\}$", line.strip())
    if match:
        directive, value = match.groups()
        if directive in standalone_directives:
            return line  # Keep as-is
        elif directive == "meta":
            return line  # Already in meta format
        elif directive in ("title", "artist", "composer", "lyricist", "album", "year"):
            return f"{{meta: {directive} {value}}}"
        elif directive == "new_song":
            return ""  # Remove song separators

    return line


def convert_section_directives(line: str) -> str:
    """Expand short section directives to full form."""
    replacements = {
        "{soc}": "{start_of_chorus}",
        "{eoc}": "{end_of_chorus}",
        "{sov}": "{start_of_verse}",
        "{eov}": "{end_of_verse}",
        "{sob}": "{start_of_bridge}",
        "{eob}": "{end_of_bridge}",
        "{sot}": "{start_of_tab}",
        "{eot}": "{end_of_tab}",
    }
    for short, full in replacements.items():
        if line.strip() == short:
            return full
    return line


def convert_custom_meta(line: str) -> str:
    """Convert custom meta fields like {meta: note X} to {meta: x_notes X}."""
    # {meta: note X} -> {meta: x_notes X}
    match = re.match(r"\{meta:\s*note\s+(.+?)\}$", line.strip())
    if match:
        return f"{{meta: x_notes {match.group(1)}}}"

    # {meta: description X} -> {meta: x_notes X}
    match = re.match(r"\{meta:\s*description\s+(.+?)\}$", line.strip())
    if match:
        return f"{{meta: x_notes {match.group(1)}}}"

    # {meta: timing X} -> {meta: x_notes X}
    match = re.match(r"\{meta:\s*timing\s+(.+?)\}$", line.strip())
    if match:
        return f"{{meta: x_notes Timing: {match.group(1)}}}"

    return line


def add_verse_structure(body_lines: list[str], has_chorus: bool) -> list[str]:
    """
    Add verse markers to unmarked content blocks.

    For songs with a chorus:
    - Wrap unmarked blocks in {start_of_verse}/{end_of_verse}
    - Add {chorus} after each verse AFTER the chorus has been defined

    For songs without a chorus:
    - Wrap all blocks as verses
    """
    result = []
    current_block = []
    in_chorus = False
    in_verse = False
    verse_count = 0
    chorus_defined = False  # Track if we've seen the chorus definition

    def flush_block(add_chorus_ref: bool = False):
        """Output the current block with appropriate markers."""
        nonlocal current_block, verse_count
        if not current_block:
            return

        # Check if block has any actual content (not just whitespace)
        has_content = any(line.strip() and not line.strip().startswith("{") for line in current_block)
        if not has_content:
            current_block = []
            return

        verse_count += 1
        result.append(f"{{start_of_verse: Verse {verse_count}}}")
        result.extend(current_block)
        result.append("{end_of_verse}")

        # Add chorus repeat indicator only if chorus has been defined
        if add_chorus_ref and chorus_defined:
            result.append("")
            result.append("{chorus}")

        current_block = []

    for line in body_lines:
        stripped = line.strip()

        # Handle section markers
        if stripped == "{soc}" or stripped == "{start_of_chorus}":
            # Flush any pending verse block first (don't add chorus ref yet)
            flush_block(add_chorus_ref=False)
            result.append("")
            result.append("{start_of_chorus}")
            in_chorus = True
            continue
        elif stripped == "{eoc}" or stripped == "{end_of_chorus}":
            result.append("{end_of_chorus}")
            in_chorus = False
            chorus_defined = True  # Chorus is now defined
            continue
        elif stripped == "{sov}" or stripped.startswith("{start_of_verse"):
            # Already has verse markers - respect them
            flush_block(add_chorus_ref=has_chorus)
            result.append("")
            result.append(convert_section_directives(stripped))
            in_verse = True
            continue
        elif stripped == "{eov}" or stripped == "{end_of_verse}":
            result.append("{end_of_verse}")
            in_verse = False
            if has_chorus and chorus_defined:
                result.append("")
                result.append("{chorus}")
            continue

        # If in a marked section, pass through
        if in_chorus or in_verse:
            result.append(line)
            continue

        # Blank line = potential block separator
        if not stripped:
            if current_block:
                flush_block(add_chorus_ref=has_chorus)
            result.append("")
            continue

        # Skip other directives but pass them through
        if stripped.startswith("{") and stripped.endswith("}"):
            if current_block:
                flush_block(add_chorus_ref=has_chorus)
            result.append(line)
            continue

        # Content line - add to current block
        current_block.append(line)

    # Flush any remaining block
    flush_block(add_chorus_ref=has_chorus)

    # Clean up: remove duplicate blank lines and trailing chorus after last verse
    cleaned = []
    prev_blank = False
    for i, line in enumerate(result):
        is_blank = not line.strip()

        # Skip duplicate blanks
        if is_blank and prev_blank:
            continue

        # Remove {chorus} if it's at the end (after last verse, no more content follows)
        if line.strip() == "{chorus}":
            # Check if there's any more content after this
            remaining = result[i + 1:]
            has_more_content = any(
                l.strip() and l.strip() != "{chorus}" and not l.strip().startswith("{end_")
                for l in remaining
            )
            if not has_more_content:
                continue

        cleaned.append(line)
        prev_blank = is_blank

    return cleaned


def process_song(song_text: str) -> tuple[str, str]:
    """
    Process a single song's text.
    Returns (title, processed_content).
    """
    lines = song_text.strip().split("\n")
    processed_lines = []
    title = None
    artist = None
    other_meta = []
    body_lines = []

    # First pass: extract and organize metadata
    in_body = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if title is not None:  # Only start body after we have a title
                in_body = True
            body_lines.append("")
            continue

        # Check for title
        title_match = re.match(r"\{title:\s*(.+?)\}$", stripped)
        if title_match:
            title = title_match.group(1)
            continue

        # Check for artist
        artist_match = re.match(r"\{artist:\s*(.+?)\}$", stripped)
        if artist_match:
            artist = artist_match.group(1)
            continue

        # Check for other metadata (key, time, tempo, meta fields)
        if re.match(r"\{(key|time|tempo|capo|meta):", stripped):
            other_meta.append(stripped)
            continue

        # Check if it's a {new_song} separator (skip it)
        if stripped == "{new_song}":
            continue

        # Everything else is body
        in_body = True
        body_lines.append(line)

    if not title:
        return None, None

    # Check if song has a chorus section
    has_chorus = any(
        "{soc}" in line or "{start_of_chorus}" in line
        for line in body_lines
    )

    # Build the processed song
    # 1. Required metadata
    processed_lines.append(f"{{meta: title {title}}}")
    if artist:
        processed_lines.append(f"{{meta: artist {artist}}}")

    # 2. Provenance metadata
    processed_lines.append("{meta: x_source golden-standard}")
    processed_lines.append("{meta: x_submitted_by github:Jollyhrothgar}")
    processed_lines.append("{meta: x_submitted 2025-12-27}")
    processed_lines.append("{meta: x_submission_issue 33}")

    # 3. Other metadata (key, time, tempo, custom meta)
    for meta_line in other_meta:
        # Convert {meta: note X} to {meta: x_notes X}
        converted = convert_custom_meta(meta_line)
        processed_lines.append(converted)

    # 4. Process body with verse structure
    structured_body = add_verse_structure(body_lines, has_chorus)
    processed_lines.extend(structured_body)

    # Remove leading/trailing blank lines from body, but keep one after metadata
    while processed_lines and not processed_lines[-1].strip():
        processed_lines.pop()

    # Ensure file ends with newline
    content = "\n".join(processed_lines) + "\n"

    return title, content


def main():
    raw_file = Path(__file__).parent / "raw" / "golden_standard.txt"
    parsed_dir = Path(__file__).parent / "parsed"
    parsed_dir.mkdir(exist_ok=True)

    # Read the raw file
    content = raw_file.read_text(encoding="utf-8")

    # Split by {new_song} first
    # Handle both with and without newlines around it
    songs = re.split(r"\n?\{new_song\}\n?", content)

    # Some songs are missing {new_song} separator - also split on {title: at line start
    # when it appears after content (not at the very start of a block)
    expanded_songs = []
    for song in songs:
        # Check if this block contains multiple {title: lines
        title_matches = list(re.finditer(r"^\{title:", song, re.MULTILINE))
        if len(title_matches) > 1:
            # Split this block into multiple songs
            for i, match in enumerate(title_matches):
                start = match.start()
                end = title_matches[i + 1].start() if i + 1 < len(title_matches) else len(song)
                expanded_songs.append(song[start:end])
        else:
            expanded_songs.append(song)
    songs = expanded_songs

    processed_count = 0
    skipped = []
    filenames_used = {}

    for song_text in songs:
        if not song_text.strip():
            continue

        title, processed_content = process_song(song_text)

        if not title:
            skipped.append(song_text[:100])
            continue

        # Generate filename
        base_filename = sanitize_filename(title)
        if not base_filename:
            skipped.append(f"Empty filename for: {title}")
            continue

        # Handle duplicates by adding a suffix
        filename = base_filename
        counter = 1
        while filename in filenames_used:
            counter += 1
            filename = f"{base_filename}{counter}"

        filenames_used[filename] = title

        # Write the file
        output_path = parsed_dir / f"{filename}.pro"
        output_path.write_text(processed_content, encoding="utf-8")
        processed_count += 1
        print(f"Created: {output_path.name}")

    print(f"\nProcessed {processed_count} songs")
    if skipped:
        print(f"Skipped {len(skipped)} entries:")
        for s in skipped[:5]:
            print(f"  - {s}...")


if __name__ == "__main__":
    main()
