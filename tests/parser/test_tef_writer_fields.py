"""What the .tef writer (G15f, docs/js/tef-export/) relies on the readers for:
the V3 title at header pointer 64 and the "Tab by:" credit line in the comments.

The fixture was written by the JS writer from a small OTF document (its
expected OTF is what the JS importer reads back). Python is the reference
importer, so it must read the same title and credit.

JS counterpart: docs/js/__tests__/tef-export-features.test.js
"""

import json
import pytest
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


ACCEPTED_TABLEDITED = [
    ("TablEdited by Lee Marcus", "Lee Marcus"),
    ("tabledited BY  James N  Leonard ", "James N Leonard"),
    ("TablEdited by: Stan Slack", "Stan Slack"),
    ("TablEdited by L.Bradshaw", "L.Bradshaw"),
    ("TablEdited by Jean-Pierre Devin", "Jean-Pierre Devin"),
    ("TablEdited by Mike Larsen AKA Lefty5string", "Mike Larsen AKA Lefty5string"),
    ("Arranged & Tabledited by Tom Arri", "Tom Arri"),
    ("Transcribed and TablEdited by Jim Crowley", "Jim Crowley"),
    ("Modified and TablEdited by Robert Fentress", "Robert Fentress"),
    ("TablEdited & Arr. by Martin Blake", "Martin Blake"),
    ("TablEdited and Arranged by Martin Blake", "Martin Blake"),
]
REJECTED_TABLEDITED = [
    "TablEdited by", "Arranged & Tabledited", "TablEdited on 12-7-2013",
    "TablEdited by Tom Arri 2010", "TablEdited by Stan Slack, Jan 2013",
    "TablEdited by Nic Durham: picke_r@hotmail.com", "TablEdited by5stringabuse",
    "Tabledited byToni Ruiz", "TablEdited by Holt&Holt /Yep, Guitars", "TablEdited by \\ Rick Diesel",
    "TablEdited by Greg Crisp (breaks 1 & 2)", "TablEdited by Donald W,Couchie",
    "Arranged and TablEdited for clawhammer banjo by Jan-Olov Sundqvist",
    "Banjo Tuning: aDADE     TablEdited by Ned Banta",
    "Sequenced by  Barry Taylor TablEdited by Patrick P.",
    "TablEdited by " + "Abcdefgh " * 7, "TablEdited by " + "x" * 61,
]


@pytest.mark.parametrize("line,name", ACCEPTED_TABLEDITED)
def test_tabledited_line_is_a_credit(line, name):
    assert tab_by_from_comments(line) == {"name": name}


@pytest.mark.parametrize("line", REJECTED_TABLEDITED)
def test_doubtful_tabledited_line_is_no_credit(line):
    assert tab_by_from_comments(line) is None


def test_tabledited_last_line_wins_and_explicit_credit_beats_it():
    assert tab_by_from_comments("TablEdited by A B\r\nTablEdited by C D") == {"name": "C D"}
    assert tab_by_from_comments("TablEdited by Devon Wells\r\nTab by: Jane Doe") == {"name": "Jane Doe"}
    assert tab_by_from_comments("Tab by: Jane Doe\r\nTablEdited by Devon Wells") == {"name": "Jane Doe"}
