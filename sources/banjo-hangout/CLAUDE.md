# Banjo Hangout and the Hangout network

**The OTF format the converter writes is `docs/schema/otf.schema.json`** (field guide:
`docs/schema/otf.md`). `tef_parser/otf.py` and `docs/js/tef-import/otf.js` own the
`FX_ORDER` / `GRACE_KINDS` / `V3_PLUCK_LETTERS` copies; tests fail if they drift
from the schema's enums. Validate with `scripts/lib/otf_schema.py` (`check(doc)`).

Banjo tablature from banjohangout.org, in TablEdit's TEF binary format. The
code in `src/` also drives four sibling sites (fiddle-, flatpicker-,
mandolin-, reso-hangout); they have no CLAUDE.md of their own, so this file
covers all five. `sources/mandozine/` and `sources/tef-uploads/` reuse the same
TEF parser.

Debugging TEF parsing (format reference, byte inspection, common rendering
bugs): `.claude/skills/tab-debug/SKILL.md`. Drum tracks:
`sources/banjo-hangout/TEF-FORMAT.md`.

## Pipeline commands

Every command except `convert-file` takes `--site` (default `banjo-hangout`; `choices` come from
`SITES` in `src/site_config.py`, the authoritative site list).

```bash
B=sources/banjo-hangout/src
uv run python $B/batch_import.py priorities                       # tier sizes
uv run python $B/batch_import.py scan --priority --max-priority 5 # catalog matching tunes only
uv run python $B/batch_import.py download --limit 50
uv run python $B/batch_import.py convert --limit 50               # TEF -> OTF, writes conversion_log.json
uv run python $B/batch_import.py import --limit 50 [--dry-run] [--no-new-works]
uv run python $B/batch_import.py stats --site mandolin-hangout   # catalog counts by status
uv run python $B/batch_import.py convert-file IN.tef [OUT.json]  # one file, no catalog
./scripts/bootstrap --quick                                       # rebuild index afterwards
```

- Counts drift; `stats` and `priorities` are the source of truth, not this file.
- `scan` without `--priority` crawls the whole listing. Use `--priority`: the
  site has about 9,000 tabs and we only want ones matching tunes we care about.
- Scraping limit: `scraper.py` waits 1.5 s between requests and caches listing
  HTML in `raw/` (gitignored). Keep both.
- `import --no-new-works` only adds arrangements to existing works. Use it for
  arrangement-promotion passes, where minting a work needs title review.

### Priority tiers

`src/priority_list.py` ranks tabs by title (it normalizes "- banjo tab",
"(arr.)" etc.). Tiers 1-20 come from the `TIER N` comments in
`TUNE_LIST` in `sources/tunearch/src/tune_list.py` (used only as a curated
tune list; nothing is imported from tunearch). Tier 25 is works already tagged
Instrumental; tier 30 is any work with no tab for the site's instrument.
`--max-priority N` catalogs only tabs at tier N or better.

## Sites

| Site | base_url | fallback_instrument | Data dir |
|------|----------|---------------------|----------|
| banjo-hangout | banjohangout.org | banjo | `sources/banjo-hangout/` |
| mandolin-hangout | mandohangout.com | mandolin | `sources/mandolin-hangout/` |
| flatpicker-hangout | flatpickerhangout.com | guitar | `sources/flatpicker-hangout/` |
| fiddle-hangout | fiddlehangout.com | fiddle | `sources/fiddle-hangout/` |
| reso-hangout | resohangout.com | dobro | `sources/reso-hangout/` |

- Each site owns its `tab_catalog.json`, `raw/`, `downloads/`, `parsed/` and
  `conversion_log.json`. Tab ids are only unique within a site.
- `downloads/*.tef` are tracked in git (small, and the parsers are frozen);
  `raw/` and `conversion_log.json` are gitignored and exist only after a run.
- Catalog status values: `pending`, `downloaded`, `converted`, `matched`
  (attached to an existing work), `imported` (new work), `skipped` (non-TEF or
  rejected), `error`.

## Import rules that are not obvious from the code

- Instrument comes from the converted OTF's tracks
  (`site_config.resolve_instrument`), not from the site. First melodic track
  wins; a file with 2+ melodic tracks that does not lead with the site's
  instrument is `ensemble`; detection failure falls back to the site's
  instrument. A tenor-banjo tab posted on Banjo Hangout lands as
  `tenor-banjo.otf.json`.
