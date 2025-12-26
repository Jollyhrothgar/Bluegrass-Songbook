# Bluegrass Songbook

A searchable collection of 17,000+ bluegrass and country songs with chords.

**Live site**: Coming soon (GitHub Pages)

## Features

- **17,053 songs** in ChordPro format
- **Keyword search** - title, artist, lyrics
- **Chord search** - find songs by Nashville numbers (`chord:VII`)
- **Progression search** - find songs by chord patterns (`prog:I-IV-V`)
- **Key detection** - automatic with transposition
- **User accounts** - Google sign-in via Supabase
- **Song lists** - create and manage multiple lists (synced to cloud)
- **Multiple versions** - support for alternate arrangements with voting
- **Favorites** - save songs locally or sync with account
- **Song editor** - create and submit new songs
- **Dark/light theme**

## Quick Start

```bash
# Clone and setup
git clone https://github.com/Jollyhrothgar/Bluegrass-Songbook.git
cd Bluegrass-Songbook
./scripts/bootstrap

# Start local server
./scripts/server
# Visit http://localhost:8080
```

## Using the Songs

Songs are in `sources/classic-country/parsed/` as `.pro` files (ChordPro format):

```chordpro
{meta: title Your Cheatin Heart}
{meta: artist Hank Williams}
{meta: composer Hank Williams}

{start_of_verse: Verse 1}
Your cheatin' [C]heart will make you [F]weep
You'll cry and [C]cry and try to [G7]sleep
{end_of_verse}
```

These files work with ChordPro apps like OnSong, SongbookPro, MobileSheets, etc.

## Contributing

### Submit a Song

1. Use the **Add Song** feature in the web UI
2. Click **Submit to Songbook** to create a GitHub issue
3. Once approved, it's automatically added

### Report Issues

Use the **Report Bug** button on any song, or open an issue on GitHub.

### Development

See [CLAUDE.md](CLAUDE.md) for architecture and development workflows.

```bash
./scripts/server                    # Frontend at :8080
./scripts/utility add-song FILE     # Add a song manually
uv run pytest                       # Run tests
```

## Project Structure

```
├── docs/                           # Frontend (GitHub Pages)
│   ├── js/search.js               # All frontend logic
│   ├── js/supabase-auth.js        # Auth & cloud sync
│   └── data/index.json            # Search index
├── sources/
│   ├── classic-country/parsed/    # ~17,000 parsed songs
│   └── manual/parsed/             # User-contributed songs
├── supabase/migrations/            # Database migrations
├── scripts/                        # CLI tools
└── ROADMAP.md                      # Product vision
```

## License

**Source Available, Not Open Source.** See [LICENSE](LICENSE) for full terms.

- **Permitted**: Personal use (<20 people), local self-hosting, educational use, contributing via PR
- **Prohibited**: Public hosting, monetization, commercial use, redistribution, enabling Pages on forks

The copyright holder reserves all rights to public hosting and monetization. By contributing, you assign all rights to the copyright holder.

Song content copyright remains with original songwriters and publishers.
