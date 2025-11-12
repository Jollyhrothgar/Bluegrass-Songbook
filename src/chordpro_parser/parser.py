#!/usr/bin/env python3
"""
HTML Song Parser - Converts classic-country-song-lyrics.com HTML to ChordPro format

This parser handles multiple HTML structure variations and preserves critical
chord-to-lyric alignment through careful whitespace normalization.
"""

import re
import json
from typing import Optional, List, Dict, Tuple
from bs4 import BeautifulSoup
from dataclasses import dataclass, asdict
import html


@dataclass
class ChordPosition:
    """Represents a chord and its position in a lyric line"""
    chord: str
    position: int


@dataclass
class SongLine:
    """Represents a line in the song - either lyrics with chords or chord-only line"""
    lyrics: Optional[str] = None
    chords: List[ChordPosition] = None
    chords_line: Optional[str] = None  # For instrumental/chord-only lines

    def __post_init__(self):
        if self.chords is None:
            self.chords = []


@dataclass
class Paragraph:
    """Represents a verse, chorus, or other song section"""
    lines: List[SongLine]
    section_type: Optional[str] = None  # 'verse', 'chorus', 'bridge', 'outro', 'intro', etc.


@dataclass
class SongContent:
    """Complete song structure"""
    paragraphs: List[Paragraph]
    playback_sequence: List[int]
    raw_repeat_instruction_text: Optional[str] = None


@dataclass
class Song:
    """Complete song data including metadata"""
    title: Optional[str] = None
    artist: Optional[str] = None
    composer: Optional[str] = None
    recorded_by: Optional[str] = None
    lyricist: Optional[str] = None
    music: Optional[str] = None
    source_html_file: Optional[str] = None
    song_content: Optional[SongContent] = None


class HTMLNormalizer:
    """Handles HTML cleaning and whitespace normalization"""

    @staticmethod
    def normalize_whitespace(text: str) -> str:
        """Convert all whitespace to regular spaces while preserving positioning"""
        # First decode HTML entities
        text = html.unescape(text)
        # Replace &nbsp; with regular space
        text = text.replace('\u00a0', ' ')
        # Replace tabs with appropriate spaces
        text = text.replace('\t', ' ')
        return text

    @staticmethod
    def extract_text_preserving_position(element) -> str:
        """Extract text from HTML element preserving exact character positions"""
        if isinstance(element, str):
            return HTMLNormalizer.normalize_whitespace(element)

        text = element.get_text()
        return HTMLNormalizer.normalize_whitespace(text)


class SectionMarkerDetector:
    """Detects and normalizes song section markers like [Chorus], [Verse], etc."""

    # Section marker patterns and their ChordPro equivalents
    SECTION_MARKERS = {
        'chorus': 'chorus',
        'verse': 'verse',
        'bridge': 'bridge',
        'intro': 'verse',  # Treat intro as verse
        'outro': 'verse',  # Treat outro as verse
        'instrumental': 'verse',
        'interlude': 'verse',
        'pre-chorus': 'verse',
        'prechorus': 'verse',
        'refrain': 'chorus',
    }

    @staticmethod
    def detect_section_marker(text: str) -> Optional[str]:
        """
        Detects if a line is a section marker like [Chorus], [Verse], etc.
        Returns the normalized section type, or None if not a marker.
        """
        if not text:
            return None

        # Check for bracketed markers: [Chorus], [Verse], etc.
        text_clean = text.strip().lower()
        if text_clean.startswith('[') and text_clean.endswith(']'):
            marker_text = text_clean[1:-1].strip()
            # Check against known section types
            return SectionMarkerDetector.SECTION_MARKERS.get(marker_text)

        return None


class StructureDetector:
    """Detects the HTML structure type and whether file contains parseable content"""

    # Anchor texts to find song content boundaries
    START_ANCHOR = "Low prices on"
    END_ANCHOR = "If you want to change the"

    @staticmethod
    def detect_structure_type(soup) -> Optional[str]:
        """
        Determine which HTML structure pattern the song uses
        Returns: 'pre_tag', 'pre_plain', 'span_br', or None if not parseable
        """
        # Look for <pre> tags - there may be multiple, find the one with actual content
        pre_tags = soup.find_all('pre')
        if pre_tags:
            # Find the pre tag with the most song content (chords/lyrics)
            # Some files have boilerplate in first pre, song in second pre
            best_pre = None
            max_chord_count = 0
            
            for pre_tag in pre_tags:
                # Count potential chords in this pre tag
                # Use raw HTML string to preserve spacing between chords
                # (get_text() concatenates without spaces, breaking chord detection)
                raw_html = str(pre_tag)
                chord_pattern = r'\b[A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d*\b'
                chord_matches = re.findall(chord_pattern, raw_html)
                chord_count = len(chord_matches)
                
                # Prefer pre tags with more chords (actual song content)
                if chord_count > max_chord_count:
                    max_chord_count = chord_count
                    best_pre = pre_tag
            
            # Only use pre tag if it has actual chord content (at least 3 chords)
            # This prevents selecting boilerplate pre tags with 0-2 false positive matches
            if best_pre and max_chord_count >= 3:
                # Check if it has font children or MANY span children (structured content)
                # These need to be parsed with pre_tag parser logic
                # Require >5 spans to avoid detecting single boilerplate spans
                spans_count = len(best_pre.find_all('span'))
                if best_pre.find('font') or spans_count > 5:
                    return 'pre_tag'
                # Plain pre tag (most common pattern #1)
                return 'pre_plain'
            # If pre tags exist but have no chord content, fall through to span_br check

        # Look for multiple span tags with Courier New font followed by br tags
        courier_spans = soup.find_all('span', style=re.compile(r'font-family:\s*Courier New', re.I))
        if len(courier_spans) > 5:  # Arbitrary threshold - song likely has multiple lines
            return 'span_br'

        return None

    @staticmethod
    def has_parseable_content(html_content: str) -> bool:
        """Check if HTML file contains song lyrics and chords"""
        soup = BeautifulSoup(html_content, 'html.parser')
        structure_type = StructureDetector.detect_structure_type(soup)

        if not structure_type:
            return False

        # Additional validation: look for chord patterns
        text = soup.get_text()
        # Simple chord pattern: capital letter followed by optional modifiers
        chord_pattern = r'\b[A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d*\b'
        chord_matches = re.findall(chord_pattern, text)

        # Should have at least a few chords
        return len(chord_matches) > 3


