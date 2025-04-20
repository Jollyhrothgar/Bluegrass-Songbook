# tests/classic_country_song_lyrics/test_parser_title.py
import pytest
from pathlib import Path
import sys

from chordpro_converter.parsers.classic_country_song_lyrics import ClassicCountrySongLyricsParser

# Ensure src path is available
project_root = Path(__file__).resolve().parent.parent
src_path = project_root / 'src'
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

# --- Test Directories ---
TEST_INPUTS_DIR = (Path(__file__).parent / 'test_inputs/classic_country_song_lyrics').resolve()
TEST_OUTPUTS_DIR = (Path(__file__).parent / 'test_outputs/classic_country_song_lyrics').resolve()

# Ensure output directory exists before tests run
TEST_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

TEST_SONG_EXTRACTION = [
  (
      "manofconstantsorrowlyricsandchords.html",
      [
        {
          "chords": "G             G7          C",
          "lyrics": "I am the ma-n of constant sorrow"
        },
      ]
  ),
  # ("talkaboutmeandseewhatshellsaylyricschords.html", "Johnny Paycheck"),
  # ("thewonderfulworldofChristmaslyricschords.html", "Elvis Presley"), 
]

TOTAL_CHORD_LINES_TEST_INPUT = [
    (
        "manofconstantsorrowlyricsandchords.html",
        20
    )
]

HAS_CHORDS_TEST_INPUT = [
    (
        "manofconstantsorrowlyricsandchords.html",
        ["G", "G7", "C", "D7"]
    )    
]


@pytest.mark.parametrize("filename,song_lines", TEST_SONG_EXTRACTION)
def test_extract_first_line(filename, song_lines):
    """
    Test that the first line is extracted correctly from the HTML file.
    """
    test_file = TEST_INPUTS_DIR / filename
    assert test_file.exists(), f"Test file {filename} does not exist."
    parser = ClassicCountrySongLyricsParser(test_file) 
    
    song = parser.get_song()

    line = "ERROR"
    chords = "ERROR"

    # idx = 0
    for line in song:
        if line['chords'] == song_lines[0]['chords'] and line['lyrics'] == song_lines[0]['lyrics']:
          lyric = line['lyrics']
          chords = line['chords']
          break
    assert (lyric == song_lines[0]['lyrics'] and chords == song_lines[0]['chords']), f"Expected lyrics: '{song_lines[0]['lyrics']}', but got '{lyric}' and expected chords: '{song_lines[0]['chords']}', but got '{chords}'"
# @pytest.mark.parametrize("filename,first_lyric,last_lyric", TEST_INPUTS)
# def test_extract_title(filename, expected_artist):
#     """
#     Test that the title is extracted correctly from the HTML file.
#     """
#     test_file = TEST_INPUTS_DIR / filename
#     assert test_file.exists(), f"Test file {filename} does not exist."
#     parser = ClassicCountrySongLyricsParser(test_file) 
    
#     artist = parser.get_artist()
#     assert artist == expected_artist, f"Expected artist '{expected_artist}', but got '{artist}'"