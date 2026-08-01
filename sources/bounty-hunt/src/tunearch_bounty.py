#!/usr/bin/env python3
"""
Fetch still-missing wanted instrumentals from TuneArch (ABC notation).

For each wanted instrumental with no work, tries TuneArch and publishes a
work with an ABC-bearing ChordPro lead sheet (same shape as the
tune-request workflow's fetch_tune.py, minus the GitHub-issue provenance;
skips instead of minting -1 slugs on collision).

Usage:
    uv run python sources/bounty-hunt/src/tunearch_bounty.py --dry-run
    uv run python sources/bounty-hunt/src/tunearch_bounty.py
"""

import argparse
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "sources" / "tunearch" / "src"))

from scraper import TuneArchScraper                 # noqa: E402
from chordpro_generator import abc_to_chordpro      # noqa: E402

WANTED_FILE = REPO_ROOT / "docs" / "data" / "wanted_songs.json"
WORKS_DIR = REPO_ROOT / "works"
REPORT_FILE = Path(__file__).resolve().parents[1] / "tunearch_bounty_report.json"


def norm(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    t = t.lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9\s]", "", t)
    t = re.sub(r"\b(the|a|an)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def slugify(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:50] or "untitled"


def missing_wanted():
    import difflib
    wanted = [s for s in json.load(open(WANTED_FILE))["songs"]
              if s["type"] not in ("Vocal", "Gospel")]
    have = set()
    for p in WORKS_DIR.glob("*/work.yaml"):
        have.add(norm(yaml.safe_load(open(p)).get("title", "")))
    squashed = {h.replace(" ", "") for h in have}

    def fulfilled(title):
        n = norm(title)
        if n in have:
            return True
        sq = n.replace(" ", "")
        if sq in squashed:
            return True  # "Billy in the Low Ground" vs "Billy in the Lowground"
        # possessive/plural variants: "Watson Blues" vs "Watson's Blues"
        return any(difflib.SequenceMatcher(None, sq, h).ratio() >= 0.94
                   for h in squashed if abs(len(h) - len(sq)) <= 2)

    return [s for s in wanted if not fulfilled(s["title"])]


def publish(tune, chordpro: str) -> str | None:
    slug = slugify(tune.metadata.title)
    work_dir = WORKS_DIR / slug
    if work_dir.exists():
        return None  # never overwrite; norm-title check should prevent this

    key = None
    if tune.abc_notation:
        m = re.search(r"^K:\s*(\w+)", tune.abc_notation, re.MULTILINE)
        if m:
            key = m.group(1)

    work = {
        "id": slug,
        "title": tune.metadata.title,
        "tags": ["Instrumental"],
        "parts": [{
            "type": "lead-sheet",
            "format": "chordpro",
            "file": "lead-sheet.pro",
            "default": True,
            "provenance": {
                "source": "tunearch",
                "source_url": getattr(tune.metadata, "url", None),
                "imported_at": date.today().isoformat(),
            },
        }],
    }
    if getattr(tune.metadata, "composer", None):
        work["composers"] = [tune.metadata.composer]
    if key:
        work["default_key"] = key

    work_dir.mkdir(parents=True)
    (work_dir / "work.yaml").write_text(
        yaml.dump(work, default_flow_style=False, allow_unicode=True, sort_keys=False))
    (work_dir / "lead-sheet.pro").write_text(chordpro + "\n")
    return slug


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    missing = missing_wanted()
    print(f"missing instrumentals to try on TuneArch: {len(missing)}")
    for s in missing:
        print(f"  {s['title']} [{s['type']}]")
    if args.dry_run:
        return

    scraper = TuneArchScraper()
    report = []
    for s in missing:
        title = s["title"]
        print(f"Fetching: {title}", flush=True)
        try:
            tune = scraper.fetch_tune(title)
        except Exception as e:
            print(f"  error: {e!r}")
            report.append({"title": title, "outcome": f"error: {e!r}"})
            continue
        if not tune or not tune.abc_notation:
            print("  not found / no ABC")
            report.append({"title": title, "outcome": "not-found"})
            continue
        if norm(tune.metadata.title) != norm(title):
            print(f"  wrong tune returned: {tune.metadata.title!r}")
            report.append({"title": title, "outcome": f"wrong-tune: {tune.metadata.title}"})
            continue
        chordpro = abc_to_chordpro(tune)
        slug = publish(tune, chordpro)
        if slug:
            print(f"  published -> {slug}")
            report.append({"title": title, "outcome": f"published:{slug}"})
        else:
            print("  slug collision, skipped")
            report.append({"title": title, "outcome": "slug-collision"})

    REPORT_FILE.write_text(json.dumps(report, indent=1))
    pub = sum(1 for r in report if r["outcome"].startswith("published:"))
    print(f"\nPublished {pub}/{len(report)}; report -> {REPORT_FILE}")


if __name__ == "__main__":
    main()