class ChordDetector:
    """Detects and parses chord lines"""

    # Comprehensive chord pattern
    CHORD_PATTERN = re.compile(
        r'\b([A-G][#b♯♭]?(?:maj|min|m|sus|dim|aug|add|M)?\d*(?:/[A-G][#b♯♭]?)?)\b'
    )

    @staticmethod
    def is_chord_line(line: str) -> bool:
        """Determine if a line is primarily chords"""
        if not line.strip():
            return False

        # Find all potential chords
        chords = ChordDetector.CHORD_PATTERN.findall(line)

        # Get all words (including potential chords)
        words = line.split()

        if not words:
            return False

        # If most words are chords, it's a chord line
        chord_ratio = len(chords) / len(words)
        return chord_ratio > 0.5

    @staticmethod
    def extract_chords_with_positions(chord_line: str) -> List[ChordPosition]:
        """Extract chords and their character positions from a chord line"""
        chords = []
        for match in ChordDetector.CHORD_PATTERN.finditer(chord_line):
            chord = match.group(1)
            position = match.start()
            chords.append(ChordPosition(chord=chord, position=position))
        return chords
    
    @staticmethod
    def map_chord_positions_to_lyrics(chord_line: str, lyric_line: str, chord_positions: List[ChordPosition]) -> List[ChordPosition]:
        """
        Map chord positions from chord line (with alignment spaces) to lyric line (without those spaces).
        
        The chord line uses spaces to align chords with words below. This function maps those
        positions to the actual character positions in the lyric line by finding which word
        each chord aligns with based on character position.
        """
        if not chord_positions:
            return []
        
        # Get words with their positions in the lyric line
        lyric_words = []
        pos = 0
        for word in lyric_line.split():
            word_start = lyric_line.find(word, pos)
            word_end = word_start + len(word)
            lyric_words.append((word, word_start, word_end))
            pos = word_end
        
        if not lyric_words:
            # No words in lyric line, return original positions clamped
            return [ChordPosition(chord=cp.chord, position=min(cp.position, len(lyric_line))) 
                    for cp in chord_positions]
        
        # Map each chord position to a lyric word position
        # The chord line has spaces that align chords with words below
        # We map based on the character position: find which word in the lyric line
        # corresponds to the chord's position in the chord line
        mapped_chords = []
        for chord_pos in chord_positions:
            chord_char_pos = chord_pos.position
            
            # Find which word in lyric_line this chord aligns with
            # We do this by mapping the character position proportionally
            # or by finding the closest word
            
            # Simple approach: find the word whose start position is closest to the
            # chord's position (scaled to lyric line length)
            best_word_idx = 0
            min_distance = float('inf')
            
            # Scale chord position to lyric line length
            if len(chord_line) > 0:
                scaled_pos = (chord_char_pos / len(chord_line)) * len(lyric_line)
            else:
                scaled_pos = chord_char_pos
            
            # Find the word whose start is closest to the scaled position
            for i, (word, word_start, word_end) in enumerate(lyric_words):
                distance = abs(word_start - scaled_pos)
                if distance < min_distance:
                    min_distance = distance
                    best_word_idx = i
            
            # Use the start of the best matching word
            mapped_pos = lyric_words[best_word_idx][1]
            mapped_chords.append(ChordPosition(chord=chord_pos.chord, position=mapped_pos))
        
        return mapped_chords


class MetadataExtractor:
    """Extracts song metadata from HTML"""

    @staticmethod
    def extract_metadata(soup, html_file: str) -> Dict[str, str]:
        """Extract title, artist, composer, recorded_by, lyricist, music from HTML"""
        metadata = {
            'title': None,
            'artist': None,
            'composer': None,
            'recorded_by': None,
            'lyricist': None,
            'music': None,
            'source_html_file': html_file
        }

        # Try to get title from HTML title tag
        title_tag = soup.find('title')
        if title_tag:
            title_text = title_tag.get_text()
            # Pattern: "Song Title lyrics and chords | Artist Name"
            if '|' in title_text:
                parts = title_text.split('|')
                if 'lyrics' in parts[0].lower():
                    title = parts[0].replace('lyrics and chords', '').replace('lyrics chords', '').replace('lyrics', '').strip()
                    metadata['title'] = ' '.join(title.split())  # Normalize whitespace
                if len(parts) > 1:
                    artist = parts[1].strip()
                    metadata['artist'] = ' '.join(artist.split())  # Normalize whitespace

        # Look for metadata in span/font elements with Courier New
        # BUT skip meta tags which often contain "recorded by" in descriptions
        courier_elements = soup.find_all(['span', 'font'], style=re.compile(r'font-family:\s*Courier New', re.I))
        courier_elements.extend(soup.find_all('font', face=re.compile(r'Lucida Console', re.I)))

        for elem in courier_elements:
            # Skip if this element is inside a meta tag
            if elem.find_parent('meta') or elem.find_parent('head'):
                continue

            text = elem.get_text()

            # Skip boilerplate text (descriptions, disclaimers, etc)
            if (len(text) > 100 or
                'intended for your personal use' in text.lower() or
                'property of the respective artist' in text.lower()):
                continue

            # Find "Recorded by" line - limit to single line
            recorded_match = re.search(r'[Rr]ecorded by\s+(.+?)(?:\n|$)', text)
            if recorded_match and not metadata['recorded_by']:
                recorded_by = recorded_match.group(1).strip()
                # Clean up common trailing junk
                recorded_by = re.sub(r'\s*\.\s*To see.*$', '', recorded_by)
                recorded_by = re.sub(r'\s*\.\s*$', '', recorded_by)
                metadata['recorded_by'] = ' '.join(recorded_by.split())

            # Find "Written by" line
            written_match = re.search(r'[Ww]ritten by\s+(.+?)(?:\n|$)', text)
            if written_match and not metadata['composer']:
                composer = written_match.group(1).strip()
                metadata['composer'] = ' '.join(composer.split())

            # Find "Lyrics by" line
            lyrics_match = re.search(r'[Ll]yrics by\s+(.+?)(?:\n|$|music by)', text, re.I)
            if lyrics_match and not metadata['lyricist']:
                lyricist = lyrics_match.group(1).strip()
                metadata['lyricist'] = ' '.join(lyricist.split())

            # Find "music by" line
            music_match = re.search(r'[Mm]usic by\s+(.+?)(?:\n|$)', text)
            if music_match and not metadata['music']:
                music_by = music_match.group(1).strip()
                metadata['music'] = ' '.join(music_by.split())

        # For <pre> tags (pre_plain structure), search in raw HTML to respect <br> boundaries
        pre_tags = soup.find_all('pre')
        for pre_tag in pre_tags:
            pre_html = str(pre_tag)

            # Find "Recorded by" before first <br>
            recorded_match = re.search(r'[Rr]ecorded by\s+(.+?)(?:<br|$)', pre_html, re.I | re.DOTALL)
            if recorded_match and not metadata['recorded_by']:
                recorded_by = re.sub(r'<[^>]+>', '', recorded_match.group(1)).strip()
                metadata['recorded_by'] = ' '.join(recorded_by.split())

            # Find "Written by" before next <br>
            written_match = re.search(r'[Ww]ritten by\s+(.+?)(?:<br|$)', pre_html, re.I | re.DOTALL)
            if written_match and not metadata['composer']:
                composer = re.sub(r'<[^>]+>', '', written_match.group(1)).strip()
                metadata['composer'] = ' '.join(composer.split())

            # Find "Lyrics by" before next <br> or "music by"
            lyrics_match = re.search(r'[Ll]yrics by\s+(.+?)(?:<br|music by|$)', pre_html, re.I | re.DOTALL)
            if lyrics_match and not metadata['lyricist']:
                lyricist = re.sub(r'<[^>]+>', '', lyrics_match.group(1)).strip()
                metadata['lyricist'] = ' '.join(lyricist.split())

            # Find "music by" before next <br>
            music_match = re.search(r'[Mm]usic by\s+(.+?)(?:<br|$)', pre_html, re.I | re.DOTALL)
            if music_match and not metadata['music']:
                music_by = re.sub(r'<[^>]+>', '', music_match.group(1)).strip()
                metadata['music'] = ' '.join(music_by.split())

        return metadata


