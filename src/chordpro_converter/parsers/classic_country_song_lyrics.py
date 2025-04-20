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

class ClassicCountrySongLyricsParser(BaseParser):
  def __init__(self, file_path: str):
    self._song_info = {
      "title": "",
      "artist": "",
      "lines": [{'chords': "", "text": ""}]
    }
    with open (file_path) as in_file:
      self._file_string = ''.join(in_file.readlines())
    
    self._artist = None
    self._title = None
    self._song = None
    self._chords = None
    self._soup = BeautifulSoup(self._file_string , 'html.parser')

  def get_title(self):
    """Returns the title of the song.
    """
    if self._title is None:
      self._title =  self._parse_title()
    return self._title


  def get_artist(self):
    """Returns the artist of the song.
    """
    if self._artist is None:
      self._artist = self._parse_artist()
    return self._artist

  def get_chords(self):
    """Returns the chords of the song.
    """
    if self._chords is None:
      self._chords = self._parse_chords()
    return self._chords

  def get_song(self):
    """Returns the song.
    """
    if self._song is None:
      self._song = self._parse_song()
    return self._song
  

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

    
  def _parse_chords(self):
    clean_text = re.sub(r"\s", " ", self._soup.text)
    self._chords = Counter(CHORD_PATTERN.findall(clean_text))
    return self._chords


  def _parse_song_from_span(self, artist, title, end_str):
    """Tries to parse the song from a span tag. Use artist and title to find the start of the song. Use end str to find
    the end of the song."""
    lyric_lines = []
    keep = False
    elements = self._soup.find_all('span')
    for i, elem in enumerate(elements):
      try:
        one_before_line = elements[i - 1].string
        two_before_line = elements[i - 2].string
        next_line = elements[i + 1].string

        try:
          one_before_line = re.sub(r'\s', ' ', one_before_line)
          two_before_line = re.sub(r'\s', ' ', two_before_line)
          next_line = re.sub(r'\s', ' ', next_line)
        except:
          pass
      except IndexError:
        pass
      line = elem.string
      try:
        line = re.sub(r'\s', ' ', line)
      except TypeError:
        if line is None:
          line = "$$EMPTY_LINE$$"
        else:
          raise ValueError(f"Unexpected line type: {type(line)}")
      line_chars = Counter(line)
      if len(line_chars.keys()) == 1 and line_chars[' '] > 0:
        line = "$$EMPTY_LINE$$"
      else:
        if line is None:
          line = "$$EMPTY_LINE$$"
      try:
        if (artist in one_before_line or artist in two_before_line) and (title in one_before_line or title in two_before_line):
          keep = True
      except Exception as e:
        pass
      try:
        if end_str in next_line.lower():
          keep = False
      except Exception as e:
        pass
      if keep:
        lyric_lines.append(line)
    return lyric_lines

  @classmethod 
  def check_if_line_is_chord(cls, line, chord_counts):
    """If all tokens in the line are chords, then return true, otherwise return false."""
    for token in line.split():
      if token not in chord_counts:
        return False
    return True

  @classmethod
  def _process_lyric_lines(cls, lyric_lines, chord_counts):
    """Create the lyrics list of dictionaries. If the lyric and chord are '' then assume it is a line break.
    
    Args:
      lyric_lines (list): The list of lyric lines.
    Returns:
      [
        {
          'chords': 'a line with chords anchored to the space where they are played',
          'lyrics': 'a line of lyrics',
        }
      ]
    """
    processed_lyrics = []
    for i, line in enumerate(lyric_lines):
      if line == "$$EMPTY_LINE$$":
        processed_lyrics.append({'chords': '', 'lyrics': ''})
      if cls.check_if_line_is_chord(line, chord_counts):
        processed_lyrics.append({'chords': line, 'lyrics': lyric_lines[i+1]})
    return processed_lyrics

  def _parse_song(self):
    self._chords = self._parse_chords()
    lyric_lines = self._parse_song_from_span(self.get_artist(), self.get_title(), "Chorus")
    self._song = self._process_lyric_lines(lyric_lines, self._chords) 
    return self._song