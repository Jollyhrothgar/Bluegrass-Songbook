# Analytics

Jupyter notebooks and scripts for analyzing Bluegrass Songbook usage data and content metrics.

## Quick Start

Run these **from `analytics/`** — `./scripts/bootstrap` and `./scripts/server`
here are `analytics/scripts/*`, not the repo-root scripts of the same name.

```bash
cd analytics
cp .env.example .env          # SUPABASE_URL + SUPABASE_SERVICE_KEY
./scripts/bootstrap           # Validates .env, then `uv sync --extra analytics`
./scripts/server              # Start Jupyter at http://localhost:8888
```

`./scripts/server` auto-increments past a busy port (up to 20 tries) and prints
the one it settled on. It launches Jupyter through
`scripts/lib/with-secrets --tpl analytics/.env.tpl`, so on a machine with the
1Password CLI the notebook gets its credentials injected at run time and the
on-disk `.env` is only what `bootstrap` validates.

## Notebooks

### dashboard.ipynb

Product analytics from Supabase:
- Visitor statistics (daily traffic, unique visitors, page views)
- User engagement (song votes, genre suggestions, tag votes)
- Behavioral analytics from `analytics_events` (song views, searches, exports).
  The event total lives in Supabase and only grows — read it off the notebook,
  not from this file
- Song engagement (most viewed, top search queries, zero-result queries)
- Export behavior breakdown (ChordPro download vs Print vs Copy)
- User lists and retention metrics

### grassiness_analysis.ipynb

Bluegrass scoring methodology validation:
- Score distribution across the collection
- Threshold analysis (20 = Bluegrass, 50 = Standard)
- Core artist catalog coverage at each threshold
- Artist era distribution (Founding/Classic/Modern)
- Cover count vs score correlation

## Search gaps — what visitors could not find

```bash
./scripts/bootstrap --quick                   # verdicts are only as fresh as docs/data/
./scripts/utility search-gaps                 # last 30 days
./scripts/utility search-gaps --since 2026-10-01
```

`scripts/lib/search_gaps.py` stitches each visitor's `search` and
`search_result_click` events into journeys (a 30-minute pause starts a new
one; keystroke pauses are collapsed), then re-runs every failed search against
the LOCAL index and sorts it: **not in the songbook** (with an
`add-placeholder` line), **in the dungeon** (by archived work, with a
`curate unprune` line), **here but not with those filters** (a missing take),
**spelled differently**, **artists**, **filters only**, and **found since**.
It also lists searches that had results nobody opened, and song pages that
were not found (`song_not_found`). It prints and suggests; it never writes,
commits or runs anything — the queries are visitors' words and the repo is
public. The dashboard's "Zero results" cell is the raw list this replaces.

Events it reads (all sent by `docs/js/analytics.js`):

| Event | Properties it relies on |
|-------|-------------------------|
| `search` | `query`, `result_count`, `scope` (`canon` / `canon+dungeon` / `dungeon`; absent before 2026-10-27 = canon) |
| `search_result_click` | `song_id`, `query`, `from_list` (a list view's row, not a search result; absent before 2026-10-27). `position` is always null for search rows: `data-index` only exists on draggable list rows |
| `song_not_found` | `song_id`, `source` (`deep_link` / `list` / `history` / `app`), `path`, `suggestions`, `referrer` (deep links only). Since 2026-10-27 |

Data is thin (~350 searches a month in Oct 2026), so read every line rather
than trusting the ranking.

## Data Sources

- **Supabase tables** (the eight `dashboard.ipynb` actually queries):
  `visitor_stats`, `visitors`, `song_votes`, `genre_suggestions`, `tag_votes`,
  `user_lists`, `list_songs`, `analytics_events`
- **Local files**: `docs/data/grassiness_scores.json`, `docs/data/bluegrass_artist_database.json`
- **MusicBrainz**: Local PostgreSQL on port 5440 (for grassiness analysis)

## Structure

```
analytics/
├── dashboard.ipynb            # Product analytics
├── grassiness_analysis.ipynb  # Bluegrass scoring analysis
├── scripts/
│   ├── bootstrap              # Install dependencies
│   └── server                 # Start Jupyter
├── bluegrass-research/        # Research notes, SQL queries, analysis scripts
├── .env.example               # Plain-text credentials template (what bootstrap checks)
├── .env.tpl                   # 1Password op:// references (what scripts/server injects)
└── *.png                      # Generated visualizations
```