class ContentExtractor:
    """Extracts song content (lyrics, chords, structure) from HTML"""

    @staticmethod
    def extract_song_snippet(soup) -> Optional[BeautifulSoup]:
        """Extract the relevant song content section"""
        # For now, return the whole soup - we'll refine boundaries later
        return soup

    @staticmethod
    def parse_span_br_structure(soup) -> List[Paragraph]:
        """Parse span+br structure (like Man of Constant Sorrow)"""
        paragraphs = []
        current_paragraph_lines = []
        current_section_type = None  # Track current section type (chorus, verse, etc.)

        # Find all span elements with Courier New font
        courier_spans = soup.find_all('span', style=re.compile(r'font-family:\s*Courier New', re.I))

        # Find the parent element that contains the song content
        if not courier_spans:
            return paragraphs

        # Find the actual song content area by looking for a span containing "recorded by"
        # followed by chord lines. This helps us skip early boilerplate.
        song_start_idx = 0
        for i, span in enumerate(courier_spans):
            text = HTMLNormalizer.extract_text_preserving_position(span)
            # Look for "recorded by" followed by chord lines
            if 'recorded by' in text.lower():
                # Check if next few spans contain chord lines
                for j in range(i + 1, min(i + 5, len(courier_spans))):
                    next_text = HTMLNormalizer.extract_text_preserving_position(courier_spans[j])
                    if ChordDetector.is_chord_line(next_text):
                        song_start_idx = i
                        break
                if song_start_idx > 0:
                    break

        # Build a sequence by iterating through Courier New spans directly
        items = []
        found_song_content = False

        # Iterate through spans starting from song_start_idx
        for i in range(song_start_idx, len(courier_spans)):
            span = courier_spans[i]
            text = HTMLNormalizer.extract_text_preserving_position(span)

            # End anchor
            if 'key' in text.lower() and 'on any song' in text.lower():
                break

            # Skip boilerplate (but allow "recorded by" if it's part of metadata)
            # Only skip "recorded by" if it's in a long line (likely boilerplate)
            skip_boilerplate = False
            if 'written by' in text.lower():
                skip_boilerplate = True
            elif 'lyrics and chords' in text.lower():
                skip_boilerplate = True
            elif 'low prices on' in text.lower():
                skip_boilerplate = True
            elif 'country music cds' in text.lower():
                skip_boilerplate = True
            elif 'mp3s' in text.lower() and len(text) > 100:
                skip_boilerplate = True
            elif len(text) > 150:
                skip_boilerplate = True
            elif 'recorded by' in text.lower() and len(text) > 100:
                # Only skip "recorded by" if it's in a long line (boilerplate)
                skip_boilerplate = True
            
            if skip_boilerplate:
                continue

            # Skip titles
            if span.find('big') or span.find_parent(['h1', 'h2', 'h3']):
                continue

            # Check for repeat instructions (supports "Repeat #4", "Repeat #4,5", etc.)
            repeat_match = re.search(r'repeat\s+#?([\d,\s]+)', text, re.I)
            if repeat_match:
                # Parse comma-separated verse numbers
                verse_nums_str = repeat_match.group(1).replace(' ', '')
                verse_nums = [int(n) for n in verse_nums_str.split(',') if n.strip()]

                # Add repeat marker for each verse number
                for verse_num in verse_nums:
                    items.append({'type': 'repeat', 'verse_num': verse_num})
                found_song_content = True
                continue

            # Check for song content
            if ChordDetector.is_chord_line(text):
                found_song_content = True

            if found_song_content and text.strip():
                items.append({'type': 'span', 'text': text})
            
            # Check for br tags between spans
            # Use a more robust approach: find the parent container and check for br tags
            # between this span and the next span in document order
            if i + 1 < len(courier_spans) and found_song_content:
                next_span = courier_spans[i + 1]
                # Find common parent
                span_parent = span.parent
                next_parent = next_span.parent
                if span_parent == next_parent:
                    # Spans are siblings - check for br tags between them
                    current = span.next_sibling
                    while current and current != next_span:
                        if hasattr(current, 'name') and current.name == 'br':
                            items.append({'type': 'br'})
                        current = current.next_sibling if hasattr(current, 'next_sibling') else None
                else:
                    # Spans are in different parents - add a br to maintain structure
                    # (This is a conservative approach to maintain paragraph breaks)
                    items.append({'type': 'br'})

        # Process items, detecting double-br as paragraph break
        i = 0
        while i < len(items):
            item = items[i]

            # Check for repeat directive
            if item['type'] == 'repeat':
                # Close current paragraph if any
                if current_paragraph_lines:
                    paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                    current_paragraph_lines = []

                # Add repeat marker as a special paragraph
                # Use a special line format to indicate this is a repeat
                paragraphs.append(Paragraph(lines=[
                    SongLine(lyrics=f"REPEAT_VERSE_{item['verse_num']}", chords=[])
                ]))
                i += 1
                continue

            # Check for paragraph break (two consecutive br tags)
            if item['type'] == 'br':
                # Look ahead for another br
                if i + 1 < len(items) and items[i + 1]['type'] == 'br':
                    # Double break - paragraph boundary
                    if current_paragraph_lines:
                        paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                        current_paragraph_lines = []
                    i += 2  # Skip both brs
                    continue
                else:
                    # Single br - just skip it
                    i += 1
                    continue

            # Process span
            if item['type'] == 'span':
                span_text = item['text']

                # Empty/whitespace-only span
                if not span_text.strip() or span_text.strip() == '\xa0':
                    i += 1
                    continue

                # Check if this is a chord line
                if ChordDetector.is_chord_line(span_text):
                    # Extract chords from this span
                    chord_positions = ChordDetector.extract_chords_with_positions(span_text)

                    # Look ahead for lyric span (skip brs)
                    next_span_idx = i + 1
                    while next_span_idx < len(items) and items[next_span_idx]['type'] == 'br':
                        next_span_idx += 1

                    # Next span should be lyrics (if exists and is not another chord line)
                    if (next_span_idx < len(items) and
                        items[next_span_idx]['type'] == 'span' and
                        not ChordDetector.is_chord_line(items[next_span_idx]['text'])):
                        lyric_text = items[next_span_idx]['text']
                        # CRITICAL: Preserve whitespace for chord alignment!
                        lyric_text = lyric_text.replace('\n', ' ')
                        # Map chord positions from chord line to lyric line
                        mapped_chord_positions = ChordDetector.map_chord_positions_to_lyrics(
                            span_text, lyric_text, chord_positions
                        )
                        song_line = SongLine(lyrics=lyric_text, chords=mapped_chord_positions)
                        current_paragraph_lines.append(song_line)
                        i = next_span_idx + 1  # Skip to after lyric span
                    else:
                        # Chord-only line (instrumental)
                        song_line = SongLine(chords_line=span_text.strip())
                        current_paragraph_lines.append(song_line)
                        i += 1
                else:
                    # Lyric line without chords above it - can normalize whitespace here
                    lyric_text = ' '.join(span_text.split())
                    if lyric_text:  # Only add non-empty
                        song_line = SongLine(lyrics=lyric_text, chords=[])
                        current_paragraph_lines.append(song_line)
                    i += 1
            else:
                i += 1

        # Add final paragraph
        if current_paragraph_lines:
            paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))

        return paragraphs

    @staticmethod
    def _find_best_pre_tag(soup):
        """Find the pre tag with the most song content (chords/lyrics)"""
        pre_tags = soup.find_all('pre')
        if not pre_tags:
            return None
        
        # Find the pre tag with the most song content
        best_pre = None
        max_chord_count = 0
        
        for pre_tag in pre_tags:
            # Count potential chords in this pre tag
            # Use raw HTML string to preserve spacing between chords
            # (get_text() concatenates without spaces, breaking chord detection)
            raw_html = str(pre_tag)
            chord_pattern = r'\b[A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d*\b'
            chord_matches = re.findall(chord_pattern, raw_html)
            chord_count = len(chord_matches)
            
            # Prefer pre tags with more chords (actual song content)
            if chord_count > max_chord_count:
                max_chord_count = chord_count
                best_pre = pre_tag
        
        # Only return pre tag if it has actual chord content (at least 3 chords)
        # This prevents selecting boilerplate pre tags with 0-2 false positive matches
        if best_pre and max_chord_count >= 3:
            return best_pre
        return None

    @staticmethod
    def parse_pre_tag_structure(soup) -> List[Paragraph]:
        """Parse <pre> tag structure (like Old Home Place)"""
        paragraphs = []
        current_paragraph_lines = []
        current_section_type = None  # Track current section type (chorus, verse, etc.)

        pre_tag = ContentExtractor._find_best_pre_tag(soup)
        if not pre_tag:
            return paragraphs

        # There may be multiple font elements - need to find them correctly
        # Structure can be: <pre><font>...</font></pre> or <pre><small><font>...</font></small></pre>
        # We need to collect ALL fonts (both direct and inside small) to process them in order
        font_elems = []
        
        # Collect direct font children of pre
        direct_fonts = [child for child in pre_tag.children
                       if hasattr(child, 'name') and child.name == 'font']
        font_elems.extend(direct_fonts)

        # Also check for small > font and big > font structures
        container_elems = [child for child in pre_tag.children
                          if hasattr(child, 'name') and child.name in ['small', 'big']]
        for container in container_elems:
            # Get direct font children of container (not nested fonts)
            fonts_in_container = [child for child in container.children
                                 if hasattr(child, 'name') and child.name == 'font']
            font_elems.extend(fonts_in_container)
        
        # If still no fonts, try finding first-level fonts (not deeply nested)
        if not font_elems:
            # Find fonts that are direct children of pre or direct children of small or big
            all_fonts = pre_tag.find_all('font', recursive=True)
            # Filter to only fonts that are direct children of pre or direct children of small/big
            for font in all_fonts:
                parent = font.parent
                if parent == pre_tag or (parent and parent.name in ['small', 'big'] and parent.parent == pre_tag):
                    if font not in font_elems:  # Avoid duplicates
                        font_elems.append(font)
        
        if not font_elems:
            # No font tags, use pre directly
            font_elems = [pre_tag]

        # Process children in order, tracking br tags for paragraph breaks
        items = []  # Will contain: {'type': 'span'/'br', 'text': ...}
        found_song_content = False

        # Process all font elements (some files have metadata in first font, content in second)
        # Also handle nested font structures: <font><font>content</font></font>
        def process_element(element, found_song_content_ref):
            """Recursively process an element and its children"""
            for child in element.children:
                if hasattr(child, 'name') and child.name:  # Must have name AND it must be non-None
                    if child.name == 'br':
                        items.append({'type': 'br'})
                    elif child.name == 'font':
                        # Nested font - recursively process it
                        process_element(child, found_song_content_ref)
                    elif child.name == 'span':
                        text = HTMLNormalizer.extract_text_preserving_position(child)

                        # End anchor - stop at footer boilerplate
                        # More specific to avoid false positives in lyrics
                        if 'key' in text.lower() and 'on any song' in text.lower():
                            break

                        # Skip metadata and titles
                        if (child.find('big') or
                            'recorded by' in text.lower() or
                            'written by' in text.lower() or
                            len(text) > 150):
                            continue

                        # Check for repeat instructions (supports "Repeat #4", "Repeat #4,5", etc.)
                        repeat_match = re.search(r'repeat\s+#?([\d,\s]+)', text, re.I)
                        if repeat_match:
                            # Parse comma-separated verse numbers
                            verse_nums_str = repeat_match.group(1).replace(' ', '')
                            verse_nums = [int(n) for n in verse_nums_str.split(',') if n.strip()]

                            # Add repeat marker for each verse number
                            for verse_num in verse_nums:
                                items.append({'type': 'repeat', 'verse_num': verse_num})
                            found_song_content_ref[0] = True
                            continue

                        # Check if song content
                        if ChordDetector.is_chord_line(text):
                            found_song_content_ref[0] = True

                        if found_song_content_ref[0]:
                            # Skip whitespace-only spans (they're just spacing, not content)
                            if text.strip():
                                items.append({'type': 'span', 'text': text})
                    elif child.name == 'big':
                        # Handle <big> elements that contain chords/lyrics
                        # Process children directly (spans and brs) to preserve structure
                        # This handles both: <big>text</big> and <big><span>...</span><br>...</big>
                        # Also handles nested <small> and nested <big> elements
                        def process_big_element(big_elem):
                            """Recursively process big element and its nested children"""
                            big_children_to_process = []
                            for big_child in big_elem.children:
                                if hasattr(big_child, 'name') and big_child.name:
                                    if big_child.name == 'small':
                                        # Nested small - process its children recursively
                                        big_children_to_process.extend(process_big_element(big_child))
                                    elif big_child.name == 'big':
                                        # Nested big - process its children recursively
                                        big_children_to_process.extend(process_big_element(big_child))
                                    else:
                                        big_children_to_process.append(big_child)
                                else:
                                    big_children_to_process.append(big_child)
                            return big_children_to_process
                        
                        big_children_to_process = process_big_element(child)
                        
                        for big_child in big_children_to_process:
                            if hasattr(big_child, 'name') and big_child.name:
                                if big_child.name == 'br':
                                    items.append({'type': 'br'})
                                elif big_child.name == 'span':
                                    # Process span like we do for font children
                                    span_text = HTMLNormalizer.extract_text_preserving_position(big_child)
                                    
                                    # End anchor - stop at footer boilerplate
                                    if 'key' in span_text.lower() and 'on any song' in span_text.lower():
                                        break
                                    
                                    # Skip metadata
                                    if (big_child.find('big') or
                                        'recorded by' in span_text.lower() or
                                        'written by' in span_text.lower() or
                                        len(span_text) > 150):
                                        continue
                                    
                                    # Check for repeat instructions
                                    repeat_match = re.search(r'repeat\s+#?([\d,\s]+)', span_text, re.I)
                                    if repeat_match:
                                        verse_nums_str = repeat_match.group(1).replace(' ', '')
                                        verse_nums = [int(n) for n in verse_nums_str.split(',') if n.strip()]
                                        for verse_num in verse_nums:
                                            items.append({'type': 'repeat', 'verse_num': verse_num})
                                        found_song_content_ref[0] = True
                                        continue
                                    
                                    # Check if song content
                                    if ChordDetector.is_chord_line(span_text):
                                        found_song_content_ref[0] = True
                                    
                                    if found_song_content_ref[0]:
                                        # Skip whitespace-only spans
                                        if span_text.strip():
                                            items.append({'type': 'span', 'text': span_text})
                            else:
                                # Text node inside <big>
                                text = str(big_child).strip()
                                if text:
                                    # Check for repeat instructions
                                    repeat_match = re.search(r'repeat\s+#?([\d,\s]+)', text, re.I)
                                    if repeat_match:
                                        verse_nums_str = repeat_match.group(1).replace(' ', '')
                                        verse_nums = [int(n) for n in verse_nums_str.split(',') if n.strip()]
                                        for verse_num in verse_nums:
                                            items.append({'type': 'repeat', 'verse_num': verse_num})
                                        found_song_content_ref[0] = True
                                        continue
                                    
                                    # Check if song content
                                    if ChordDetector.is_chord_line(text):
                                        found_song_content_ref[0] = True
                                    
                                    if found_song_content_ref[0]:
                                        items.append({'type': 'span', 'text': text})
                else:
                    # Handle text nodes (direct text children of font element)
                    text = str(child).strip()
                    if text:
                        # Skip metadata
                        if ('recorded by' in text.lower() or
                            'written by' in text.lower() or
                            len(text) > 150):
                            continue

                        # Check for repeat instructions (supports "Repeat #4", "Repeat #4,5", etc.)
                        repeat_match = re.search(r'repeat\s+#?([\d,\s]+)', text, re.I)
                        if repeat_match:
                            # Parse comma-separated verse numbers
                            verse_nums_str = repeat_match.group(1).replace(' ', '')
                            verse_nums = [int(n) for n in verse_nums_str.split(',') if n.strip()]

                            # Add repeat marker for each verse number
                            for verse_num in verse_nums:
                                items.append({'type': 'repeat', 'verse_num': verse_num})
                            found_song_content_ref[0] = True
                            continue

                        # Check if song content
                        if ChordDetector.is_chord_line(text):
                            found_song_content_ref[0] = True

                        if found_song_content_ref[0]:
                            items.append({'type': 'span', 'text': text})
        
        # Use a list to allow modification in nested function
        found_song_content_ref = [found_song_content]
        
        # Process all font elements
        for content in font_elems:
            process_element(content, found_song_content_ref)
        
        found_song_content = found_song_content_ref[0]

        # Now process items, looking for double-br as paragraph break
        i = 0
        while i < len(items):
            item = items[i]

            # Check for repeat directive
            if item['type'] == 'repeat':
                # Close current paragraph if any
                if current_paragraph_lines:
                    paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                    current_paragraph_lines = []

                # Add repeat marker as a special paragraph
                paragraphs.append(Paragraph(lines=[
                    SongLine(lyrics=f"REPEAT_VERSE_{item['verse_num']}", chords=[])
                ]))
                i += 1
                continue

            # Check for paragraph break (two consecutive br tags)
            if item['type'] == 'br':
                # Look ahead for another br
                if i + 1 < len(items) and items[i + 1]['type'] == 'br':
                    # Double break - paragraph boundary
                    if current_paragraph_lines:
                        paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                        current_paragraph_lines = []
                    i += 2  # Skip both brs
                    continue
                else:
                    # Single br - just skip it
                    i += 1
                    continue

            # Process span
            if item['type'] == 'span':
                span_text = item['text']

                # Check if this is a section marker like [Chorus], [Verse], etc.
                section_type = SectionMarkerDetector.detect_section_marker(span_text)
                if section_type:
                    # Close current paragraph with detected section type
                    if current_paragraph_lines:
                        paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                        current_paragraph_lines = []
                    # Set section type for next paragraph
                    current_section_type = section_type
                    i += 1
                    continue

                # Check if chord line
                if ChordDetector.is_chord_line(span_text):
                    chord_positions = ChordDetector.extract_chords_with_positions(span_text)

                    # Look ahead for lyric line (next span, skipping brs)
                    next_span_idx = i + 1
                    while next_span_idx < len(items) and items[next_span_idx]['type'] == 'br':
                        next_span_idx += 1

                    if (next_span_idx < len(items) and
                        items[next_span_idx]['type'] == 'span' and
                        not ChordDetector.is_chord_line(items[next_span_idx]['text'])):
                        # Have lyric line - preserve whitespace for chord alignment!
                        lyric_text = items[next_span_idx]['text']
                        lyric_text = lyric_text.replace('\n', ' ')
                        # Map chord positions from chord line to lyric line
                        mapped_chord_positions = ChordDetector.map_chord_positions_to_lyrics(
                            span_text, lyric_text, chord_positions
                        )
                        song_line = SongLine(lyrics=lyric_text, chords=mapped_chord_positions)
                        current_paragraph_lines.append(song_line)
                        i = next_span_idx + 1  # Skip to after lyric span
                    else:
                        # Chord-only line
                        song_line = SongLine(chords_line=span_text.strip())
                        current_paragraph_lines.append(song_line)
                        i += 1
                else:
                    # Lyric line without chords - can normalize whitespace
                    lyric_text = ' '.join(span_text.split())
                    if lyric_text:  # Only add non-empty
                        song_line = SongLine(lyrics=lyric_text, chords=[])
                        current_paragraph_lines.append(song_line)
                    i += 1
            else:
                i += 1

        if current_paragraph_lines:
            paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))

        return paragraphs

    @staticmethod
    def parse_pre_plain_structure(soup) -> List[Paragraph]:
        """Parse plain <pre> tag structure (no font/span children)"""
        paragraphs = []
        current_paragraph_lines = []
        current_section_type = None  # Track current section type (chorus, verse, etc.)

        pre_tag = ContentExtractor._find_best_pre_tag(soup)
        if not pre_tag:
            return paragraphs

        # Get raw text and split by actual line breaks
        # The content is plain text with <br> tags for line breaks
        raw_html = str(pre_tag)

        # Split by <br> tags first
        lines = re.split(r'<br\s*/?>',  raw_html, flags=re.I)

        # Clean up HTML tags and normalize whitespace
        clean_lines = []
        for line in lines:
            # Remove HTML tags
            text = re.sub(r'<[^>]+>', '', line)
            text = HTMLNormalizer.normalize_whitespace(text)
            clean_lines.append(text)

        # Process lines into paragraphs
        current_paragraph_lines = []
        i = 0
        found_first_content = False  # Track if we've started song content

        while i < len(clean_lines):
            line = clean_lines[i]

            # End anchor - stop at footer boilerplate
            # More specific to avoid false positives in lyrics
            if 'key' in line.lower() and 'on any song' in line.lower():
                break

            # Check for blank line (potential paragraph break)
            if not line.strip():
                # Count consecutive blank lines
                blank_count = 1
                next_idx = i + 1
                while next_idx < len(clean_lines) and not clean_lines[next_idx].strip():
                    blank_count += 1
                    next_idx += 1

                # Find next non-empty line
                if next_idx < len(clean_lines):
                    next_line = clean_lines[next_idx]

                    # Verse boundary rules (in priority order):
                    # 1. Two or more consecutive blank lines = always a verse boundary
                    # 2. Single blank line followed by chord line = verse boundary
                    # 3. Single blank line followed by lyrics = just internal spacing
                    if blank_count >= 2 or ChordDetector.is_chord_line(next_line):
                        if current_paragraph_lines:
                            paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                            current_paragraph_lines = []

                i += 1
                continue

            # Check for repeat instructions (supports "Repeat #4", "Repeat #4,5", etc.)
            repeat_match = re.search(r'repeat\s+#?([\d,\s]+)', line, re.I)
            if repeat_match:
                # Close current paragraph if any
                if current_paragraph_lines:
                    paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                    current_paragraph_lines = []

                # Parse comma-separated verse numbers
                verse_nums_str = repeat_match.group(1).replace(' ', '')
                verse_nums = [int(n) for n in verse_nums_str.split(',') if n.strip()]

                # Add repeat marker for each verse number
                for verse_num in verse_nums:
                    paragraphs.append(Paragraph(lines=[
                        SongLine(lyrics=f"REPEAT_VERSE_{verse_num}", chords=[])
                    ]))
                i += 1
                continue

            # Check if this line is a section marker like [Chorus], [Verse], etc.
            section_type = SectionMarkerDetector.detect_section_marker(line)
            if section_type:
                # Close current paragraph if any
                if current_paragraph_lines:
                    paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))
                    current_paragraph_lines = []
                # Set section type for next paragraph
                current_section_type = section_type
                i += 1
                continue

            # Skip metadata and boilerplate
            if ('recorded by' in line.lower() or
                'written by' in line.lower() or
                len(line) > 200):
                i += 1
                continue

            # Empty line or just whitespace = skip but don't create paragraph break
            # (paragraph breaks come from |||PARAGRAPH_BREAK||| marker only)
            if not line.strip():
                i += 1
                continue

            # Skip standalone title line (usually first non-metadata line)
            # It's not a chord line and not part of a verse
            if (not found_first_content and
                not ChordDetector.is_chord_line(line) and
                len(line.strip()) > 0 and
                len(line.strip()) < 100):  # Titles are typically short
                # Check if next line is metadata or blank or a chord line
                if i + 1 < len(clean_lines):
                    next_line = clean_lines[i + 1]
                    if (not next_line.strip() or
                        'recorded by' in next_line.lower() or
                        'written by' in next_line.lower()):
                        # This is likely a standalone title - skip it
                        i += 1
                        continue

            # Check if chord line
            if ChordDetector.is_chord_line(line):
                found_first_content = True  # Mark that we've found song content
                chord_positions = ChordDetector.extract_chords_with_positions(line)

                if i + 1 < len(clean_lines) and not ChordDetector.is_chord_line(clean_lines[i + 1]):
                    lyric_line = clean_lines[i + 1]
                    song_line = SongLine(lyrics=lyric_line, chords=chord_positions)
                    current_paragraph_lines.append(song_line)
                    i += 2
                else:
                    song_line = SongLine(chords_line=line)
                    current_paragraph_lines.append(song_line)
                    i += 1
            else:
                if line.strip():  # Only add non-empty lines
                    found_first_content = True  # Mark that we've found song content
                    song_line = SongLine(lyrics=line, chords=[])
                    current_paragraph_lines.append(song_line)
                i += 1

        if current_paragraph_lines:
            paragraphs.append(Paragraph(lines=current_paragraph_lines, section_type=current_section_type))

        return paragraphs

    @staticmethod
    def extract_repeat_instructions(soup) -> Tuple[Optional[str], List[int]]:
        """Extract repeat instructions and generate playback sequence"""
        text = soup.get_text()

        # Look for "Repeat #N xM" pattern
        repeat_match = re.search(r'[Rr]epeat\s+#?(\d+)\s+x(\d+)', text)

        if repeat_match:
            paragraph_num = int(repeat_match.group(1)) - 1  # Convert to 0-indexed
            repeat_count = int(repeat_match.group(2))
            instruction_text = repeat_match.group(0)

            # Generate playback sequence
            # Assuming we want to repeat that paragraph 'repeat_count' times total
            # We'll need to know total paragraph count for this
            # For now, return the instruction and let caller build sequence
            return instruction_text, [paragraph_num, repeat_count]

        return None, []

    @staticmethod
    def parse(soup, structure_type: str, filename: str) -> Song:
        """Main parsing method"""
        # Extract metadata
        metadata = MetadataExtractor.extract_metadata(soup, filename)

        # Extract paragraphs based on structure type
        if structure_type == 'span_br':
            paragraphs = ContentExtractor.parse_span_br_structure(soup)
        elif structure_type == 'pre_tag':
            paragraphs = ContentExtractor.parse_pre_tag_structure(soup)
        elif structure_type == 'pre_plain':
            paragraphs = ContentExtractor.parse_pre_plain_structure(soup)
        else:
            paragraphs = []

        # Extract repeat instructions
        repeat_text, repeat_info = ContentExtractor.extract_repeat_instructions(soup)

        # Build playback sequence
        if repeat_info:
            para_idx, repeat_count = repeat_info
            # Default sequence
            playback_sequence = list(range(len(paragraphs)))
            # Insert repeats after the original occurrence
            if para_idx < len(paragraphs):
                insert_pos = para_idx + 1
                for _ in range(repeat_count):
                    playback_sequence.insert(insert_pos, para_idx)
                    insert_pos += 1
        else:
            playback_sequence = list(range(len(paragraphs)))

        song_content = SongContent(
            paragraphs=paragraphs,
            playback_sequence=playback_sequence,
            raw_repeat_instruction_text=repeat_text
        )

        return Song(
            title=metadata.get('title'),
            artist=metadata.get('artist'),
            composer=metadata.get('composer'),
            recorded_by=metadata.get('recorded_by'),
            lyricist=metadata.get('lyricist'),
            music=metadata.get('music'),
            source_html_file=metadata.get('source_html_file'),
            song_content=song_content
        )


