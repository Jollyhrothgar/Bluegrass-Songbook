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

## CRITICAL: Cost Controls

**NEVER submit paid API calls without explicit user confirmation.** This includes:
- Anthropic batch API (LLM tagging)
- Strum Machine API (if it ever becomes paid)
- Any other external paid service

Always:
1. Show the cost estimate with breakdown (token counts, rates, total)
2. Give the user a chance to validate the calculation - cost estimates can have bugs
3. Ask for explicit permission to proceed
4. Wait for clear "yes" before submitting - don't auto-submit

## Development Practices

- **Test-driven development** - write tests, especially for parser changes
- **Best practices**: DRY, KISS - avoid over-engineering
- **Python**: Always use `uv run` (e.g., `uv run pytest`, `uv run python script.py`)
- **Branching**:
  - Features: `feature/<name>` (e.g., `feature/chord-display-mode`)
  - Bug fixes: `bug/<name-or-issue-id>` (e.g., `bug/parser-missing-chord`)
- **Worktrees**: Use `.bare` worktree setup for parallel work on multiple features (see below)
- **Trunk-based workflow**: All PRs merge to `main`. CI runs tests; deployment only happens if tests pass.
- **Understand the project before making changes**: Confirm with the user before you make changes
  (and also do your research). Does making a change corrupt the search index? Do you rember that
  there are effectively two "CI modes" - the 'long mode' that is built with local deps, and the
  short mode that uses github actions. Have you ensured that github actions reflect the intent of
  the user and the state that needs to serve users?

## Repository Structure (Git Worktrees)

This repo uses a bare git repository with worktrees for parallel feature development:

```
bluegrassbook.com/
├── .bare/              # Bare git repo (shared git data)
├── main/               # Worktree: main branch
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
├── works/                   # PRIMARY: Song collection (17,500+ works)
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
│       └── posts.json       # Blog manifest
│
├── sources/                 # Song and tab sources
│   ├── classic-country/     # ~17,000 parsed songs (migrated to works/)
│   ├── golden-standard/     # 86 curated bluegrass standards
│   ├── manual/              # Hand-created songs
│   ├── tunearch/            # ABC fiddle tunes
│   ├── banjo-hangout/       # Banjo tabs from Banjo Hangout (TEF→OTF)
│   ├── bluegrass-lyrics/    # Additional lyrics source
│   └── tef-uploads/         # User-uploaded TEF files for conversion
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
│   ├── github-project/SKILL.md  # GitHub project management
│   ├── tab-debug/SKILL.md   # TEF/tablature debugging workflow
│   └── add-issue/SKILL.md   # GitHub issue creation with duplicate detection
│
├── ROADMAP.md               # Product vision & phases
├── tests/                   # pytest test suite (parser)
├── docs/js/__tests__/       # Vitest unit tests (frontend)
├── e2e/                     # Playwright E2E tests
└── package.json             # Node.js test dependencies
```

## Works Architecture

Note: works are generated from sources. We are actively developing right now, and we should treat
works as emphemeral - e.g. built from sources. E.g. if there is a banjo tab error - do not correct
the work, instead correct the parser (do this interactively with the user).

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
| **Banjo Hangout tabs** | `sources/banjo-hangout/` | `sources/banjo-hangout/CLAUDE.md` |
| **Build pipeline** | `scripts/lib/` | `scripts/lib/CLAUDE.md` |
| **ChordPro syntax** | `.claude/skills/chordpro/` | `SKILL.md` (auto-invoked) |
| **GitHub project** | `.claude/skills/github-project/` | `SKILL.md` (milestones, issues, labels) |
| **TEF/Tab debugging** | `.claude/skills/tab-debug/` | `SKILL.md` (TEF parsing issues) |
| **Issue creation** | `.claude/skills/add-issue/` | `SKILL.md` (duplicate detection, labels) |
| **Backend (Supabase)** | `supabase/`, `docs/js/supabase-auth.js` | `supabase/CLAUDE.md` |

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
| `build.yml` | Push to main, PRs | Runs tests; deploys to GitHub Pages only if tests pass |
| `process-song-submission.yml` | Issue labeled `song-submission` + `approved` | Adds new song |
| `process-song-correction.yml` | Issue labeled `song-correction` + `approved` | Updates existing song |

## Chrome DevTools MCP

