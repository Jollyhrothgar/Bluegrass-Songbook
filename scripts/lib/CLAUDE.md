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

```bash
uv run python scripts/lib/build_works_index.py            # full build
uv run python scripts/lib/build_works_index.py --no-tags  # skip tag enrichment
```

### Outputs

The index is split so a phone loads only what search needs: `index.jsonl`
(canon rows, no ChordPro), `archive.jsonl` (the `indexed: false` rows, `lyrics`
clipped to 200 chars), and `songs/{id}.pro` (full ChordPro for every work). The
frontend fetches `songs/{id}.pro` when a song opens and reads `archive.jsonl`
only for rows missing from the canon (deep links, saved lists, version groups).
Canon `lyrics` stay full width because `lyrics:` search reads them.

- Row shape is written by `write_outputs()`. `content` and `abc_content` are
  not on rows. `has_content` and `has_abc` are `true` or omitted.
- `tablature_parts[].tracks` is the OTF's playable track count (percussion
  excluded, or single-instrument tabs would get `tag:multipart`).
- Output is byte-stable: id-sorted, and `.pro` / page files are rewritten
  only when their text changed. Stale `songs/*.pro` and `tabs/` files are
  pruned after the tab provenance gate in `build_works_index.py` (`_tab_provenance_mismatch`:
  each copied OTF's `x_source.source_id` must equal its part's
  `provenance.source_id`; a mismatch fails the build), so a failed build never
  mutates `docs/data/`.
- Tools that reason about the whole corpus read `archive.jsonl` too
  (`curate`, `batch_tag_songs`, `grassiness`, `strum_machine --batch`). The
  `search_index.py` CLI matches the site (canon only); `--archive` adds the
  pruned rows.
- `search_index.py` must match the site's search: `search_gaps.py` replays
  visitors' failed searches through it. Change `search()` in
  `docs/js/search-core.js` and `search_parsed()` there together
  (`tests/test_search_index.py`). It lacks the site's stemmed-word fallback
  (`stemWord` in `docs/js/stem.js`, used by `search()`) and virtual instrument
  tags (`getInstrumentTags` in `docs/js/tags.js`), so it may find less than the
  site, never more.
- `./scripts/server` gzips like GitHub Pages, so local load times are
  realistic.

### Forked lead sheets (`arrangements`)

`works_writer.fork_to_arrangement` adds an edit of someone else's chart as an
additional lead-sheet part (`lead-sheet-<label>.pro`, `default: false`,
`x_version_*` set). The build publishes it as `songs/{id}--{slug}.pro` (the
`--` cannot collide with a work id, because `slugify` collapses dash runs) and
lists every take in the row's `arrangements`, present only when a work has
more than one lead sheet. The primary lead sheet still owns `content`,
`lyrics`, `chords`, `key` and search; a fork never adds a search hit. The slug
comes from the part's filename, so it is stable across label edits. The
Arrangement pill (`docs/js/work-view.js`) reads it.

### Static song pages and sitemap (`build_song_pages.py`)

The last step of the build; also `uv run python scripts/lib/build_song_pages.py`.
Reads the written `index.jsonl` and `songs/*.pro` and emits (all gitignored):

- `docs/songs/{song}/index.html` and `.../{version}/index.html`: the app's own
  `docs/index.html` with that song's title, description, canonical and JSON-LD
  swapped in, plus a pre-rendered chart for crawlers. `main.js` routes the
  path so a visitor gets the real app.
- `docs/songs/index.html` (every song A to Z, the page that gives each song a
  referring link), `docs/404.html` (a copy of `index.html`; Pages serves it for
  archived songs and the app routes it), `docs/sitemap.xml`.
- The template is filled by exact-string landmarks (`_fill`, `HOME_HEAD`, a
  regex that needs the description right after the `<title>`). Editing those
  lines in `docs/index.html` fails the build on purpose.
- Sitemap `<lastmod>` is the last git commit date of the song's work or any
  version, never the build date (Google ignores inconsistent lastmod).
  `git_dates()` needs full history; the deploy job checks out with
  `fetch-depth: 0`. On a shallow clone the sitemap is undated rather than wrong.

### Songs, versions and URLs (`apply_songs`)

`build_works_index.apply_songs()` (after `apply_curation`) turns work.yaml
`song:` / `version:` / `slug:` into each row's `path` and version group
(`group_id: song:{root}`, `canonical` on a root with versions, `variant_of`
on each version). This replaces the fuzzy title groups for the Arrangement pill
and "N versions" badge, because `fuzzy_group_songs` is a similarity heuristic
(see "Version grouping"), not evidence that two works are one song. `seed_songs.py` stamped the fields once;
re-running it on seeded works is unsupported, so fix a song in its work.yaml.

