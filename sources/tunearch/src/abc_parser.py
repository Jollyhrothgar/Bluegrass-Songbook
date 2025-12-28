#!/usr/bin/env python3
"""
ABC Parser - Extract ABC notation and metadata from TuneArch HTML pages
"""

import re
from typing import List, Optional, TYPE_CHECKING
from bs4 import BeautifulSoup

if TYPE_CHECKING:
    try:
        from .scraper import TuneMetadata
    except ImportError:
        from scraper import TuneMetadata


def extract_abc_blocks(soup: BeautifulSoup) -> List[str]:
    """Extract ABC notation blocks from a TuneArch page"""
    abc_blocks = []

    # Method 1: Look for <pre> blocks containing ABC notation
    for pre in soup.find_all('pre'):
        text = pre.get_text()
        # ABC notation always has X: (index) and K: (key) fields
        if 'X:' in text and ('K:' in text or 'M:' in text):
            abc_blocks.append(clean_abc_notation(text))

    # Method 2: Look for divs with ABC class or data attributes
    for div in soup.find_all('div', class_=re.compile(r'abc', re.I)):
        abc_content = div.get('data-abc') or div.get_text()
        if abc_content and 'X:' in abc_content:
            abc_blocks.append(clean_abc_notation(abc_content))

    # Method 3: Look for ABC in page content text (TuneArch often has it inline)
    if not abc_blocks:
        content_div = soup.find('div', {'id': 'mw-content-text'})
        if content_div:
            # Get the full text content with newlines preserved
            text = content_div.get_text(separator='\n')

            # Find ALL ABC blocks on the page (there may be multiple versions)
            # ABC block starts with X: and continues until we hit a non-ABC line
            lines = text.split('\n')
            current_abc = []
            in_abc = False
            found_key = False

            for line in lines:
                line = line.strip()

                # Start of new ABC block
                if re.match(r'^X:\s*\d+', line):
                    # Save previous block if it had notation
                    if current_abc and has_notation(current_abc):
                        abc_blocks.append(clean_abc_notation('\n'.join(current_abc)))
                    current_abc = [line]
                    in_abc = True
                    found_key = False
                    continue

                if not in_abc:
                    continue

                # ABC header fields (A-Z followed by colon)
                if re.match(r'^[A-Za-z]:', line):
                    # Clean URL lines (S: field often has http links)
                    if line.startswith('S:') and 'http' in line:
                        # Extract just the URL reference
                        line = re.sub(r'http\S+', '', line).strip()
                        if line == 'S:':
                            continue
                    current_abc.append(line)
                    if line.startswith('K:'):
                        found_key = True
                    continue

                # After K: line, look for actual notation
                if found_key:
                    # ABC notation lines contain measure bars, notes, etc.
                    # They typically start with |, :, ", or contain notes and bars
                    if line.startswith('|') or line.startswith(':') or line.startswith('"'):
                        current_abc.append(line)
                    elif '|' in line and re.search(r'[a-gA-G]', line):
                        # Contains both bars and notes - it's notation
                        current_abc.append(line)
                    elif re.match(r'^[\|\:\[\]a-gA-GzZ0-9\s\'\,\(\)\{\}\-\#\^\_\<\>\~\.\"\=\!]+$', line) and line:
                        # Looks like ABC notation characters
                        current_abc.append(line)
                    elif not line:
                        # Empty line - might be end of block
                        continue
                    else:
                        # Non-ABC line - end of this block
                        if has_notation(current_abc):
                            abc_blocks.append(clean_abc_notation('\n'.join(current_abc)))
                        current_abc = []
                        in_abc = False
                        found_key = False

            # Don't forget the last block
            if current_abc and has_notation(current_abc):
                abc_blocks.append(clean_abc_notation('\n'.join(current_abc)))

    return abc_blocks


def has_notation(abc_lines: List[str]) -> bool:
    """Check if ABC lines contain actual music notation (not just headers)"""
    for line in abc_lines:
        # Skip header lines
        if re.match(r'^[A-Za-z]:', line):
            continue
        # Look for notation: bars with notes
        if '|' in line and re.search(r'[a-gA-G]', line):
            return True
    return False


