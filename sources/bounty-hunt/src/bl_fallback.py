#!/usr/bin/env python3
"""
Lyrics-only fallback: wanted vocals with no usable chart but BL lyrics on disk.

For each Vocal/Gospel wanted song whose UG extraction found nothing usable
(no-results / rejected / review-rejected) and that still has no work under
fuzzy title matching, publish a lyrics-only work from the BluegrassLyrics
parsed corpus (same shape as sources/ultimate-guitar/import_lyrics_only.py).

Usage:
    uv run python sources/bounty-hunt/src/bl_fallback.py --dry-run
    uv run python sources/bounty-hunt/src/bl_fallback.py
"""

import argparse
import difflib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE = Path(__file__).resolve().parents[1]
BL_DIR = REPO_ROOT / "sources" / "bluegrass-lyrics" / "parsed"
WORKS_DIR = REPO_ROOT / "works"
WANTED_FILE = REPO_ROOT / "docs" / "data" / "wanted_songs.json"
EXTRACT_DIR = BASE / "extractions"
REPORT_FILE = BASE / "bl_fallback_report.json"


def norm(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    t = t.lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9\s]", "", t)
    t = re.sub(r"\b(the|a|an)\b", " ", t)
    t = re.sub(r"in\b", "ing", t)
    return re.sub(r"\s+", " ", t).strip()


def squash(t):
    return norm(t).replace(" ", "")


def slugify(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:60] or "untitled"


def fulfilled_index():
    idx = set()
    for wy in WORKS_DIR.glob("*/work.yaml"):
        for line in open(wy, errors="replace"):
            if line.startswith("title:"):
                idx.add(squash(line.split(":", 1)[1]))
                break
    return idx


def is_fulfilled(title, idx):
    sq = squash(title)
    if sq in idx:
        return True
    return any(difflib.SequenceMatcher(None, sq, h).ratio() >= 0.94
               for h in idx if abs(len(h) - len(sq)) <= 3)


def bl_chordpro(bl, url):
    lines = [f"{{meta: title {bl['title']}}}",
             "{meta: x_lyrics_source bluegrass-lyrics}",
             f"{{meta: x_lyrics_url {url}}}", ""]
    for section in bl.get("sections", []):
        st = section.get("type", "verse")
        lines.append("{start_of_chorus}" if st == "chorus" else f"{{start_of_{st}}}")
        lines.extend(section.get("lines", []))
        lines.append("{end_of_chorus}" if st == "chorus" else f"{{end_of_{st}}}")
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wanted = [s for s in json.load(open(WANTED_FILE))["songs"]
              if s["type"] in ("Vocal", "Gospel")]
    bl_by_norm = {}
    for f in BL_DIR.glob("*.json"):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        n = norm(d.get("title", ""))
        if n and n not in bl_by_norm and d.get("sections"):
            bl_by_norm[n] = d

    idx = fulfilled_index()
    candidates = []
    for s in wanted:
        if is_fulfilled(s["title"], idx):
            continue
        bl = bl_by_norm.get(norm(s["title"]))
        if bl:
            candidates.append((s, bl))

    print(f"lyrics-only candidates: {len(candidates)}")
    if args.dry_run:
        for s, bl in candidates[:50]:
            print(f"  {s['title']} <- BL {bl.get('slug')}")
        return

    report, created = [], 0
    for s, bl in candidates:
        slug = slugify(bl["title"])
        work_dir = WORKS_DIR / slug
        if work_dir.exists():
            report.append({"title": s["title"], "outcome": "slug-exists"})
            continue
        url = bl.get("source_url") or f"https://www.bluegrasslyrics.com/song/{bl.get('slug')}/"
        work = {
            "id": slug, "title": bl["title"], "tags": [],
            "parts": [{"type": "lead-sheet", "format": "chordpro",
                       "file": "lead-sheet.pro", "default": True,
                       "provenance": {"source": "bluegrass-lyrics",
                                      "source_url": url,
                                      "imported_at": date.today().isoformat()}}],
        }
        work_dir.mkdir(parents=True)
        (work_dir / "work.yaml").write_text(
            yaml.dump(work, sort_keys=False, allow_unicode=True, default_flow_style=False))
        (work_dir / "lead-sheet.pro").write_text(bl_chordpro(bl, url) + "\n")
        created += 1
        report.append({"title": s["title"], "outcome": f"created:{slug}"})

    REPORT_FILE.write_text(json.dumps(report, indent=1))
    print(f"created {created} lyrics-only works; report -> {REPORT_FILE}")


if __name__ == "__main__":
    main()
