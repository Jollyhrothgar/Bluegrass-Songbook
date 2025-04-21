import pytest
from pathlib import Path
from chordpro_converter.parsers.classic_country_scoring_parser import ScoringParser

TEST_DIR = Path(__file__).parent.parent / "shared_song_inputs" / "classic_country_song_lyrics"

TEST_CASES = [
  ("manofconstantsorrowlyricsandchords.html", "Man of Constant Sorrow", "Soggy Bottom Boys"),
  ("talkaboutmeandseewhatshellsaylyricschords.html", "Talk About Me And See What She'll Say", "Johnny Paycheck"),
  ("thewonderfulworldofChristmaslyricschords.html", "The Wonderful World Of Christmas", "Elvis Presley"),
  ("halfofthishalfofthatlyricschords.html", "Half Of This Half Of That", "Wynn Stewart"),
  ("homeontherangelyricschords.html", "Home On The Range", "Gene Autry"),
  ("nowandforeverlyricschords.html", "Now And Forever", "Anne Murray"),
]

@pytest.mark.parametrize("filename, expected_title, expected_artist", TEST_CASES)
def test_scoring_parser_metadata(filename, expected_title, expected_artist):
  path = TEST_DIR / filename
  html = path.read_text(encoding="utf-8")
  parser = ScoringParser(html)
  data = parser.to_dict()

  assert data["title"] == expected_title
  assert data["artist"] == expected_artist
  assert isinstance(data["lines"], list)
  assert any(line["lyrics"] for line in data["lines"]), "No lyrics found"

  # Only assert chords if chords were found in the raw text
  if data["chords"]:
      assert any(line["chords"] for line in data["lines"]), "No chords found"

