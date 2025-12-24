# Bluegrass Songbook

A searchable collection of 17,000+ bluegrass and country songs in ChordPro format, with semantic search capabilities.

## Features

- **17,122 songs** parsed from classic-country-song-lyrics.com
- **Accurate chord alignment** preserving original positioning
- **ChordPro format** compatible with standard apps (OnSong, SongbookPro, etc.)
- **Semantic search** (coming soon) - find songs by "vibe" or meaning
- **Progression search** (coming soon) - find songs by chord patterns (I-IV-V)

## Using the Songs

### Browse the Collection

Songs are in `songs/classic-country/parsed/` as `.pro` files:

```
songs/classic-country/parsed/
├── abeautifullife.pro
├── abillionairesong.pro
├── abornloser.pro
└── ... (17,122 files)
```

### ChordPro Format

Each file follows the [ChordPro standard](https://www.chordpro.org/):

```chordpro
{title: Your Cheatin' Heart}
{artist: Hank Williams}
{composer: Hank Williams}
{key: C}

{sov}
Your cheatin' [C]heart will make you [F]weep
You'll cry and [C]cry and try to [G7]sleep
{eov}
```

### Import to Apps

These `.pro` files work with:
- [OnSong](https://onsongapp.com/) (iOS)
- [SongbookPro](https://songbook-pro.com/) (iOS/Android)
- [Songsheet Generator](https://tenbyten.com/software/songsgen/)
- Any ChordPro-compatible app

## Search (Coming Soon)

A static web interface for searching the collection:

- **Semantic search**: Find songs by theme ("murder ballads", "songs about trains")
- **Lyric search**: Search for exact phrases
- **Progression search**: Find songs using specific chord patterns

## For Developers

See [CLAUDE.md](CLAUDE.md) for architecture details and development workflow.

### Quick Start

```bash
# Install dependencies
uv sync

# Run parser on new HTML files
uv run python3 batch_process.py

# Validate output
python3 viewer/server.py
# Visit http://localhost:8000

# Run tests
uv run pytest
```

### Project Structure

```
├── src/songbook/           # Python package
│   ├── parser/             # HTML → ChordPro conversion
│   ├── analysis/           # Key detection, chord normalization
│   └── search/             # Search index building
├── songs/                  # Song data by source
│   └── classic-country/
│       ├── raw/            # Original HTML
│       └── parsed/         # ChordPro output
├── docs/                   # GitHub Pages search UI
└── viewer/                 # Validation UI
```

### Adding Songs from New Sources

1. Add HTML files to `songs/<source>/raw/`
2. Create or adapt a parser for the HTML structure
3. Run batch processing
4. Validate with the viewer UI

See [ROADMAP.md](ROADMAP.md) for planned features and sources.

## Data Sources

| Source | Songs | Status |
|--------|-------|--------|
| classic-country-song-lyrics.com | 17,122 | Complete |
| Ultimate Guitar | - | Planned |
| Chordie | - | Planned |

## License

Song lyrics and chords are sourced from publicly available websites. This project provides parsing tools and does not claim ownership of the musical content.

## Contributing

Contributions welcome! See [CLAUDE.md](CLAUDE.md) for development setup and testing requirements.
