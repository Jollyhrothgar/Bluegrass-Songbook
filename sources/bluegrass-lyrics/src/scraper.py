#!/usr/bin/env python3
"""
Scraper for BluegrassLyrics.com

Phase 1: Build song index and download all pages
"""

import asyncio
import aiohttp
import json
import re
from pathlib import Path
from bs4 import BeautifulSoup
from datetime import datetime

BASE_URL = "https://www.bluegrasslyrics.com"
RAW_DIR = Path(__file__).parent.parent / "raw"
OUTPUT_DIR = Path(__file__).parent.parent

# Rate limit: 100 req/sec means we can be aggressive
CONCURRENT_REQUESTS = 50
REQUEST_DELAY = 0.01  # 10ms between batches


async def fetch(session: aiohttp.ClientSession, url: str) -> str | None:
    """Fetch a URL and return HTML content."""
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status == 200:
                return await resp.text()
            else:
                print(f"  [WARN] {resp.status} for {url}")
                return None
    except Exception as e:
        print(f"  [ERROR] {url}: {e}")
        return None


async def get_song_index(session: aiohttp.ClientSession) -> list[dict]:
    """Scrape the homepage to get all song URLs."""
    print("Fetching song index from homepage...")

    html = await fetch(session, BASE_URL)
    if not html:
        raise RuntimeError("Failed to fetch homepage")

    soup = BeautifulSoup(html, "html.parser")
    songs = []

    # Find all song links - they follow pattern /song/{slug}/
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if "/song/" in href:
            # Normalize URL
            if href.startswith("/"):
                href = BASE_URL + href
            elif not href.startswith("http"):
                href = BASE_URL + "/" + href

            # Extract slug
            match = re.search(r"/song/([^/]+)/?", href)
            if match:
                slug = match.group(1)
                title = link.get_text(strip=True)
                songs.append({
                    "slug": slug,
                    "title": title,
                    "url": f"{BASE_URL}/song/{slug}/"
                })

    # Dedupe by slug
    seen = set()
    unique_songs = []
    for song in songs:
        if song["slug"] not in seen:
            seen.add(song["slug"])
            unique_songs.append(song)

    print(f"Found {len(unique_songs)} unique songs on homepage")
    return unique_songs


async def download_song(
    session: aiohttp.ClientSession,
    song: dict,
    semaphore: asyncio.Semaphore
) -> bool:
    """Download a single song page."""
    async with semaphore:
        slug = song["slug"]
        output_file = RAW_DIR / f"{slug}.html"

        # Skip if already downloaded
        if output_file.exists():
            return True

        html = await fetch(session, song["url"])
        if html:
            output_file.write_text(html, encoding="utf-8")
            return True
        return False


async def download_all_songs(songs: list[dict]) -> dict:
    """Download all song pages concurrently."""
    print(f"\nDownloading {len(songs)} song pages...")
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)

    async with aiohttp.ClientSession() as session:
        tasks = [download_song(session, song, semaphore) for song in songs]
        results = await asyncio.gather(*tasks)

    success = sum(1 for r in results if r)
    failed = len(results) - success

    print(f"Downloaded: {success} success, {failed} failed")
    return {"success": success, "failed": failed}


async def main():
    """Main entry point."""
    print("=" * 60)
    print("BluegrassLyrics.com Scraper")
    print("=" * 60)

    async with aiohttp.ClientSession() as session:
        # Phase 1.1: Get song index
        songs = await get_song_index(session)

    # Save index
    index_file = OUTPUT_DIR / "song_index.json"
    with open(index_file, "w") as f:
        json.dump({
            "scraped_at": datetime.now().isoformat(),
            "count": len(songs),
            "songs": songs
        }, f, indent=2)
    print(f"Saved song index to {index_file}")

    # Phase 1.2: Download all songs
    stats = await download_all_songs(songs)

    print("\n" + "=" * 60)
    print("Scraping complete!")
    print(f"  Songs indexed: {len(songs)}")
    print(f"  Pages downloaded: {stats['success']}")
    print(f"  Failed: {stats['failed']}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
