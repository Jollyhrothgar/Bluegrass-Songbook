#!/usr/bin/env python3
"""Build posts.json manifest from markdown files in docs/posts/."""

import json
import re
from pathlib import Path


POSTS_DIR = Path(__file__).parent.parent.parent / "docs" / "posts"
OUTPUT_FILE = Path(__file__).parent.parent.parent / "docs" / "data" / "posts.json"


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from markdown content.

    Returns (metadata dict, body content).
    """
    if not content.startswith("---"):
        return {}, content

    # Find the closing ---
    end_match = re.search(r"\n---\s*\n", content[3:])
    if not end_match:
        return {}, content

    frontmatter_text = content[3:end_match.start() + 3]
    body = content[end_match.end() + 3:]

    # Simple YAML parsing (just key: value pairs)
    metadata = {}
    for line in frontmatter_text.strip().split("\n"):
        if ":" in line:
            key, _, value = line.partition(":")
            metadata[key.strip()] = value.strip()

    return metadata, body


def build_posts_manifest():
    """Scan posts directory and build manifest."""
    if not POSTS_DIR.exists():
        print(f"Posts directory not found: {POSTS_DIR}")
        return

    posts = []

    for md_file in sorted(POSTS_DIR.glob("*.md"), reverse=True):
        content = md_file.read_text()
        metadata, body = parse_frontmatter(content)

        # Extract slug from filename (e.g., 2024-12-28-hello-world.md -> 2024-12-28-hello-world)
        slug = md_file.stem

        # Use frontmatter or derive from filename
        title = metadata.get("title", slug.split("-", 3)[-1].replace("-", " ").title())
        date = metadata.get("date", slug[:10] if len(slug) >= 10 else "")
        summary = metadata.get("summary", "")

        # If no summary, extract first paragraph
        if not summary:
            # Skip headings and empty lines, get first paragraph
            lines = [l for l in body.strip().split("\n") if l.strip() and not l.startswith("#")]
            if lines:
                summary = lines[0][:200]
                if len(lines[0]) > 200:
                    summary += "..."

        posts.append({
            "slug": slug,
            "title": title,
            "date": date,
            "summary": summary
        })

    # Ensure output directory exists
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(posts, f, indent=2)

    print(f"Built {len(posts)} posts -> {OUTPUT_FILE}")


if __name__ == "__main__":
    build_posts_manifest()
