---
paths:
  - "works/**"
  - "curation/**"
  - "scripts/lib/works_writer.py"
  - "scripts/lib/work_schema.py"
  - "scripts/lib/seed_songs.py"
  - "scripts/lib/curate.py"
---

# works/: the song store

`works/` has been authoritative since 2026-07-31. Each work is a directory
with a `work.yaml` and its parts. Fix metadata (title, artist, composers,
tags) directly in `work.yaml`: nothing regenerates works from `sources/`, so
the edit sticks. Importers may add works and parts but must never overwrite an
existing work's metadata. Write through `scripts/lib/works_writer.py`, which
refuses suppressed ids and existing works.

```yaml
# works/blue-moon-of-kentucky-1/work.yaml (trimmed)
id: blue-moon-of-kentucky-1
title: Blue Moon Of Kentucky
slug: blue-moon-of-kentucky      # song root only: its URL name when the id would mislead
artist: Bill Monroe              # scraped performer; see below
composers: [Bill Monroe]         # authorship
default_key: G
parts:
- type: lead-sheet
  format: chordpro
  file: lead-sheet.pro
  default: true
  provenance: {source: trusted-user, imported_at: '2026-02-01'}
```

- **`artist` is a scrape artifact.** Sources took it from whatever performer
  page a chart was found on, so it is stored and searchable but never shown as
  the song's artist (fix-it item F9). Authorship lives in `composers`; the
  index's `composer` comes only from there.
- **Songs and versions.** A work is its own song unless it has
  `song: <root work id>` (it is a version of that song) and `version: '<name>'`
  (its URL: `/songs/<song>/<version>/`). `scripts/lib/seed_songs.py` seeded
  these once on evidence only (matching lyrics, curation pins, merge
  redirects). Name a version for what it provably is (`2`, `banjo-tab`),
  never for the scraped `artist`. Fix one by editing its `work.yaml`.
- **Work ids are permanent data keys** (lists, votes, pending edits), even when
  the URL uses `slug`.
- **Part types:** `lead-sheet`, `tablature`, `chord-chart` (format `chart`,
  `chord-chart.yaml`; at most one, song roots only; `scripts/lib/chord_chart.py`),
  and one legacy `document`.
  **Formats:** `chordpro`, `otf` (the key is literally `otf`), `chart`, and one
  legacy `pdf`. ABC is not a part type: it lives inside a lead sheet as a
  `{start_of_abc}` block, which the index exposes as `has_abc`. Recount with
  `grep -rhoE '^\s*(- )?type: [a-z-]+' works/*/work.yaml | awk '{print $NF}' | sort | uniq -c`
  (swap `type` for `format`). On 2026-10-28: 19,150 lead sheets, 493 tabs.
- **Provenance** is `parts[].provenance` (`source`, `source_id`,
  `source_file`): it ties the built index back to `sources/`.
- **Archived is not deleted.** Works off the searchable index still resolve by
  URL. `./scripts/utility curate unprune <id>` restores one ("Index Prune" in
  `scripts/lib/CLAUDE.md`). Canonical/variant pins and suppressions live in
  `curation/registry.yaml`.
- **Add a song** from a `.pro` file with `./scripts/utility add-song FILE.pro`
  (reads its `{meta: ...}` directives; a taken id is an error unless
  `--on-collision suffix`), or create `works/<slug>/` by hand and run
  `./scripts/bootstrap --quick`.