- Merge redirects must stay merged: `works_writer.redirect_violations` runs in
  every build and fails on a redirect source that still has a `works/` dir, a
  chained redirect, or a dangling target. Importers writing straight into
  `works/` once re-created 79 merged works, and openWork then followed the
  redirect and hid their edits.
- `merge_works.py` drops a source's lead sheet when the target already has one.
  Prefer making two works versions of one song over merging them.

### Tablature arrangements

A work can hold several tabs of one instrument. Each `tablature_parts` entry
has `instrument`, `file`, `tracks`, `default` and optional `label`,
`difficulty`, `tuning`, `source_id`, `author`.

- `file` is `data/tabs/{work}-{instrument}-{source_id}.otf.json` (no
  `source_id`: `-p{position}`). Instrument alone is not unique.
- Exactly one `default: true` per instrument per work: the `tab_pins:` entry
  in `curation/registry.yaml` if any, else the first part for that instrument
  in work.yaml (`curation.apply_tab_defaults()`).
  Set one with `./scripts/utility curate pin-tab <work-id> <instrument> <source_id>`.
- Inside `works/` the first arrangement is `{instrument}.otf.json`; alternates
  are `{instrument}-{source_id}.otf.json`. The tab copy step in `build_works_index.py`
  deletes `docs/data/tabs/*.otf.json` files no longer published, but only names
  matching `{work}-{instrument}[-{id}].otf.json`, so hand-placed `*_tef`
  fixtures survive. The separate copy into `docs/data/docs/` never prunes.
- `work_schema.validate_work` requires `(instrument, provenance.source_id)` to
  be unique within a work and part filenames not to repeat.
- A work's `source` is, in order: `x_source` in the lead sheet, the lead-sheet
  part's provenance, then the tab part's provenance.

### Version grouping and Strum Machine

- `compute_group_id` makes `group_id` from a normalized title (lowercase, no
  accents, no parenthetical suffix, no leading article) plus a hash of the first
  200 chars of lyrics. `fuzzy_group_songs` then merges groups whose titles are
  at least 85% similar (`difflib.SequenceMatcher`) and whose lyrics are 70%
  similar (50% when chord overlap is 80%+). `apply_songs` overrides these
  groups for display.
- Strum Machine matching reads `strum_machine_cache.json` only: exact
  normalized title, then without articles, then cache keys without articles.

### Editorial curation (`curation.py`, `curate.py`)

`curation/registry.yaml` holds canonical pins (+ variant labels),
suppressions (unioned with `deleted_songs.json`), `keep:` rescues and
`tab_pins:`. `filter_suppressed()` and `apply_curation()` apply it at build
time; importers call `is_suppressed()` so suppressed works are not re-created.

```bash
./scripts/utility curate report                # groups without a canonical pin
./scripts/utility curate pin <canonical-id> [variant-id ...] [--label LABEL]
./scripts/utility curate suppress <work-id> --reason "..."
./scripts/utility curate pin-tab <work-id> <instrument> <source_id>
```

Suppression is two questions. Use the right one:

- `is_suppressed()` is the mint guard: the exact id plus the collision-suffix
  base, so a suppressed `foo` cannot come back as `foo-1`. Only `create_work`
  asks it.
- `is_suppressed_exact()` is the write guard for a work that already exists
  (`add_part`, `update_part`, `update_metadata`, `fork_to_arrangement`, via
  `Guards.blocked_existing`). It matches what `filter_suppressed()` does: if the
  build still publishes a work, you may add to it. Using the mint guard here
  once refused a real user's tab on `dark-hollow-1` (unrelated to the deleted
  `dark-hollow`) every hour, because the failed row was re-dispatched.

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

OTF files are serialized by `scripts/lib/otf_format.py` (JS twin
`docs/js/otf-format.js`, same bytes). A tab row's replay marker is
`tab_marker` (a sha of the document's value, not of the file text), so a layout
change can't re-apply a row; `already_applied` also accepts `legacy_tab_marker`,
the pre-G15b `indent=2` sha. `reformat_otf.py` rewrites the tracked `.otf.json`
files into the layout.

## Metadata parsing

The build accepts both `{meta: title Song Name}` and `{title: Song Name}`
(also `artist`, and so on) and normalizes them.
