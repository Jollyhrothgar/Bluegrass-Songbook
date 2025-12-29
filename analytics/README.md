# Analytics Dashboard

Jupyter notebook for analyzing Bluegrass Songbook usage data from Supabase.

## Quick Start

```bash
# 1. Create .env with your Supabase credentials
cp .env.example .env
# Edit .env with your service role key

# 2. Setup and start
./scripts/bootstrap
./scripts/server
```

Open http://localhost:8888/notebooks/dashboard.ipynb

## Setup Details

### Credentials

Get your Supabase credentials from:
https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api

You need the **service role key** (not anon key) to bypass RLS and see all data.

### Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/bootstrap` | Install deps, validate .env |
| `./scripts/server` | Start Jupyter notebook |

## Before Committing

Clear all outputs before committing to avoid leaking data:
- Kernel → Restart & Clear Output
- Or: `jupyter nbconvert --clear-output --inplace dashboard.ipynb`

## Data Available

| Table | Description |
|-------|-------------|
| `visitor_stats` | Daily page views + unique visitors |
| `visitors` | Individual visitor IDs (hashed), first/last seen |
| `song_votes` | User votes on song versions |
| `genre_suggestions` | User-contributed tags |
| `tag_votes` | Tag curation votes |
| `user_lists` | User-created song lists |
| `list_songs` | Songs in user lists |