- Known gap: `tef_parser` defaults an instrument-less TEF to a 5-string banjo
  track, so such files import as `banjo` on any site. Fixing it means giving
  `tef_to_otf` a default-instrument argument; deferred because the parser is
  locked by golden tests against the JS port (`docs/js/tef-import/`).
- Strict-instrument gate (`works_importer.py`): on the four sibling sites a
  conversion imports only if the detected instrument is the site's own or
  `ensemble`. Otherwise a dobro tab written as `6-string-guitar` would be filed
  under guitar. Banjo Hangout is exempt because it genuinely hosts tenor-banjo,
  guitar and ensemble arrangements.
- Several arrangements per instrument are allowed. The duplicate check is on
  `source_id`, not instrument. The first arrangement is `{instrument}.otf.json`;
  later ones are `{instrument}-{source_id}.otf.json`. The default shown is
  editorial: `./scripts/utility curate pin-tab <work> <instrument> <source_id>`,
  otherwise the first part in work.yaml.
- "Does this title already have a work?" is `works_importer.find_matching_work`,
  backed by `scripts/lib/dedup_scorer.WorkCorpus`. Tab imports have no lyrics,
  so titles must score at least `TITLE_ONLY_MIN` (0.95). `batch_import` builds
  one `WorkCorpus` per run; do not build one per tab (it rereads every
  work.yaml). `_find_matching_work_legacy` is kept only to log disagreements
  (`[dedup-scorer] match differs...`). Tests: `tests/test_works_importer_dedup.py`.
- `batch_convert.py` duplicates part of `works_importer.py` (its own slugs and
  YAML template, no curation guard). It survives because it alone writes the
  `tef_*` provenance fields and `conversion_log.json`. Prefer
  `works_importer` for new logic.
- Multi-instrument files import as `instrument: ensemble`
  (`ensemble.otf.json`); the frontend shows a track mixer.

## Metadata

- Title: the listing's title, falling back to the TEF's own title when the
  listing has none (TEF titles are often null-padded, file names or bare
  numbers; titles like that are skipped as "Invalid title").
- Author: always the listing's uploader; TEF composer is rarely filled.
- Tags: `map_to_tags` in `src/batch_convert.py` always adds `Instrumental`,
  then maps listing genre and style through `DEFAULT_GENRE_TAG_MAP` and
  `DEFAULT_STYLE_TAG_MAP` in `src/site_config.py` (a site may override).
- Provenance in work.yaml (`source`, `source_id`, `source_url`, `author`,
  optional `difficulty` and `tuning`, `imported_at`). `source_id` is the
  arrangement identity: it keys the published
  `docs/data/tabs/{work}-{instrument}-{source_id}.otf.json` and what
  `curate pin-tab` names.

## Download URLs

TEF files live on `hangoutstorage.com`, not the Hangout site. Two filename
shapes exist and neither number is reliably the tab id:

```
older:  .../storage/tabs/{letter}/{slug}-{attachment_id}.tef
newer:  .../storage/tabs/{letter}/tab-{slug}-{tab_id}-{timestamp}.tef
```

The number in an older-shape name is a per-file attachment id in a different
namespace (tab 10545 ships `arkansas_traveller-426.tef` plus a `.gtp` and
`.mid` with their own attachment ids). So never derive a tab id from a
filename, and never template a download URL: scrape it from the detail page
href. The converter records its id in the OTF's `x_source.source_id`, and
`build_works_index`'s provenance gate compares that with work.yaml's
`provenance.source_id`.

Files in `downloads/` are `{id}.tef` (manual) or `{id}_tef.tef` (scraper).

## Parser notes not covered by the tab-debug skill

- V2 and V3 both parse. Routing follows TablEdit's loaders: byte 205 >= 10
  means V3, and V3 notes start at the u32 at 0x3C. Remaining mismatches with
  TablEdit are listed under fix-it item A13 in
  `docs/plans/2026-09-30-fix-it-list.md`.
- "Empty notation (0 events)" skips are parser failures to investigate, not
  empty files. Inspect with `conversion_log.json` (`status: skipped|error`,
  `error` text) in the site's data dir.
- The Python parser is the oracle for the in-browser JS port. After any
  legitimate parser change, regenerate the golden fixture
  (`docs/js/tef-import/__fixtures__/gen_golden.py`, see the tab-debug skill).
