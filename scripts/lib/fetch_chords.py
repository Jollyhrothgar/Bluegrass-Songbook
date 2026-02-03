#!/usr/bin/env python3
"""
Fetch chords/lyrics from the web for missing songs.

Uses web search to find chord charts, then saves raw content for later parsing.

Usage:
    # Test with a single song
    uv run python scripts/lib/fetch_chords.py "Act Naturally"

    # Batch process from JSON list
    uv run python scripts/lib/fetch_chords.py --batch docs/data/sm_missing_vocals.json --limit 10

    # Dry run (search only, don't save)
    uv run python scripts/lib/fetch_chords.py --batch docs/data/sm_missing_vocals.json --limit 5 --dry-run
"""

import json
import re
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus, urlparse

import httpx
from bs4 import BeautifulSoup

# Rate limiting
RATE_LIMIT_DELAY = 1.5  # seconds between requests

# Playwright browser instance (lazy loaded)
_browser = None
_playwright = None


def get_browser():
    """Get or create a Playwright browser instance."""
    global _browser, _playwright
    if _browser is None:
        from playwright.sync_api import sync_playwright
        _playwright = sync_playwright().start()
        _browser = _playwright.chromium.launch(headless=True)
    return _browser


def close_browser():
    """Close the Playwright browser if open."""
    global _browser, _playwright
    if _browser:
        _browser.close()
        _browser = None
    if _playwright:
        _playwright.stop()
        _playwright = None


def fetch_with_playwright(url: str, selector: str = 'pre') -> Optional[str]:
    """Fetch a JS-rendered page using Playwright."""
    try:
        browser = get_browser()
        page = browser.new_page()
        page.goto(url, timeout=30000)

        # Wait for content to load
        page.wait_for_selector(selector, timeout=10000)

        # Get the content
        element = page.query_selector(selector)
        if element:
            content = element.inner_text()
            page.close()
            return content

        page.close()
        return None
    except Exception as e:
        print(f"Playwright error for {url}: {e}", file=sys.stderr)
        return None

# Output directory
RAW_DIR = Path(__file__).parent.parent.parent / "sources" / "web-chords" / "raw"


def search_duckduckgo(query: str, site_filter: str = None) -> list[dict]:
    """Search DuckDuckGo for chord pages."""
    # Add site filter if specified
    if site_filter:
        query = f"{query} site:{site_filter}"
    # Use DuckDuckGo HTML search (no API key needed)
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')
        results = []

        for result in soup.select('.result'):
            title_el = result.select_one('.result__title')
            link_el = result.select_one('.result__url')
            snippet_el = result.select_one('.result__snippet')

            if link_el:
                # URL is in the text of .result__url element
                actual_url = link_el.get_text(strip=True)

                # Skip ads (amazon, etc.) unless they contain our target site
                if site_filter and site_filter not in actual_url.lower():
                    continue

                results.append({
                    'title': title_el.get_text(strip=True) if title_el else '',
                    'url': actual_url,
                    'snippet': snippet_el.get_text(strip=True) if snippet_el else ''
                })

        return results
    except Exception as e:
        print(f"Search error: {e}", file=sys.stderr)
        return []


def is_chord_site(url: str) -> bool:
    """Check if URL is from a known chord site with text-based chords."""
    # Sites with actual lyrics + chords as text
    chord_domains = [
        'e-chords.com',
        'azchords.com',
        'guitartabs.cc',
        'chordsbase.com',
        'cowboylyrics.com',
        'chordie.com',
        'ultimate-guitar.com',
    ]
    # Exclude sites that don't work:
    # - chordu.com: video sync without actual lyrics
    # - traditionalmusic.co.uk: sheet music images, not text
    url_lower = url.lower()
    if 'chordu.com' in url_lower or 'traditionalmusic.co.uk' in url_lower:
        return False
    return any(d in url_lower for d in chord_domains)


def fetch_ultimate_guitar(url: str) -> Optional[str]:
    """Fetch and extract content from Ultimate Guitar using Playwright."""
    # UG is JS-rendered, use Playwright
    # The chord content is in a pre tag or div with specific classes
    selectors = ['pre', '[data-content]', '.js-tab-content', '.ugm-b-tab--content']

    for selector in selectors:
        content = fetch_with_playwright(url, selector)
        if content and len(content) > 100:  # Sanity check for real content
            return content

    return None


