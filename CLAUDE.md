# Bluegrass Songbook

A bluegrass jam songbook: a curated searchable index of ~1,800 bluegrass and
bluegrass-adjacent songs, backed by an 18,500+ work archive (every archived
work still resolves by direct URL and can be restored to search — see
"Index Prune" in `scripts/lib/CLAUDE.md`).

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

## Bug Triage — No Invisible Bandaids

**IMPORTANT**: When the user complains about something being wrong — rendering looks off, data seems incorrect, behavior is unexpected — **dispatch the `triage` subagent BEFORE writing any code fix.**

The triage agent investigates root cause and comes back with a structured verdict that classifies every suggested fix as:
- **ROOT FIX**: Addresses the actual cause
- **BANDAID**: Makes the symptom go away without fixing the cause (acceptable if tracked as tech debt)
- **WORKAROUND**: Avoids the buggy path entirely

**Why this matters**: This project has layered pipelines (TEF → OTF → renderer, ChordPro → works → index → UI). A symptom at the display layer often hides a bug in the parser or data. Fixing at the surface creates invisible bandaids that cascade into worse problems later.

**When to dispatch triage**:
- User says something "looks wrong" or "should be X not Y"
- You notice unexpected data while implementing a feature
- A test fails in a way that seems like bad data rather than bad test logic
- You're tempted to add a special case or override to make something "just work"

**How**: `Task(subagent_type="triage", prompt="<describe the complaint and what you've observed so far>")`

A known bandaid tracked as an issue is fine. An invisible bandaid is not.

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
├── works/                   # PRIMARY: Song collection (18,300+ works)
│   └── {work-slug}/         # e.g., "blue-moon-of-kentucky"
│       ├── work.yaml        # Metadata: title, artist, tags, parts
│       └── lead-sheet.pro   # ChordPro lead sheet
│
├── docs/                    # Frontend (GitHub Pages)
│   ├── index.html           # Search UI + song editor
│   ├── blog.html            # Dev blog
│   ├── js/                  # ES modules
│   │   ├── main.js          # Entry point, initialization, routing
│   │   ├── shell.js         # App shell: top band, bottom band, pill primitive
│   │   ├── state.js         # Shared state
│   │   ├── search-core.js   # Search logic
│   │   ├── work-view.js     # THE unified song page (openWork) — all routes land here
│   │   ├── song-view.js     # Lead-sheet helpers, ABC notation, list nav
│   │   ├── song-controls.js # Pill builders (Key / Display / Info / Export)
│   │   ├── chord-explorer/  # Interactive chord progression builder
│   │   ├── bounty-view.js   # Bounty/voting system
│   │   ├── add-song-picker.js # Song selection interface
│   │   └── renderers/       # Part renderers
│   │       ├── chordpro.js  # ChordPro parse + render (shared everywhere)
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
│   ├── bluegrass-lyrics/    # 764 songs from BluegrassLyrics.com (Feb 2026)
│   ├── ultimate-guitar/     # Chord enrichment via UG Mobile API
│   ├── web-chords/          # 325 songs from chord websites (raw, not yet parsed)
│   ├── traditional-music-uk/ # Chord data from traditionalmusic.co.uk
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

## Data Tiers — what's tracked, and why

**The rule: if a build produces it, git doesn't track it.** `git status` should
only ever show things a human edited, so "commit everything that's dirty" is
always the right answer and nobody has to decide what belongs in a PR.

| Tier | Where | Tracked? | Read by the site build? | If lost |
|------|-------|----------|------------------------|---------|
| 1. Acquisition cache | `sources/*/raw/`, `downloads/` | mostly **no** (per-source `.gitignore`) | no | re-scrape |
| 2. Primary artifacts | `sources/*/parsed/`, Hangout `downloads/*.tef` | **yes** | no | not re-creatable cheaply — the parsers are frozen |
| 3. Authoritative | `works/*/work.yaml` + parts | **yes** | **yes** | unrecoverable — hand-edited |
| 4. Generated site data | `docs/data/index.jsonl`, `archive.jsonl`, `songs/`, `tabs/*.otf.json` | **no** | rebuilt every deploy | `./scripts/bootstrap --quick` |

