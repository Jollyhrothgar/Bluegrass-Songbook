# Bluegrass Songbook

A searchable collection of 17,000+ bluegrass and country songs with chords, built for the bluegrass community.

## Quick Start

```bash
./scripts/bootstrap          # First-time setup (install deps + build index)
./scripts/server             # Start frontend at http://localhost:8080
./scripts/utility add-song FILE.pro  # Add a song to the collection
./scripts/utility refresh-tags       # Refresh tags from MusicBrainz (local only)
./scripts/utility build-posts        # Build blog posts manifest
```

## Development Practices

- **Test-driven development** - write tests, especially for parser changes
- **Best practices**: DRY, KISS - avoid over-engineering
- **Python**: Always use `uv run` (e.g., `uv run pytest`, `uv run python script.py`)
- **Branching**:
  - Features: `feature/<name>` (e.g., `feature/chord-display-mode`)
  - Bug fixes: `bug/<name-or-issue-id>` (e.g., `bug/parser-missing-chord`)
- **Worktrees**: Use `.bare` worktree setup for parallel work on multiple features (see below)

## Repository Structure (Git Worktrees)

This repo uses a bare git repository with worktrees for parallel feature development:

```
bluegrassbook.com/
├── .bare/              # Bare git repo (shared git data)
├── main/               # Worktree: main branch (you are here)
└── feature-xyz/        # Worktree: feature branches as needed
```

**Setup from scratch:**
```bash
mkdir bluegrassbook.com && cd bluegrassbook.com
git clone --bare git@github.com:Jollyhrothgar/Bluegrass-Songbook.git .bare
echo "gitdir: ./.bare" > .git
cd .bare && git worktree add ../main main
cd ../main && git branch --set-upstream-to=origin/main main
```

**Common worktree commands:**
```bash
# Create a new feature worktree
cd .bare && git worktree add ../feature-xyz -b feature-xyz

# List worktrees
git worktree list

# Remove a worktree (after merging)
git worktree remove ../feature-xyz
```

## Project Structure

```
Bluegrass-Songbook/
├── works/                   # PRIMARY: Song collection (17,650+ works)
│   └── {work-slug}/         # e.g., "blue-moon-of-kentucky"
│       ├── work.yaml        # Metadata: title, artist, tags, parts
│       └── lead-sheet.pro   # ChordPro lead sheet
│
├── docs/                    # Frontend (GitHub Pages)
│   ├── index.html           # Search UI + song editor
│   ├── blog.html            # Dev blog
│   ├── js/                  # ES modules
│   │   ├── main.js          # Entry point, initialization
│   │   ├── state.js         # Shared state
│   │   ├── search-core.js   # Search logic
│   │   ├── song-view.js     # Song rendering
│   │   ├── work-view.js     # Work display with parts/tabs
│   │   └── renderers/       # Tablature renderers
│   │       ├── tablature.js # Tab display
│   │       └── tab-player.js # Interactive tab player
│   ├── css/style.css        # Dark/light themes
│   ├── posts/               # Blog posts (markdown)
│   └── data/
│       ├── index.jsonl      # Song index (built from works/)
│       ├── id_mapping.json  # Legacy ID → work slug mapping
│       └── posts.json       # Blog manifest
│
├── sources/                 # LEGACY: Original song sources
│   ├── classic-country/     # ~17,000 parsed songs (migrated to works/)
│   ├── golden-standard/     # 86 curated bluegrass standards
│   ├── manual/              # Hand-created songs
│   ├── tunearch/            # ABC fiddle tunes
│   └── bluegrass-lyrics/    # Additional lyrics source
│
├── scripts/                 # CLI tools
│   ├── bootstrap            # Setup + build index
│   ├── server               # Start dev server
│   ├── utility              # add-song, count-chords, refresh-tags
│   └── lib/                 # Python implementations
│       ├── build_works_index.py  # PRIMARY: Build index from works/
│       ├── work_schema.py        # work.yaml schema
│       └── build_index.py        # LEGACY: Build from sources/
│
├── analytics/               # Data analysis dashboard
│   ├── dashboard.ipynb      # Jupyter notebook
│   └── scripts/             # Export utilities
│
├── supabase/                # Supabase backend configuration
│   └── migrations/          # SQL migrations (version-controlled)
│
├── .claude/skills/          # Claude Code skills
│   ├── chordpro/SKILL.md    # ChordPro syntax reference
│   └── github-project/SKILL.md  # GitHub project management
│
├── ROADMAP.md               # Product vision & phases
├── tests/                   # pytest test suite (parser)
├── docs/js/__tests__/       # Vitest unit tests (frontend)
├── e2e/                     # Playwright E2E tests
└── package.json             # Node.js test dependencies
```

## Works Architecture

Songs are organized in `works/`, where each work is a directory containing:

```yaml
# works/blue-moon-of-kentucky/work.yaml
id: blue-moon-of-kentucky
title: Blue Moon of Kentucky
artist: Patsy Cline
composers: [Bill Monroe]
default_key: C
tags: [ClassicCountry, NashvilleSound, JamFriendly]
parts:
  - type: lead-sheet
    format: chordpro
    file: lead-sheet.pro
    default: true
    provenance:
      source: classic-country
      source_file: bluemoonofkentuckylyricschords.pro
      imported_at: '2026-01-02'
```

**Part types**: `lead-sheet`, `tablature`, `abc-notation`
**Formats**: `chordpro`, `opentabformat`, `abc`

The frontend can display multiple parts per work (e.g., lead sheet + banjo tab).

## Key Components

