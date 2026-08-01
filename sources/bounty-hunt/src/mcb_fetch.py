#!/usr/bin/env python3
"""
Fetch jam charts from mattcbruno.com's song library (Google Docs).

The site exposes a JSON manifest of 441 charts; each chart is a public
Google Doc that exports as plain chords-over-lyrics text. We fetch the
bounty-board matches (default) into web-chords raw format, parse them with
the web-chords parser, then stamp artist/key from the manifest onto the
parsed .pro files (the parser only derives artists from UG-style URLs).

Usage:
    uv run python sources/bounty-hunt/src/mcb_fetch.py            # wanted only
    uv run python sources/bounty-hunt/src/mcb_fetch.py --all      # whole library
    uv run python sources/bounty-hunt/src/mcb_fetch.py --stamp    # post-parse stamp
"""

import argparse
import json
import re
import time
import unicodedata
import urllib.request
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = BASE / "raw-mcb"
PARSED_DIR = BASE / "parsed-mcb"
MANIFEST_FILE = BASE / "mcb_manifest.json"
WANTED_FILE = REPO_ROOT / "docs" / "data" / "wanted_songs.json"

MANIFEST_URL = "https://mattcbruno.com/wp-json/jsl-song-library/v1/songs"
RATE_DELAY = 1.2


def norm(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    t = t.lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9\s]", "", t)
    t = re.sub(r"\b(the|a|an)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def slugify(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-") or "untitled"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bluegrassbook.com songbook builder (respectful fetch)"})
    return urllib.request.urlopen(req, timeout=30).read()


def doc_txt_url(doc_url):
    m = re.search(r"/d/([\w-]+)", doc_url or "")
    return f"https://docs.google.com/document/d/{m.group(1)}/export?format=txt" if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="fetch the whole library, not just wanted matches")
    ap.add_argument("--stamp", action="store_true", help="only stamp artist/key onto parsed-mcb/*.pro")
    args = ap.parse_args()

    if MANIFEST_FILE.exists():
        manifest = json.load(open(MANIFEST_FILE))
    else:
        manifest = json.loads(fetch(MANIFEST_URL))
        MANIFEST_FILE.write_text(json.dumps(manifest, indent=1))
    by_slug = {slugify(m["jslSongName"].split("/")[0]): m for m in manifest}

    if args.stamp:
        stamped = 0
        for pro in PARSED_DIR.glob("*.pro"):
            m = by_slug.get(pro.stem.removeprefix("mcb-"))
            if not m:
                continue
            text = pro.read_text()
            lines = text.split("\n")
            insert = []
            artist = (m.get("jslOriginalArtist") or "").strip()
            if artist and artist.lower() != "traditional" and "{meta: artist" not in text:
                insert.append(f"{{meta: artist {artist}}}")
            key = (m.get("jslOriginalKey") or "").strip()
            tonality = (m.get("jslTonality") or "").strip()
            if key and "{key:" not in text:
                if tonality.lower() == "minor" and not key.endswith("m"):
                    key += "m"
                insert.append(f"{{key: {key}}}")
            if m.get("jslDocUrl") and "x_source_url" not in text:
                insert.append(f"{{meta: x_source_url {m['jslDocUrl']}}}")
            if insert:
                lines[1:1] = insert
                pro.write_text("\n".join(lines))
                stamped += 1
        print(f"stamped {stamped} files")
        return

    wanted_norms = {norm(s["title"]) for s in json.load(open(WANTED_FILE))["songs"]}
    todo = []
    for m in manifest:
        title = m["jslSongName"]
        primary = title.split("/")[0].strip()
        if not args.all and not ({norm(title), norm(primary)} & wanted_norms):
            continue
        todo.append((primary, m))

    RAW_DIR.mkdir(exist_ok=True)
    print(f"to fetch: {len(todo)}")
    ok = failed = 0
    for i, (primary, m) in enumerate(todo):
        slug = "mcb-" + slugify(primary)
        out = RAW_DIR / f"{slug}.txt"
        if out.exists():
            continue
        url = doc_txt_url(m.get("jslDocUrl"))
        if not url:
            print(f"  [{i+1}] {primary}: no doc url")
            failed += 1
            continue
        try:
            txt = fetch(url).decode("utf-8-sig", errors="replace").replace("\r\n", "\n")
        except Exception as e:
            print(f"  [{i+1}] {primary}: FETCH ERROR {e}")
            failed += 1
            time.sleep(RATE_DELAY)
            continue
        # No source_url header: the web-chords parser slug-checks URL paths,
        # and Google-Docs paths (/document/d/{id}/edit) read as a bogus title
        # slug and fail every file. The real URL is stamped as x_source_url
        # in the --stamp step instead.
        header = (f"# title: {primary}\n"
                  f"# fetched_at: {datetime.now().isoformat(timespec='seconds')}\n\n")
        out.write_text(header + txt)
        ok += 1
        print(f"  [{i+1}/{len(todo)}] {primary} ok", flush=True)
        time.sleep(RATE_DELAY)
    print(f"fetched {ok}, failed {failed}")
    print("next: parse with web-chords parser --raw-dir raw-mcb --out-dir parsed-mcb, then --stamp")


if __name__ == "__main__":
    main()
