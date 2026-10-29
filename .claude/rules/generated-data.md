---
paths:
  - "docs/data/**"
  - "docs/songs/**"
  - "scripts/lib/build_*.py"
  - ".gitignore"
---

# Generated data: what git tracks

If a build produces it, git doesn't track it. `git status` should only show
human edits, so committing everything dirty is always right.

| Tier | Where | Tracked | If lost |
|------|-------|---------|---------|
| Acquisition cache | `sources/*/raw/`, `downloads/` | mostly no (per-source `.gitignore`) | re-scrape |
| Primary artifacts | `sources/*/parsed/`, Hangout `downloads/*.tef` | yes | costly: the parsers are frozen |
| Authoritative | `works/*/work.yaml` + parts | yes | unrecoverable (hand-edited) |
| Generated | `docs/data/index.jsonl`, `archive.jsonl`, `songs/`, `tabs/*.otf.json`, `charts/`; `docs/songs/` | no | `./scripts/bootstrap --quick` |

Every deploy rebuilds the generated tier (`build.yml` runs
`build_works_index.py`, then uploads `docs/`). List the workflows that rebuild
it with `grep -ln build_works_index .github/workflows/*`.

Three things under `docs/data/` stay tracked on purpose:

- **`docs/data/tabs/*_tef.otf.json`**: six hand-placed OTF test fixtures. The
  orphan prune spares the `*_tef` name, and
  `docs/js/__tests__/otf-editor/facade-27493.test.js` reads one. Give a new
  fixture the same suffix.
- **`docs/data/docs/`** (published PDFs): one has no source in `works/`, and
  the copy step never prunes, so git is the only copy.
- **Caches in `docs/data/*.json`** (`artist_tags`, `llm_tags`, `tag_overrides`,
  `strum_machine_cache`, `deleted_songs`, `grassiness_scores`, …): CI reads
  them as inputs because it can't rebuild them. See "Local vs CI Operations" in
  `scripts/lib/CLAUDE.md`.

To see what an import did to the published corpus, rebuild and inspect
locally (or check production): the git diff won't show it.

To re-verify the split: copy `docs/data/`, delete `songs/ tabs/ index.jsonl
archive.jsonl`, run `./scripts/bootstrap --quick`, and diff against the copy.