Use the `chrome-devtools` MCP when Playwright/Vitest aren't enough:

- **Visual debugging** - inspect rendered DOM, see layout issues, check CSS
- **Performance profiling** - identify slow renders, memory issues
- **Network inspection** - debug index.jsonl loading, tablature fetch failures
- **Console errors** - catch runtime JS errors not surfaced in tests

Start the dev server first (`./scripts/server`), then use the MCP to interact with the page.

## Current State

- **17,500+ songs** in works-based architecture with chord search, transposition, favorites, dark mode
- **Works system**: Each song is a "work" with multiple parts (lead sheet, tablature, ABC notation)
- **Tablature**: Banjo Hangout tabs with TEF→OTF parsing, playback, track mixer for multi-instrument arrangements
- **Tags**: Genre (Bluegrass, ClassicCountry, etc.), Vibe (JamFriendly, Modal), Instrument (tag:fiddle, tag:banjo) - primary source is LLM tagging, with MusicBrainz and grassiness scoring as fallbacks
- **User accounts**: Google OAuth via Supabase, cloud-synced lists
- **Song versions**: Multiple arrangements with voting (infrastructure ready)
- **URL stability**: Work URLs (`#work/{slug}`) are permanent; legacy `#song/{id}` URLs redirect

**Recent additions (Jan-Feb 2026):**
- **Trusted user editing**: Trusted users can make instant edits without approval
- **Super-user requests**: Regular users can request trusted status via GitHub issue
- **LLM tagging**: Primary tag source using Claude batch API
- **Tag voting**: Trusted users can override incorrect tags
- **Legacy ID migration**: Song IDs migrated from filename-based to work slugs
- **Strum Machine integration**: 605+ songs with practice backing tracks
- **Quick controls bar**: One-click access to key/size/layout during practice
- **Focus mode**: Distraction-free full-screen song view
- **Covering artists**: Shows which bluegrass legends recorded each song
- **Multi-owner lists**: Collaborative list curation with follow/unfollow
- **Thunderdome**: Claim abandoned lists (now 1 year inactivity threshold)
- **Frictionless feedback**: Report issues and request songs without GitHub account
- **Submitter attribution**: Tracks who submitted content ("Rando Calrissian" for anonymous)

**What's next**: See GitHub milestones (`gh issue list --milestone "Milestone Name"`)

**In Progress (Feb 2026):**
- **Strum Machine missing songs**: Scraped SM's song index (~833 songs we don't have). Investigating automated fetching from web chord sources (Ultimate Guitar, Chordie, etc.). Challenge: each source formats data differently, so parsing needs to be source-specific. See `docs/data/sm_missing_vocals.json` for the gap list and `scripts/lib/fetch_chords.py` for the fetching prototype. Next step: create separate parser modules per source in `sources/web-chords/`.

## File Navigation

| I want to... | Go to... |
|--------------|----------|
| Add a UI feature | `docs/js/` + `docs/js/CLAUDE.md` |
| Work with tablature/renderers | `docs/js/renderers/` + `docs/js/work-view.js` |
| Build the OTF editor | `docs/js/otf-editor/DESIGN.md` |
| Modify homepage collections | `docs/js/collections.js` |
| Understand works structure | `works/` + `scripts/lib/work_schema.py` |
| Fix a parser bug | `sources/classic-country/src/parser.py` + its CLAUDE.md |
| Debug TEF/tablature parsing | `.claude/skills/tab-debug/SKILL.md` |
| Understand ChordPro syntax | `.claude/skills/chordpro/SKILL.md` |
| Understand grassiness scoring | `scripts/lib/tagging/CLAUDE.md` |
| Work with auth/user data | `docs/js/supabase-auth.js` |
| Add a database migration | `supabase/migrations/` |
| Manage issues/milestones | `.claude/skills/github-project/SKILL.md` |
| Write a blog post | `docs/posts/` (then run `./scripts/utility build-posts`) |
| Analyze usage data | `analytics/dashboard.ipynb` |
| Analyze grassiness data | `analytics/grassiness_analysis.ipynb` |
| See product vision | `ROADMAP.md` |
| Run parser tests | `uv run pytest` |
| Run frontend tests | `npm test` |
| Run E2E tests | `npm run test:e2e` |
| Debug in browser | Chrome DevTools MCP (note - the scripts/chrome can helpfully launch a logged in
debug browser |
