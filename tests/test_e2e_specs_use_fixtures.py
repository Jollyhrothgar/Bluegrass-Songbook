"""Every Playwright spec must import `test` from e2e/fixtures.js.

That fixture installs the Supabase mock on every browser context, so no test
can reach the production project that docs/js/supabase-auth.js hard-codes.
Until 2026-10-27, 35 of the 40 specs imported @playwright/test directly and
talked to production: every test starts with empty localStorage, so each page
load was a new row in `visitors`, and a full run added ~500 "visitors" to the
home page counter (E2E bursts peaked at ~300 a minute).

A spec importing `test` from @playwright/test bypasses the backstop silently;
this makes it a red CI run instead.
"""

import re
from pathlib import Path

import pytest

E2E_DIR = Path(__file__).parent.parent / 'e2e'
SPECS = sorted(E2E_DIR.glob('*.spec.js'))

PLAYWRIGHT_TEST_IMPORT = re.compile(
    r"import\s*\{([^}]*)\}\s*from\s*['\"]@playwright/test['\"]")


def test_specs_exist():
    assert SPECS, f'no specs found in {E2E_DIR}'


@pytest.mark.parametrize('spec', SPECS, ids=lambda p: p.name)
def test_spec_imports_test_from_fixtures(spec):
    source = spec.read_text()
    for names in PLAYWRIGHT_TEST_IMPORT.findall(source):
        imported = {n.strip().split(' as ')[0] for n in names.split(',')}
        assert 'test' not in imported, (
            f"{spec.name} imports `test` from @playwright/test; import it from "
            f"'./fixtures.js' so the Supabase mock backstop is installed")
    assert re.search(r"from\s*['\"]\./fixtures\.js['\"]", source), (
        f"{spec.name} does not import from './fixtures.js'")
