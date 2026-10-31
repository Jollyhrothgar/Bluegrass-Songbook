"""parse_tab_chord against the table shared with docs/js/__tests__/tab-chord.test.js."""
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

from tab_chord import parse_tab_chord  # noqa: E402

CASES = json.loads(
    (REPO_ROOT / "tests" / "fixtures" / "tab-chord" / "tab-chords.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=[repr(c["text"]) for c in CASES])
def test_parse_tab_chord(case):
    assert parse_tab_chord(case["text"]) == case["parts"]


def test_non_strings():
    assert parse_tab_chord(None) is None
    assert parse_tab_chord(7) is None
