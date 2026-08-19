# Bluegrass Songbook

A curated, searchable bluegrass songbook (~2,400 songs in the search index),
backed by a 19,000+ work archive. Archived works are not deleted — they still
resolve by direct URL and can be restored to search.

**Live site**: [bluegrassbook.com](https://bluegrassbook.com)

Counts move. To check them yourself after `./scripts/bootstrap`:
`ls works | wc -l`, `wc -l < docs/data/index.jsonl`, `wc -l < docs/data/archive.jsonl`.

## Features

- **19,000+ works** in ChordPro format (~2,400 surfaced in search)
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

Songs are in `works/{work-slug}/lead-sheet.pro` as ChordPro files:

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

1. Sign in, then use the **Add Song** feature in the web UI
2. Click **Submit to Songbook**

Submissions no longer travel as GitHub issues. The submission is written
straight to the `pending_songs` table (live on the site within seconds) and is
then committed into `works/` by the `Process Pending Submission` workflow.

### Report Issues

Use the **🚩 Report issue** action on any song page, or open an issue on GitHub.
Reports need no account; they open a `song-flag` issue.

### Development

See [CLAUDE.md](CLAUDE.md) for architecture and development workflows.

```bash
./scripts/server                    # Frontend at :8080 (auto-increments to 8090 if busy)
./scripts/utility help              # List every utility subcommand
./scripts/bootstrap --quick         # Rebuild the search index from works/
uv run pytest                       # Run Python tests
npm test                            # Run frontend (vitest) tests
```

> ⚠️ `./scripts/utility add-song FILE` is **legacy and does not add a song to
> the site.** It copies the file into `songs/manual/parsed/` and rebuilds the
> old `scripts/lib/build_index.py` index, which reads `sources/manual/parsed/`
> — neither path feeds `works/`, and the site index is built from `works/` by
> `scripts/lib/build_works_index.py`. To add a song, use the in-app editor or
> hand-author `works/{slug}/work.yaml` + its part file.

## Project Structure

```
├── works/                          # PRIMARY: Song collection (19,000+ works)
│   └── {work-slug}/
│       ├── work.yaml               # Metadata: title, artist, tags, parts
│       └── lead-sheet.pro          # ChordPro content
├── docs/                           # Frontend (GitHub Pages)
│   ├── js/                         # ES modules
│   │   ├── main.js                 # Entry point, initialization, routing
│   │   ├── search-core.js          # Search logic
│   │   ├── work-view.js            # THE unified song page (openWork)
│   │   ├── song-view.js            # Lead-sheet helpers, ABC, list nav
│   │   └── supabase-auth.js        # Auth & cloud sync
│   └── data/index.jsonl            # Search index (generated; not in git)
├── sources/                        # Original song sources (used for migration)
│   ├── classic-country/            # ~17,000 parsed songs
│   └── manual/                     # User-contributed songs
├── supabase/                       # Backend (Supabase)
│   ├── migrations/                 # Database migrations
│   └── functions/                  # Edge functions
├── scripts/                        # CLI tools
└── ROADMAP.md                      # Product vision
```

## License

**Source Available, Not Open Source.** See [LICENSE](LICENSE) for full terms.

- **Permitted**: Personal use (<20 people), local self-hosting, educational use, contributing via PR
- **Prohibited**: Public hosting, monetization, commercial use, redistribution, enabling Pages on forks

The copyright holder reserves all rights to public hosting and monetization. By contributing, you assign all rights to the copyright holder.

Song content copyright remains with original songwriters and publishers.
