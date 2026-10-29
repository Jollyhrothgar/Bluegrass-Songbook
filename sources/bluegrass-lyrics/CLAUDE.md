# BluegrassLyrics.com Source

Lyrics for traditional bluegrass and early country songs from
[BluegrassLyrics.com](https://www.bluegrasslyrics.com/). The site owner gave
permission for the import (Feb 2026).

Status: finished (Feb 2026), scraper and parser frozen. 1,110 works cite
`source: bluegrass-lyrics` (`grep -rl "source: bluegrass-lyrics" works/*/work.yaml | wc -l`);
that includes older works whose lyrics were matched, not only the 764 new imports
(494 with chords from Ultimate Guitar, 270 lyrics-only).

## Pipeline

1. `src/scraper.py` fetches the index and pages into `raw/` (gitignored), listed in
   `song_index.json` (1,818 URLs).
2. `src/parser.py` writes `parsed/<slug>.json` (title, url, sections of lines;
   one file per song, tracked).
3. `src/matcher.py` dedupes against `works/`; `classification_report.json` is the
   result (823 already present, 995 new).
4. Chords came from Ultimate Guitar and were merged by `sources/ultimate-guitar/`,
   which also did the imports to `works/`.

## Things to know

- The site gives no artist. Anything in an artist field is inherited from the
  Ultimate Guitar search, so it is a scrape artifact (see `.claude/rules/works.md`).
- Section detection is imperfect on unusually formatted songs.
- Attribution lives in each chart as `{meta: x_lyrics_source bluegrass-lyrics}`
  and `x_lyrics_url`; the frontend shows "BluegrassLyrics.com" linking the page.
  Enriched charts also carry `x_chords_source ultimate-guitar`, which the
  frontend shows as "Community Contribution".
- Other code reads `parsed/*.json`: `sources/bounty-hunt` uses it for lyric-overlap
  validation and a lyrics-only fallback.
