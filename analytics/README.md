# Analytics Dashboard

Jupyter notebook for analyzing Bluegrass Songbook usage data from Supabase.

## Quick Start

```bash
# 1. Create .env with your Supabase credentials
cp .env.example .env
# Edit .env with your service role key

# 2. Setup and start (run from analytics/ — these are analytics/scripts/*,
#    not the repo-root scripts of the same name)
./scripts/bootstrap
./scripts/server
```

Open http://localhost:8888/lab/tree/dashboard.ipynb — or whichever port
`./scripts/server` reports, since it auto-increments past a busy 8888.

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

## Security

Notebook outputs are **never committed**: notebooks live in git as
percent-format `.py` files (jupytext), and the paired `.ipynb` that holds the
outputs is gitignored. See "Notebooks are .py files" in `CLAUDE.md`.

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
