"""
Ultimate Guitar chord extractor using Chrome DevTools MCP.

This script uses MCP to:
1. Search Ultimate Guitar for a song
2. Navigate to the best chord result
3. Extract raw chord content
4. Store it for later processing through the frontend paste handlers

Usage:
    # In Claude Code, with Chrome running in debug mode:
    uv run python sources/ultimate-guitar/extractor.py
"""

import json
import time
import asyncio
from pathlib import Path
from dataclasses import dataclass, asdict

# Conditional MCP imports
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    ClientSession = None


@dataclass
class ExtractedSong:
    """Extracted chord data from Ultimate Guitar."""
    bl_slug: str  # Our BluegrassLyrics song slug
    title: str
    artist: str
    ug_url: str
    tuning: str | None
    capo: str | None
    raw_content: str  # Chord-above-lyrics format (for paste handler)
    extracted_at: str


# JavaScript to search UG and get results
SEARCH_RESULTS_JS = """
() => {
  const links = [...document.querySelectorAll('a[href*="tabs.ultimate-guitar.com/tab/"][href*="-chords-"]')];
  const results = [];

  for (const link of links) {
    const url = link.href;
    const title = link.textContent.replace(/\\s+/g, ' ').trim();

    // Find artist
    let el = link.parentElement;
    let artistLink = null;
    while (el && !artistLink) {
      artistLink = el.querySelector('a[href*="/artist/"]');
      el = el.parentElement;
    }
    const artist = artistLink?.textContent?.trim() || 'Unknown';

    results.push({ url, title, artist });
  }

  return results;
}
"""

# JavaScript to extract chord content from a tab page
EXTRACT_CONTENT_JS = """
() => {
  const main = document.querySelector('main');
  const fullText = main?.innerText || '';
  const lines = fullText.split('\\n');

  // Find song content start
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\\[(Verse|Chorus|Intro|Bridge|Outro|Instrumental)/i.test(line)) {
      startIdx = i;
      break;
    }
  }

  // Find end markers
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'X' || line.startsWith('Print') ||
        line.startsWith('Last update:') || line === 'Rating' ||
        line.match(/^\\*\\s/) || line.startsWith('This version:')) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) return { error: 'No song content found' };

  // Extract clean content
  const songLines = lines.slice(startIdx, endIdx)
    .filter(l => {
      const t = l.trim();
      return t && t !== 'X' && !t.match(/^\\d+\\.\\d+$/);
    });

  // Get metadata
  const title = document.querySelector('h1')?.textContent?.replace(/\\s*Chords\\s*$/i, '').trim();
  const artist = main.querySelector('a[href*="/artist/"]')?.textContent?.trim();
  const tuning = document.querySelector('a[href*="tuner?tuning="]')?.textContent?.trim();
  const capoMatch = fullText.match(/Capo:\\s*([^\\n]+)/);
  const capo = capoMatch ? capoMatch[1].trim() : null;

  return {
    title,
    artist,
    tuning,
    capo: capo === 'No capo' ? null : capo,
    url: window.location.href,
    content: songLines.join('\\n')
  };
}
"""


def select_best_result(results: list[dict], target_title: str) -> dict | None:
    """
    Select the best chord result from search.

    Preference order:
    1. Traditional/Carter Family/Misc Traditional artists
    2. Exact title match
    3. First result
    """
    preferred_artists = ['carter family', 'misc traditional', 'traditional', 'misc praise']

    # Normalize target title for matching
    target_lower = target_title.lower().strip()

    # Score each result
    scored = []
    for r in results:
        score = 0
        artist_lower = r['artist'].lower()
        title_lower = r['title'].lower()

        # Prefer traditional artists
        for i, preferred in enumerate(preferred_artists):
            if preferred in artist_lower:
                score += (10 - i)
                break

        # Exact title match bonus
        if target_lower in title_lower:
            score += 5

        # Version 1 preference (no "ver X" suffix)
        if 'ver' not in title_lower:
            score += 2

        scored.append((score, r))

    if not scored:
        return None

    # Return highest scored
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


async def search_and_extract(session: ClientSession, song_title: str, bl_slug: str) -> ExtractedSong | None:
    """
    Search UG for a song and extract chord content.
    """
    from urllib.parse import quote

    # Navigate to search results (Chords only)
    search_url = f"https://www.ultimate-guitar.com/search.php?title={quote(song_title)}&type=300"

    await session.call_tool("navigate_page", {"type": "url", "url": search_url})
    await asyncio.sleep(2)  # Wait for page load

    # Get search results
    result = await session.call_tool("evaluate_script", {"function": SEARCH_RESULTS_JS})
    results = json.loads(result.content[0].text) if result.content else []

    if not results:
        print(f"  No results found for: {song_title}")
        return None

    # Select best result
    best = select_best_result(results, song_title)
    if not best:
        print(f"  No suitable result for: {song_title}")
        return None

    print(f"  Found: {best['title']} by {best['artist']}")

    # Navigate to the chord page
    await session.call_tool("navigate_page", {"type": "url", "url": best["url"]})
    await asyncio.sleep(2)

    # Extract content
    result = await session.call_tool("evaluate_script", {"function": EXTRACT_CONTENT_JS})
    data = json.loads(result.content[0].text) if result.content else {}

    if "error" in data:
        print(f"  Extraction error: {data['error']}")
        return None

    from datetime import datetime

    return ExtractedSong(
        bl_slug=bl_slug,
        title=data.get("title", song_title),
        artist=data.get("artist", "Unknown"),
        ug_url=data.get("url", best["url"]),
        tuning=data.get("tuning"),
        capo=data.get("capo"),
        raw_content=data.get("content", ""),
        extracted_at=datetime.now().isoformat()
    )


async def main():
    """Test extraction with a single song."""
    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "chrome-devtools-mcp@latest", "--browserUrl", "http://127.0.0.1:9222"],
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Test with a known song
            song = await search_and_extract(
                session,
                "Will The Circle Be Unbroken",
                "will-the-circle-be-unbroken"
            )

            if song:
                print(f"\nExtracted: {song.title} by {song.artist}")
                print(f"URL: {song.ug_url}")
                print(f"Content preview:\n{song.raw_content[:500]}...")

                # Save to file
                output_dir = Path(__file__).parent / "extracted"
                output_dir.mkdir(exist_ok=True)

                output_file = output_dir / f"{song.bl_slug}.json"
                with open(output_file, "w") as f:
                    json.dump(asdict(song), f, indent=2)
                print(f"\nSaved to: {output_file}")


if __name__ == "__main__":
    asyncio.run(main())
