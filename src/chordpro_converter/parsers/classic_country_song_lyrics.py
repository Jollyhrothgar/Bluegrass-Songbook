# src/chordpro_converter/parsers/classic_country_song_lyrics.py

import re
from bs4 import BeautifulSoup, NavigableString, FeatureNotFound
from html import unescape
from unicodedata import normalize
from urllib.parse import urlparse
import logging
from collections import Counter
from .base import BaseParser

# Chord pattern logic to find all chords in HTML.
CHORD_PATTERN = re.compile(
    r'\b([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)\b'
)

# Chord pattern logic with leading and trailing whitespace.
CHORD_PATTERN_WITH_WHITESPACE = re.compile(
    r'(\s?)'  # Optional whitespace before (captured)
    r'\b'
    r'([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)'
    r'\b'
    r'(\s?)'  # Optional whitespace after (captured)
)

class ClassicCountrySongLyricsParser(BaseParser):
  def __init__(self, file_path: str):
    self._song_info = {
      "title": "",
      "artist": "",
      "lines": [{'chords': "", "text": ""}]
    }
    with open (file_path) as in_file:
      self._file_string = ''.join(in_file.readlines())
    
    self._soup = BeautifulSoup(self._file_string , 'html.parser')

  def get_title(self):
    """Returns the title of the song.
    """
    return self._parse_title()

  def get_artist(self):
    """Returns the artist of the song.
    """
    return self._parse_artist()

  def _parse_title(self):
    """Reads the soup and returns the title of the song."""

    title = "NO TITLE FOUND"
    for elem in self._soup.find_all('title'):
      if "|" in elem.string:
        title, _ = elem.string.split("|")
        title = re.sub(r"lyrics( and)? chords", "", title)
        title = title.strip()

    return title

  def _parse_artist(self):  
    """Reads the soup and returns the artist of the song."""
    artist = "NO ARTIST FOUND"
    for elem in self._soup.find_all('title'):
      if "|" in elem.string:
        _, artist = elem.string.split("|")
        artist = artist.strip()

    return artist