Tier 4 is gitignored (2026-08-02). Every consumer rebuilds it before use — the
Pages deploy (`.github/workflows/build.yml` runs `build_works_index.py` then
uploads `docs/`) and all four `process-*.yml` automations — so the committed
copies never reached production and only made corpus PRs unreadable.

Three carve-outs, all deliberate — each verified by wiping `docs/data/` and
rebuilding from `works/` (songs and tabs came back with **0 diffs**; the items
below did **not** come back, which is exactly why they stay tracked):

- **`docs/data/tabs/*_tef.otf.json` stays tracked.** Those six are hand-placed
  OTF test fixtures, not build output: `build_works_index`'s orphan prune
  spares them and `docs/js/__tests__/otf-editor/facade-27493.test.js` reads one
  directly. Adding a new fixture means matching that `*_tef` name.
- **`docs/data/docs/` (published PDFs) stays tracked.** It's 4 files that never
  churn, so ignoring it would buy nothing — and one of them
  (`ive-just-seen-a-face-banjo-intro-tab.pdf`) has no matching source anywhere
  in `works/`, so it is only recoverable from git. The doc-copy step also has
  no orphan prune, so stale copies from deleted works linger here.
- **Caches in `docs/data/*.json` stay tracked** (`artist_tags`, `llm_tags`,
  `tag_overrides`, `strum_machine_cache`, `deleted_songs`, `grassiness_scores`,
  …). They are *inputs* CI reads, not outputs — see "Local vs CI Operations" in
  `scripts/lib/CLAUDE.md`.

Re-verify any time with: snapshot `docs/data/`, delete `songs/ tabs/
index.jsonl archive.jsonl`, run `./scripts/bootstrap --quick`, diff.

Consequences worth knowing: a fresh clone must run `./scripts/bootstrap` before
`./scripts/server` has data; and to see what an import did to the published
corpus, rebuild and inspect locally (or check prod) rather than reading a diff.

Provenance is unaffected — it lives in `works/*/work.yaml` under
`parts[].provenance` (`source`, `source_id`, `source_file`), which is what ties
tier 4 back to tier 1. Only 9 of 19,227 works lack it.

## Works Architecture

**Works are now authoritative (Mike, 2026-07-31).** Source regeneration is
finished: `works/` is the durable, hand-editable store. Metadata fixes
(artist, composers, tags, titles) belong DIRECTLY in `works/*/work.yaml` —
they will not be clobbered, because nothing bulk-regenerates works from
sources anymore. Importers still ADD works/parts (new tabs, new songs) but
must never overwrite existing works' metadata.

