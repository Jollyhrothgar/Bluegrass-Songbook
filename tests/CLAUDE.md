# Tests (Python)

pytest suite for the build pipeline, parsers and work schema. Config is in `pyproject.toml`
(`testpaths = ["tests"]`, files `test_*.py`).

```bash
uv run pytest                              # all tests
uv run pytest -x                           # stop on first failure
uv run pytest tests/test_curation.py -k name   # one file / one test
find tests -name 'test_*.py' | sort        # the current set (about 50 files; don't trust a list here)
```

- `tests/parser/` covers the classic-country HTML parser (`test_detector.py`,
  `test_integration.py`) and the TEF to OTF parser (`test_tef_*.py`). Fixtures for it are in
  `tests/parser/fixtures/`; shared ones are in `tests/fixtures/` (path via the `fixtures_path`
  fixture in `conftest.py`).
- Three tests guard wiring that fails silently elsewhere. Do not delete them to make CI pass:
  - `test_workflow_deploy_triggers.py`: every workflow that pushes to `main` must be listed in
    `build.yml`'s `workflow_run` trigger, or its commits never deploy.
  - `test_e2e_specs_use_fixtures.py`: every Playwright spec imports `test` from
    `e2e/fixtures.js`, the backstop that mocks Supabase so specs cannot hit production.
  - `test_ci_concurrency.py`: only `build.yml`'s deploy job is in the `pages` concurrency group;
    each PR has its own, or PR checks cancel each other and wait behind deploys.
- The live contribution path (pending_songs to `works/`) is `test_process_pending.py` and
  `test_works_writer.py`. `tests/test_dedup_scorer.py` (the duplicate-submission scorer) uses `tests/fixtures/dedup/` and
  must stay in step with the JS mirror `docs/js/dedup-check.js`.

Frontend unit tests are in `docs/js/__tests__/` (`npm test`, which exits;
`npm run test:watch` does not). E2E tests are in `e2e/` (`npm run test:e2e`; Playwright starts its own server on port 8137).
