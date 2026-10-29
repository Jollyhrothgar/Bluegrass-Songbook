# The works build (`build_works_index.py`)

Reference for changing what the build writes. The pipeline overview, local vs
CI operations and the secrets rules are in `scripts/lib/CLAUDE.md`.

```bash
uv run python scripts/lib/build_works_index.py            # full build
uv run python scripts/lib/build_works_index.py --no-tags  # skip tag enrichment
```

## Outputs

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
- `search_index.py` must match the site's search; the rule loads from
  `.claude/rules/search.md` when you touch either side.
- `./scripts/server` gzips like GitHub Pages, so local load times are
  realistic.

## Forked lead sheets (`arrangements`)

`works_writer.fork_to_arrangement` adds an edit of someone else's chart as an
additional lead-sheet part (`lead-sheet-<label>.pro`, `default: false`,
`x_version_*` set). The build publishes it as `songs/{id}--{slug}.pro` (the
`--` cannot collide with a work id, because `slugify` collapses dash runs) and
lists every take in the row's `arrangements`, present only when a work has
more than one lead sheet. The primary lead sheet still owns `content`,
`lyrics`, `chords`, `key` and search; a fork never adds a search hit. The slug
comes from the part's filename, so it is stable across label edits. The
Arrangement pill (`docs/js/work-view.js`) reads it.

## Static song pages and sitemap (`build_song_pages.py`)

The last step of the build; also `uv run python scripts/lib/build_song_pages.py`.
Reads the written `index.jsonl` and `songs/*.pro` and emits (all gitignored):

- `docs/songs/{song}/index.html` and `.../{version}/index.html`: the app's own
  `docs/index.html` with that song's title, description, canonical and JSON-LD
  swapped in, plus a pre-rendered chart for crawlers. `main.js` routes the
  path so a visitor gets the real app.
- `docs/songs/index.html` (every song A to Z, the page that gives each song a
  referring link), `docs/404.html` (a copy of `index.html`; Pages serves it for
  archived songs and the app routes it), `docs/sitemap.xml`.
- `docs/tab-editor/index.html` (G15c): the same template with the tab editor
  front door's title, description, canonical and a pre-rendered
  `<article class="prerender">` in `#results` (`render_tab_editor_page`). The app
  replaces the article with `docs/js/tab-editor-home.js`; the heading and the
  privacy line must read the same in both (a pytest reads the JS for them). Its
  sitemap `<lastmod>` is the newer of `docs/index.html` and this script, since
  no commit touches a generated file.
- The template is filled by exact-string landmarks (`_fill`, `HOME_HEAD`, a
  regex that needs the description right after the `<title>`). Editing those
  lines in `docs/index.html` fails the build on purpose.
- Sitemap `<lastmod>` is the last git commit date of the song's work or any
  version, never the build date (Google ignores inconsistent lastmod).
  `git_dates()` needs full history; the deploy job checks out with
  `fetch-depth: 0`. On a shallow clone the sitemap is undated rather than wrong.

## Songs, versions and URLs (`apply_songs`)

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

## Tablature arrangements

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

## Version grouping and Strum Machine

- `compute_group_id` makes `group_id` from a normalized title (lowercase, no
  accents, no parenthetical suffix, no leading article) plus a hash of the first
  200 chars of lyrics. `fuzzy_group_songs` then merges groups whose titles are
  at least 85% similar (`difflib.SequenceMatcher`) and whose lyrics are 70%
  similar (50% when chord overlap is 80%+). `apply_songs` overrides these
  groups for display.
- Strum Machine matching reads `strum_machine_cache.json` only: exact
  normalized title, then without articles, then cache keys without articles.

## Editorial curation (`curation.py`, `curate.py`)

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

## Metadata parsing

The build accepts both `{meta: title Song Name}` and `{title: Song Name}`
(also `artist`, and so on) and normalizes them.