History: before 2026-07-31 works were treated as ephemeral parser output
("fix the parser, not the work"), and source `artist` fields inherited
whatever performer page a chart was scraped from — so authorship-looking
attributions (e.g. "You Are My Sunshine ~ Johnny Cash") are scrape artifacts.
The `artist` field means "as performed by"; authorship lives in `composers`
(the index's `composer` comes only from work.yaml `composers`).

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

| Component | Location | Reference |
|-----------|----------|-----------|
| **Frontend** | `docs/` | `docs/js/CLAUDE.md` |
| **App shell (top/bottom bands, pills)** | `docs/js/shell.js`, `docs/js/song-controls.js` | `docs/js/CLAUDE.md` |
| **Unified song page / Tablature** | `docs/js/work-view.js`, `docs/js/renderers/` | `docs/js/CLAUDE.md` |
| **Parser** | `sources/classic-country/src/` | `sources/classic-country/src/CLAUDE.md` |
| **Banjo Hangout tabs** | `sources/banjo-hangout/` | `sources/banjo-hangout/CLAUDE.md` |
| **Build pipeline** | `scripts/lib/` | `scripts/lib/CLAUDE.md` |
| **ChordPro syntax** | `.claude/skills/chordpro/` | `SKILL.md` (auto-invoked) |
| **GitHub project** | `.claude/skills/github-project/` | `SKILL.md` (milestones, issues, labels) |
| **TEF/Tab debugging** | `.claude/skills/tab-debug/` | `SKILL.md` (TEF parsing issues) |
| **Issue creation** | `.claude/skills/add-issue/` | `SKILL.md` (duplicate detection, labels) |
| **Chord Explorer** | `docs/js/chord-explorer/` | `docs/js/chord-explorer/CLAUDE.md` |
| **Backend (Supabase)** | `supabase/`, `docs/js/supabase-auth.js` | `supabase/CLAUDE.md` |
| **Analytics** | `analytics/` | `analytics/CLAUDE.md` |
| **E2E Tests** | `e2e/` | `e2e/CLAUDE.md` |
| **Python Tests** | `tests/` | `tests/CLAUDE.md` |

### Project Skills (`.claude/skills/`)

| Skill | Purpose |
|-------|---------|
| **chordpro** | ChordPro syntax reference (auto-invoked) |
| **github-project** | Milestones, issues, labels, PR workflows |
| **tab-debug** | TEF/tablature debugging workflow |
| **add-issue** | GitHub issue creation with duplicate detection |

### Project Commands (`.claude/commands/`)

| Command | Purpose |
|---------|---------|
| **roast_image** | Process a complaint screenshot into a Bluegrass Standards Board case with bureaucratic roast |

### Project Agents (`.claude/agents/`)

| Agent | Purpose |
|-------|---------|
| **triage** | Bug triage investigator. Dispatch when user complains about wrong behavior. Traces root cause, labels fixes as ROOT FIX vs BANDAID. See "Bug Triage" section above. |

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
| `build.yml` | Push to main, PRs | Runs tests, rebuilds search index, deploys to GitHub Pages only if tests pass |
| `process-song-submission.yml` | Issue labeled `song-submission` + `approved` | Adds new song |
| `process-song-correction.yml` | Issue labeled `song-correction` + `approved` | Updates existing song |
| `process-tune-request.yml` | Issue labeled `tune-request` | Processes tune requests |
| `auto-label-issues.yml` | New issues | Automatically labels issues |
| `cleanup-pending.yml` | Scheduled | Cleans up stale pending songs |

## Chrome DevTools MCP

Use the `chrome-devtools` MCP when Playwright/Vitest aren't enough:

- **Visual debugging** - inspect rendered DOM, see layout issues, check CSS
- **Performance profiling** - identify slow renders, memory issues
- **Network inspection** - debug index.jsonl loading, tablature fetch failures
- **Console errors** - catch runtime JS errors not surfaced in tests

Start the dev server first (`./scripts/server`), then use the MCP to interact with the page.

## Current State

- **Curated index (2026-07-31)**: search/collections show the bluegrass canon (~1,800 songs kept by a two-of-three-ledgers rule — MusicBrainz coverage, Strum Machine, BluegrassLyrics — plus instrumentals, curated artists, user adds, and a manual review). The other ~16,900 works are archived, not deleted: direct URLs work, and `./scripts/utility curate unprune <id>` puts any song back
- **18,500+ works** in works-based architecture with chord search, transposition, favorites, dark mode
- **Works system**: Each song is a "work" with multiple parts (lead sheet, tablature, ABC notation)
- **Tablature**: Banjo Hangout tabs with TEF→OTF parsing, playback, track mixer for multi-instrument arrangements
- **Tags**: Genre (Bluegrass, ClassicCountry, etc.), Vibe (JamFriendly, Modal), Instrument (tag:fiddle, tag:banjo) - primary source is LLM tagging, with MusicBrainz and grassiness scoring as fallbacks
- **User accounts**: Google OAuth via Supabase, cloud-synced lists
- **Song versions**: Multiple arrangements with voting via the Arrangement pill; editorial curation (canonical/variant pins) in `curation/registry.yaml`
- **URL stability**: Work URLs (`#work/{slug}`) are permanent; legacy `#song/{id}` URLs redirect
- **App shell UI**: slim top band + bottom band + pill controls (`docs/js/shell.js`); one unified song page (`work-view.js` / `openWork`); auto-hiding chrome (`body.chrome-hidden`) instead of a focus mode

**Recent additions (Jan-Feb 2026):**
- **Trusted user editing**: Trusted users can make instant edits without approval
- **Super-user requests**: Regular users can request trusted status via GitHub issue
- **LLM tagging**: Primary tag source using Claude batch API
- **Tag voting**: Trusted users can override incorrect tags
- **Legacy ID migration**: Song IDs migrated from filename-based to work slugs
- **Strum Machine integration**: 605+ songs with practice backing tracks
- **UI redesign (Jul 2026)**: app shell with top/bottom bands, pill controls (Key/Display/Info/Export/Arrangement) replacing the old quick-controls bar, sidebar, and version-picker modal
- **Auto-hiding chrome**: the top band hides while you scroll through a song (replaced focus mode)
- **Covering artists**: Shows which bluegrass legends recorded each song
- **Multi-owner lists**: Collaborative list curation with follow/unfollow
- **Thunderdome**: Claim abandoned lists (now 1 year inactivity threshold)
- **Frictionless feedback**: Report issues and request songs without GitHub account
- **Submitter attribution**: Tracks who submitted content ("Rando Calrissian" for anonymous)

**What's next**: See GitHub milestones (`gh issue list --milestone "Milestone Name"`)

**Recent (Feb 2026):**
- **BluegrassLyrics.com import**: 764 songs imported (494 with chords from UG enrichment, 270 lyrics-only). See `sources/bluegrass-lyrics/CLAUDE.md` and `sources/ultimate-guitar/CLAUDE.md`.
- **Strum Machine matching**: 764 total songs now matched (+147 from BL import)
- **LLM tagging**: All new songs tagged with genre tags via Anthropic batch API

## File Navigation

| I want to... | Go to... |
|--------------|----------|
| Add a UI feature | `docs/js/` + `docs/js/CLAUDE.md` |
| Work with tablature/renderers | `docs/js/renderers/` + `docs/js/work-view.js` |
| Build the OTF editor | `docs/js/otf-editor/DESIGN.md` |
| Modify homepage collections | `docs/js/collections.js` |
| Build chord progressions | `docs/js/chord-explorer/` + `docs/js/chord-explorer/CLAUDE.md` |
| Understand works structure | `works/` + `scripts/lib/work_schema.py` |
| Pin canonical versions / suppress works | `curation/registry.yaml` + `scripts/lib/curate.py` (see `scripts/lib/CLAUDE.md`) |
| Fix a parser bug | `sources/classic-country/src/parser.py` + its CLAUDE.md |
| Debug TEF/tablature parsing | `.claude/skills/tab-debug/SKILL.md` |
| Understand ChordPro syntax | `.claude/skills/chordpro/SKILL.md` |
| Understand grassiness scoring | `scripts/lib/tagging/CLAUDE.md` |
| BluegrassLyrics.com import | `sources/bluegrass-lyrics/CLAUDE.md` |
| Ultimate Guitar chord scraper | `sources/ultimate-guitar/CLAUDE.md` |
| Work with auth/user data | `docs/js/supabase-auth.js` |
| Add a database migration | `supabase/migrations/` |
| Manage issues/milestones | `.claude/skills/github-project/SKILL.md` |
| Write a blog post | `docs/posts/` (then run `./scripts/utility build-posts`) |
| Analyze usage data | `analytics/dashboard.ipynb` |
| Analyze grassiness data | `analytics/grassiness_analysis.ipynb` |
| See product vision | `ROADMAP.md` |
| Run parser tests | `uv run pytest` |
| Run frontend tests | `npm test` |
| Run E2E tests | `npm run test:e2e` (see `e2e/CLAUDE.md`) |
| Debug in browser | Chrome DevTools MCP (`./scripts/chrome` launches a debug browser with saved login) |