def fetch_chordu(url: str) -> Optional[str]:
    """Fetch and extract content from ChordU."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # ChordU has lyrics in specific containers
        content_div = soup.select_one('.chord-lyrics') or soup.select_one('.lyrics-container')
        if content_div:
            return content_div.get_text(separator='\n')

        # Fallback: get all text from main content
        main = soup.select_one('main') or soup.select_one('.content')
        if main:
            return main.get_text(separator='\n')

        return None

    except Exception as e:
        print(f"Fetch error for {url}: {e}", file=sys.stderr)
        return None


def fetch_echords(url: str) -> Optional[str]:
    """Fetch and extract content from e-chords.com."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # e-chords has content in pre tags
        pre = soup.select_one('pre')
        if pre:
            text = pre.get_text()
            # Normalize line breaks (e-chords uses \r)
            text = text.replace('\r\n', '\n').replace('\r', '\n')
            # Clean up "Hide this tab" and tab notation
            lines = text.split('\n')
            clean_lines = []
            skip_until_blank = False

            for line in lines:
                # Skip tab lines (start with E|, B|, etc.)
                if line.strip().startswith(('E|', 'B|', 'G|', 'D|', 'A|', 'e|')):
                    skip_until_blank = True
                    continue
                if 'Hide this tab' in line:
                    continue
                if skip_until_blank:
                    if not line.strip():
                        skip_until_blank = False
                    continue
                clean_lines.append(line)

            return '\n'.join(clean_lines)

        return None

    except Exception as e:
        print(f"Fetch error for {url}: {e}", file=sys.stderr)
        return None


def fetch_traditionalmusic(url: str) -> Optional[str]:
    """Fetch content from traditionalmusic.co.uk."""
    # Try Playwright first for JS-rendered content
    content = fetch_with_playwright(url, 'pre')
    if content and len(content) > 50:
        return content

    # Fallback to httpx
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Content is usually in a pre tag
        pre = soup.select_one('pre')
        if pre:
            return pre.get_text()

        return None

    except Exception as e:
        print(f"Fetch error for {url}: {e}", file=sys.stderr)
        return None


def fetch_cowboylyrics(url: str) -> Optional[str]:
    """Fetch content from cowboylyrics.com."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Content is in pre tags
        pre = soup.select_one('pre')
        if pre:
            return pre.get_text()

        return None

    except Exception as e:
        print(f"Fetch error for {url}: {e}", file=sys.stderr)
        return None


def fetch_generic_chord_page(url: str) -> Optional[str]:
    """Fetch content from a generic chord page."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Remove scripts and styles
        for tag in soup(['script', 'style', 'nav', 'header', 'footer']):
            tag.decompose()

        # Look for pre tags (common for chord charts)
        pre = soup.select_one('pre')
        if pre:
            return pre.get_text()

        # Look for common chord container classes
        for selector in ['.chord-sheet', '.lyrics', '.tab-content', '.chords', 'article']:
            el = soup.select_one(selector)
            if el:
                return el.get_text(separator='\n')

        return None

    except Exception as e:
        print(f"Fetch error for {url}: {e}", file=sys.stderr)
        return None


def is_chord_line(line: str) -> bool:
    """Check if a line contains mostly chords."""
    if not line.strip():
        return False
    words = line.strip().split()
    if not words:
        return False
    chord_pattern = re.compile(r'^[A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:/[A-G][#b]?)?$')
    chord_count = sum(1 for w in words if chord_pattern.match(w))
    return chord_count / len(words) > 0.5


def convert_to_chordpro(raw_content: str, title: str, artist: str = None) -> str:
    """Convert raw chord/lyrics content to ChordPro format."""
    lines = raw_content.split('\n')
    output_lines = []

    # Add metadata
    output_lines.append(f"{{meta: title {title}}}")
    if artist:
        output_lines.append(f"{{meta: artist {artist}}}")
    output_lines.append("{meta: x_source web-chords}")
    output_lines.append("")

    i = 0
    while i < len(lines):
        line = lines[i]

        # Skip empty lines at start
        if len(output_lines) <= 4 and not line.strip():
            i += 1
            continue

        # Check if this is a chord-only line followed by a lyric line
        if is_chord_line(line):
            next_line = lines[i + 1] if i + 1 < len(lines) else ""

            # Only merge if next line is NOT a chord line and has content
            if next_line.strip() and not is_chord_line(next_line):
                merged = merge_chord_line_with_lyrics(line, next_line)
                output_lines.append(merged)
                i += 2
            else:
                # Standalone chord line - convert to bracketed format
                converted = convert_chord_line(line)
                output_lines.append(converted)
                i += 1
        else:
            # Regular lyric line - might already have inline chords
            output_lines.append(line.rstrip())
            i += 1

    return '\n'.join(output_lines)


