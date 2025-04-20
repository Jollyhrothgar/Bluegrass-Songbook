# development of various functions / utiltiies.

import re
import json
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

# Songs should have at least one chord.
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

def parse_from_span(soup, artist, title, end_str):
  """Tries to parse the song from a span tag. Use artist and title to find the start of the song. Use end str to find
  the end of the song."""
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
      if end_str in next_line.lower():
        keep = False
    except Exception as e:
      pass
    if keep:
      lyric_lines.append(line)
  return lyric_lines

def check_if_line_is_chord(line, chord_counts):
  """If all tokens in the line are chords, then return true, otherwise return false."""
  for token in line.split():
    if token not in chord_counts:
      return False
  return True

def process_lyrics(lyric_lines, chord_counts):
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
    if check_if_line_is_chord(line, chord_counts):
      processed_lyrics.append({'chords': line, 'lyrics': lyric_lines[i+1]})
  return processed_lyrics

if __name__ == "__main__":
  filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/manofconstantsorrowlyricsandchords.html"
  # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/talkaboutmeandseewhatshellsaylyricschords.html"
  # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/thewonderfulworldofChristmaslyricschords.html"

  with open (filename) as in_file:
    file_string = ''.join(in_file.readlines())
  
  soup = BeautifulSoup(file_string , 'html.parser')

  clean_text = re.sub(r"\s", " ", soup.text)
  chords = Counter(CHORD_PATTERN.findall(clean_text))

  print(chords)
  title, artist = None, None
  for elem in soup.find_all('title'):
    if "|" in elem.string:
      title, artist = elem.string.split("|")
      title = title.replace("lyrics and chords", "").strip()
      artist = artist.strip()
  lyric_lines = parse_from_span(soup, artist, title,  'if you want to change the "key" on any song')
  processed_lyrics = process_lyrics(lyric_lines, chords)
  print(json.dumps(processed_lyrics, indent=2))