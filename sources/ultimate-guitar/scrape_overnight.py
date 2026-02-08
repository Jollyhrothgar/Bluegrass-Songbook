#!/usr/bin/env python3
"""
Standalone UG chord scraper that can run overnight.

Uses the UG mobile API (no browser needed, no CAPTCHAs).
Based on reverse engineering from https://github.com/Pilfer/ultimate-guitar-scraper

Usage:
    # Run (will process until interrupted or done)
    uv run python sources/ultimate-guitar/scrape_overnight.py

    # Limit to N songs
    uv run python sources/ultimate-guitar/scrape_overnight.py --limit 100

    # Dry run (show what would be scraped)
    uv run python sources/ultimate-guitar/scrape_overnight.py --dry-run
"""

import json
import time
import random
import argparse
import hashlib
import secrets
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import quote, urlencode
import requests

# Directories
BASE_DIR = Path(__file__).parent
BL_PARSED_DIR = BASE_DIR.parent / "bluegrass-lyrics" / "parsed"
RAW_DIR = BASE_DIR / "raw_extractions"
WORKS_DIR = BASE_DIR.parent.parent / "works"
PROGRESS_FILE = BASE_DIR / "scrape_progress.json"

# Rate limiting (still be respectful even with API)
MIN_DELAY = 1.0
MAX_DELAY = 3.0
BATCH_SIZE = 20
BATCH_PAUSE_MIN = 30
BATCH_PAUSE_MAX = 60

# UG Mobile API configuration
UG_API_BASE = "https://api.ultimate-guitar.com/api/v1"
UG_USER_AGENT = "UGT_ANDROID/4.11.1 (Pixel; 8.1.0)"


class UGClient:
    """Client for the UG mobile API."""

    def __init__(self):
        self.device_id = secrets.token_hex(8)  # 16 hex chars
        self.session = requests.Session()
        self.session.headers.update({
            "Accept-Charset": "utf-8",
            "Accept": "application/json",
            "User-Agent": UG_USER_AGENT,
            "Connection": "close",
        })

    def _get_api_key(self) -> str:
        """Generate the API key based on device ID and current time."""
        now = datetime.now(timezone.utc)
        # Format: YYYY-MM-DD:H (hour as integer, not zero-padded)
        date_str = now.strftime("%Y-%m-%d")
        hour = now.hour  # 0-23, not padded
        formatted_date = f"{date_str}:{hour}"
        data = f"{self.device_id}{formatted_date}createLog()"
        return hashlib.md5(data.encode()).hexdigest()

    def _request(self, endpoint: str, params: dict = None) -> dict | None:
        """Make an API request with proper headers."""
        url = f"{UG_API_BASE}{endpoint}"

        headers = {
            "X-UG-CLIENT-ID": self.device_id,
            "X-UG-API-KEY": self._get_api_key(),
        }

        try:
            response = self.session.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            print(f"    API error: {e}")
            return None

    def search(self, title: str, tab_type: str = "chords") -> list[dict]:
        """
        Search for tabs.

        tab_type can be: chords, tabs, bass, drums, ukulele, etc.
        Returns list of result dicts.
        """
        # Type 300 is chords in the web API, but mobile API uses type names
        params = {
            "title": title,
            "type": tab_type,
            "page": 1,
        }

        result = self._request("/tab/search", params)
        if not result:
            return []

        tabs = result.get("tabs", [])
        return tabs

    def get_tab(self, tab_id: int) -> dict | None:
        """Get full tab content by ID."""
        params = {
            "tab_id": tab_id,
            "tab_access_type": "public",
        }

        result = self._request("/tab/info", params)
        return result


def human_delay(min_s: float = MIN_DELAY, max_s: float = MAX_DELAY) -> float:
    """Sleep for a random human-like duration."""
    delay = random.triangular(min_s, max_s, (min_s + max_s) / 2)
    time.sleep(delay)
    return delay


