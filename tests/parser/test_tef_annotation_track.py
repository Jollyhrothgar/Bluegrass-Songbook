"""Every annotation records its track (G21a, OTF 1.3).

A .tef anchors each text to a string row counted across ALL tracks (banjo 0-4,
guitar 5-10, ...); the importer turns the row into the owning track's id, through
the mapping chord diagrams use (``_diagram_track_index``). Corpus files carry
the proof: Foggy Mountain Breakdown 1481 is V2 with four tracks, Cumberland Gap
24908 is V3 with three.

JS counterpart: docs/js/__tests__/tef-import-annotation-track.test.js
"""

import sys
from collections import Counter
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
import otf_schema  # noqa: E402

FMB = REPO_ROOT / "sources/flatpicker-hangout/downloads/1481_tef_foggy_mountain_breakdown___banjo_and_guitar_duel.tef"
CUMBERLAND = REPO_ROOT / "sources/banjo-hangout/downloads/24908_tef_cumberland_gap___reno.tef"


def convert(path):
    tef = TEFReader(str(path)).parse()
    return tef, tef_to_otf(tef).to_dict()


def owner(instruments, row):
    """The index of the instrument whose strings hold cumulative ``row``."""
    for index, instrument in enumerate(instruments):
        if row < instrument.num_strings:
            return index
        row -= instrument.num_strings
    return None


@pytest.mark.parametrize("path", [FMB, CUMBERLAND], ids=lambda p: p.name.split("_")[0])
def test_each_text_gets_the_track_its_string_row_is_on(path):
    tef, otf = convert(path)
    ids = [t["id"] for t in otf["tracks"]]
    assert len(otf["annotations"]) == len(tef.text_events) > 0
    for text, a in zip(tef.text_events, otf["annotations"]):
        assert a["text"] == text.text
        assert a["track"] == ids[owner(tef.instruments, text.string_row)]
    assert otf_schema.check(otf) == ([], [])


def test_foggy_mountain_breakdown_v2_four_tracks():
    tef, otf = convert(FMB)
    assert tef.header.is_v2
    assert [t["id"] for t in otf["tracks"]] == ["banjo", "guitar", "guitar-2", "bass"]
    assert Counter(a["track"] for a in otf["annotations"]) == {
        "banjo": 545, "guitar": 208, "guitar-2": 113, "bass": 111}
    # Measure 2, tick 0: six texts, four tracks (the pile-up G21 is about).
    at_start = {(a["text"], a["track"]) for a in otf["annotations"]
                if a["measure"] == 2 and a["tick"] == 0}
    assert at_start == {
        ("G", "banjo"), ("m", "banjo"), ("G: Lead Guitar...", "guitar"),
        ("Blank for now...", "guitar"), ("G: Rhythm Guitar...", "guitar-2"),
        ("G: Bass...", "bass")}


def test_cumberland_gap_v3_three_tracks():
    tef, otf = convert(CUMBERLAND)
    assert not tef.header.is_v2
    assert [t["id"] for t in otf["tracks"]] == ["banjo", "bass", "mandolin"]
    # Rows 0-4 are the banjo's five strings; bass is 5-8, mandolin 9-12.
    assert {a["track"] for a in otf["annotations"]} == {"banjo"}
    assert Counter(a["text"] for a in otf["annotations"]) == {"G": 24, "D": 8}


def test_a_row_past_every_track_leaves_the_text_trackless():
    tef, _ = convert(CUMBERLAND)
    tef.text_events[0].string_row = 99
    otf = tef_to_otf(tef).to_dict()
    assert "track" not in otf["annotations"][0]
    assert otf["annotations"][1]["track"] == "banjo"
    assert otf_schema.check(otf) == ([], [])


def test_the_key_order_is_text_then_track():
    _, otf = convert(CUMBERLAND)
    assert list(otf["annotations"][0]) == ["measure", "tick", "text", "track"]
    assert otf["otf_version"] == "1.3"


# ----------------------------------------------------------- place (above / below)
#
# TablEdit stores a text's side as a placement value: V3 text record (0x39) byte
# 11; V2 text record byte 4 bits 5-6. 0 above, 1 below the staff, 2 above (prints
# like 0), 3 on the staff near its string. OTF keeps only `place: "below"` (value
# 1); everything else draws above, so `place` is absent. Checked against
# TablEdit's own printouts and its own V2 -> V3 conversions.

BRILLIANCY_V2 = REPO_ROOT / "sources/banjo-hangout/downloads/11655_tef_brilliancy.tef"
BRILLIANCY_V3 = Path(__file__).parent / "fixtures" / "brilliancy_11655_tabledit_v3.tef"      # TablEdit's own conversion
TEMPERANCE = REPO_ROOT / "sources/banjo-hangout/downloads/21627_tef_temperance_reel.tef"
TEMPERANCE_2 = REPO_ROOT / "sources/banjo-hangout/downloads/28162_tef_temperance_reel.tef"


@pytest.mark.parametrize("path", [BRILLIANCY_V2, BRILLIANCY_V3], ids=["v2", "tabledit-v3"])
def test_brilliancy_part_labels_are_below(path):
    _, otf = convert(path)
    below = [a for a in otf["annotations"] if a.get("place") == "below"]
    assert [a["text"].split()[0] for a in below] == ["Part"] * 3
    assert all(a.get("place") in (None, "below") for a in otf["annotations"])      # never "above"
    assert otf_schema.check(otf) == ([], [])


def test_both_generations_agree_on_brilliancy():
    place = lambda p: [(a["measure"], a["text"], a.get("place")) for a in convert(p)[1]["annotations"]]
    assert place(BRILLIANCY_V2) == place(BRILLIANCY_V3)


def test_foggy_mountain_breakdown_fingering_letters_are_below():
    _, otf = convert(FMB)
    below = [a for a in otf["annotations"] if a.get("place") == "below"]
    assert len(below) == 426
    assert {a["text"] for a in below} == {"m", "i"}
    assert {a["track"] for a in below} == {"banjo"}


@pytest.mark.parametrize("path, below, total", [(TEMPERANCE, 16, 64), (TEMPERANCE_2, 114, 159)],
                         ids=["21627", "28162"])
def test_temperance_reel_v3_texts_below(path, below, total):
    """V3 byte 11, counted in two V3 corpus files."""
    _, otf = convert(path)
    assert len(otf["annotations"]) == total
    assert sum(a.get("place") == "below" for a in otf["annotations"]) == below


def test_placement_two_and_three_are_not_kept():
    tef, _ = convert(CUMBERLAND)
    for value in (0, 2, 3):
        tef.text_events[0].placement = value
        assert "place" not in tef_to_otf(tef).to_dict()["annotations"][0]
    tef.text_events[0].placement = 1
    assert tef_to_otf(tef).to_dict()["annotations"][0]["place"] == "below"
    assert list(tef_to_otf(tef).to_dict()["annotations"][0]) == ["measure", "tick", "text", "track", "place"]
