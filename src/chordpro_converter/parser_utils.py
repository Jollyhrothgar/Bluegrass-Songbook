# src/chordpro_converter/parser_utils.py
# -*- coding: utf-8 -*-
# V24 - Corrected parse_body_to_chordpro logic, added key inference debug

import re
from bs4 import BeautifulSoup, NavigableString, FeatureNotFound
from html import unescape
from unicodedata import normalize
from urllib.parse import urlparse
import logging
from collections import Counter

# --- ChordPro Body Parsing Logic ---
CHORD_PATTERN = re.compile(
    r'\b([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)\b'
)

CHORD_PATTERN_WITH_WHITESPACE = re.compile(
    r'(\s?)'  # Optional whitespace before (captured)
    r'\b'
    r'([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)'
    r'\b'
    r'(\s?)'  # Optional whitespace after (captured)
)

def find_chords_with_optional_whitespace(text):
    """
    Finds chords in the text, capturing optional single whitespace
    characters immediately before and after each chord.
    Returns a list of the full matched strings (chord + optional whitespace).
    """
    matches = CHORD_PATTERN_WITH_WHITESPACE.finditer(text)
    results = []
    for match in matches:
        leading_whitespace = match.group(1)
        chord = match.group(2)
        trailing_whitespace = match.group(3)
        results.append(leading_whitespace + chord + trailing_whitespace)
    return results


MIN_CHORD_COUNT = 1

def find_containers_containing_text(soup, text):
  """
  Searches a BeautifulSoup object for elements containing the specified text
  and returns a list of the container (Tag) objects.

  Args:
    soup (BeautifulSoup): The BeautifulSoup object to search.
    text (str): The text to search for.
  """
  containers = []
  for element in soup.find_all(string=lambda string: string and text in string):
    # Get the parent of the text node, which is the container tag
    container = element.parent
    if container not in containers:  # Avoid duplicates if multiple parts of text match
      containers.append(container.name)
  return containers


if __name__ == "__main__":
    filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/test_inputs/manofconstantsorrowlyricsandchords.html"
    # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/test_inputs/talkaboutmeandseewhatshellsaylyricschords.html"

    # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/test_inputs/thewonderfulworldofChristmaslyricschords.html"
    with open (filename) as in_file:
        file_string = ''.join(in_file.readlines())
        approx_chords = CHORD_PATTERN.findall(file_string)
        container_search_chords = Counter(find_chords_with_optional_whitespace(file_string))
        approx_chord_count = Counter(approx_chords)

        print(approx_chord_count)
        soup = BeautifulSoup(file_string , 'html.parser')

        containers = []
        for container_chord in container_search_chords.keys():
            containers+=find_containers_containing_text(soup, container_chord)
        most_likely_container = Counter(containers).most_common(1)[0][0]
        title, artist = None, None
        for elem in soup.find_all('title'):
            if "|" in elem.string:
                title, artist = elem.string.split("|")
                title = title.replace("lyrics and chords", "").strip()
                artist = artist.strip()
        if title is None or artist is None:
            raise ValueError(f"Title [{title}] or artist [{artist}] not found in the HTML file.")
        print(f"Title: {title}, Artist: {artist}")