def batch_pause():
    """Longer pause between batches."""
    pause = random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX)
    print(f"  [Batch pause: {pause:.0f}s]")
    time.sleep(pause)


def get_songs_to_scrape() -> list[tuple[str, str]]:
    """
    Get BL songs that need scraping.
    Returns list of (slug, title) tuples.

    Filters out:
    - Songs already in works/
    - Songs already in raw_extractions/
    """
    # Get existing works
    existing_works = set()
    if WORKS_DIR.exists():
        existing_works = {p.name for p in WORKS_DIR.iterdir() if p.is_dir()}

    # Get already extracted
    already_extracted = set()
    if RAW_DIR.exists():
        already_extracted = {p.stem for p in RAW_DIR.glob("*.json")}

    # Get BL songs
    songs = []
    for f in sorted(BL_PARSED_DIR.glob("*.json")):
        slug = f.stem

        # Skip if already have
        if slug in existing_works:
            continue
        if slug in already_extracted:
            continue

        # Load to get title
        try:
            with open(f) as fh:
                data = json.load(fh)
            title = data.get("title", slug.replace("-", " ").title())
            songs.append((slug, title))
        except Exception as e:
            print(f"Warning: Could not load {f}: {e}")

    return songs


def select_best_result(results: list[dict], query_title: str) -> dict | None:
    """
    Select the best UG result for a song.
    Prefers traditional/bluegrass artists.
    """
    if not results:
        return None

    # Preferred artists for bluegrass/traditional songs
    preferred_artists = [
        "traditional", "misc traditional", "carter family", "bill monroe",
        "stanley brothers", "flatt & scruggs", "doc watson", "ralph stanley",
        "jimmy martin", "ricky skaggs", "alison krauss", "tony rice",
        "hank williams", "johnny cash", "merle haggard", "george jones"
    ]

    query_lower = query_title.lower()

    # Score each result
    scored = []
    for r in results:
        score = 0
        artist_lower = r.get("artist_name", "").lower()
        title_lower = r.get("song_name", "").lower()

        # Title similarity
        if query_lower in title_lower or title_lower in query_lower:
            score += 10

        # Preferred artist
        for pref in preferred_artists:
            if pref in artist_lower:
                score += 5
                break

        # Rating bonus
        rating = r.get("rating", 0)
        if rating > 0:
            score += min(rating, 5)

        # Prefer chords type
        if r.get("type") == "Chords":
            score += 3

        scored.append((score, r))

    scored.sort(key=lambda x: -x[0])
    return scored[0][1] if scored else None


def search_and_extract(client: UGClient, slug: str, title: str) -> dict | None:
    """
    Search UG for a song and extract chords.
    Returns extraction data or None.
    """
    print(f"  Searching: {title}")

    try:
        # Search UG
        results = client.search(title, tab_type="chords")

        if not results:
            print(f"    No results found")
            return None

        # Select best result
        best = select_best_result(results, title)
        if not best:
            print(f"    No suitable result")
            return None

        tab_id = best.get("id")
        if not tab_id:
            print(f"    No tab ID in result")
            return None

        print(f"    Found: {best.get('song_name')} by {best.get('artist_name')} (id={tab_id})")

        # Small delay before fetching full tab
        human_delay(0.5, 1.5)

        # Get full tab content
        tab_data = client.get_tab(tab_id)
        if not tab_data:
            print(f"    Could not fetch tab")
            return None

        content = tab_data.get("content")
        if not content:
            # Try wiki_tab format
            content = tab_data.get("wiki_tab", {}).get("content")

        if not content:
            print(f"    Empty content")
            return None

        return {
            "bl_slug": slug,
            "title": best.get("song_name", title),
            "artist": best.get("artist_name", ""),
            "ug_tab_id": tab_id,
            "ug_url": f"https://tabs.ultimate-guitar.com/tab/{tab_id}",
            "content": content
        }

    except Exception as e:
        print(f"    Error: {e}")
        return None


