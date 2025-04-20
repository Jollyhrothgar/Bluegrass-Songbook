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

if __name__ == "__main__":
  filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/manofconstantsorrowlyricsandchords.html"
  # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/talkaboutmeandseewhatshellsaylyricschords.html"
  # filename = "/Users/mike/workspace/bluegrass_songbook_v2/tests/classic_country_song_lyrics/test_inputs/classic_country_song_lyrics/thewonderfulworldofChristmaslyricschords.html"

  with open (filename) as in_file:
    file_string = ''.join(in_file.readlines())
  
  soup = BeautifulSoup(file_string , 'html.parser')

  clean_text = re.sub(r"\s", " ", soup.text)
  chords = Counter(CHORD_PATTERN.findall(clean_text))

  title, artist = None, None
  for elem in soup.find_all('title'):
    if "|" in elem.string:
      title, artist = elem.string.split("|")
      title = title.replace("lyrics and chords", "").strip()
      artist = artist.strip()

  print(filename)
  print(f"  {chords}")
  print(f"  {artist}")
  print(f"  {title}")