# Scripts Directory

Global scripts for the Bluegrass Songbook application.

## Script Hierarchy

```
scripts/                          # Global app scripts
├── bootstrap                     # Setup + build search index
├── server                        # Start development servers
├── utility                       # User-facing utility commands
└── lib/                          # Python implementations
    ├── add_song.py
    ├── build_index.py
    └── chord_counter.py

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

### server

Start the frontend development server.

```bash
./scripts/server              # Start frontend server on port 8080
```

For source-specific servers, see the source's scripts directory.

### utility

User-facing utility commands.

```bash
./scripts/utility add-song /path/to/song.pro    # Add song + rebuild index
./scripts/utility add-song /path/to/song.pro --skip-index-rebuild
./scripts/utility count-chords [path]           # Chord statistics
```

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

No scripts needed - just .pro files dropped directly into `sources/manual/parsed/`.

Use `./scripts/utility add-song` to add songs with automatic index rebuild.
