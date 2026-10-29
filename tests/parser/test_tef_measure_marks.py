"""Repeat signs (G15d4): the V3 0xb7 / V2 0x5e "reading guide" marks.

Each fixture is a frozen copy of a Banjo Hangout / Fiddle Hangout TEF chosen
because it isolates one thing (copied 2026-10-29; ids are the site ids):

  marks_v3_26282   Fire on the Mountain: Red Haired Boy-style 0x81 + 0x0a
                   endings, and a lone 0x08 end bar at m13.
  marks_v3_27159   Cumberland Gap: a plain 0x40 / 0x80 repeat pair.
  marks_v3_25911   Golden Slippers: 5 records fold into 3 entries (0x80 and
                   0x01 in one measure OR into 0x81).
  marks_v2_21612   Wild Horse: the same 0x40 / 0x81 / 0x0a shape in V2.
  marks_v2_21420   a lone 0x08 end bar in V2.
  marks_v2_22933   Soldier's Joy: one of the 7 files whose repeats are ONLY
                   barlines (no stored reading list).
  marks_v2_24144   Huckleberry Hornpipe: 11 records, 9 entries.
  marks_v2_17542   ending 7 ("unspecified"): draws nothing, raw keeps it.

Only cell byte 2 (V3 file byte 6; V2 record byte 4) is read, OR-ed into the
measure holding the record. Spec: issue #318, G15d4.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.otf import decode_mark_raw  # noqa: E402

FIX = Path(__file__).parent / "fixtures"

#: fixture -> (records, [(measure, raw), ...])
EXPECTED = {
    "marks_v3_26282_fire_on_the_mountain.tef":
        (5, [(5, 0x81), (6, 0x0a), (10, 0x81), (11, 0x0a), (13, 0x08)]),
    "marks_v3_27159_cumberland_gap.tef":
        (2, [(1, 0x40), (8, 0x80)]),
    "marks_v3_25911_golden_slippers.tef":
        (5, [(2, 0x40), (9, 0x81), (10, 0x0a)]),
    "marks_v2_21612_wild_horse.tef":
        (3, [(1, 0x40), (8, 0x81), (9, 0x0a)]),
    "marks_v2_21420_lone_end_bar.tef":
        (2, [(1, 0x40), (8, 0x08)]),
    "marks_v2_22933_soldiers_joy.tef":
        (4, [(1, 0x40), (8, 0x80), (9, 0x40), (16, 0x80)]),
    "marks_v2_24144_huckleberry_hornpipe.tef":
        (11, [(1, 0x40), (4, 0x81), (5, 0x02), (6, 0x40), (9, 0x81),
              (10, 0x02), (11, 0x40), (14, 0x81), (15, 0x02)]),
    "marks_v2_17542_unspecified_ending.tef":
        (5, [(1, 0x07), (8, 0x80), (9, 0x40), (16, 0x80), (17, 0x08)]),
}


def _marks(name):
    tef = TEFReader(str(FIX / name)).parse()
    return tef, tef_to_otf(tef).to_dict().get("measure_marks", [])


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_record_lands_in_one_ascending_entry_per_measure(name):
    records, want = EXPECTED[name]
    tef, marks = _marks(name)
    assert tef.mark_records == records
    assert [(m["measure"], m["raw"]) for m in marks] == want
    measures = [m["measure"] for m in marks]
    assert measures == sorted(set(measures))


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_decoded_fields_come_from_the_shared_helper(name):
    _, marks = _marks(name)
    for m in marks:
        assert m == {"measure": m["measure"], **decode_mark_raw(m["raw"]), "raw": m["raw"]}


def test_red_haired_boy_style_endings_v3():
    _, marks = _marks("marks_v3_26282_fire_on_the_mountain.tef")
    by = {m["measure"]: m for m in marks}
    assert by[5] == {"measure": 5, "repeat_end": True, "ending": 1, "raw": 0x81}
    # 0x0a is "2." AND an end bar (Red Haired Boy's second endings close the part)
    assert by[6] == {"measure": 6, "ending": 2, "end_bar": True, "raw": 0x0a}


def test_red_haired_boy_style_endings_v2():
    _, marks = _marks("marks_v2_21612_wild_horse.tef")
    assert marks[1] == {"measure": 8, "repeat_end": True, "ending": 1, "raw": 0x81}
    assert marks[2] == {"measure": 9, "ending": 2, "end_bar": True, "raw": 0x0a}


@pytest.mark.parametrize("name,measure", [
    ("marks_v3_26282_fire_on_the_mountain.tef", 13),
    ("marks_v2_21420_lone_end_bar.tef", 8),
])
def test_lone_end_bar(name, measure):
    _, marks = _marks(name)
    assert {"measure": measure, "end_bar": True, "raw": 0x08} in marks


@pytest.mark.parametrize("name", [
    "marks_v3_27159_cumberland_gap.tef", "marks_v2_22933_soldiers_joy.tef"])
def test_repeat_start_and_end_pair(name):
    _, marks = _marks(name)
    assert marks[0] == {"measure": 1, "repeat_start": True, "raw": 0x40}
    assert marks[1]["repeat_end"] is True and marks[1]["raw"] == 0x80
    assert "ending" not in marks[1]


def test_records_in_one_measure_are_ored():
    # Golden Slippers m9: a 0x80 and a 0x01 record -> one 0x81 entry
    tef, marks = _marks("marks_v3_25911_golden_slippers.tef")
    assert tef.mark_records == 5 and len(marks) == 3
    assert marks[1] == {"measure": 9, "repeat_end": True, "ending": 1, "raw": 0x81}
    # Huckleberry Hornpipe: 11 records, 9 entries
    tef, marks = _marks("marks_v2_24144_huckleberry_hornpipe.tef")
    assert tef.mark_records == 11 and len(marks) == 9


def test_unspecified_ending_keeps_raw_and_models_nothing():
    _, marks = _marks("marks_v2_17542_unspecified_ending.tef")
    assert marks[0] == {"measure": 1, "raw": 0x07}


def test_marks_only_file_has_no_reading_list():
    tef = TEFReader(str(FIX / "marks_v2_22933_soldiers_joy.tef")).parse()
    d = tef_to_otf(tef).to_dict()
    assert "reading_list" not in d and d["measure_marks"]


def test_a_file_without_marks_has_no_measure_marks_key():
    d = tef_to_otf(TEFReader(str(FIX / "21802_fingering_annotations.tef")).parse()).to_dict()
    assert "measure_marks" not in d


# --- corpus sweep: smoke test against an independent loader -----------------

def _corpus():
    import glob
    root = str(REPO_ROOT)
    return sorted(glob.glob(root + "/sources/*/downloads/*.tef")
                  + glob.glob(root + "/sources/mandozine/tefs/*.tef"))


def test_corpus_every_mark_record_is_kept():
    """Every 0xb7 / 0x5e record in the corpus lands in measure_marks.

    The spike's loader (spike/tabledit_export/rea-2026-10-28/tefmarks.py) is
    the independent count: OR-ing its flag bytes per measure must give the
    same (measure, raw) list the importer produces.
    """
    files = _corpus()
    if len(files) < 100:
        pytest.skip("corpus downloads absent")
    sys.path.insert(0, str(REPO_ROOT / "spike" / "tabledit_export" / "rea-2026-10-28"))
    import tefmarks  # noqa: E402

    total_records = total_entries = 0
    for f in files:
        flags = {}
        records = 0
        t3 = tefmarks.load_v3(f)
        if t3 and t3["nm"]:
            for pos, _row, cb in t3["cells"]:
                if cb[0] == 0xb7:
                    m = tefmarks.measure_of(t3["starts"], pos)
                    flags[m] = flags.get(m, 0) | cb[2]
                    records += 1
        else:
            t2 = tefmarks.load_v2(f)
            if t2 and t2["stride"] == 6:
                for m, _w, _r, rec in t2["cells"]:
                    if rec[2] == 0x5e:
                        flags[m] = flags.get(m, 0) | rec[4]
                        records += 1
        d = tef_to_otf(TEFReader(f).parse()).to_dict()
        got = [(m["measure"] - 1, m["raw"]) for m in d.get("measure_marks", [])]
        assert got == sorted(flags.items()), f
        total_records += records
        total_entries += len(got)
    assert total_records > 500 and total_entries <= total_records
