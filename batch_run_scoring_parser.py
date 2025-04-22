from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed  # Use ProcessPoolExecutor
from collections import Counter
from tqdm import tqdm
import logging
import json
import os  # Import the os module

from src.chordpro_converter.parsers.classic_country_scoring_parser import ScoringParser

SOURCE_DIR = Path("sources/www.classic-country-song-lyrics.com")
CHORDPRO_DIR = Path("chordpro")  # Define the ChordPro output directory
SUMMARY_LOG = Path("song_parsing_summary_scoring.log")
ERROR_LOG = Path("parsing_errors_scoring.log")

# Setup logging
logger = logging.getLogger("bluegrass_songbook_logger")
logger.setLevel(logging.WARNING)
handler = logging.FileHandler(ERROR_LOG, mode="w", encoding="utf-8")
formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

def process_file(file_path: Path):  # Renamed to process_file
  """
  Processes a single HTML file: parses it, converts to ChordPro, and saves the output.

  Args:
      file_path: The path to the HTML file.

  Returns:
      A dictionary containing the processing result.
  """
  try:
    html = file_path.read_text(encoding="utf-8")
    parser = ScoringParser(html)
    data = parser.to_dict()

    title_ok = data["title"] != "NO TITLE FOUND"
    artist_ok = data["artist"] != "NO ARTIST FOUND"
    chords_ok = bool(data["chords"])
    lines_ok = bool(data["lines"]) and any(l["chords"] or l["lyrics"] for l in data["lines"])

    key = f"A:{int(artist_ok)} T:{int(title_ok)} C:{int(chords_ok)} L:{int(lines_ok)}"

    if key == "A:1 T:1 C:1 L:1":
      chordpro = parser.to_chordpro()
      # Sanitize the filename to remove invalid characters
      output_name = f"{''.join(c for c in data['title'] if c.isalnum() or c in (' ', '-', '_'))} - {''.join(c for c in data['artist'] if c.isalnum() or c in (' ', '-', '_'))}.chordpro"
      # Ensure the ChordPro directory exists
      CHORDPRO_DIR.mkdir(parents=True, exist_ok=True)
      output_path = CHORDPRO_DIR / output_name
      try:
        with output_path.open("w", encoding="utf-8") as f:
          f.write(chordpro)
        logger.info("Successfully parsed and saved: %s", output_path.name)
      except Exception as e:
        error_msg = f"Error writing ChordPro file {output_path.name}: {e}"
        logger.error(error_msg) # Log the error
        return {
            "filename": file_path.name,
            "result_key": "ERROR",
            "error": error_msg,
        }

    return {
      "filename": file_path.name,
      "result_key": key,
      "error": None,
    }

  except Exception as e:
    error_msg = f"Exception parsing {file_path.name}: {e}"
    logger.warning(error_msg) # Log the error
    return {
      "filename": file_path.name,
      "result_key": "ERROR",
      "error": error_msg,
    }

def main():
  files = list(SOURCE_DIR.rglob("*.html"))
  summary = Counter()
  results = []

  # Use ProcessPoolExecutor for multiprocessing
  with ProcessPoolExecutor() as executor:
    futures = {executor.submit(process_file, f): f for f in files}
    for future in tqdm(as_completed(futures), total=len(files), desc="Processing songs"):
      result = future.result()
      summary[result["result_key"]] += 1
      results.append(result)

  # Write summary
  with SUMMARY_LOG.open("w", encoding="utf-8") as f:
    f.write("filename | result_key | error\n")
    f.write("-" * 80 + "\n")
    for r in results:
      f.write(f"{r['filename']} | {r['result_key']} | {r['error'] or ''}\n")

  # Print to console
  print("\n=== Summary ===")
  for key, count in sorted(summary.items(), key=lambda x: -x[1]):
    print(f"{key:20} : {count} files")

if __name__ == "__main__":
  main()
