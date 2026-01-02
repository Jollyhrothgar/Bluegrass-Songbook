#!/usr/bin/env python3
"""
Strum Machine API integration for Bluegrass Songbook.

Matches songs against Strum Machine's database and stores URLs for practice links.

API Reference:
- Match Songs: GET /api/v0/match-songs?q=... (undocumented, 10 req/sec limit)
- Songs CRUD: /songs (list, create, retrieve, update, delete)
- Lists CRUD: /lists (manage song lists)
- URL params: ?key=G&bpm=200 (set key and tempo when opening)

Usage:
    # Match all songs and update index
    ./scripts/utility strum-machine-match

    # Match a single song (for testing)
    python -m scripts.lib.strum_machine "Blue Moon of Kentucky"
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import httpx

# Configuration
API_BASE = "https://strummachine.com/api/v0"
MATCH_ENDPOINT = f"{API_BASE}/match-songs"
RATE_LIMIT = 10  # requests per second
RATE_LIMIT_DELAY = 1.0 / RATE_LIMIT  # 0.1 seconds between requests

# Cache file to avoid re-fetching
CACHE_FILE = Path(__file__).parent.parent.parent / "docs" / "data" / "strum_machine_cache.json"


def get_api_key() -> str:
    """Get API key from environment."""
    key = os.environ.get("STRUM_MACHINE_API_KEY")
    if not key:
        # Try loading from .env files
        for env_file in [Path.home() / ".env", Path(".env"), Path("local.env")]:
            if env_file.exists():
                with open(env_file) as f:
                    for line in f:
                        if line.startswith("STRUM_MACHINE_API_KEY="):
                            key = line.split("=", 1)[1].strip().strip('"\'')
                            break
            if key:
                break

    if not key:
        raise ValueError(
            "STRUM_MACHINE_API_KEY not found. Set it in environment or ~/.env"
        )
    return key


def load_cache() -> dict:
    """Load cached matches from disk."""
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_cache(cache: dict) -> None:
    """Save cache to disk."""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def match_song(
    title: str,
    api_key: str,
    client: Optional[httpx.Client] = None,
    min_score: float = 0.9,
) -> Optional[dict]:
    """
    Match a song title against Strum Machine's database.

    Args:
        title: Song title to search for
        api_key: Strum Machine API key
        client: Optional httpx client for connection reuse
        min_score: Minimum score to accept (1.0 = exact, 0.9 = fuzzy/typos)

    Returns:
        Best match dict with 'title', 'label', 'url', 'score' or None
    """
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {"q": title}

    try:
        if client:
            response = client.get(MATCH_ENDPOINT, params=params, headers=headers)
        else:
            response = httpx.get(MATCH_ENDPOINT, params=params, headers=headers)

        response.raise_for_status()
        data = response.json()

        results = data.get("results", [])
        if not results:
            return None

        # Filter for minimum score
        results = [r for r in results if r.get("score", 0) >= min_score]

        if not results:
            return None

        # Return best match (first result, highest score)
        return results[0]

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise ValueError("Invalid API key")
        raise
    except Exception as e:
        print(f"Error matching '{title}': {e}", file=sys.stderr)
        return None


def batch_match_songs(
    songs: list[dict],
    api_key: str,
    use_cache: bool = True,
    force: bool = False,
    progress_callback: Optional[callable] = None,
) -> dict[str, dict]:
    """
    Batch match songs against Strum Machine.

    Args:
        songs: List of song dicts with 'id' and 'title' keys
        api_key: Strum Machine API key
        use_cache: Whether to use/update cache
        force: If True, ignore cache and re-fetch all songs
        progress_callback: Optional callback(current, total, title, match, cached) for progress

    Returns:
        Dict mapping song_id -> match result (or None)
    """
    cache = {} if force else (load_cache() if use_cache else {})
    results = {}
    api_calls = 0

    # Use connection pooling for efficiency
    with httpx.Client(timeout=30.0) as client:
        for i, song in enumerate(songs):
            song_id = song.get("id", "")
            title = song.get("title", "")

            if not title:
                results[song_id] = None
                continue

            # Check cache first (None means "checked but no match")
            cache_key = title.lower().strip()
            if use_cache and not force and cache_key in cache:
                cached_result = cache[cache_key]
                # Handle legacy None entries and new _no_match sentinel
                if cached_result and cached_result.get("_no_match"):
                    results[song_id] = None
                else:
                    results[song_id] = cached_result
                if progress_callback:
                    progress_callback(i + 1, len(songs), title, cached_result, cached=True)
                continue

            # Rate limit
            time.sleep(RATE_LIMIT_DELAY)

            # Fetch from API
            match = match_song(title, api_key, client=client)
            results[song_id] = match
            api_calls += 1

            # Update cache - store sentinel for no-match so we don't re-poll
            if use_cache:
                cache[cache_key] = match if match else {"_no_match": True}

            if progress_callback:
                progress_callback(i + 1, len(songs), title, match, cached=False)

            # Save cache periodically (every 100 API calls) for resume on failure
            if use_cache and api_calls % 100 == 0:
                save_cache(cache)

    # Final save
    if use_cache:
        save_cache(cache)

    return results


def build_strum_machine_url(base_url: str, key: Optional[str] = None, bpm: Optional[int] = None) -> str:
    """
    Build a Strum Machine URL with optional key and BPM parameters.

    Args:
        base_url: Base song URL from match result
        key: Optional key (e.g., 'G', 'Am', 'F#')
        bpm: Optional tempo in BPM

    Returns:
        URL with query parameters appended
    """
    params = []
    if key:
        params.append(f"key={quote(key)}")
    if bpm:
        params.append(f"bpm={bpm}")

    if params:
        separator = "&" if "?" in base_url else "?"
        return f"{base_url}{separator}{'&'.join(params)}"
    return base_url


def print_progress(current: int, total: int, title: str, match: Optional[dict], cached: bool = False) -> None:
    """Default progress callback with match logging."""
    if cached:
        status = "cached"
    elif match and not match.get("_no_match"):
        status = f"MATCH"
    else:
        status = "no match"

    # Log attempted title and matched title (if different)
    if match and not match.get("_no_match"):
        matched_title = match.get("title", "")
        if matched_title.lower() != title.lower():
            print(f"[{current}/{total}] {status}: '{title[:40]}' -> '{matched_title[:40]}'", file=sys.stderr)
        else:
            print(f"[{current}/{total}] {status}: {title[:50]}", file=sys.stderr)
    else:
        print(f"[{current}/{total}] {status}: {title[:50]}", file=sys.stderr)


# CLI interface
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.lib.strum_machine <song title>")
        print("       python -m scripts.lib.strum_machine --batch [--force]")
        sys.exit(1)

    api_key = get_api_key()

    if sys.argv[1] == "--batch":
        force = "--force" in sys.argv

        # Batch mode: read songs from index.jsonl
        index_file = Path(__file__).parent.parent.parent / "docs" / "data" / "index.jsonl"
        if not index_file.exists():
            print(f"Index file not found: {index_file}", file=sys.stderr)
            sys.exit(1)

        songs = []
        with open(index_file) as f:
            for line in f:
                if line.strip():
                    songs.append(json.loads(line))

        if force:
            print(f"FORCE MODE: Re-fetching all {len(songs)} songs...", file=sys.stderr)
        else:
            print(f"Matching {len(songs)} songs against Strum Machine (cached songs will be skipped)...", file=sys.stderr)

        results = batch_match_songs(songs, api_key, force=force, progress_callback=print_progress)

        # Output results as JSON
        matched = {k: v for k, v in results.items() if v}
        print(json.dumps(matched, indent=2))
        print(f"\nMatched: {len(matched)}/{len(songs)} songs", file=sys.stderr)

    else:
        # Single song mode
        title = " ".join(sys.argv[1:])
        print(f"Searching for: {title}", file=sys.stderr)

        result = match_song(title, api_key)
        if result:
            print(json.dumps(result, indent=2))
            print(f"\nURL with key: {build_strum_machine_url(result['url'], key='G')}", file=sys.stderr)
        else:
            print("No match found", file=sys.stderr)
            sys.exit(1)
