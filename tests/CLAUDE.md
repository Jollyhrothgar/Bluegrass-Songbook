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

| File | Tests |
|------|-------|
| `parser/test_detector.py` | HTML structure detection (pre_plain vs pre_tag formats) |
| `parser/test_integration.py` | Full parsing pipeline: HTML → ChordPro |
| `test_add_placeholder.py` | CLI placeholder work creation |
| `test_work_schema.py` | Work YAML round-trip serialization |
| `test_grouping.py` | Song grouping/deduplication (simplify_chord, compute_group_id, fuzzy_group_songs) |

## Fixtures

Defined in `conftest.py`:
- `fixtures_path` - Points to test fixtures directory
- `sample_html_pre_plain` - Sample HTML with plain pre blocks
- `sample_html_pre_tag` - Sample HTML with tagged pre blocks

## See Also

- Frontend unit tests: `docs/js/__tests__/` (Vitest, run with `npm test`)
- E2E tests: `e2e/` (Playwright, run with `npm run test:e2e`)
