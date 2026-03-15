# Analytics

Jupyter notebooks and scripts for analyzing Bluegrass Songbook usage data and content metrics.

## Quick Start

```bash
cp .env.example .env          # Add Supabase service role key
./scripts/bootstrap           # Install dependencies
./scripts/server              # Start Jupyter at http://localhost:8888
```

## Notebooks

### dashboard.ipynb

Product analytics from Supabase:
- Visitor statistics (daily traffic, unique visitors, page views)
- User engagement (song votes, genre suggestions, tag votes)
- Behavioral analytics (2,040+ events: song views, searches, exports)
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

- **Supabase tables**: `visitor_stats`, `visitors`, `song_votes`, `genre_suggestions`, `tag_votes`, `user_lists`, `analytics_events`
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
├── .env.example               # Supabase credentials template
└── *.png                      # Generated visualizations
```
