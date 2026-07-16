# Web-Chords Source

325 songs fetched from various chord websites via DuckDuckGo search (Feb 2026).

## Status

**Raw only** - files have been fetched but not yet parsed into ChordPro or integrated into works/.

## Structure

```
web-chords/
├── raw/           # 325 .txt files with metadata headers
└── parsed/        # Empty (not yet processed)
```

## Raw File Format

Each file has a metadata header followed by raw chord/lyrics content:

```
# title: Song Title
# source_url: https://...
# fetched_at: 2026-02-01T...
# artist: Artist Name

[raw chord/lyrics content from source site]
```

## How It Was Created

Files were fetched by `scripts/lib/fetch_chords.py`, which:
1. Searches DuckDuckGo for song + "chords"
2. Identifies chord sites (e-chords.com, cowboylyrics.com, ultimate-guitar.com, etc.)
3. Fetches content via HTTP or Playwright (for JS-rendered sites)
4. Extracts chord/lyrics via BeautifulSoup
5. Saves with metadata header to `raw/`

Rate limited to 1.5s between requests. Prefers text-based sites over JS-rendered ones.

## Next Steps

To integrate into the collection:
1. Build a parser to convert raw files → `.pro` ChordPro in `parsed/`
2. Run migration to create/update entries in `works/`
3. Rebuild search index: `./scripts/bootstrap --quick`
