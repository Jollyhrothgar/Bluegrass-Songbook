# Build Scripts (scripts/lib)

Python for the build pipeline and for writing to `works/`. For what is
tracked in git, see `.claude/rules/generated-data.md`; for the work.yaml
shape, `.claude/rules/works.md`.

```
works/*/work.yaml + lead-sheet.pro --build_works_index.py--> docs/data/index.jsonl    (canon rows, no content)
                                                           > docs/data/archive.jsonl  (indexed:false rows)
                                                           > docs/data/songs/{id}.pro (full ChordPro, every work)
                                                           > docs/songs/**, sitemap   (build_song_pages.py)
```

- `./scripts/bootstrap --quick` runs the build. `--enrich` also runs
  `enrich_songs.py`, which rewrites `sources/*/parsed/*.pro`; nothing reads
  those into `works/` any more, so skip it.
- `ls scripts/lib/*.py` is the file list. `build_index.py` (reads
  `sources/*/parsed/`) and `migrate_to_works.py` are legacy: no build calls
  them, so do not extend them.
- Run Python with `uv run`.

## Secrets

Nothing secret is written to disk. `.env.tpl` files hold 1Password `op://`
references (committed); values are injected into one command's environment:

```bash
./scripts/lib/with-secrets -- uv run python3 scripts/lib/fetch_deleted_songs.py
./scripts/lib/with-secrets --tpl analytics/.env.tpl -- <command>
```

- `./scripts/utility` already wraps the commands that need secrets (syncs,
  genre-suggestion export, Strum Machine matching, LLM tagging). If you add a
  script that reads `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` or
  `STRUM_MACHINE_API_KEY`, wrap its call site too. The service-role key
  bypasses every RLS policy, which is why it must not sit in a `.env`.
- `with-secrets` falls back in order: 1Password if it can resolve the
  template, then an existing `.env` (machines without `op`), then variables
  already exported (CI).
- `scripts/bootstrap` never deletes a `.env`; it only says you may.
  Regenerate one with `op inject -i .env.tpl -o .env`.
- Do not probe 1Password with `op whoami`. Under the desktop app integration
  it reports "not signed in" in every fresh shell while `op read` / `op run`
  work, so scripts that trusted it silently fell back to a stale plaintext
  key. The probe is `op inject -i <tpl> >/dev/null`
  (`tests/test_with_secrets.py` pins it). No `op signin` is needed; keep the
  1Password app unlocked.

## Local vs CI Operations

CI has no MusicBrainz database, no Strum Machine key and no Anthropic key.
Operations that need them run locally; the result is a cache file in
`docs/data/` that you commit, and CI reads it during the build.

| Operation | Where | Cache file | Command |
|-----------|-------|------------|---------|
| Build index, harmonic tags | everywhere | none | `./scripts/bootstrap --quick` |
| MusicBrainz artist tags, grassiness, verified artists | local only (MB DB on port 5440) | `artist_tags.json`, `bluegrass_recordings.json`, `bluegrass_tagged.json`, `grassiness_scores.json`, `verified_artists.json` | `./scripts/utility refresh-musicbrainz` (needs `uv sync --extra analytics`) |
| Strum Machine URLs | local only (API limited to 10 req/s) | `strum_machine_cache.json` | `./scripts/utility strum-machine-match` |
| LLM genre tags | local only | `llm_tags.json` | see "Tag system" |
| Deleted songs sync | hourly CI + local | `deleted_songs.json` | `./scripts/utility sync-deleted-songs` |
| Promoted songs sync | hourly CI + local | `promoted_songs.json` | `./scripts/utility sync-promoted-songs` |
| Tag overrides sync | hourly CI + local | `tag_overrides.json` (applied at next build) | `./scripts/utility sync-tag-votes` |
| Genre suggestions export | hourly CI + local | `user_genre_suggestions.json` (review only, never applied) | `./scripts/utility export-suggestions` |

- The deleted/promoted syncs run in `sync-deleted-songs.yml`; the tag and
  genre ones in `sync-community-input.yml`.
- A sync that cannot reach Supabase exits non-zero. A broken sync that looked
  successful once let the build ship stale data. `supabase_client.py` holds the
  shared connect/fail logic.
- A promotion has the same effect as `curate unprune`, but lives in the JSON
  cache rather than `registry.yaml`. If a promoted work was also deleted,
  deletion wins (the build warns).

## Index Prune

Search and collections show only the bluegrass canon. Everything else is
archived, not deleted: it keeps its URL, stays in lists, and can be restored.

- `curation/index_prune.csv` lists work ids that `apply_index_prune()`
  (`curation.py`) stamps `indexed: false`. A row is exempt if it is
  user-origin (`USER_SOURCES` in `curation.py`, or `submitted_by`) or has a
  `keep:` entry in `curation/registry.yaml`.
- Why each song is in or out: `curation/INDEX_DECISIONS.md`. The MusicBrainz
  coverage data it used is vendored in `curation/decision-data/`, so no local
  database is needed to re-analyze it.
