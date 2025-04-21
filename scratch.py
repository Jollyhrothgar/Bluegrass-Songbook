# development of various functions / utiltiies.

import re
import json
from bs4 import BeautifulSoup
from collections import Counter
from chordpro_converter.parsers.classic_country_anchoring_parser import AnchoringParser
from chordpro_converter.parsers.classic_country_scoring_parser import ScoringSongParser
from pathlib import Path
from tqdm import tqdm

# Chord pattern logic to find all chords in HTML.
CHORD_PATTERN = re.compile(
    r'\b([A-G][#b]?(?:m|min|maj|dim|aug|sus|add)?(?:[2-79]|11|13)?(?:sus[24])?(?:/[A-G][#b]?)?)\b'
)

# Songs should have at least one chord.
MIN_CHORD_COUNT = 1


def test_span_parsing(filename):
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

  parser = ClassicCountrySongLyricsParser(filename)
  song = parser.to_dict()
  song_string = "\n".join([f"    {line}" for line in json.dumps(song, indent=2, ensure_ascii=False).split("\n")])

  print()
  print(filename)
  print(song_string)


if __name__ == "__main__":
  # infile = "/Users/mike/workspace/bluegrass_songbook_v2/sources/www.classic-country-song-lyrics.com/nowandforeverlyricschords.html"
  # infile = "/Users/mike/workspace/bluegrass_songbook_v2/sources/www.classic-country-song-lyrics.com/homeontherangelyricschords.html"
  # infile = "/Users/mike/workspace/bluegrass_songbook_v2/sources//www.classic-country-song-lyrics.com/manofconstantsorrowlyricsandchords.html"
  infile = "/Users/mike/workspace/bluegrass_songbook_v2/sources/www.classic-country-song-lyrics.com/halfofthishalfofthatlyricschords.html"

  # test_span_parsing(infile)

  with open(infile) as f:
    html = f.read()

  parser = ScoringSongParser(html)
  song_data = parser.to_dict()

  print(json.dumps(song_data, indent=2, ensure_ascii=False))

  print(ScoringSongParser)