| Component | Location | CLAUDE.md |
|-----------|----------|-----------|
| **Frontend** | `docs/` | `docs/js/CLAUDE.md` |
| **Works/Tablature** | `docs/js/work-view.js`, `docs/js/renderers/` | `docs/js/CLAUDE.md` |
| **Parser** | `sources/classic-country/src/` | `sources/classic-country/src/CLAUDE.md` |
| **Build pipeline** | `scripts/lib/` | `scripts/lib/CLAUDE.md` |
| **ChordPro syntax** | `.claude/skills/chordpro/` | `SKILL.md` (auto-invoked) |
| **GitHub project** | `.claude/skills/github-project/` | `SKILL.md` (milestones, issues, labels) |
| **Backend (Supabase)** | `supabase/`, `docs/js/supabase-auth.js` | - |

## Development Workflows

### Adding a UI Feature

1. Edit the relevant module in `docs/js/` (see `docs/js/CLAUDE.md` for module breakdown)
2. Edit `docs/css/style.css` for styling
3. Test at `http://localhost:8080` (run `./scripts/server`)
4. Push to main - CI will verify JS syntax and rebuild if needed

### Fixing Parser Issues

1. Edit `sources/classic-country/src/parser.py`
2. Test with debug viewer: `./sources/classic-country/scripts/server debug_viewer`
3. Run regression test: `./sources/classic-country/scripts/test regression`
4. See `sources/classic-country/src/CLAUDE.md` for parser details

### Adding a Song Manually

```bash
./scripts/utility add-song ~/path/to/song.pro
```

### Rebuilding the Search Index

```bash
./scripts/bootstrap --quick   # Regenerates docs/data/index.jsonl from works/
```

This runs `build_works_index.py`, which reads all `works/*/work.yaml` files and builds the search index.

### Refreshing MusicBrainz Tags (Local Only)

MusicBrainz tag enrichment requires a local PostgreSQL database with the MusicBrainz dump. This cannot run in CI.

```bash
# 1. Start the MusicBrainz database (separate repo)
/Users/mike/workspace/music_brainz/mb-db/scripts/db start

# 2. Install psycopg2 if needed
uv pip install psycopg2-binary

# 3. Refresh artist tags and rebuild index
./scripts/utility refresh-tags

# 4. Commit the updated cache (CI uses this)
git add docs/data/artist_tags.json
git commit -m "Refresh MusicBrainz artist tags"
```

The `artist_tags.json` cache is checked into git so CI builds can apply tags without the MusicBrainz database.

## Format: ChordPro + Extensions

We use **ChordPro-compatible syntax** with custom extensions:

```chordpro
{meta: title Your Cheatin Heart}
{meta: artist Hank Williams}
{meta: composer Hank Williams}
{key: G}
{tempo: 120}
{meta: x_source classic-country}      # Custom extension

{start_of_verse: Verse 1}
Your cheatin' [G]heart will make you [C]weep
{end_of_verse}
```

**Version metadata** (for alternate arrangements):
```chordpro
{meta: x_version_label Simplified}
{meta: x_version_type simplified}      # alternate | cover | simplified | live
{meta: x_arrangement_by John Smith}
{meta: x_version_notes Easier chord voicings for beginners}
```

**Key conventions:**
- `{meta: key value}` for all metadata (consistent pattern)
- `{meta: x_*}` for custom fields (ChordPro spec allows this)
- Standard ChordPro for portability to other apps

See `.claude/skills/chordpro/SKILL.md` for full syntax reference.

## GitHub

**Milestones**: Run `gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title): \(.open_issues) open"'`

**Labels**: Run `gh label list` to see available labels and descriptions.

**See**: `.claude/skills/github-project/SKILL.md` for issue/milestone management patterns.

**Automated Workflows**:

| Workflow | Trigger | Action |
|----------|---------|--------|
| `build.yml` | Push to main, PRs | Rebuilds index + posts, auto-commits if changed |
| `process-song-submission.yml` | Issue labeled `song-submission` + `approved` | Adds new song |
| `process-song-correction.yml` | Issue labeled `song-correction` + `approved` | Updates existing song |

## Current State

- **17,650+ songs** in works-based architecture with chord search, transposition, favorites, dark mode
- **Works system**: Each song is a "work" with multiple parts (lead sheet, tablature, ABC notation)
- **Tablature**: Tab rendering with playback for fiddle tunes and instrumentals
- **Tags**: Genre (Bluegrass, ClassicCountry, etc.), Vibe (JamFriendly, Modal), Instrument (tag:fiddle, tag:banjo) - 93% coverage via MusicBrainz + harmonic analysis
- **User accounts**: Google OAuth via Supabase, cloud-synced lists
- **Song versions**: Multiple arrangements with voting (infrastructure ready)
- **URL stability**: Work URLs (`#work/{slug}`) are permanent; legacy `#song/{id}` URLs redirect

**What's next**: See GitHub milestones (`gh issue list --milestone "Milestone Name"`)

## File Navigation

| I want to... | Go to... |
|--------------|----------|
| Add a UI feature | `docs/js/` + `docs/js/CLAUDE.md` |
| Work with tablature/renderers | `docs/js/renderers/` + `docs/js/work-view.js` |
| Understand works structure | `works/` + `scripts/lib/work_schema.py` |
| Fix a parser bug | `sources/classic-country/src/parser.py` + its CLAUDE.md |
| Understand ChordPro syntax | `.claude/skills/chordpro/SKILL.md` |
| Work with auth/user data | `docs/js/supabase-auth.js` |
| Add a database migration | `supabase/migrations/` |
| Manage issues/milestones | `.claude/skills/github-project/SKILL.md` |
| Write a blog post | `docs/posts/` (then run `./scripts/utility build-posts`) |
| Analyze usage data | `analytics/dashboard.ipynb` |
| See product vision | `ROADMAP.md` |
| Run parser tests | `uv run pytest` |
| Run frontend tests | `npm test` |
| Run E2E tests | `npm run test:e2e` |