def clean_abc_notation(abc: str) -> str:
    """Clean up ABC notation text"""
    # Normalize line endings
    abc = abc.replace('\r\n', '\n').replace('\r', '\n')

    # Remove leading/trailing whitespace
    abc = abc.strip()

    # Ensure proper ABC header if missing X:
    lines = abc.split('\n')
    has_x_field = any(line.strip().startswith('X:') for line in lines)

    if not has_x_field:
        # Add X:1 at the beginning
        abc = 'X:1\n' + abc

    return abc


def extract_key_from_abc(abc: str) -> Optional[str]:
    """Extract key from ABC K: field"""
    match = re.search(r'^K:\s*([A-G][#b]?)\s*(.*?)$', abc, re.MULTILINE | re.IGNORECASE)
    if match:
        key = match.group(1).upper()
        mode_str = match.group(2).strip().lower()

        # Handle minor modes
        if 'min' in mode_str or mode_str == 'm':
            key += 'm'
        elif 'dor' in mode_str:
            key += 'Dor'  # Dorian
        elif 'mix' in mode_str:
            key += 'Mix'  # Mixolydian

        return key
    return None


def extract_time_from_abc(abc: str) -> Optional[str]:
    """Extract time signature from ABC M: field"""
    match = re.search(r'^M:\s*(\d+/\d+|C\|?)', abc, re.MULTILINE)
    if match:
        ts = match.group(1)
        if ts == 'C':
            return '4/4'
        if ts == 'C|':
            return '2/2'
        return ts
    return None


def extract_title_from_abc(abc: str) -> Optional[str]:
    """Extract title from ABC T: field"""
    match = re.search(r'^T:\s*(.+)$', abc, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return None


def extract_metadata_from_page(soup: BeautifulSoup, title: str, url: str) -> 'TuneMetadata':
    """Extract metadata from tune page tables and infoboxes"""
    try:
        from .scraper import TuneMetadata
    except ImportError:
        from scraper import TuneMetadata

    metadata = TuneMetadata(
        title=title,
        tunearch_url=url
    )

    # Parse infobox-style tables
    for row in soup.find_all('tr'):
        cells = row.find_all(['th', 'td'])
        if len(cells) >= 2:
            label = cells[0].get_text().strip().lower()
            value = cells[1].get_text().strip()

            if not value:
                continue

            if 'key' in label and 'accidental' not in label:
                metadata.key = value
            elif 'accidental' in label:
                # Combine with key if present
                if metadata.key:
                    metadata.key = f"{metadata.key} ({value})"
            elif 'time' in label or ('meter' in label and 'rhythm' not in label):
                metadata.time_signature = value
            elif 'mode' in label:
                metadata.mode = value
            elif 'rhythm' in label or 'type' in label:
                metadata.meter_rhythm = value
            elif 'genre' in label or 'style' in label:
                metadata.genre = value
            elif 'region' in label or 'country' in label or 'origin' in label:
                metadata.region = value
            elif 'composer' in label or 'author' in label:
                metadata.composer = value
            elif 'theme' in label and 'code' in label:
                metadata.theme_code = value
            elif 'structure' in label or 'form' in label:
                metadata.structure = value
            elif 'also known' in label or 'alternate' in label or 'alias' in label:
                alts = [t.strip() for t in value.split(',') if t.strip()]
                metadata.alt_titles.extend(alts)

    # Also check for bold labels followed by values (common wiki format)
    for bold in soup.find_all('b'):
        label = bold.get_text().strip().lower()
        next_sibling = bold.next_sibling
        if next_sibling:
            value = str(next_sibling).strip().lstrip(':').strip()
            if value and len(value) < 100:
                if 'rhythm' in label or 'type' in label:
                    metadata.meter_rhythm = value
                elif 'region' in label:
                    metadata.region = value

    return metadata