class ChordProGenerator:
    """Generates ChordPro format output from Song data"""

    @staticmethod
    def song_to_chordpro(song: Song) -> str:
        """Convert Song object to ChordPro format string"""
        lines = []

        # Add metadata directives using meta format
        if song.title:
            lines.append(f"{{meta: title {song.title}}}")

        # Map recorded_by to artist if artist is not already set
        artist = song.artist or song.recorded_by
        if artist:
            lines.append(f"{{meta: artist {artist}}}")

        if song.composer:
            lines.append(f"{{meta: writer {song.composer}}}")

        if song.lyricist:
            lines.append(f"{{meta: lyricist {song.lyricist}}}")

        if song.music:
            lines.append(f"{{meta: music {song.music}}}")

        lines.append("")  # Blank line after metadata

        # Process paragraphs according to playback sequence
        if not song.song_content:
            return "\n".join(lines)

        # Detect which paragraphs are choruses (appear multiple times in playback)
        paragraph_counts = {}
        for para_idx in song.song_content.playback_sequence:
            paragraph_counts[para_idx] = paragraph_counts.get(para_idx, 0) + 1

        chorus_paragraphs = {idx for idx, count in paragraph_counts.items() if count > 1}

        # Track which occurrence we're on for each paragraph
        paragraph_occurrence = {}
        verse_counter = 0

        # First pass: identify verses for repeat directives
        actual_verses = []  # Store paragraphs that are actual verses (not repeats)

        for para_idx in song.song_content.playback_sequence:
            if para_idx >= len(song.song_content.paragraphs):
                continue

            paragraph = song.song_content.paragraphs[para_idx]

            # Check if this is a repeat marker
            if (paragraph.lines and
                paragraph.lines[0].lyrics and
                paragraph.lines[0].lyrics.startswith("REPEAT_VERSE_")):
                continue  # Skip repeat markers in first pass

            actual_verses.append((para_idx, paragraph))

        for idx, para_idx in enumerate(song.song_content.playback_sequence):
            if para_idx >= len(song.song_content.paragraphs):
                continue

            paragraph = song.song_content.paragraphs[para_idx]

            # Check if this is a repeat marker
            if (paragraph.lines and
                paragraph.lines[0].lyrics and
                paragraph.lines[0].lyrics.startswith("REPEAT_VERSE_")):
                # Extract verse number to repeat
                repeat_text = paragraph.lines[0].lyrics
                verse_num = int(repeat_text.replace("REPEAT_VERSE_", ""))

                # Find the verse to repeat (1-indexed)
                if 0 < verse_num <= len(actual_verses):
                    repeat_para_idx, repeat_paragraph = actual_verses[verse_num - 1]

                    # Determine if it's a chorus (appears multiple times)
                    if repeat_para_idx in chorus_paragraphs:
                        lines.append("{start_of_chorus}")
                        end_tag = "{end_of_chorus}"
                    else:
                        lines.append(f"{{start_of_verse: Verse {verse_num}}}")
                        end_tag = "{end_of_verse}"

                    # Output the repeated verse
                    for song_line in repeat_paragraph.lines:
                        if song_line.lyrics:
                            chordpro_line = ChordProGenerator._insert_chords_inline(
                                song_line.lyrics,
                                song_line.chords
                            )
                            lines.append(chordpro_line)
                        elif song_line.chords_line:
                            lines.append(f"{{comment: {song_line.chords_line}}}")

                    lines.append(end_tag)
                    lines.append("")
                continue

            # Track occurrence number
            occurrence = paragraph_occurrence.get(para_idx, 0) + 1
            paragraph_occurrence[para_idx] = occurrence

            # Determine section label and tags
            # First check if section type was explicitly detected
            if paragraph.section_type == 'chorus':
                if occurrence == 1:
                    lines.append("{start_of_chorus}")
                else:
                    lines.append(f"{{start_of_chorus: Repeat {occurrence - 1}}}")
                end_tag = "{end_of_chorus}"
            elif paragraph.section_type == 'bridge':
                lines.append("{start_of_bridge}")
                end_tag = "{end_of_bridge}"
            elif para_idx in chorus_paragraphs:
                # It's a chorus (detected by repetition heuristic)
                if occurrence == 1:
                    lines.append("{start_of_chorus}")
                else:
                    lines.append(f"{{start_of_chorus: Repeat {occurrence - 1}}}")
                end_tag = "{end_of_chorus}"
            else:
                # It's a verse - only increment counter on first occurrence
                if occurrence == 1:
                    verse_counter += 1
                lines.append(f"{{start_of_verse: Verse {verse_counter}}}")
                end_tag = "{end_of_verse}"

            # Process each line in the paragraph
            for song_line in paragraph.lines:
                if song_line.lyrics:
                    # Build line with inline chords
                    chordpro_line = ChordProGenerator._insert_chords_inline(
                        song_line.lyrics,
                        song_line.chords
                    )
                    lines.append(chordpro_line)
                elif song_line.chords_line:
                    # Instrumental/chord-only line
                    lines.append(f"{{comment: {song_line.chords_line}}}")

            lines.append(end_tag)
            lines.append("")  # Blank line after section

        return "\n".join(lines)

    @staticmethod
    def _insert_chords_inline(lyrics: str, chords: List[ChordPosition]) -> str:
        """Insert chord markers at specified positions in lyric line"""
        if not chords:
            return lyrics

        # Sort chords by position (descending) so we can insert from right to left
        sorted_chords = sorted(chords, key=lambda c: c.position, reverse=True)

        result = lyrics
        for chord_pos in sorted_chords:
            pos = chord_pos.position
            # Handle position that might be beyond string length
            # Add spaces to pad the line to accommodate the chord
            if pos > len(result):
                # Pad with spaces up to the chord position
                result = result + ' ' * (pos - len(result))

            # Insert chord bracket at position
            result = result[:pos] + f"[{chord_pos.chord}]" + result[pos:]

        return result

    @staticmethod
    def song_to_json(song: Song) -> str:
        """Convert Song object to JSON string"""
        # Convert dataclasses to dicts
        def convert(obj):
            if isinstance(obj, (Song, SongContent, Paragraph, SongLine, ChordPosition)):
                return asdict(obj)
            return obj

        song_dict = asdict(song)
        return json.dumps(song_dict, indent=2, default=convert)


