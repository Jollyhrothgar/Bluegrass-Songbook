# TuneArch Source

ABC notation for fiddle tunes and instrumentals sourced from [The Traditional Tune Archive](https://tunearch.org/).

## Structure

```
tunearch/
├── src/
│   ├── scraper.py           # TuneArch HTTP client with rate limiting
│   ├── abc_parser.py        # ABC extraction from wiki pages
│   ├── chordpro_generator.py # Convert to .pro format
│   ├── batch_fetch.py       # CLI for fetching tunes
│   └── tune_list.py         # Curated list of ~100 popular instrumentals
├── parsed/                   # Output .pro files with ABC blocks
├── raw/                      # Cached HTML (gitignored)
└── tune_catalog.json         # Tracks fetch status
```

## Usage

```bash
# Fetch a single tune by name
uv run python sources/tunearch/src/batch_fetch.py --tune "Salt Creek"

# Batch fetch from curated list (limit 10)
uv run python sources/tunearch/src/batch_fetch.py --limit 10

# Search TuneArch and fetch results
uv run python sources/tunearch/src/batch_fetch.py --search "bluegrass reel" --limit 20

# After fetching, rebuild the index
uv run python scripts/lib/build_index.py
```

## Output Format

Tunes are saved as ChordPro files with embedded ABC notation:

```chordpro
{meta: title Salt Creek}
{meta: artist Traditional}
{meta: x_source tunearch}
{meta: x_type instrumental}
{meta: x_rhythm Reel}
{key: A}
{time: 4/4}

{start_of_abc}
X:1
T:Salt Creek
M:4/4
L:1/8
K:A
|: E2AB c2BA | E2AB c2Bc | d2fd c2ec | BAGB A2AB :|
{end_of_abc}
```

## Rate Limiting

The scraper enforces 1 request/second to be respectful to TuneArch servers. Cached HTML is stored in `raw/` to avoid re-fetching.

## Attribution

All content from TuneArch.org is used for educational purposes. Each tune includes `x_tunearch_url` metadata linking back to the original page.