def load_progress() -> dict:
    """Load scraping progress."""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {
        "started_at": datetime.now().isoformat(),
        "processed": 0,
        "succeeded": 0,
        "failed": 0,
        "no_results": 0,
        "last_slug": None
    }


def save_progress(progress: dict):
    """Save scraping progress."""
    progress["last_updated"] = datetime.now().isoformat()
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Scrape UG chords overnight via mobile API")
    parser.add_argument("--limit", type=int, default=0, help="Max songs (0=unlimited)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be scraped")
    parser.add_argument("--test", action="store_true", help="Test API with one search")
    args = parser.parse_args()

    # Test mode
    if args.test:
        print("Testing UG API...")
        client = UGClient()
        results = client.search("Will The Circle Be Unbroken")
        if results:
            print(f"Found {len(results)} results")
            for r in results[:5]:
                print(f"  - {r.get('song_name')} by {r.get('artist_name')} (type={r.get('type')}, id={r.get('id')})")

            # Try to get the first one
            if results[0].get("id"):
                print(f"\nFetching tab {results[0]['id']}...")
                tab = client.get_tab(results[0]["id"])
                if tab:
                    content = tab.get("content") or tab.get("wiki_tab", {}).get("content")
                    if content:
                        print(f"Content preview ({len(content)} chars):")
                        print(content[:500])
                    else:
                        print("No content found. Keys in response:", list(tab.keys()))
                else:
                    print("Failed to fetch tab")
        else:
            print("No results - API may not be working")
        return

    # Get songs to scrape
    songs = get_songs_to_scrape()

    if args.limit > 0:
        songs = songs[:args.limit]

    print(f"Songs to scrape: {len(songs)}")

    if args.dry_run:
        print("\nWould scrape:")
        for slug, title in songs[:30]:
            print(f"  {slug}: {title}")
        if len(songs) > 30:
            print(f"  ... and {len(songs) - 30} more")
        return

    if not songs:
        print("Nothing to scrape!")
        return

    # Ensure output dir exists
    RAW_DIR.mkdir(exist_ok=True)

    # Load progress
    progress = load_progress()

    print(f"\nStarting scrape at {datetime.now().strftime('%H:%M:%S')}")
    print(f"Using UG Mobile API (no browser needed)")
    print(f"Rate limiting: {MIN_DELAY}-{MAX_DELAY}s between requests")
    print(f"Batch pause every {BATCH_SIZE} songs: {BATCH_PAUSE_MIN}-{BATCH_PAUSE_MAX}s")
    print()

    client = UGClient()

    try:
        batch_count = 0

        for i, (slug, title) in enumerate(songs):
            print(f"[{i+1}/{len(songs)}] {slug}")

            result = search_and_extract(client, slug, title)

            if result:
                # Save raw extraction
                out_file = RAW_DIR / f"{slug}.json"
                with open(out_file, "w") as f:
                    json.dump(result, f)
                print(f"    Saved to {out_file.name}")
                progress["succeeded"] += 1
            else:
                progress["failed"] += 1

            progress["processed"] += 1
            progress["last_slug"] = slug
            save_progress(progress)

            # Rate limiting
            batch_count += 1
            if batch_count >= BATCH_SIZE:
                batch_pause()
                batch_count = 0
            elif i < len(songs) - 1:
                delay = human_delay()
                print(f"    [Delay: {delay:.1f}s]")

    except KeyboardInterrupt:
        print("\n\nInterrupted by user")

    # Summary
    print(f"\n=== SCRAPE COMPLETE ===")
    print(f"Processed: {progress['processed']}")
    print(f"Succeeded: {progress['succeeded']}")
    print(f"Failed: {progress['failed']}")
    if progress['processed'] > 0:
        print(f"Success rate: {progress['succeeded'] / progress['processed']:.0%}")

    print(f"\nRaw extractions saved to: {RAW_DIR}")
    print(f"Run merges with: uv run python sources/ultimate-guitar/run_merges.py")


if __name__ == "__main__":
    main()