def convert_chord_line(line: str) -> str:
    """Convert a chord-only line to have bracketed chords."""
    chord_pattern = re.compile(r'([A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:/[A-G][#b]?)?)')
    return chord_pattern.sub(r'[\1]', line)


def merge_chord_line_with_lyrics(chord_line: str, lyric_line: str) -> str:
    """Merge a chord line with the lyrics line below it."""
    # Find chord positions
    chord_pattern = re.compile(r'([A-G][#b]?(?:maj|min|m|sus|dim|aug|add|M|7|9|11|13)*(?:/[A-G][#b]?)?)')

    chords = []
    for match in chord_pattern.finditer(chord_line):
        chords.append((match.start(), match.group(1)))

    if not chords:
        return lyric_line

    # Sort by position
    chords.sort(key=lambda x: x[0])

    # Insert chords into lyrics at appropriate positions
    result = []
    lyric_idx = 0

    for pos, chord in chords:
        # Add lyrics up to this chord position
        while lyric_idx < pos and lyric_idx < len(lyric_line):
            result.append(lyric_line[lyric_idx])
            lyric_idx += 1

        # Pad with spaces if needed
        while lyric_idx < pos:
            result.append(' ')
            lyric_idx += 1

        # Add the chord
        result.append(f'[{chord}]')

    # Add remaining lyrics
    result.append(lyric_line[lyric_idx:])

    return ''.join(result)


def clean_title(title: str) -> tuple[str, Optional[str]]:
    """Extract clean title and artist from song title string."""
    # Remove common suffixes
    title = re.sub(r'\s+via\s+.*$', '', title)
    title = re.sub(r'\s+[A-G][#b]?\s+to\s+[A-G][#b]?\s+version$', '', title, flags=re.I)
    title = re.sub(r'\s+\d+/\d+\s+version$', '', title, flags=re.I)
    title = re.sub(r'\s+(simplest|simple)\s+.*$', '', title, flags=re.I)

    # Extract artist if in brackets or after dash
    artist = None

    # Check for [Artist] pattern
    match = re.search(r'\[([^\]]+)\]', title)
    if match:
        potential_artist = match.group(1)
        # Check if it looks like an artist name (not a key or version)
        if not re.match(r'^[A-G][#b]?$', potential_artist) and 'version' not in potential_artist.lower():
            artist = potential_artist
            title = title.replace(match.group(0), '').strip()

    # Check for "Title - Artist" pattern (but not "Title - G" which is a key)
    if not artist:
        match = re.match(r'^(.+?)\s+-\s+([A-Z][a-z].*)$', title)
        if match and not re.match(r'^[A-G][#b]?m?$', match.group(2)):
            title = match.group(1)
            artist = match.group(2)

    return title.strip(), artist


def generate_slug(title: str, artist: str = None) -> str:
    """Generate a URL-friendly slug."""
    text = f"{title}-{artist}" if artist else title
    # Lowercase
    slug = text.lower()
    # Replace spaces and special chars with hyphens
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    # Remove leading/trailing hyphens
    slug = slug.strip('-')
    # Collapse multiple hyphens
    slug = re.sub(r'-+', '-', slug)
    return slug


