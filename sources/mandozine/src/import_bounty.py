#!/usr/bin/env python3
"""
Import wanted-list instrumentals from the Mandozine TablEdit archive.

Mandozine (mandozine.com) publishes ~3,000 contributed TablEdit files as
bulk zips (frozen 2019). `sources/mandozine/tabs/` holds the extracted
archive. This driver matches still-missing wanted instrumentals against
the archive filenames ({Title}-{Key}-{Author}.tef), converts one file per
tune through the shared Hangout TEF->OTF pipeline, and imports via the
shared works importer — then rewrites each imported part's provenance to
honest mandozine values (the shared importer templates Hangout detail-page
URLs that don't exist on mandozine).

Usage:
    uv run python sources/mandozine/src/import_bounty.py --dry-run
    uv run python sources/mandozine/src/import_bounty.py
"""

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from catalog import TabEntry                        # noqa: E402
from converter import TEFConverter                  # noqa: E402
from site_config import SiteConfig                  # noqa: E402
from works_importer import find_matching_work, import_tab  # noqa: E402

DATA_DIR = REPO_ROOT / "sources" / "mandozine"
TABS_DIR = DATA_DIR / "tabs"
WANTED_FILE = REPO_ROOT / "docs" / "data" / "wanted_songs.json"
ARCHIVE_URL = "https://mandozine.com/music/zip_files/allfiles.zip"

# Known-false filename matches (different tune with a containing name).
EXCLUDE_TITLES = {"fortune"}  # matches BanishMisfortune (Irish, unrelated)

SITE = SiteConfig(
    name="mandozine",
    source="mandozine",
    fallback_instrument="mandolin",
    data_dir=DATA_DIR,
    base_url="https://mandozine.com",
    instrument_words=("mandolin", "mando"),
)


def norm(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    t = t.lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9\s]", "", t)
    t = re.sub(r"\b(the|a|an)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def squash(t):
    return norm(t).replace(" ", "")


def parse_filename(name):
    """{Title}-{Key}-{Author}[-Guitar].tef -> (author, key, is_guitar)."""
    stem = re.sub(r"\.tef$", "", name, flags=re.I)
    parts = stem.split("-")
    is_guitar = parts[-1].lower() == "guitar"
    if is_guitar:
        parts = parts[:-1]
    key = author = None
    if len(parts) >= 3 and re.fullmatch(r"[A-G][#b]?m?", parts[-2]):
        key, author = parts[-2], parts[-1]
    elif len(parts) >= 2 and re.fullmatch(r"[A-G][#b]?m?", parts[-1]):
        key = parts[-1]
    return author, key, is_guitar


def pick_file(title, files):
    """One arrangement per tune: prefer mandolin over guitar, Trad first."""
    sq = squash(title)
    cands = [f for f in files
             if squash(re.sub(r"\.tef$", "", f.name, flags=re.I)).startswith(sq)]
    if not cands:
        return None
    def rank(f):
        author, _key, is_guitar = parse_filename(f.name)
        return (is_guitar, 0 if (author or "").lower() == "trad" else 1, f.name)
    return sorted(cands, key=rank)[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wanted = [s for s in json.load(open(WANTED_FILE))["songs"]
              if s["type"] not in ("Vocal", "Gospel")]
    have = set()
    for p in (REPO_ROOT / "works").glob("*/work.yaml"):
        have.add(norm(yaml.safe_load(open(p)).get("title", "")))
    missing = [s for s in wanted
               if norm(s["title"]) not in have
               and norm(s["title"]) not in EXCLUDE_TITLES]

    files = sorted(TABS_DIR.glob("*.tef"))
    picks = []
    for s in missing:
        f = pick_file(s["title"], files)
        if f:
            picks.append((s["title"], f))

    print(f"{len(picks)} picks from {len(missing)} missing tunes")
    for title, f in picks:
        print(f"  {title} -> {f.name}")
    if args.dry_run:
        return

    SITE.parsed_dir.mkdir(parents=True, exist_ok=True)
    converter = TEFConverter(SITE)
    imported = []
    for title, f in picks:
        author, key, _g = parse_filename(f.name)
        tab_id = f"mz{squash(title)[:40]}_tef"
        tab = TabEntry(id=tab_id, title=title, author=author, format="tef",
                       source_url=ARCHIVE_URL, status="downloaded")
        print(f"Converting {f.name}")
        out_path, _meta = converter.convert(f, tab)
        if not out_path:
            print("  conversion failed")
            continue
        slug = import_tab(_FakeCatalog(), tab, SITE)
        if not slug:
            continue
        # Rewrite the templated Hangout-style provenance to honest values.
        wy = REPO_ROOT / "works" / slug / "work.yaml"
        w = yaml.safe_load(open(wy))
        for part in w.get("parts", []):
            prov = part.get("provenance") or {}
            if prov.get("source") == "mandozine" and prov.get("source_id") == tab_id.split("_")[0]:
                prov["source_url"] = ARCHIVE_URL
                prov["source_file"] = f.name
                prov.pop("source_id", None)
        if key and not w.get("default_key"):
            w["default_key"] = key
        wy.write_text(yaml.dump(w, sort_keys=False, allow_unicode=True,
                                default_flow_style=False))
        imported.append((title, slug, f.name))
        print(f"  imported -> {slug}")

    print(f"\nImported {len(imported)}/{len(picks)}")


class _FakeCatalog:
    """import_tab only reads catalog for nothing we need; stub."""
    tabs = {}


if __name__ == "__main__":
    main()
