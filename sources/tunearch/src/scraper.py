#!/usr/bin/env python3
"""
TuneArch Scraper - Fetches ABC notation from tunearch.org

Respects rate limits and provides both batch and single-tune fetching.
"""

import re
import time
import requests
from pathlib import Path
from bs4 import BeautifulSoup
from dataclasses import dataclass, field
from typing import Optional, List
from urllib.parse import quote, urljoin

try:
    from .abc_parser import extract_abc_blocks, extract_metadata_from_page
except ImportError:
    from abc_parser import extract_abc_blocks, extract_metadata_from_page


@dataclass
class TuneMetadata:
    """Metadata extracted from a TuneArch tune page"""
    title: str
    alt_titles: List[str] = field(default_factory=list)
    key: Optional[str] = None
    time_signature: Optional[str] = None
    mode: Optional[str] = None
    meter_rhythm: Optional[str] = None  # e.g., "Reel", "Jig", "Hornpipe"
    genre: Optional[str] = None  # e.g., "Bluegrass, Old-Time"
    region: Optional[str] = None
    composer: Optional[str] = None
    source: Optional[str] = None  # Publication source
    theme_code: Optional[str] = None
    structure: Optional[str] = None  # e.g., "AABB"
    tunearch_url: str = ""


@dataclass
class ABCTune:
    """A single ABC tune with metadata"""
    metadata: TuneMetadata
    abc_notation: str
    raw_html: Optional[str] = None


class TuneArchScraper:
    """Scraper for TuneArch.org tune pages"""

    BASE_URL = "https://tunearch.org"
    WIKI_BASE = f"{BASE_URL}/wiki/"
    SEARCH_URL = f"{BASE_URL}/w/index.php"
    RATE_LIMIT_SECONDS = 1.0  # Be polite

    def __init__(self, cache_dir: Optional[Path] = None):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'BluegrassSongbook/1.0 (educational project; https://github.com/Jollyhrothgar/Bluegrass-Songbook)'
        })
        self.cache_dir = cache_dir
        self.last_request_time = 0.0

    def _rate_limit(self):
        """Ensure minimum time between requests"""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.RATE_LIMIT_SECONDS:
            time.sleep(self.RATE_LIMIT_SECONDS - elapsed)
        self.last_request_time = time.time()

    def _get_cached(self, tune_name: str) -> Optional[str]:
        """Check cache for previously fetched HTML"""
        if not self.cache_dir:
            return None
        cache_file = self.cache_dir / f"{self._safe_filename(tune_name)}.html"
        if cache_file.exists():
            return cache_file.read_text(encoding='utf-8')
        return None

    def _save_cache(self, tune_name: str, html: str):
        """Save HTML to cache"""
        if not self.cache_dir:
            return
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = self.cache_dir / f"{self._safe_filename(tune_name)}.html"
        cache_file.write_text(html, encoding='utf-8')

    def _safe_filename(self, name: str) -> str:
        """Convert tune name to safe filename"""
        return re.sub(r'[^a-z0-9]', '_', name.lower())[:80]

    def fetch_tune_page(self, tune_name: str, use_cache: bool = True) -> Optional[str]:
        """Fetch raw HTML for a tune page"""
        # Check cache first
        if use_cache:
            cached = self._get_cached(tune_name)
            if cached:
                return cached

        self._rate_limit()

        # URL-encode the tune name for wiki URL
        url = f"{self.WIKI_BASE}{quote(tune_name.replace(' ', '_'))}"

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            html = response.text

            # Cache the result
            self._save_cache(tune_name, html)

            return html
        except requests.RequestException as e:
            print(f"Error fetching {tune_name}: {e}")
            return None

    def search_tunes(self, query: str, limit: int = 20) -> List[str]:
        """Search TuneArch for tunes matching query, return list of tune names"""
        self._rate_limit()

        params = {
            'search': query,
            'title': 'Special:Search',
            'profile': 'default',
            'fulltext': '1'
        }

        try:
            response = self.session.get(self.SEARCH_URL, params=params, timeout=30)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            results = []

            # Parse search results - look for result links
            for result in soup.select('.mw-search-result-heading a'):
                title = result.get('title', '')
                if title and not title.startswith('Special:'):
                    results.append(title)
                    if len(results) >= limit:
                        break

            return results
        except requests.RequestException as e:
            print(f"Error searching for '{query}': {e}")
            return []

    def parse_tune_page(self, html: str, url: str) -> Optional[ABCTune]:
        """Parse a TuneArch tune page to extract ABC and metadata"""
        soup = BeautifulSoup(html, 'html.parser')

        # Extract title from page heading
        title_elem = soup.find('h1', {'id': 'firstHeading'})
        title = title_elem.get_text().strip() if title_elem else "Unknown"

        # Remove disambiguation suffix like "(1)" from title
        title = re.sub(r'\s*\(\d+\)\s*$', '', title)

        # Extract ABC notation blocks
        abc_blocks = extract_abc_blocks(soup)
        if not abc_blocks:
            return None

        # Extract metadata from info tables
        metadata = extract_metadata_from_page(soup, title, url)

        return ABCTune(
            metadata=metadata,
            abc_notation=abc_blocks[0],  # Primary notation
            raw_html=html
        )

    def fetch_tune(self, tune_name: str, use_cache: bool = True) -> Optional[ABCTune]:
        """Fetch and parse a single tune by name"""
        html = self.fetch_tune_page(tune_name, use_cache=use_cache)
        if not html:
            return None

        url = f"{self.WIKI_BASE}{quote(tune_name.replace(' ', '_'))}"
        return self.parse_tune_page(html, url)
