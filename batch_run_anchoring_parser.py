import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from tqdm import tqdm

# --- Logging Setup ---
WARNINGS_LOG_NAME = "bluegrass_songbook.log"
SUMMARY_LOG_NAME = "song_parsing_summary.log"

logger = logging.getLogger("bluegrass_songbook_logger")
logger.setLevel(logging.WARNING)
logger.propagate = False

if not logger.handlers:
  file_handler = logging.FileHandler(WARNINGS_LOG_NAME, mode="w", encoding="utf-8")
  file_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
  logger.addHandler(file_handler)

# --- Parser Import ---
from chordpro_converter.parsers.classic_country_anchoring_parser import AnchoringParser

# --- Constants ---
source_dir = Path("sources/www.classic-country-song-lyrics.com")

# --- Core Check Function ---
def check_song(file_path: Path):
  try:
    parser = AnchoringParser(file_path)

    artist = parser.get_artist()
    title = parser.get_title()
    chords = parser.get_chords()
    lines = parser.get_song()

    artist_ok = artist != "NO ARTIST FOUND"
    title_ok = title != "NO TITLE FOUND"
    chords_ok = isinstance(chords, list) and len(chords) > 0
    lines_ok = isinstance(lines, list) and len(lines) > 0

    result_key = f"A:{int(artist_ok)} T:{int(title_ok)} C:{int(chords_ok)} L:{int(lines_ok)}"

    return {
      "filename": file_path.name,
      "artist_ok": artist_ok,
      "title_ok": title_ok,
      "chords_ok": chords_ok,
      "lines_ok": lines_ok,
      "result_key": result_key,
      "error": None,
    }

  except Exception as e:
    logger.warning("Exception parsing %s: %s", file_path.name, e)
    return {
      "filename": file_path.name,
      "artist_ok": False,
      "title_ok": False,
      "chords_ok": False,
      "lines_ok": False,
      "result_key": "ERROR",
      "error": str(e),
    }

# --- Main Execution ---
def main():
  files = list(source_dir.rglob("*.html"))
  results = []
  summary = Counter()

  with ThreadPoolExecutor() as executor:
    futures = {executor.submit(check_song, file): file for file in files}
    for future in tqdm(as_completed(futures), total=len(files), desc="Parsing songs"):
      result = future.result()
      results.append(result)
      summary[result["result_key"]] += 1

  # Write human-readable summary log
  with Path(SUMMARY_LOG_NAME).open("w", encoding="utf-8") as log:
    log.write("filename | artist | title | chords | lines | error\n")
    log.write("-" * 90 + "\n")
    for r in results:
      log.write(
        f"{r['filename']} | "
        f"{'✅' if r['artist_ok'] else '❌'} | "
        f"{'✅' if r['title_ok'] else '❌'} | "
        f"{'✅' if r['chords_ok'] else '❌'} | "
        f"{'✅' if r['lines_ok'] else '❌'} | "
        f"{r['error'] or ''}\n"
      )

  # Print summary to terminal
  print("\n=== Summary ===")
  for key, count in sorted(summary.items(), key=lambda x: -x[1]):
    print(f"{key:20} : {count} files")

if __name__ == "__main__":
  main()
