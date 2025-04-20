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

TEST_INPUTS = [
  ("manofconstantsorrowlyricsandchords.html", "Man of Constant Sorrow"),
  ("talkaboutmeandseewhatshellsaylyricschords.html", "Talk About Me And See What She'll Say"),
  ("thewonderfulworldofChristmaslyricschords.html", "The Wonderful World Of Christmas"), 
]

@pytest.mark.parametrize("filename,expected_title", TEST_INPUTS)
def test_extract_title(filename, expected_title):
    """
    Test that the title is extracted correctly from the HTML file.
    """
    test_file = TEST_INPUTS_DIR / filename
    assert test_file.exists(), f"Test file {filename} does not exist."
    parser = ClassicCountrySongLyricsParser(test_file) 
    
    title = parser.get_title()
    assert title == expected_title, f"Expected title '{expected_title}', but got '{title}'"