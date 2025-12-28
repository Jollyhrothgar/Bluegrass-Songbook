#!/usr/bin/env python3
"""
Analyze song structures to develop heuristics for verse/chorus marking.
"""

import re
from pathlib import Path
from collections import Counter


def analyze_song(filepath: Path) -> dict:
    """Analyze a single song's structure."""
    content = filepath.read_text()
    lines = content.split("\n")

    has_chorus = "{start_of_chorus}" in content
    has_verse = "{start_of_verse}" in content

    # Find content blocks (separated by blank lines or section markers)
    blocks = []
    current_block = []
    in_chorus = False
    in_verse = False

    for line in lines:
        stripped = line.strip()

        # Skip metadata
        if stripped.startswith("{meta:") or stripped.startswith("{key:") or \
           stripped.startswith("{time:") or stripped.startswith("{tempo:"):
            continue

        # Track section markers
        if stripped == "{start_of_chorus}":
            if current_block:
                blocks.append({"type": "unmarked", "lines": current_block})
                current_block = []
            in_chorus = True
            continue
        elif stripped == "{end_of_chorus}":
            if current_block:
                blocks.append({"type": "chorus", "lines": current_block})
                current_block = []
            in_chorus = False
            continue
        elif stripped == "{start_of_verse}" or stripped.startswith("{start_of_verse:"):
            if current_block:
                blocks.append({"type": "unmarked", "lines": current_block})
                current_block = []
            in_verse = True
            continue
        elif stripped == "{end_of_verse}":
            if current_block:
                blocks.append({"type": "verse", "lines": current_block})
                current_block = []
            in_verse = False
            continue

        # Blank line = block separator (if not in a section)
        if not stripped:
            if current_block and not in_chorus and not in_verse:
                block_type = "chorus" if in_chorus else "verse" if in_verse else "unmarked"
                blocks.append({"type": block_type, "lines": current_block})
                current_block = []
            continue

        # Skip other directives
        if stripped.startswith("{"):
            continue

        # Content line
        if stripped:
            current_block.append(stripped)

    # Don't forget the last block
    if current_block:
        block_type = "chorus" if in_chorus else "verse" if in_verse else "unmarked"
        blocks.append({"type": block_type, "lines": current_block})

    # Analyze block patterns
    unmarked_count = sum(1 for b in blocks if b["type"] == "unmarked")
    chorus_count = sum(1 for b in blocks if b["type"] == "chorus")
    verse_count = sum(1 for b in blocks if b["type"] == "verse")

    # Check for repeated content (potential chorus detection)
    block_texts = ["\n".join(b["lines"]) for b in blocks]
    text_counts = Counter(block_texts)
    repeated_blocks = {text: count for text, count in text_counts.items() if count > 1}

    return {
        "file": filepath.name,
        "has_chorus_marker": has_chorus,
        "has_verse_marker": has_verse,
        "total_blocks": len(blocks),
        "unmarked_blocks": unmarked_count,
        "chorus_blocks": chorus_count,
        "verse_blocks": verse_count,
        "repeated_block_count": len(repeated_blocks),
        "blocks": blocks,
    }


def main():
    parsed_dir = Path(__file__).parent / "parsed"

    results = []
    for filepath in sorted(parsed_dir.glob("*.pro")):
        results.append(analyze_song(filepath))

    # Summary statistics
    print("=== SONG STRUCTURE ANALYSIS ===\n")

    # Category 1: Songs with chorus markers
    with_chorus = [r for r in results if r["has_chorus_marker"]]
    print(f"Songs with chorus markers: {len(with_chorus)}")
    avg_unmarked = sum(r["unmarked_blocks"] for r in with_chorus) / len(with_chorus) if with_chorus else 0
    print(f"  Average unmarked blocks (likely verses): {avg_unmarked:.1f}")

    # Category 2: Songs without any markers
    no_markers = [r for r in results if not r["has_chorus_marker"] and not r["has_verse_marker"]]
    print(f"\nSongs without any markers: {len(no_markers)}")

    # Check which have repeated blocks (potential auto-chorus detection)
    with_repeats = [r for r in no_markers if r["repeated_block_count"] > 0]
    print(f"  With repeated blocks: {len(with_repeats)}")
    print(f"  Without repeated blocks: {len(no_markers) - len(with_repeats)}")

    # Show examples
    print("\n=== EXAMPLES: Songs with chorus but unmarked verses ===")
    for r in with_chorus[:3]:
        print(f"\n{r['file']}:")
        print(f"  Blocks: {r['total_blocks']} total, {r['unmarked_blocks']} unmarked, {r['chorus_blocks']} chorus")
        for i, block in enumerate(r["blocks"]):
            preview = block["lines"][0][:50] if block["lines"] else "(empty)"
            print(f"    Block {i+1} [{block['type']}]: {preview}...")

    print("\n=== EXAMPLES: Songs without markers (with repeats) ===")
    for r in with_repeats[:3]:
        print(f"\n{r['file']}:")
        print(f"  Blocks: {r['total_blocks']} total, {r['repeated_block_count']} repeated")
        for i, block in enumerate(r["blocks"]):
            preview = block["lines"][0][:50] if block["lines"] else "(empty)"
            print(f"    Block {i+1}: {preview}...")

    print("\n=== EXAMPLES: Songs without markers (no repeats) ===")
    no_repeats = [r for r in no_markers if r["repeated_block_count"] == 0]
    for r in no_repeats[:3]:
        print(f"\n{r['file']}:")
        print(f"  Blocks: {r['total_blocks']} total")
        for i, block in enumerate(r["blocks"]):
            preview = block["lines"][0][:50] if block["lines"] else "(empty)"
            print(f"    Block {i+1}: {preview}...")


if __name__ == "__main__":
    main()
