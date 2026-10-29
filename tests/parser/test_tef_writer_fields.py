"""What the .tef writer (G15f, docs/js/tef-export/) relies on the readers for:
the V3 title at header pointer 64 and the "Tab by:" credit line in the comments.

The fixture was written by the JS writer from a small OTF document (its
expected OTF is what the JS importer reads back). Python is the reference
importer, so it must read the same title and credit.

JS counterpart: docs/js/__tests__/tef-export-features.test.js
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.otf import tab_by_from_comments  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
FIXTURE = FIXTURES / "writer_v3_title_and_credit.tef"


def test_python_reads_the_title_and_credit_the_writer_wrote():
    doc = tef_to_otf(TEFReader(str(FIXTURE)).parse()).to_dict()
    expected = json.loads(FIXTURE.with_suffix(".expected.otf.json").read_text())
    # "Part" in the title is why the old first-printable-string rule skipped it
    assert doc["metadata"]["title"] == "The Parting Glass"
    assert doc["metadata"]["tab_by"] == {"name": "Jess Picker", "url": "https://example.com/jess"}
    assert doc["metadata"] == expected["metadata"]


def test_tab_by_line_forms():
    assert tab_by_from_comments("Tab by: Jess") == {"name": "Jess"}
    assert tab_by_from_comments("TablEdited by Bill\r\nTab by: Jess <https://x.org/j>\r\n") == {
        "name": "Jess", "url": "https://x.org/j"}
    # Without the colon it is ordinary comment text (28 corpus files say "Tab by David Johnson")
    assert tab_by_from_comments("Tab by David Johnson") is None
    assert tab_by_from_comments("Tab by: " + "x" * 101) is None
    assert tab_by_from_comments("") is None
