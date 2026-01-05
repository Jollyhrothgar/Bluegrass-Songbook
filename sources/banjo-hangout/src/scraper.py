"""Banjo Hangout tab scraper.

Fetches tab metadata and downloads TEF files from banjohangout.org.
"""

import re
import time
import requests
from pathlib import Path
from dataclasses import dataclass
from typing import Optional
from bs4 import BeautifulSoup
from urllib.parse import urljoin

from catalog import TabEntry, TabCatalog


@dataclass
class TabMetadata:
    """Metadata extracted from a tab listing."""
    id: str
    title: str
    author: str
    format: str
    download_url: str
    genre: Optional[str] = None
    style: Optional[str] = None
    key: Optional[str] = None
    tuning: Optional[str] = None
    difficulty: Optional[str] = None


class BanjoHangoutScraper:
    """Scraper for Banjo Hangout tab archive."""

    BASE_URL = "https://www.banjohangout.org"
    TAB_BROWSE_URL = f"{BASE_URL}/w/tab/browse/m/byletter/v/"
    TAB_DETAIL_URL = f"{BASE_URL}/tab/browse.asp"
    RATE_LIMIT_SECONDS = 1.5  # Be respectful

    # Letters to scan (A-Z, plus numeric)
    LETTERS = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + ['0']

    def __init__(self, cache_dir: Path, download_dir: Path):
        self.cache_dir = cache_dir
        self.download_dir = download_dir
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'BluegrassSongbook/1.0 (educational project; github.com/Jollyhrothgar/Bluegrass-Songbook)'
        })
        self.last_request_time = 0.0

    def _rate_limit(self):
        """Ensure minimum time between requests."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.RATE_LIMIT_SECONDS:
            time.sleep(self.RATE_LIMIT_SECONDS - elapsed)
        self.last_request_time = time.time()

    def _get_cached(self, cache_key: str) -> Optional[str]:
        """Check cache for previously fetched HTML."""
        cache_file = self.cache_dir / f"{cache_key}.html"
        if cache_file.exists():
            return cache_file.read_text(encoding='utf-8')
        return None

    def _save_cache(self, cache_key: str, html: str):
        """Save HTML to cache."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = self.cache_dir / f"{cache_key}.html"
        cache_file.write_text(html, encoding='utf-8')

    def _safe_filename(self, name: str) -> str:
        """Convert to safe filename."""
        return re.sub(r'[^a-z0-9]', '_', name.lower())[:80]

    def fetch_letter_page(self, letter: str, use_cache: bool = True) -> Optional[str]:
        """Fetch the browse page for a letter."""
        cache_key = f"browse_{letter.lower()}"

        if use_cache:
            cached = self._get_cached(cache_key)
            if cached:
                return cached

        self._rate_limit()

        url = f"{self.TAB_BROWSE_URL}{letter}"
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            html = response.text
            self._save_cache(cache_key, html)
            return html
        except requests.RequestException as e:
            print(f"Error fetching letter {letter}: {e}")
            return None

    def parse_tab_entries(self, html: str) -> list[TabMetadata]:
        """Parse tab entries from a browse page."""
        soup = BeautifulSoup(html, 'html.parser')
        entries = []

        # Find all tab headings
        # Pattern: <h2 class='noSpacing bold'><a href='/tab/browse.asp?m=detail&v=12345'>Title</a>
        for h2 in soup.find_all('h2', class_='noSpacing'):
            link = h2.find('a', href=re.compile(r'/tab/browse\.asp\?m=detail&v='))
            if not link:
                continue

            # Extract tab ID from URL
            href = link.get('href', '')
            match = re.search(r'v=(\d+)', href)
            if not match:
                continue
            tab_id = match.group(1)

            # Title
            title = link.get_text(strip=True)

            # Find the parent container that has metadata
            container = h2.find_parent()
            if not container:
                continue

            # Get the text content of the container
            text = container.get_text()

            # Extract metadata using regex
            author = self._extract_author(container)
            genre = self._extract_field(text, 'Genre')
            style = self._extract_field(text, 'Style')
            key = self._extract_field(text, 'Key')
            tuning = self._extract_field(text, 'Tuning')
            difficulty = self._extract_field(text, 'Difficulty')

            # Find download links and determine format
            download_info = self._find_download_links(container)

            for fmt, url in download_info:
                entries.append(TabMetadata(
                    id=f"{tab_id}_{fmt}",  # Include format in ID for uniqueness
                    title=title,
                    author=author or 'unknown',
                    format=fmt,
                    download_url=url,
                    genre=genre,
                    style=style,
                    key=key,
                    tuning=tuning,
                    difficulty=difficulty,
                ))

        return entries

    def _extract_author(self, container) -> Optional[str]:
        """Extract author/poster username."""
        # Look for "Posted by <a href='/my/username'>username</a>"
        link = container.find('a', href=re.compile(r'/my/'))
        if link:
            return link.get_text(strip=True)
        return None

    def _extract_field(self, text: str, field_name: str) -> Optional[str]:
        """Extract a metadata field from text.

        Note: BeautifulSoup's get_text() converts &nbsp; to \xa0 (Unicode nbsp)
        """
        # Pattern: "Genre: Bluegrass" followed by nbsp, newline, or next field
        # \xa0 is the Unicode nbsp character that get_text() produces
        # Also handles "Difficulty: IntermediatePosted by" edge case
        pattern = rf'{field_name}:\s*([^\xa0\n]+?)(?:\s*\xa0|\s*\n|Posted|$)'
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return None

    def _find_download_links(self, container) -> list[tuple[str, str]]:
        """Find download links and their formats."""
        links = []

        # Map of text patterns to format codes
        format_map = {
            'TABLEDIT': 'tef',
            'TABRITE': 'bjo',
            'PDF': 'pdf',
        }

        for link in container.find_all('a', href=True):
            href = link.get('href', '')
            text = link.get_text(strip=True).upper()

            # Check for download links on hangoutstorage.com
            if 'hangoutstorage.com' in href:
                # Determine format from extension or link text
                if href.endswith('.tef'):
                    links.append(('tef', href))
                elif href.endswith('.pdf'):
                    links.append(('pdf', href))
                elif href.endswith('.bjo'):
                    links.append(('bjo', href))
                elif href.endswith('.mid'):
                    links.append(('midi', href))
                elif href.endswith('.mp3'):
                    links.append(('mp3', href))
                elif text in format_map:
                    links.append((format_map[text], href))

        return links

    def scan_catalog(self, letters: list[str] = None, limit: int = None) -> list[TabMetadata]:
        """Scan the tab archive and build catalog of available tabs.

        Args:
            letters: Letters to scan (default: all A-Z + 0)
            limit: Maximum number of tabs to return (default: unlimited)

        Returns:
            List of TabMetadata objects
        """
        if letters is None:
            letters = self.LETTERS

        all_tabs = []
        for letter in letters:
            print(f"Scanning letter {letter}...")
            html = self.fetch_letter_page(letter)
            if html:
                tabs = self.parse_tab_entries(html)
                print(f"  Found {len(tabs)} tabs")
                all_tabs.extend(tabs)

                if limit and len(all_tabs) >= limit:
                    all_tabs = all_tabs[:limit]
                    break

        return all_tabs

    def download_tab(self, tab: TabEntry) -> Optional[Path]:
        """Download a tab file.

        Args:
            tab: TabEntry with download URL

        Returns:
            Path to downloaded file, or None on failure
        """
        if tab.format != 'tef':
            return None  # Only download TEF files for now

        # Get download URL from source_url (which stores the download URL)
        download_url = tab.source_url

        # For entries from catalog, source_url is the page URL
        # We need to fetch the detail page to get the actual download URL
        # This is a limitation - we'd need to store download_url separately
        # For now, assume we stored download_url in a custom way

        # Actually, looking at the catalog structure, we should store
        # download_url separately. Let's add that.

        self._rate_limit()

        self.download_dir.mkdir(parents=True, exist_ok=True)
        # Use readable filename: id_title.tef
        safe_title = self._safe_filename(tab.title) if tab.title else "unknown"
        output_path = self.download_dir / f"{tab.id}_{safe_title}.tef"

        try:
            # Use stored download URL (we'll need to adjust catalog to store this)
            response = self.session.get(download_url, timeout=60)
            response.raise_for_status()
            output_path.write_bytes(response.content)
            return output_path
        except requests.RequestException as e:
            print(f"Error downloading {tab.id}: {e}")
            return None


def scan_and_update_catalog(
    catalog: TabCatalog,
    scraper: BanjoHangoutScraper,
    letters: list[str] = None,
    limit: int = None
) -> int:
    """Scan Banjo Hangout and update the catalog.

    Args:
        catalog: TabCatalog to update
        scraper: BanjoHangoutScraper instance
        letters: Letters to scan (default: all)
        limit: Max tabs to add

    Returns:
        Number of new tabs added
    """
    tabs = scraper.scan_catalog(letters=letters, limit=limit)
    new_count = 0

    for meta in tabs:
        # Only add TEF tabs for now
        if meta.format != 'tef':
            continue

        # Check if already in catalog
        if meta.id in catalog.tabs:
            continue

        # Create tab entry with full source URL for attribution
        tab = TabEntry(
            id=meta.id,
            title=meta.title,
            author=meta.author,
            format=meta.format,
            source_url=meta.download_url,  # Store download URL here
            genre=meta.genre,
            style=meta.style,
            key=meta.key,
            tuning=meta.tuning,
            difficulty=meta.difficulty,
            status='pending',
        )

        catalog.add_tab(tab)
        new_count += 1

    catalog.update_scan_time()
    catalog.save()

    return new_count
