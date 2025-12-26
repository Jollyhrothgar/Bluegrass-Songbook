# Bluegrass Songbook

A searchable collection of 17,000+ bluegrass and country songs with chords, built for the bluegrass community.

## Quick Start

```bash
./scripts/bootstrap          # First-time setup (install deps + build index)
./scripts/server             # Start frontend at http://localhost:8080
./scripts/utility add-song FILE.pro  # Add a song to the collection
```

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
├── docs/                    # Frontend (GitHub Pages)
│   ├── index.html           # Search UI + song editor
│   ├── js/search.js         # All frontend logic
│   ├── css/style.css        # Dark/light theme styles
│   └── data/index.json      # Song index (built from .pro files)
│
├── sources/                 # Song collections (each self-contained)
│   ├── classic-country/     # ~17,000 parsed songs
│   │   ├── raw/             # Original HTML files
│   │   ├── parsed/          # Generated .pro files
│   │   ├── src/             # Parser code (CLAUDE.md inside)
│   │   └── viewer/          # Debug UI for parser validation
│   └── manual/              # Hand-created songs
│       └── parsed/          # .pro files
│
├── scripts/                 # CLI tools
│   ├── bootstrap            # Setup + build index
│   ├── server               # Start dev server
│   ├── utility              # add-song, count-chords
│   └── lib/                 # Python implementations
│
├── supabase/                # Supabase backend configuration
│   └── migrations/          # SQL migrations (version-controlled)
│
├── .claude/skills/          # Claude Code skills
│   └── chordpro/SKILL.md    # ChordPro syntax reference
│
├── ROADMAP.md               # Product vision & phases
└── tests/                   # pytest test suite
```

## Key Components

| Component | Location | CLAUDE.md |
|-----------|----------|-----------|
| **Frontend** | `docs/` | `docs/js/CLAUDE.md` |
| **Parser** | `sources/classic-country/src/` | `sources/classic-country/src/CLAUDE.md` |
| **Build pipeline** | `scripts/lib/` | `scripts/lib/CLAUDE.md` |
| **ChordPro syntax** | `.claude/skills/chordpro/` | `SKILL.md` (auto-invoked) |
| **Backend (Supabase)** | `supabase/`, `docs/js/supabase-auth.js` | - |

## Development Workflows

### Adding a UI Feature

1. Edit `docs/js/search.js` (all logic is here)
2. Edit `docs/css/style.css` for styling
3. Test at `http://localhost:8080` (run `./scripts/server`)
4. See `docs/js/CLAUDE.md` for architecture

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
./scripts/bootstrap --quick   # Regenerates docs/data/index.json
```

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

**Labels**: Run `gh label list` to see available labels and descriptions.

**Workflows**:

| Workflow | Trigger | Action |
|----------|---------|--------|
| `process-song-submission.yml` | Issue labeled `song-submission` + `approved` | Adds new song |
| `process-song-correction.yml` | Issue labeled `song-correction` + `approved` | Updates existing song |

## Current State

- **17,053 songs** from classic-country-song-lyrics.com (exact duplicates removed)
- **Search**: keyword, chord (Nashville numbers), progression
- **Features**: transposition, favorites, song editor, dark mode
- **Authentication**: Google OAuth via Supabase
- **User lists**: Create/manage multiple song lists (synced to cloud)
- **Song versions**: Infrastructure for multiple versions with voting (UI ready, awaiting content)
- **Next**: playback engine, fiddle tunes (see ROADMAP.md)

## File Navigation

| I want to... | Go to... |
|--------------|----------|
| Add a UI feature | `docs/js/search.js` + `docs/js/CLAUDE.md` |
| Fix a parser bug | `sources/classic-country/src/parser.py` + its CLAUDE.md |
| Understand ChordPro syntax | `.claude/skills/chordpro/SKILL.md` |
| Work with auth/user data | `docs/js/supabase-auth.js` |
| Add a database migration | `supabase/migrations/` |
| See product roadmap | `ROADMAP.md` |
| Run tests | `uv run pytest` |
| Debug parser output | `./sources/classic-country/scripts/server debug_viewer` |
