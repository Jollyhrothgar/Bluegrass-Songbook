from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from tqdm import tqdm
import logging
import json

from src.chordpro_converter.parsers.classic_country_scoring_parser import ScoringParser

SOURCE_DIR = Path("sources/www.classic-country-song-lyrics.com")
SUMMARY_LOG = Path("song_parsing_summary_scoring.log")
ERROR_LOG = Path("parsing_errors_scoring.log")

# Setup logging
logger = logging.getLogger("bluegrass_songbook_logger")
logger.setLevel(logging.WARNING)
handler = logging.FileHandler(ERROR_LOG, mode="w", encoding="utf-8")
formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)

def check_file(file_path: Path):
  try:
    html = file_path.read_text(encoding="utf-8")
    parser = ScoringParser(html)
    data = parser.to_dict()

    title_ok = data["title"] != "NO TITLE FOUND"
    artist_ok = data["artist"] != "NO ARTIST FOUND"
    chords_ok = bool(data["chords"])
    lines_ok = bool(data["lines"]) and any(l["chords"] or l["lyrics"] for l in data["lines"])

    key = f"A:{int(artist_ok)} T:{int(title_ok)} C:{int(chords_ok)} L:{int(lines_ok)}"

    return {
      "filename": file_path.name,
      "result_key": key,
      "error": None,
    }

  except Exception as e:
    logger.warning("Exception parsing %s: %s", file_path.name, str(e))
    return {
      "filename": file_path.name,
      "result_key": "ERROR",
      "error": str(e),
    }

def main():
  files = list(SOURCE_DIR.rglob("*.html"))
  summary = Counter()
  results = []

  with ThreadPoolExecutor() as executor:
    futures = {executor.submit(check_file, f): f for f in files}
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