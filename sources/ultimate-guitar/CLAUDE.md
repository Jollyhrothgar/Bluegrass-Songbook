# Ultimate Guitar Chord Scraper

Chord extraction from Ultimate Guitar's mobile API, merged into BluegrassLyrics.com
lyrics (`sources/bluegrass-lyrics/parsed`).

Status: finished (Feb 2026); only one work cites `source: ultimate-guitar`. The
import produced the 764 bluegrass-lyrics works (494 with chords, 270 lyrics-only);
those cite `bluegrass-lyrics`. `sources/bounty-hunt/src/ug_scrape.py` is the newer
scraper for the wanted list and does not use this code.

## Pipeline

`scrape_overnight.py` (UG mobile API search then `/tab/info`) writes
`raw_extractions/*.json`. `merge.py` fuzzy-matches each UG line to a lyric line
(0.7 threshold), copies chord positions onto the BluegrassLyrics text and snaps
them to word starts. `run_merges.py` runs it for every song into `results/`.
`import_to_works.py` imports a song when `coverage` (`MergeResult.coverage` in `merge.py`: BluegrassLyrics lines that received chords / total lines) is at least 70%, or when
one section has 20+ words and two or more lines matched at 0.85 or better.
`import_lyrics_only.py` imports the rest without chords.

`raw_extractions/`, `results/` and `scrape_progress.json` are gitignored and
absent in a fresh checkout. `embedding_match.py` is `merge.py`'s optional
`--embeddings` matcher.

## Commands

```bash
uv run python sources/ultimate-guitar/scrape_overnight.py [--limit N] [--dry-run]
uv run python sources/ultimate-guitar/run_merges.py            # flags: --embeddings, --song; no --dry-run
uv run python sources/ultimate-guitar/import_to_works.py [--dry-run]
uv run python sources/ultimate-guitar/import_lyrics_only.py [--dry-run]
```

The scraper paces itself at 1 to 3 seconds per request with a 30 to 60 second
pause every 20 songs. Keep that if you rerun it. The API credentials and signing
scheme are in `scrape_overnight.py`, not here.

## Constraints

- The frontend must never name Ultimate Guitar. `sourceDisplayNames` in
  `docs/js/song-view.js` maps `ultimate-guitar` to "Community Contribution" and
  `bluegrass-lyrics` to "BluegrassLyrics.com". The raw UG text is not redistributed.
- Chord placement is approximate wherever the UG lyrics differ from the
  BluegrassLyrics text.