def fetch_song_chords(title: str, dry_run: bool = False) -> Optional[dict]:
    """
    Search for and fetch chords for a song.

    Returns dict with 'title', 'artist', 'raw_content', 'source_url' or None.
    """
    clean_name, artist = clean_title(title)

    # Build search query
    base_query = f'{clean_name} chords lyrics'
    if artist:
        base_query = f'{clean_name} {artist} chords'

    print(f"Searching: {base_query}", file=sys.stderr)
    results = search_duckduckgo(base_query)
    time.sleep(RATE_LIMIT_DELAY)

    if not results:
        print(f"  No search results", file=sys.stderr)
        return None

    # Prioritize results from preferred sites (text-based chord charts)
    chord_url = None
    preferred_sites = ['e-chords.com', 'cowboylyrics.com', 'azchords.com', 'ultimate-guitar.com']
    fallback_sites = ['chordie.com', 'guitartabs.cc']
    # Note: traditionalmusic.co.uk removed - uses sheet music images, not text

    # First pass: preferred sites
    for r in results[:10]:
        url = r.get('url', '').lower()
        if any(site in url for site in preferred_sites):
            chord_url = r.get('url', '')
            if not chord_url.startswith('http'):
                chord_url = 'https://' + chord_url
            print(f"  Found (preferred): {chord_url[:70]}", file=sys.stderr)
            break

    # Second pass: fallback sites
    if not chord_url:
        for r in results[:10]:
            url = r.get('url', '').lower()
            if any(site in url for site in fallback_sites) or is_chord_site(url):
                chord_url = r.get('url', '')
                if not chord_url.startswith('http'):
                    chord_url = 'https://' + chord_url
                print(f"  Found (fallback): {chord_url[:70]}", file=sys.stderr)
                break

    if not chord_url:
        print(f"  No chord site in results", file=sys.stderr)
        for r in results[:3]:
            print(f"    - {r.get('url', '')[:60]}", file=sys.stderr)
        return None

    if dry_run:
        return {'title': clean_name, 'artist': artist, 'raw_content': None, 'source_url': chord_url}

    # Fetch content based on site
    url_lower = chord_url.lower()

    if 'e-chords.com' in url_lower:
        content = fetch_echords(chord_url)
    elif 'traditionalmusic.co.uk' in url_lower:
        content = fetch_traditionalmusic(chord_url)
    elif 'cowboylyrics.com' in url_lower:
        content = fetch_cowboylyrics(chord_url)
    elif 'ultimate-guitar' in url_lower:
        content = fetch_ultimate_guitar(chord_url)
    elif 'chordu' in url_lower:
        content = fetch_chordu(chord_url)
    else:
        content = fetch_generic_chord_page(chord_url)

    time.sleep(RATE_LIMIT_DELAY)

    if not content:
        print(f"  Could not extract content", file=sys.stderr)
        return None

    return {
        'title': clean_name,
        'artist': artist,
        'raw_content': content,
        'source_url': chord_url
    }


def save_raw(song_data: dict) -> Path:
    """Save raw content to sources/web-chords/raw/."""
    slug = generate_slug(song_data['title'], song_data['artist'])
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # Save raw content with metadata header
    raw_path = RAW_DIR / f"{slug}.txt"

    # Build metadata header
    header_lines = [
        f"# title: {song_data['title']}",
        f"# source_url: {song_data['source_url']}",
        f"# fetched_at: {time.strftime('%Y-%m-%d %H:%M:%S')}",
    ]
    if song_data.get('artist'):
        header_lines.insert(1, f"# artist: {song_data['artist']}")

    header = '\n'.join(header_lines) + '\n\n'
    raw_path.write_text(header + song_data['raw_content'])

    return raw_path


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Fetch chords from the web')
    parser.add_argument('title', nargs='?', help='Song title to search for')
    parser.add_argument('--batch', help='JSON file with list of song titles')
    parser.add_argument('--limit', type=int, default=10, help='Max songs to process in batch mode')
    parser.add_argument('--dry-run', action='store_true', help='Search only, do not fetch or save')
    parser.add_argument('--offset', type=int, default=0, help='Skip first N songs in batch')

    args = parser.parse_args()

    if args.batch:
        # Batch mode
        with open(args.batch) as f:
            songs = json.load(f)

        songs = songs[args.offset:args.offset + args.limit]

        print(f"Processing {len(songs)} songs (offset={args.offset}, limit={args.limit})", file=sys.stderr)
        print(f"Dry run: {args.dry_run}", file=sys.stderr)
        print("", file=sys.stderr)

        results = {'success': [], 'failed': [], 'skipped': []}

        for i, title in enumerate(songs):
            print(f"[{i+1}/{len(songs)}] {title}", file=sys.stderr)

            try:
                result = fetch_song_chords(title, dry_run=args.dry_run)

                if result:
                    if not args.dry_run and result.get('raw_content'):
                        path = save_raw(result)
                        print(f"  Saved to: {path}", file=sys.stderr)
                    results['success'].append({'title': title, 'url': result.get('source_url')})
                else:
                    results['failed'].append(title)
            except Exception as e:
                print(f"  Error: {e}", file=sys.stderr)
                results['failed'].append(title)

            print("", file=sys.stderr)

        # Summary
        print("=" * 60, file=sys.stderr)
        print(f"Success: {len(results['success'])}", file=sys.stderr)
        print(f"Failed: {len(results['failed'])}", file=sys.stderr)

        if results['failed']:
            print("\nFailed songs:", file=sys.stderr)
            for t in results['failed']:
                print(f"  - {t}", file=sys.stderr)

    elif args.title:
        # Single song mode
        result = fetch_song_chords(args.title, dry_run=args.dry_run)

        if result:
            if args.dry_run:
                print(f"Would fetch from: {result['source_url']}")
            else:
                print(result['raw_content'])
        else:
            print("Could not find chords", file=sys.stderr)
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)

    # Cleanup
    close_browser()


if __name__ == '__main__':
    try:
        main()
    finally:
        close_browser()
