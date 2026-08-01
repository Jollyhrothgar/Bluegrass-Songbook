#!/usr/bin/env python3
"""
Fulfill wanted-list instrumentals from the Hangout Network TEF catalogs.

Maps wanted instrumentals (type != Vocal/Gospel) to already-cataloged TEF
tabs across the five Hangout sites, picks ONE arrangement per (tune, site),
downloads + converts just those, and imports them via the existing hangout
works importer (which handles instrument detection, dedupe, curation
guards). Deliberately does NOT touch other converted-but-unimported tabs
(wave-1 arrangement-promotion candidates pending editorial review).

Usage:
    uv run python sources/bounty-hunt/src/tef_bounty.py --dry-run
    uv run python sources/bounty-hunt/src/tef_bounty.py
"""

import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
HANGOUT_SRC = REPO_ROOT / "sources" / "banjo-hangout" / "src"
sys.path.insert(0, str(HANGOUT_SRC))

from catalog import TabCatalog                      # noqa: E402
from converter import TEFConverter                  # noqa: E402
from scraper import HangoutScraper                  # noqa: E402
from site_config import SITES, get_site             # noqa: E402
from works_importer import find_matching_work, import_tab  # noqa: E402

import yaml                                         # noqa: E402

WANTED_FILE = REPO_ROOT / "docs" / "data" / "wanted_songs.json"
REPORT_FILE = Path(__file__).resolve().parents[1] / "tef_bounty_report.json"

RATE_DELAY = 1.5


def norm(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    t = t.lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9\s]", "", t)
    t = re.sub(r"\b(the|a|an)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wanted = [s for s in json.load(open(WANTED_FILE))["songs"]
              if s["type"] not in ("Vocal", "Gospel")]
    wanted_by_norm = {norm(s["title"]): s for s in wanted}

    # site -> norm title -> chosen TabEntry (one arrangement per tune per site)
    picks = []
    for site_name in SITES:
        site = get_site(site_name)
        catalog = TabCatalog.for_site(site)
        by_tune = {}
        for tab in catalog.tabs.values():
            n = norm(tab.title)
            if n not in wanted_by_norm or tab.format != "tef":
                continue
            by_tune.setdefault(n, []).append(tab)
        for n, tabs in by_tune.items():
            # Idempotence: skip if a work for this tune already carries this
            # site's instrument (otherwise each rerun drains one more
            # alternate arrangement onto the work).
            wd = find_matching_work(tabs[0].title, site)
            if wd:
                w = yaml.safe_load(open(wd / "work.yaml"))
                instruments = {p.get("instrument") for p in w.get("parts", [])}
                if site.fallback_instrument in instruments:
                    continue
            # Prefer work already done: converted > downloaded > pending.
            order = {"converted": 0, "downloaded": 1, "pending": 2}
            usable = [t for t in tabs if t.status in order]
            if not usable:
                continue  # imported already, or all skipped/errored
            usable.sort(key=lambda t: (order[t.status], t.id))
            picks.append((site_name, wanted_by_norm[n]["title"], usable[0],
                          [t.id for t in usable[1:]]))

    picks.sort(key=lambda p: (p[1], p[0]))
    print(f"{len(picks)} (tune, site) picks covering "
          f"{len({p[1] for p in picks})} wanted tunes")
    for site_name, title, tab, alts in picks:
        print(f"  {title} [{site_name}] -> {tab.id} ({tab.status}, "
              f"by {tab.author or '?'}){' alts:' + str(len(alts)) if alts else ''}")
    if args.dry_run:
        return

    report = []
    by_site = {}
    for site_name, title, tab, alts in picks:
        by_site.setdefault(site_name, []).append((title, tab, alts))

    for site_name, items in by_site.items():
        site = get_site(site_name)
        catalog = TabCatalog.for_site(site)
        scraper = HangoutScraper(site)
        converter = TEFConverter(site)

        for title, pick, alts in items:
            tab = catalog.tabs[pick.id]  # live entry from this catalog instance
            entry = {"title": title, "site": site_name, "tab_id": tab.id,
                     "author": tab.author, "alternates": alts,
                     "outcome": None}
            report.append(entry)

            if tab.status == "pending":
                print(f"Downloading {tab.id}: {title} [{site_name}]")
                if scraper.download_tab(tab):
                    catalog.update_status(tab.id, "downloaded")
                else:
                    catalog.update_status(tab.id, "error", "Download failed")
                    entry["outcome"] = "download-failed"
                    time.sleep(RATE_DELAY)
                    continue
                time.sleep(RATE_DELAY)

            if tab.status == "downloaded":
                # Issue #193: downloads are named {id}_{safe_title}.tef but
                # the converter expects {id}.tef — resolve by id prefix.
                tef_path = converter.downloads_dir / f"{tab.id}.tef"
                if not tef_path.exists():
                    matches = sorted(converter.downloads_dir.glob(f"{tab.id}_*.tef"))
                    if matches:
                        tef_path = matches[0]
                if not tef_path.exists():
                    entry["outcome"] = "tef-missing"
                    catalog.update_status(tab.id, "error", "TEF file not found")
                    continue
                print(f"Converting {tab.id}: {title}")
                out_path, _meta = converter.convert(tef_path, tab)
                if out_path:
                    catalog.update_status(tab.id, "converted")
                else:
                    catalog.update_status(tab.id, "skipped", "Conversion failed")
                    entry["outcome"] = "conversion-failed"
                    continue

            if tab.status == "converted":
                print(f"Importing {tab.id}: {title}")
                slug = import_tab(catalog, tab, site)
                if slug:
                    catalog.update_status(tab.id, "imported")
                    catalog.set_work_slug(tab.id, slug)
                    entry["outcome"] = f"imported:{slug}"
                else:
                    catalog.update_status(tab.id, "skipped", "Could not import")
                    entry["outcome"] = "import-skipped"

        catalog.save()

    REPORT_FILE.write_text(json.dumps(report, indent=1))
    done = sum(1 for e in report if (e["outcome"] or "").startswith("imported:"))
    print(f"\nImported {done}/{len(report)}; report -> {REPORT_FILE}")


if __name__ == "__main__":
    main()
