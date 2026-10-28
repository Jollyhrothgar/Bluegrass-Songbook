# Classic Country Parser

Converts HTML pages saved from classic-country-song-lyrics.com into ChordPro.

Status: finished import, parser frozen. 17,053 works cite `source: classic-country`
(`grep -rl "source: classic-country" works/*/work.yaml | wc -l`). `raw/` (17,382
HTML files) and `parsed/` (17,122 `.pro`) are both tracked in git. About 260 pages
matched no HTML pattern and were never parsed (won't fix). Since 2026-07-31
`works/` is authoritative and nothing re-parses into it, so a parser change no
longer reaches the site. Fix individual songs in `works/*/` instead.

## Commands

The wrappers live in `sources/classic-country/scripts/`, not the repo-root
`scripts/` (the root `server` is the frontend, the root `utility` has no
`batch_parse`, and there is no root `test`). Run them from the repo root:

```bash
./sources/classic-country/scripts/test reparse <songname>        # one song, with diff
./sources/classic-country/scripts/test regression --name my_fix  # before/after over everything
./sources/classic-country/scripts/utility batch_parse            # raw/ -> parsed/
./sources/classic-country/scripts/server debug_viewer            # http://localhost:8000
```

## Things the code doesn't make obvious

- `parser.py` holds all the logic: `StructureDetector` picks one of three HTML
  shapes (`pre_plain`, `pre_tag`, `span_br`), a per-shape extractor builds
  paragraphs, and `ChordProGenerator` writes the `.pro`. A fix usually has to be
  made in all three extractors.
- Verse boundary: two or more blank lines always split; one blank line splits
  only when a chord line follows; one blank before lyrics is spacing.
- Repeat markers ("Repeat #3", "Repeat #4,5") are 1-indexed and expanded in a
  second pass, so a repeat can refer to a verse later in the page.
- Chord positions are character offsets into the lyric line, so the page must be
  fixed-width. Check that before debugging alignment.
- BeautifulSoup text nodes have `name=None`; tag-only checks skip them.
- `protected.txt` (one song id per line) lists hand-corrected songs that
  `batch_process.py` skips. It is also read by `scripts/lib/enrich_songs.py`.
- - `src/` also holds one-off analysis scripts (`analyze_changes.py`,
  `create_spot_check.py`, `select_outliers.py`, `quick_fix.py`, and similar).
  They are not part of the pipeline.
