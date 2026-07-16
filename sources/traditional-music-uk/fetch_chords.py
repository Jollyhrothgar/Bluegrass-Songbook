#!/usr/bin/env python3
"""
Fetch chord data from traditionalmusic.co.uk for matched BluegrassLyrics songs.
"""
import asyncio
import aiohttp
import json
import re
from pathlib import Path
from bs4 import BeautifulSoup

SOURCE_DIR = Path(__file__).parent
RAW_DIR = SOURCE_DIR / "raw"
PARSED_DIR = SOURCE_DIR / "parsed"

CONCURRENT_REQUESTS = 10
REQUEST_DELAY = 0.1  # Be polite


async def fetch(session: aiohttp.ClientSession, url: str) -> str | None:
    """Fetch a URL."""
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status == 200:
                return await resp.text()
    except Exception as e:
        print(f"  [ERROR] {url}: {e}")
    return None


def extract_chords_and_lyrics(html: str) -> dict | None:
    """Extract chord/lyrics content from TMUK page."""
    soup = BeautifulSoup(html, "html.parser")

    # Title
    title = ""
    title_elem = soup.find("title")
    if title_elem:
        title = title_elem.get_text(strip=True)
        # Clean up title
        title = re.sub(r"\s*-\s*Traditional Music Library.*", "", title)

    # Find the main content - usually in a <pre> tag or specific div
    content = ""

    # Try <pre> tag first (common for chord sheets)
    pre = soup.find("pre")
    if pre:
        content = pre.get_text()
    else:
        # Try main content area
        for tag in soup.find_all(["div", "td"]):
            text = tag.get_text()
            if "[" in text and "]" in text and len(text) > 200:
                # Looks like chord content
                content = text
                break

    if not content:
        return None

    # Check if it has chords
    chord_pattern = r"\[[A-G][b#]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13)*\]"
    chords_found = re.findall(chord_pattern, content)

    if not chords_found:
        return None

    # Extract lines with chords
    lines = content.split("\n")
    chord_lines = []
    for line in lines:
        if re.search(chord_pattern, line):
            chord_lines.append(line.strip())

    return {
        "title": title,
        "raw_content": content,
        "chord_lines": chord_lines,
        "chords_found": list(set(chords_found)),
    }


async def fetch_match(
    session: aiohttp.ClientSession,
    match: dict,
    semaphore: asyncio.Semaphore
) -> dict | None:
    """Fetch chord data for a matched song."""
    async with semaphore:
        tmuk = match["tmuk_matches"][0]
        url = tmuk["url"]

        # Check cache
        cache_file = RAW_DIR / f"{tmuk['filename']}.html"
        if cache_file.exists():
            html = cache_file.read_text(encoding="utf-8", errors="ignore")
        else:
            html = await fetch(session, url)
            if html:
                cache_file.write_text(html, encoding="utf-8")
            await asyncio.sleep(REQUEST_DELAY)

        if not html:
            return None

        parsed = extract_chords_and_lyrics(html)
        if not parsed:
            return None

        return {
            "bl_slug": match["bl_slug"],
            "bl_title": match["bl_title"],
            "tmuk_url": url,
            "tmuk_collection": tmuk["collection"],
            "match_type": match["match_type"],
            **parsed
        }


async def main():
    print("=" * 60)
    print("Fetching chords from traditionalmusic.co.uk")
    print("=" * 60)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PARSED_DIR.mkdir(parents=True, exist_ok=True)

    # Load matches - only exact matches for now (more reliable)
    with open(SOURCE_DIR / "bl_match_results.json") as f:
        results = json.load(f)

    # Start with exact matches only
    matches = [m for m in results["matches"] if m["match_type"] == "exact"]
    print(f"Fetching {len(matches)} exact matches...")

    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)

    async with aiohttp.ClientSession() as session:
        tasks = [fetch_match(session, m, semaphore) for m in matches]
        fetched = await asyncio.gather(*tasks)

    # Filter successful fetches
    successful = [f for f in fetched if f is not None]
    print(f"\nSuccessfully fetched chords: {len(successful)}/{len(matches)}")

    # Save results
    output_file = SOURCE_DIR / "fetched_chords.json"
    with open(output_file, "w") as f:
        json.dump({
            "total_matches": len(matches),
            "successful": len(successful),
            "songs": successful
        }, f, indent=2)

    print(f"Saved to {output_file}")

    # Show sample
    if successful:
        print("\n=== SAMPLE ===")
        sample = successful[0]
        print(f"Song: {sample['bl_title']}")
        print(f"From: {sample['tmuk_collection']}")
        print(f"Chords: {', '.join(sample['chords_found'][:8])}")
        print("First few lines with chords:")
        for line in sample['chord_lines'][:4]:
            print(f"  {line[:70]}")


if __name__ == "__main__":
    asyncio.run(main())
