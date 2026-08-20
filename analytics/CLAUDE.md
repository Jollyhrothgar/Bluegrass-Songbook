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
