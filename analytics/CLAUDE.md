# Analytics

Jupyter notebooks and scripts for usage data (Supabase) and content metrics. `analytics/README.md`
repeats the quick start for humans.

## Run it

Run from `analytics/`. `./scripts/bootstrap` and `./scripts/server` here are
`analytics/scripts/*`, not the repo-root scripts of the same name.

```bash
cd analytics
cp .env.example .env          # SUPABASE_URL + SUPABASE_SERVICE_KEY
./scripts/bootstrap           # validates .env, then `uv sync --extra analytics`
./scripts/server [port]       # Jupyter, default 8888; walks up to 20 ports if busy, prints the one used
```

`server` launches Jupyter through `scripts/lib/with-secrets --tpl analytics/.env.tpl`, so with the
1Password CLI the credentials are injected at run time; the on-disk `.env` is only what `bootstrap`
checks. `.env` holds a service key: never commit it.

## Notebooks

Notebooks are committed as percent-format Python (jupytext `# %%` cells), so a
change reviews like code and no output (production numbers, visitor ids, query
text) can reach git. Each `.py` pairs with a gitignored `.ipynb` of the same
name that holds the outputs (`analytics/jupytext.toml`); `./scripts/server`
creates any missing `.ipynb` from its `.py` before starting, and Jupyter writes
both on every save. Edit in Jupyter, commit the `.py`. This replaced
nbstripout, whose per-clone git filter broke git commands in other worktrees.

- `dashboard.py`: product analytics from Supabase (visitors, weekly active users, votes and
  tag votes, `analytics_events` behaviour, top and zero-result searches, exports, lists). It
  queries `visitor_stats`, `visitors`, `song_votes`, `genre_suggestions`, `tag_votes`, `user_lists`,
  `user_list_items`, `user_favorites`, `analytics_events`. Every query goes through `fetch_all`,
  because PostgREST caps a request at 1,000 rows.
- `grassiness_analysis.py`: validates the bluegrass scoring (thresholds 20 = Bluegrass,
  50 = Standard; method in `scripts/lib/tagging/CLAUDE.md`). Reads `docs/data/grassiness_scores.json`
  and `docs/data/bluegrass_artist_database.json`, and the local MusicBrainz Postgres on port 5440
  (see the root CLAUDE.md).

Traps when reading the data:

- `visitor_stats.unique_visitors` counts first-ever visits only; `dashboard.py` renames it
  `new_visitors`.
- `analytics_events` has only an anonymous `visitor_id`, so "signed-in" weekly activity is inferred
  from contributor tables (votes, tags, lists, favorites): a floor, not a split of one total.
- Events are missing from 2026-01-07 to 2026-10-01 (the `log_events` outage, fix-it item A2).
- Events are written only on the production host (`docs/js/telemetry.js`), so local and Playwright
  traffic is not in the data. Mike's own browsers are left out too: open
  `https://bluegrassbook.com/?internal=1` once per browser (clearing site data undoes it), and add the
  visitor id its toast shows to `INTERNAL_VISITORS` in the dashboard's setup cell to drop that
  browser's history.

## Search gaps: what visitors could not find

```bash
./scripts/bootstrap --quick                   # from the repo root; verdicts are only as fresh as docs/data/
./scripts/utility search-gaps                 # last 30 days
./scripts/utility search-gaps --since 2026-10-01
```

`scripts/lib/search_gaps.py` (tests: `tests/test_search_gaps.py`) joins each visitor's `search` and
`search_result_click` events into journeys, re-runs every failed search against the local index and
sorts it into the sections in `SECTIONS`: not in the songbook (with a
`./scripts/utility add-placeholder` command that creates a placeholder work for it), in the dungeon
(with a `curate unprune` command), here but not with those filters, spelled differently, artists,
filters that match nothing at all, and found nothing then but in the songbook now. It also lists
searches with results nobody opened and `song_not_found` events. It only prints suggestions; it never writes or commits, because the queries are visitors' words and the repo
is public. Traffic is thin (hundreds of searches a month), so read every line rather than trusting
the ranking.

It depends on these events from `docs/js/analytics.js`; changing their properties breaks it:

| Event | Properties it relies on |
|-------|-------------------------|
| `search` | `query`, `result_count`, `scope` (`canon` / `canon+dungeon` / `dungeon`; absent before 2026-10-27 means canon) |
| `search_result_click` | `song_id`, `query`, `from_list` (absent before 2026-10-27). `position` is always null for search rows |
| `song_not_found` | `song_id`, `source` (`deep_link` / `list` / `history` / `app`), `path`, `suggestions`, `referrer` (deep links only) |

## Other contents

- `bluegrass-research/`: one-off research notes, SQL and scripts from the January 2026 bluegrass-corpus research (MusicBrainz repertoire, tagging, landing page).
  `scripts/lib/CLAUDE.md` and `scripts/lib/tagging/CLAUDE.md` mention some of them; check there
  before deleting.
- `*.png` in `analytics/`: output of `grassiness_analysis.py`, regenerated by running it.
