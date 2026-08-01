#!/usr/bin/env python3
"""
Gate parsed bounty charts on validation before import.

  --queue    print the needs_review items (with lyric snippets) as JSON,
             ready for a knowledge-based review pass
  (default)  copy eligible parsed/*.pro into staging/ for works_importer

Eligible = extraction status "accepted" AND (not needs_review, or slug is
approved in review_decisions.json). review_decisions.json:

  {"approved": ["slug", ...], "rejected": {"slug": "why", ...}}

Then:
  uv run python sources/web-chords/src/works_importer.py \
      --parsed-dir sources/bounty-hunt/staging \
      --report sources/bounty-hunt/import_report.json \
      --new-ids sources/bounty-hunt/new_work_ids.txt
"""

import argparse
import json
import re
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
EXTRACT_DIR = BASE / "extractions"
PARSED_DIR = BASE / "parsed"
STAGING_DIR = BASE / "staging"
DECISIONS_FILE = BASE / "review_decisions.json"


def lyric_snippet(content: str, n: int = 4) -> list:
    lines = []
    text = re.sub(r"\[/?(tab|ch)\]", "", content or "")
    for line in text.split("\n"):
        line = line.strip()
        if not line or line.startswith("["):
            continue
        toks = line.split()
        chordish = sum(1 for t in toks if re.match(
            r"^[A-G][#b]?(m|maj|min|dim|aug|sus|add)?\d*(/[A-G][#b]?)?$", t))
        if toks and chordish / len(toks) > 0.6:
            continue
        lines.append(line)
        if len(lines) >= n:
            break
    return lines


def load_extractions():
    out = {}
    for f in EXTRACT_DIR.glob("*.json"):
        try:
            out[f.stem] = json.load(open(f))
        except Exception:
            pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queue", action="store_true",
                    help="print needs_review queue instead of staging")
    args = ap.parse_args()

    extractions = load_extractions()

    if args.queue:
        queue = []
        for slug, rec in sorted(extractions.items()):
            if rec.get("status") != "accepted":
                continue
            v = rec.get("validation", {})
            if not v.get("needs_review"):
                continue
            cand = rec.get("candidate", {})
            queue.append({
                "slug": slug,
                "wanted_title": rec["wanted"]["title"],
                "wanted_artists": (rec["wanted"].get("artists") or [])[:4],
                "ug_artist": cand.get("artist_name"),
                "ug_title": cand.get("song_name"),
                "version_note": cand.get("version_description") or None,
                "votes": cand.get("votes"),
                "lyrics": lyric_snippet(rec.get("content")),
            })
        print(json.dumps(queue, indent=1))
        return

    decisions = {"approved": [], "rejected": {}}
    if DECISIONS_FILE.exists():
        decisions = json.load(open(DECISIONS_FILE))
    approved = set(decisions.get("approved", []))
    rejected = decisions.get("rejected", {})

    STAGING_DIR.mkdir(exist_ok=True)
    for old in STAGING_DIR.glob("*.pro"):
        old.unlink()

    staged, held, dropped = [], [], []
    for pro in sorted(PARSED_DIR.glob("*.pro")):
        slug = pro.stem
        rec = extractions.get(slug)
        if not rec or rec.get("status") != "accepted":
            held.append((slug, "no accepted extraction"))
            continue
        if slug in rejected:
            dropped.append((slug, rejected[slug]))
            continue
        v = rec.get("validation", {})
        if v.get("needs_review") and slug not in approved:
            held.append((slug, f"needs review (UG artist: "
                               f"{rec.get('candidate', {}).get('artist_name')})"))
            continue
        shutil.copy2(pro, STAGING_DIR / pro.name)
        staged.append(slug)

    print(f"staged   {len(staged)}")
    print(f"held     {len(held)}")
    for slug, why in held:
        print(f"    {slug}: {why}")
    print(f"rejected {len(dropped)}")
    for slug, why in dropped:
        print(f"    {slug}: {why}")


if __name__ == "__main__":
    main()
