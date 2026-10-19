# TablEdit export harness

These scripts run TablEdit's own MusicXML exporter over the whole TEF corpus,
then compare its output with our parser. Results are in fix-it A14/A15 and
`docs/plans/2026-10-18-tef-feature-survey.md`.

| Script | Does |
|---|---|
| `export_corpus.py [OUT]` | Exports every corpus `.tef` through TablEdit, with every module included (`patch_modes.py`), using accessibility actions only (`ax_export.sh`). Writes `OUT/xml` and our `OUT/otf`. `--otf-only` re-runs just the parser. |
| `compare_corpus.py [OUT]` | Compares every file note for note and writes `OUT/compare.json`. |
| `feature_census.py [OUT]` | Counts each TablEdit feature at the byte level and joins it to TablEdit's export and our OTF. Writes `OUT/census.json`. |

`OUT` defaults to `out/`, which is gitignored. It holds about 200 MB of exports.