if __name__ == "__main__":
    # Test with example files
    import sys

    test_files = [
        'man_of_constant_sorrow_input.html',
        'old_home_place_input.html'
    ]

    for test_file in test_files:
        print(f"\n{'='*60}")
        print(f"Processing: {test_file}")
        print('='*60)

        with open(test_file, 'r', encoding='utf-8') as f:
            html_content = f.read()

        if not StructureDetector.has_parseable_content(html_content):
            print(f"✗ {test_file} does not have parseable content")
            continue

        print(f"✓ {test_file} has parseable content")
        soup = BeautifulSoup(html_content, 'html.parser')
        structure_type = StructureDetector.detect_structure_type(soup)
        print(f"  Structure type: {structure_type}")

        # Parse the song
        song = ContentExtractor.parse(soup, structure_type, test_file)

        # Print metadata
        print(f"\nMetadata:")
        print(f"  Title: {song.title}")
        print(f"  Artist: {song.artist}")
        print(f"  Composer: {song.composer}")
        print(f"  Recorded by: {song.recorded_by}")

        if song.song_content:
            print(f"\nStructure:")
            print(f"  Paragraphs: {len(song.song_content.paragraphs)}")
            print(f"  Playback sequence: {song.song_content.playback_sequence}")
            if song.song_content.raw_repeat_instruction_text:
                print(f"  Repeat instruction: {song.song_content.raw_repeat_instruction_text}")

        # Generate ChordPro output
        chordpro_output = ChordProGenerator.song_to_chordpro(song)
        print(f"\n--- ChordPro Output ---")
        print(chordpro_output[:500] + "..." if len(chordpro_output) > 500 else chordpro_output)
