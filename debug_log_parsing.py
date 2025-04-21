from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from tqdm import tqdm

import logging

logging.basicConfig(
    filename='song_parsing_debug.log',
    level=logging.WARNING,
    format='%(asctime)s [%(levelname)s] %(message)s'
)

from src.chordpro_converter.parsers.classic_country_song_lyrics import ClassicCountrySongLyricsParser

source_dir = Path("sources/www.classic-country-song-lyrics.com")
log_path = Path("song_parsing_debug.log")

def check_song(file_path: Path):
  try:
    parser = ClassicCountrySongLyricsParser(file_path)

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
    return {
      "filename": file_path.name,
      "artist_ok": False,
      "title_ok": False,
      "chords_ok": False,
      "lines_ok": False,
      "result_key": "ERROR",
      "error": str(e),
    }

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

  # Write log
  with log_path.open("w") as log:
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

  # Print summary
  print("\n=== Summary ===")
  for key, count in sorted(summary.items(), key=lambda x: -x[1]):
    print(f"{key:20} : {count} files")

if __name__ == "__main__":
  main()
