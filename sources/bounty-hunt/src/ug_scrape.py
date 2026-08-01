#!/usr/bin/env python3
"""
Bounty-board chord scraper: fetch lyrics+chords charts for wanted songs.

Reads docs/data/wanted_songs.json (the bounty board), searches the Ultimate
Guitar mobile API for each Vocal/Gospel song, validates that the result is
the *right song* (and a bluegrass-relevant version), and writes:

  extractions/{slug}.json   full candidate + validation evidence (always)
  raw/{slug}.txt            web-chords-format raw chart (accepted charts only)

raw/ files are then parsed by the existing web-chords parser:

  uv run python sources/web-chords/src/parser.py \
      --raw-dir sources/bounty-hunt/raw \
      --out-dir sources/bounty-hunt/parsed \
      --report sources/bounty-hunt/parse_report.json

Validation tiers (recorded per song, best evidence wins):
  hint             UG artist matches the wanted-list artist hints
  mb-recording     UG artist recorded this title per bluegrass_recordings.json
  bluegrass-artist UG artist is in the MusicBrainz-derived bluegrass artist set
  traditional      UG credits Traditional / Misc (fine for canon repertoire)
  unverified       title matched but no artist evidence -> needs_review

When BluegrassLyrics parsed lyrics exist for the title, lyric overlap is
checked: strong overlap confirms the song regardless of artist; near-zero
overlap rejects the chart as a wrong-song grab.

Usage:
    uv run python sources/bounty-hunt/src/ug_scrape.py --limit 20
    uv run python sources/bounty-hunt/src/ug_scrape.py            # full run
    uv run python sources/bounty-hunt/src/ug_scrape.py --only "Train 45"
"""

import argparse
import difflib
import importlib.util
import json
import re
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE_DIR = Path(__file__).resolve().parents[1]
RAW_DIR = BASE_DIR / "raw"
EXTRACT_DIR = BASE_DIR / "extractions"
PROGRESS_FILE = BASE_DIR / "scrape_progress.json"

WANTED_FILE = REPO_ROOT / "docs" / "data" / "wanted_songs.json"
RECORDINGS_FILE = REPO_ROOT / "docs" / "data" / "bluegrass_recordings.json"
BL_PARSED_DIR = REPO_ROOT / "sources" / "bluegrass-lyrics" / "parsed"

# Reuse the proven UG mobile API client from the ultimate-guitar source.
_spec = importlib.util.spec_from_file_location(
    "ug_overnight", REPO_ROOT / "sources" / "ultimate-guitar" / "scrape_overnight.py")
_ug = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ug)
UGClient = _ug.UGClient
human_delay = _ug.human_delay
batch_pause = _ug.batch_pause
BATCH_SIZE = _ug.BATCH_SIZE

TRADITIONAL_ARTISTS = {
    "traditional", "misc traditional", "misc", "unknown", "misc praise songs",
    "misc country", "misc americana", "misc folk", "misc soundtrack",
}

STOPWORDS = {"the", "a", "an", "and", "of", "in", "on", "to", "my", "me",
             "i", "im", "ill", "is", "are", "was", "you", "your", "it"}

MIN_TITLE_RATIO = 0.88
LYRIC_CONFIRM = 0.35
LYRIC_REJECT = 0.15
MAX_CANDIDATES_TRIED = 3


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\b(the|a|an)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text or "untitled"


def sig_words(text: str) -> set:
    return {w for w in norm(text).split() if len(w) > 2 and w not in STOPWORDS}


def title_matches(wanted: str, candidate: str) -> bool:
    a, b = norm(wanted), norm(candidate)
    if not a or not b:
        return False
    if a == b:
        return True
    # Strip parentheticals: "Katy Daley (Katy Daly)" etc.
    a2 = norm(re.sub(r"\([^)]*\)", " ", wanted))
    b2 = norm(re.sub(r"\([^)]*\)", " ", candidate))
    if a2 and a2 == b2:
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= MIN_TITLE_RATIO


def artist_matches(candidate_artist: str, hint_artists: list) -> bool:
    ca = sig_words(candidate_artist) or set(norm(candidate_artist).split())
    if not ca:
        return False
    for hint in hint_artists:
        ha = sig_words(hint) or set(norm(hint).split())
        if not ha:
            continue
        overlap = len(ca & ha) / min(len(ca), len(ha))
        if overlap >= 0.6:
            return True
    return False


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

def load_reference():
    rec = json.load(open(RECORDINGS_FILE))
    rec_by_title = {}
    for title, entries in rec.get("recordings", {}).items():
        rec_by_title[norm(title)] = {norm(e[0]) for e in entries if e}
    all_artists = set()
    artists_field = rec.get("artists", [])
    if isinstance(artists_field, dict):
        all_artists = {norm(a) for a in artists_field.keys()}
    elif isinstance(artists_field, list):
        for a in artists_field:
            all_artists.add(norm(a if isinstance(a, str) else a.get("name", "")))
    return rec_by_title, all_artists


