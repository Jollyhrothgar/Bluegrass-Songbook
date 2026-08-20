# Tests (Python)

pytest test suite for the build pipeline, parser, and work schema.

## Running

```bash
uv run pytest          # Run all tests (verbose by default)
uv run pytest -x       # Stop on first failure
```

## Configuration

Defined in `pyproject.toml`:
- Test directory: `tests/`
- File pattern: `test_*.py`
- Default flags: `-v` (verbose)

## Test Files

**This table is a partial map, not an inventory** — the suite is ~38 files and
grows. List the current set with:

```bash
find tests -name 'test_*.py' | sort
```

A few landmarks:

| File | Tests |
|------|-------|
| `parser/test_detector.py` | HTML structure detection (pre_plain vs pre_tag formats) |
| `parser/test_integration.py` | Full parsing pipeline: HTML → ChordPro |
| `parser/test_tef_*.py` | TEF→OTF parsing: durations, ties, triplets, articulations, time signatures, anacrusis, … |
| `test_add_placeholder.py` | CLI placeholder work creation |
| `test_work_schema.py` | Work YAML round-trip serialization |
| `test_grouping.py` | Song grouping/deduplication (simplify_chord, compute_group_id, fuzzy_group_songs) |
| `test_process_pending.py` / `test_works_writer.py` | The live contribution path (pending_songs → works/) |
| `test_dedup_scorer.py` | Per-submission duplicate check (fixtures in `tests/fixtures/dedup/`) |
| `test_curation.py` / `test_index_outputs.py` | Curation registry and the split index/archive/.pro outputs |
| `test_workflow_deploy_triggers.py` | Every workflow that pushes is listed in `build.yml`'s `workflow_run` |

## Fixtures

Defined in `conftest.py`:
- `fixtures_path` - Points to test fixtures directory
- `sample_html_pre_plain` - Sample HTML with plain pre blocks
- `sample_html_pre_tag` - Sample HTML with tagged pre blocks

## See Also

- Frontend unit tests: `docs/js/__tests__/` (Vitest, run with `npm test`)
- E2E tests: `e2e/` (Playwright, run with `npm run test:e2e`)
