# Scripts Directory

Global scripts for the Bluegrass Songbook application.

## Script Hierarchy

```
scripts/                          # Global app scripts
├── bootstrap                     # Setup + build search index
├── server                        # Start development servers
├── utility                       # User-facing utility commands
└── lib/                          # Python implementations (~35 modules; run `ls scripts/lib/`)
    ├── build_works_index.py      # PRIMARY: builds docs/data/ from works/
    ├── work_schema.py            # work.yaml schema
    ├── works_writer.py           # The only writer into works/
    ├── process_pending.py        # pending_songs row -> works/
    ├── curate.py                 # curation/registry.yaml pins & suppressions
    └── build_index.py            # LEGACY: builds from sources/*/parsed/

sources/classic-country/scripts/    # Source-specific scripts
├── bootstrap                     # Batch parse HTML files
└── test                          # Parser testing commands
```

## Global Scripts

### bootstrap

First-time setup and build. Safe to run anytime.

```bash
./scripts/bootstrap           # Full setup: uv sync + build index
./scripts/bootstrap --quick   # Skip dependency install, just build index
```

The index build is `scripts/lib/build_works_index.py`, reading `works/`.

### server

Start the frontend development server.

```bash
./scripts/server              # Frontend server, port 8080
./scripts/server 8085         # Explicit port
./scripts/server --exact      # Fail instead of auto-incrementing
```

Without `--exact` the server walks 8080-8090 to find a free port, and it first
kills any Python `http.server` it finds on those ports.

For source-specific servers, see the source's scripts directory.

### utility

User-facing utility commands. The dispatch in `scripts/utility` is the source
of truth and it carries ~30 subcommands — run the built-in help rather than
trusting a list here:

```bash
./scripts/utility help
```

Frequently used:

```bash
./scripts/utility count-chords [path]           # Chord statistics
./scripts/utility coverage [--gaps]             # Chords/lyrics/tab/abc coverage
./scripts/utility search "artist:bill monroe"   # Query the index from the CLI
./scripts/utility curate report                 # Groups with no canonical pin
./scripts/utility build-posts                   # Rebuild docs/data/posts.json
./scripts/utility db-check                      # Assert schema invariants (read-only)
```

```bash
./scripts/utility add-song /path/to/song.pro    # local chart -> works/{slug}/
```

`scripts/lib/add_song.py` writes through `works_writer.create_work`: the work
id is `slugify(title)` (or `--id`), title/artist/composer/key come from the
file's `{meta: ...}` directives unless overridden, and the part is stamped
`provenance.source: manual`. An existing or suppressed id is refused rather
than overwritten (`--on-collision suffix` opts into `{slug}-1`). It rebuilds
`build_works_index.py` afterwards unless `--skip-index-rebuild`.

(Before 2026-08-19 it copied the file into `songs/manual/parsed/` and rebuilt
the LEGACY `build_index.py`, which reads `sources/manual/parsed/` — a
different directory. Neither fed `works/`, so the command was a no-op that
exited 0.)

## Source-Specific Scripts

Each song source has its own scripts directory with source-specific tooling.

### classic-country

Parser and testing tools for classic-country-song-lyrics.com:

```bash
# Batch parse all HTML files
./sources/classic-country/scripts/bootstrap

# Start debug viewer (side-by-side HTML vs parsed)
./sources/classic-country/scripts/server debug_viewer

# Run regression test after parser changes
./sources/classic-country/scripts/test regression --name fix_xyz

# Run statistical validator
./sources/classic-country/scripts/test validate

# Quick single-song reparse
./sources/classic-country/scripts/test reparse songname

# Find outlier files for review
./sources/classic-country/scripts/test outliers
```

### manual

`sources/manual/parsed/` holds 24 hand-authored .pro files. It is a **legacy
source directory**: only the legacy `scripts/lib/build_index.py` reads it, and
the site index is built from `works/` instead. Dropping a .pro file there does
not put a song on the site.