def load_bl_lyrics():
    """norm(title) -> (slug, raw_lyrics)"""
    out = {}
    for f in BL_PARSED_DIR.glob("*.json"):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        t = norm(d.get("title", ""))
        if t and t not in out and d.get("raw_lyrics"):
            out[t] = (d.get("slug", f.stem), d["raw_lyrics"])
    return out


# ---------------------------------------------------------------------------
# Content handling
# ---------------------------------------------------------------------------

def strip_ug_markup(content: str) -> str:
    text = content.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\[/?tab\]", "", text)
    text = re.sub(r"\[/?ch\]", "", text)
    return text


def content_lyric_words(content: str) -> set:
    """Significant lyric words from UG content (chord lines dropped)."""
    words = set()
    for line in strip_ug_markup(content).split("\n"):
        line = line.strip()
        if not line or re.match(r"^\[.*\]$", line):
            continue
        toks = line.split()
        # Chord lines: nearly all tokens look like chord symbols
        chordish = sum(1 for t in toks if re.match(
            r"^[A-G][#b]?(m|maj|min|dim|aug|sus|add)?\d*(/[A-G][#b]?)?$", t))
        if toks and chordish / len(toks) > 0.6:
            continue
        words |= sig_words(line)
    return words


def lyric_overlap(content: str, bl_lyrics: str) -> float:
    ug_words = content_lyric_words(content)
    bl_words = sig_words(bl_lyrics)
    if not bl_words or not ug_words:
        return 0.0
    return len(ug_words & bl_words) / len(bl_words)


def chord_token_count(content: str) -> int:
    return len(re.findall(r"\[ch\]", content))


def ug_web_url(artist: str, title: str, tab_id: int) -> str:
    return (f"https://tabs.ultimate-guitar.com/tab/"
            f"{slugify(artist)}/{slugify(title)}-chords-{tab_id}")


# ---------------------------------------------------------------------------
# Candidate selection
# ---------------------------------------------------------------------------

def classify_artist(candidate_artist: str, wanted_song: dict,
                    rec_by_title: dict, all_artists: set) -> str:
    ca = norm(candidate_artist)
    if artist_matches(candidate_artist, wanted_song.get("artists") or []):
        return "hint"
    rec_artists = rec_by_title.get(norm(wanted_song["title"]), set())
    if ca in rec_artists or any(
            artist_matches(candidate_artist, [ra]) for ra in rec_artists):
        return "mb-recording"
    if ca in all_artists:
        return "bluegrass-artist"
    if ca in TRADITIONAL_ARTISTS:
        return "traditional"
    return "unverified"


TIER_SCORE = {"hint": 100, "mb-recording": 80, "bluegrass-artist": 50,
              "traditional": 30, "unverified": 0}


def rank_candidates(results: list, wanted_song: dict,
                    rec_by_title: dict, all_artists: set) -> list:
    ranked = []
    for r in results:
        if r.get("type") != "Chords":
            continue
        if r.get("tab_access_type") not in (None, "public"):
            continue
        if not title_matches(wanted_song["title"], r.get("song_name", "")):
            continue
        tier = classify_artist(r.get("artist_name", ""), wanted_song,
                               rec_by_title, all_artists)
        score = TIER_SCORE[tier]
        votes = r.get("votes") or 0
        rating = r.get("rating") or 0
        if votes > 0 and rating > 0:
            score += min(votes, 40) ** 0.5 + rating
        ranked.append((score, tier, r))
    ranked.sort(key=lambda x: -x[0])
    return ranked


# ---------------------------------------------------------------------------
# Per-song pipeline
# ---------------------------------------------------------------------------

