#!/usr/bin/env python3
"""
Count lines of code in the project, broken down by language.

Usage:
    python scripts/lib/loc_counter.py [path]
"""

import sys
from pathlib import Path
from collections import defaultdict

# Map file extensions to language names
EXTENSION_MAP = {
    ".py": "Python",
    ".js": "JavaScript",
    ".ts": "TypeScript",
    ".html": "HTML",
    ".css": "CSS",
    ".json": "JSON",
    ".md": "Markdown",
    ".yml": "YAML",
    ".yaml": "YAML",
    ".sh": "Shell",
    ".bash": "Shell",
    ".sql": "SQL",
    ".pro": "ChordPro",
    ".cho": "ChordPro",
    ".chopro": "ChordPro",
}

# Directories to skip
SKIP_DIRS = {
    ".git",
    ".bare",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    ".uv",
    "raw",  # Skip raw HTML source files
    "dist",
    "build",
}

# Files to skip
SKIP_FILES = {
    "package-lock.json",
    "uv.lock",
}


def count_lines(file_path: Path) -> int:
    """Count non-empty lines in a file."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return sum(1 for line in f if line.strip())
    except Exception:
        return 0


def scan_directory(root: Path) -> dict[str, dict[str, int]]:
    """
    Scan directory and count lines by language.

    Returns dict mapping language -> {"files": count, "lines": count}
    """
    stats = defaultdict(lambda: {"files": 0, "lines": 0})

    for path in root.rglob("*"):
        # Skip directories
        if path.is_dir():
            continue

        # Skip if any parent directory is in skip list
        if any(part in SKIP_DIRS for part in path.parts):
            continue

        # Skip specific files
        if path.name in SKIP_FILES:
            continue

        # Get language from extension
        ext = path.suffix.lower()
        language = EXTENSION_MAP.get(ext)

        if language:
            lines = count_lines(path)
            stats[language]["files"] += 1
            stats[language]["lines"] += lines

    return stats


def format_number(n: int) -> str:
    """Format number with commas."""
    return f"{n:,}"


def main():
    # Get path from args or use current directory
    if len(sys.argv) > 1:
        root = Path(sys.argv[1])
    else:
        root = Path.cwd()

    if not root.exists():
        print(f"Error: {root} does not exist")
        sys.exit(1)

    print(f"Counting lines of code in: {root}\n")

    stats = scan_directory(root)

    if not stats:
        print("No recognized source files found.")
        sys.exit(0)

    # Sort by lines descending
    sorted_stats = sorted(stats.items(), key=lambda x: x[1]["lines"], reverse=True)

    # Calculate totals
    total_files = sum(s["files"] for s in stats.values())
    total_lines = sum(s["lines"] for s in stats.values())

    # Find column widths
    lang_width = max(len(lang) for lang in stats.keys())
    files_width = max(len(format_number(s["files"])) for s in stats.values())
    lines_width = max(len(format_number(s["lines"])) for s in stats.values())

    # Print header
    print(f"{'Language':<{lang_width}}  {'Files':>{files_width}}  {'Lines':>{lines_width}}  {'%':>6}")
    print("-" * (lang_width + files_width + lines_width + 12))

    # Print each language
    for language, data in sorted_stats:
        pct = (data["lines"] / total_lines * 100) if total_lines > 0 else 0
        print(
            f"{language:<{lang_width}}  "
            f"{format_number(data['files']):>{files_width}}  "
            f"{format_number(data['lines']):>{lines_width}}  "
            f"{pct:>5.1f}%"
        )

    # Print totals
    print("-" * (lang_width + files_width + lines_width + 12))
    print(
        f"{'Total':<{lang_width}}  "
        f"{format_number(total_files):>{files_width}}  "
        f"{format_number(total_lines):>{lines_width}}"
    )


if __name__ == "__main__":
    main()