- Count the split with `wc -l docs/data/index.jsonl docs/data/archive.jsonl`
  after a build.

```bash
./scripts/utility curate unprune <work-id> --reason "why it belongs"
./scripts/bootstrap --quick
# In bulk: remove rows from curation/index_prune.csv (or add keep: entries
# in curation/registry.yaml), then rebuild.
```

## How a bot commit reaches the site

A commit pushed by a workflow does not trigger a deploy. GitHub does not
start workflows for pushes made with the default `GITHUB_TOKEN`, so a
`github-actions[bot]` commit lands in git and nothing rebuilds.

`build.yml` closes the gap with a `workflow_run` trigger that lists the
content workflows by their `name:` field:

```yaml
workflow_run:
  workflows: ["Process Pending Submission", "Process Tune Request",
              "Sync Community Input", "Sync Deleted + Promoted Songs"]
```

- It matches the `name:`, not the filename. Renaming a workflow unhooks
  deployment with no warning anywhere.
- A new workflow that pushes to `main` deploys nothing until its name is added.
- `tests/test_workflow_deploy_triggers.py` fails CI in both directions
  (a pushing workflow not listed; a listed name that does not exist or does not
  push).
- `cleanup-pending.yml` runs after a successful `CI & Deploy`, so a broken
  trigger also stops `pending_songs` rows being reaped.
- Escape hatch when `main` is ahead of the site:
  `gh workflow run build.yml --ref main` (dispatch bypasses the `gate` job and
  always rebuilds).

## build_works_index.py

`uv run python scripts/lib/build_works_index.py` (`--no-tags` skips tag
enrichment). Read `scripts/lib/BUILD.md` before changing what it writes: the
row shape and output files, song pages and the sitemap, versions and URLs,
forked lead sheets, tab arrangements, version grouping, and curation. The
rules that changes elsewhere most often break:

- `build_song_pages.py` fills `docs/index.html` by exact-string landmarks;
  editing the `<title>` and description lines there fails the build on
  purpose.
- Merge redirects must stay merged: `works_writer.redirect_violations` fails
  the build on a redirect source that still has a `works/` dir.
- Suppression asks two questions. `is_suppressed()` guards minting a new id;
  `is_suppressed_exact()` guards writing to a work that exists. Using the
  first for the second refused a real user's tab every hour.
- A failed build never mutates `docs/data/`: stale outputs are pruned only
  after the tab provenance gate passes.

## Tag system

Tags are applied on every build by `tag_enrichment.py`:

1. LLM genre tags from `docs/data/llm_tags.json` (primary).
2. Harmonic analysis from chords: `JamFriendly` (at most 5 unique chords, has
   I-IV-V), `Modal` (has bVII), `Jazzy` (7ths, 9ths, dim, aug, slash chords).
3. MusicBrainz `artist_tags.json`, only if `llm_tags.json` is missing.
4. `tag_overrides.json` (trusted-user downvotes) removes tags.

Re-tag everything (local, costs money; confirm per the root CLAUDE.md first):

```bash
uv run python scripts/lib/batch_tag_songs.py                  # submit (about 2 h)
uv run python scripts/lib/batch_tag_songs.py --status <batch_id>
uv run python scripts/lib/batch_tag_songs.py --results <batch_id>
./scripts/bootstrap --quick && git add docs/data/llm_tags.json
```

Grassiness scoring (what feeds `covering_artists`) is in
`scripts/lib/tagging/CLAUDE.md`.

## Writing to works/

All writes go through `works_writer.py` (`create_work`, `add_part`,
`update_part`, `update_metadata`, `fork_to_arrangement`). It applies the
suppression and redirect guards and never overwrites an existing work on
create. Do not write `work.yaml` with a bare `yaml.dump`.

- `add_song.py` (`./scripts/utility add-song FILE.pro`): metadata comes from
  the chart's `{meta: ...}` directives, flags override; id is `slugify(title)`
  or `--id`; default `--on-collision` is `fail`; part provenance is
  `source: manual`. Then rebuilds the index.
- `add_placeholder.py` (`./scripts/utility add-placeholder "Title" ...`):
  `create_work(part=None)` makes a work with `parts: []` and
  `status: placeholder`, which `isPlaceholder` (`docs/js/utils.js`; used by the bounty board and
  add-song picker) reads.
  `part` is a required argument that may be `None`, so nobody mints an empty
  work by omission. Refuses suppressed and redirected ids (exit 1).

## Contribution path and duplicate check

`process_pending.py` lands a Supabase `pending_songs` row in `works/` (run by
`process-pending.yml`); `dedup_scorer.py` answers "is this submission already a
work?". Read `scripts/lib/process-pending.md` before changing either, the edge
function `supabase/functions/_shared/pending-dispatch.ts`, or anything that
writes `provenance.source_id`.

## Metadata parsing

The build accepts both `{meta: title Song Name}` and `{title: Song Name}`
(also `artist`, and so on) and normalizes them.
