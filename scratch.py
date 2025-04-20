# development of various functions / utiltiies.

import re
from bs4 import BeautifulSoup, NavigableString, FeatureNotFound
from html import unescape
from unicodedata import normalize
from urllib.parse import urlparse
import logging
from collections import Counter

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

# Songs should have at least one chord.
MIN_CHORD_COUNT = 1

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

def parse_classic_country_music_song_lyrics(file_path):
  """Parse a single file scraped from classic-country-music.com and return the metadata, lyrics, and chords.

  Args:
    file_path (str): The path to the HTML file.
  Returns:
    dict: A dictionary containing the metadata, lyrics, and chords.
  """


if __name__ == "__main__":
  filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/manofconstantsorrowlyricsandchords.html"
  # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/talkaboutmeandseewhatshellsaylyricschords.html"
  # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/thewonderfulworldofChristmaslyricschords.html"

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

  lyric_lines = []
  keep = False
  elements = soup.find_all('span')
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
      if 'if you want to change the "key" on any song' in next_line.lower():
        print(next_line.upper())
        keep = False
    except Exception as e:
      pass
    if keep:
      lyric_lines.append(line)
  print("\n".join(lyric_lines))