def process_song(client: UGClient, song: dict, rec_by_title: dict,
                 all_artists: set, bl_lyrics: dict) -> dict:
    """Returns the extraction record (always saved)."""
    title = song["title"]
    record = {
        "wanted": song,
        "scraped_at": datetime.now().isoformat(timespec="seconds"),
        "status": None,          # accepted | rejected-* | no-results
        "validation": {},
        "candidate": None,
        "content": None,
    }

    results = client.search(title, tab_type="chords")
    if not results:
        record["status"] = "no-results"
        return record

    ranked = rank_candidates(results, song, rec_by_title, all_artists)
    if not ranked:
        record["status"] = "rejected-no-title-match"
        record["validation"]["results_seen"] = len(results)
        return record

    bl = bl_lyrics.get(norm(title))
    tried = []
    for score, tier, cand in ranked[:MAX_CANDIDATES_TRIED]:
        human_delay(0.5, 1.5)
        tab = client.get_tab(cand["id"])
        content = None
        if tab:
            content = tab.get("content") or tab.get("wiki_tab", {}).get("content")
        if not content or chord_token_count(content) < 8:
            tried.append({"id": cand["id"], "why": "empty-or-chordless"})
            continue

        overlap = None
        if bl:
            overlap = round(lyric_overlap(content, bl[1]), 3)
            if overlap < LYRIC_REJECT:
                tried.append({"id": cand["id"], "why": f"lyric-mismatch {overlap}"})
                continue

        needs_review = tier == "unverified" and not (
            overlap is not None and overlap >= LYRIC_CONFIRM)
        record["status"] = "accepted"
        record["candidate"] = cand
        record["content"] = content
        record["validation"] = {
            "tier": tier,
            "score": round(score, 1),
            "lyric_overlap": overlap,
            "bl_slug": bl[0] if bl else None,
            "needs_review": needs_review,
            "tried": tried,
            "key_hint": cand.get("tonality_name") or None,
        }
        return record

    record["status"] = "rejected-all-candidates"
    record["validation"] = {"tried": tried, "results_seen": len(results)}
    return record


def write_raw(slug: str, record: dict):
    cand = record["candidate"]
    url = ug_web_url(cand["artist_name"], cand["song_name"], cand["id"])
    header = (f"# title: {record['wanted']['title']}\n"
              f"# artist: {cand['artist_name']}\n"
              f"# source_url: {url}\n"
              f"# fetched_at: {record['scraped_at']}\n\n")
    (RAW_DIR / f"{slug}.txt").write_text(header + strip_ug_markup(record["content"]))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Scrape UG charts for bounty-board songs")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--types", default="Vocal,Gospel",
                    help="wanted-song types to process (comma-separated)")
    ap.add_argument("--only", help="process a single title")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    types = {t.strip() for t in args.types.split(",")}
    wanted = json.load(open(WANTED_FILE))["songs"]
    songs = [s for s in wanted if s["type"] in types]
    if args.only:
        songs = [s for s in songs if norm(s["title"]) == norm(args.only)]

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)

    done = {p.stem for p in EXTRACT_DIR.glob("*.json")}
    todo = [(slugify(s["title"]), s) for s in songs]
    todo = [(slug, s) for slug, s in todo if slug not in done]
    if args.limit:
        todo = todo[:args.limit]

    print(f"Wanted ({','.join(sorted(types))}): {len(songs)}; "
          f"already scraped: {len(done)}; to do: {len(todo)}")
    if args.dry_run:
        for slug, s in todo[:40]:
            print(f"  {slug}: {s['title']}  (artists: {', '.join((s.get('artists') or [])[:3])})")
        return

    rec_by_title, all_artists = load_reference()
    bl_lyrics = load_bl_lyrics()
    print(f"Reference: {len(rec_by_title)} recorded titles, "
          f"{len(all_artists)} artists, {len(bl_lyrics)} BL lyric sets")

    client = UGClient()
    stats = {"accepted": 0, "needs_review": 0, "rejected": 0, "no_results": 0}

    for i, (slug, song) in enumerate(todo):
        print(f"[{i + 1}/{len(todo)}] {song['title']}", flush=True)
        try:
            record = process_song(client, song, rec_by_title, all_artists, bl_lyrics)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"    ERROR {e!r}", flush=True)
            record = {"wanted": song, "status": f"error: {e!r}",
                      "scraped_at": datetime.now().isoformat(timespec="seconds")}

        with open(EXTRACT_DIR / f"{slug}.json", "w") as f:
            json.dump(record, f, indent=1)

        st = record["status"]
        if st == "accepted":
            write_raw(slug, record)
            v = record["validation"]
            flag = " NEEDS-REVIEW" if v.get("needs_review") else ""
            stats["accepted"] += 1
            stats["needs_review"] += 1 if v.get("needs_review") else 0
            print(f"    OK [{v['tier']}] {record['candidate']['artist_name']}"
                  f" (overlap={v.get('lyric_overlap')}){flag}", flush=True)
        elif st == "no-results":
            stats["no_results"] += 1
            print("    no results", flush=True)
        else:
            stats["rejected"] += 1
            print(f"    {st}", flush=True)

        with open(PROGRESS_FILE, "w") as f:
            json.dump({"updated": datetime.now().isoformat(timespec="seconds"),
                       "processed": i + 1, "of": len(todo), **stats}, f, indent=1)

        if (i + 1) % BATCH_SIZE == 0:
            batch_pause()
        else:
            human_delay()

    print(f"\nDone. {json.dumps(stats)}")


if __name__ == "__main__":
    main()
