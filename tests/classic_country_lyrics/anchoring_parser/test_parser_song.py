# tests/classic_country_song_lyrics/test_parser_title.py
import pytest
from pathlib import Path
import sys
import json

from chordpro_converter.parsers.classic_country_anchoring_parser import ClassicCountrySongLyricsParser

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
        {
            "chords": "G             G7          C",
            "lyrics": "I am the ma-n of constant sorrow"
        }
    ),
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


@pytest.mark.parametrize("filename, expected_line", TEST_SONG_EXTRACTION)
def test_extract_first_line(filename, expected_line):
    test_file = TEST_INPUTS_DIR / filename
    assert test_file.exists(), f"Test file {filename} does not exist."

    parser = ClassicCountrySongLyricsParser(test_file)
    song = parser.get_song()

    # Try to find a matching line in the output
    matched_line = next(
        (line for line in song if line["chords"] == expected_line["chords"] and line["lyrics"] == expected_line["lyrics"]),
        None
    )

    assert matched_line is not None, (
        f"Expected line not found.\n"
        f"Expected lyrics: '{expected_line['lyrics']}', chords: '{expected_line['chords']}'"
    )

@pytest.mark.parametrize("filename, expected_chords", HAS_CHORDS_TEST_INPUT)
def test_has_chords(filename, expected_chords):
    test_file = TEST_INPUTS_DIR / filename
    assert test_file.exists(), f"Test file {filename} does not exist."

    parser = ClassicCountrySongLyricsParser(test_file)
    chords = parser.get_chords()

    matched_all = False
    for chord in expected_chords:
        if chord in chords:
            matched_all = True
        else:
            matched_all = False
            break
    assert matched_all, f"Expected to find all chords {expected_chords}, but found: {chords}."