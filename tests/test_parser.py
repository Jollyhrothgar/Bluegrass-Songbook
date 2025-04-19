# tests/test_parser.py
# V23 - Assertions for V23 parser, refined first lyric line detection

import os
import sys
import pytest
import re # For sanitize_filename and line checking
from pathlib import Path

# Ensure src path is available
project_root = Path(__file__).resolve().parent.parent
src_path = project_root / 'src'
if str(src_path) not in sys.path:
     sys.path.insert(0, str(src_path))

# Import the functions to be tested
from chordpro_converter.parser_utils import extract_chordpro_fields_from_html, parse_body_to_chordpro

# --- Test Directories ---
TEST_INPUTS_DIR = Path(__file__).parent / 'test_inputs'
TEST_OUTPUTS_DIR = Path(__file__).parent / 'test_outputs'

# Ensure output directory exists before tests run
TEST_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# --- Discover HTML files ---
html_test_files = sorted(list(TEST_INPUTS_DIR.glob('*.html')))
if not html_test_files:
     print(f"\nWarning: No test HTML files found in {TEST_INPUTS_DIR}")
# Create clearer IDs for pytest output
html_test_ids = [file.name for file in html_test_files]

# --- Helper Functions ---
def sanitize_filename(name):
    if not name: return "unknown"
    sanitized = re.sub(r'[\\/*?:"<>|]', "", name); sanitized = re.sub(r'\s+', '_', sanitized)
    return sanitized[:100]

def format_chordpro_output(metadata, parsed_body):
    chordpro_content = []
    if metadata.get('title'): chordpro_content.append(f"{{title: {metadata['title']}}}")
    if metadata.get('artist'): chordpro_content.append(f"{{artist: {metadata['artist']}}}")
    if metadata.get('inferred_key'): chordpro_content.append(f"{{key: {metadata['inferred_key']}}}")
    if metadata.get('source_url'): chordpro_content.append(f"{{comment: Source URL: {metadata['source_url']}}}")
    if metadata.get('disclaimer'): chordpro_content.append(f"{{comment: Disclaimer: {metadata['disclaimer']}}}")
    chordpro_content.append("")
    if parsed_body: chordpro_content.append(parsed_body)
    else: chordpro_content.append("{comment: Error: Song body could not be parsed or was empty.}")
    return "\n".join(chordpro_content)

# --- Parametrized Test Function ---
@pytest.mark.parametrize("input_html_path", html_test_files, ids=html_test_ids)
def test_html_to_chordpro_generation(input_html_path):
    test_filename = input_html_path.name
    print(f"\nProcessing test file: {test_filename}")
    output_pro_filename = input_html_path.with_suffix('.pro').name
    output_pro_path = TEST_OUTPUTS_DIR / output_pro_filename

    try: html_content = input_html_path.read_text(encoding='utf-8', errors='ignore')
    except Exception as e: pytest.fail(f"Failed to read test file {test_filename}: {e}")

    try: extracted_data = extract_chordpro_fields_from_html(html_content, str(input_html_path))
    except Exception as e: pytest.fail(f"Metadata extraction crashed on {test_filename}: {e.__class__.__name__}: {e}")

    assert extracted_data is not None, f"Parser returned None for {test_filename}"
    assert 'title' in extracted_data, f"'title' missing in output for {test_filename}"
    assert extracted_data['title'].strip() != '', f"'title' is empty for {test_filename}"

    raw_body = extracted_data.get('raw_song_body')
    parsed_body = None
    assert raw_body, f"Raw song body extraction failed for {test_filename}"

    if raw_body:
        try:
            parsed_body = parse_body_to_chordpro(raw_body)
            assert isinstance(parsed_body, str), f"Body parsing did not return a string for {test_filename}"
        except Exception as e: pytest.fail(f"Body parsing crashed on {test_filename}: {e.__class__.__name__}: {e}")
    else: print(f"Warning: No raw song body found for {test_filename}")

    final_chordpro = format_chordpro_output(extracted_data, parsed_body)
    assert isinstance(final_chordpro, str), f"ChordPro formatting did not return a string for {test_filename}"

    try:
        output_pro_path.parent.mkdir(parents=True, exist_ok=True)
        output_pro_path.write_text(final_chordpro, encoding='utf-8')
        print(f"Successfully generated: tests/test_outputs/{output_pro_filename}")
    except Exception as e: pytest.fail(f"Failed to write output file {output_pro_filename}: {e}")

    # --- V22 Specific Checks ---
    output_lines = [line.strip() for line in final_chordpro.splitlines() if line.strip()]
    body_start_index = -1
    for idx, line in enumerate(output_lines):
         if line and not line.startswith('{'): body_start_index = idx; break
    assert body_start_index != -1, f"Could not find start of body in generated .pro file for {test_filename}"
    actual_body_lines = output_lines[body_start_index:]
    assert actual_body_lines, f"Body lines list is empty for {test_filename}"

    # Find the first line in the body that contains letters OUTSIDE brackets
    first_lyric_line = ""
    for line in actual_body_lines:
        line_no_chords = re.sub(r'\[[^\]]+\]', '', line).strip() # Remove chords
        if re.search(r'[a-zA-Z]', line_no_chords): # Check if remaining text has letters
            first_lyric_line = line # Use original line with chords
            break
    assert first_lyric_line, f"Could not find first lyric line in body for {test_filename}"

    # Perform checks based on filename
    if test_filename == 'manofconstantsorrowlyricsandchords.html':
         assert extracted_data.get('artist') == "Soggy Bottom Boys"
         assert extracted_data.get('inferred_key') == "G"
         assert "{title: Man of Constant Sorrow}" in final_chordpro
         # Check the first *actual lyric line* generated by the V23 parser
         expected_line = "[G]I am the[G7] ma-n of[C] constant sorrow" # V17 merger output expected
         assert first_lyric_line == expected_line, \
             f"First lyric line mismatch for {test_filename}.\nExpected: '{expected_line}'\nGot:      '{first_lyric_line}'"
         assert 'disclaimer' in extracted_data, f"Disclaimer missing for {test_filename}"
         assert "property of the respective artist" in extracted_data['disclaimer'], f"Disclaimer phrase missing for {test_filename}"

    elif test_filename == 'talkaboutmeandseewhatshellsaylyricschords.html':
         assert extracted_data.get('artist') == "Johnny Paycheck"
         assert extracted_data.get('inferred_key') == "C" # Expect 'C' now
         assert "{title: Talk About Me And See What She'll Say}" in final_chordpro
         # Check the first *actual lyric line* generated by the parser
         expected_line = "[C]You think you have her love com[F]pletely"
         assert first_lyric_line == expected_line, \
             f"First lyric line mismatch for {test_filename}.\nExpected: '{expected_line}'\nGot:      '{first_lyric_line}'"
         assert 'disclaimer' in extracted_data, f"Disclaimer missing for {test_filename}"
         assert "property of the respective artist" in extracted_data['disclaimer'], f"Disclaimer phrase missing for {test_filename}"

# --- Keep specific edge case tests separate ---
def test_empty_html():
     with pytest.raises(ValueError, match="Could not extract title"):
          extract_chordpro_fields_from_html("", "empty_test_string")
