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

Open http://localhost:8888/notebooks/dashboard.ipynb — or whichever port
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

Notebook outputs are **automatically stripped on commit** via `nbstripout`.
No manual clearing needed - the git filter handles it.

The filter is only half committed: `.gitattributes` (`*.ipynb filter=nbstripout`)
is in the repo, but the `filter.nbstripout.*` git config that makes it do
anything is per-clone and is installed by `./scripts/bootstrap`
(`nbstripout --install`). On a fresh clone that hasn't run it, outputs commit
unstripped. Check with `git config --get filter.nbstripout.clean`.

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
