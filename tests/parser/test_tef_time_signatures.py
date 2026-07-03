"""Mid-tune time-signature changes (V2 component type 27).

TEF V2 encodes a per-measure time-signature override as a component with
(byte2 & 0x1f) == 27 (TuxGuitar TEInputStream.readComponents()):

  denominator = 2 ** (byte2 >> 5) / 2, falling back to the header
                denominator when the top bits are 0 (TablEdit sometimes
                leaves them unset; TuxGuitar's formula yields 0/0 there)
  measure grid length = ts_size - 4 * byte3   (ts_size = 256*num/den)
  numerator = grid_length * denominator / 256

Notes inside the changed measure are stored RIGHT-ALIGNED in the fixed
header-ts grid slot: their positions carry an offset of tsMove = 4 * byte3
which must be subtracted (TuxGuitar's tsMove). The override applies only
to its own measure — there is no revert marker (TablEdit's MusicXML export
makes the reversion explicit, the TEF file does not).

Ground truths (from TablEdit's own MusicXML export of wheel_hoss and byte
inspection of 23602/21874):
- wheel_hoss (header 4/4): 2/4 measures at 17/36/60/70; m17 guitar notes
  at ticks 0 and 480, m36 guitar at 0/240/480/720.
- 23602 (header 2/4!): a single 1/4 measure at m26 (d3=16, grid 64).
- 21874: a no-op explicit 4/4 marker on every measure -> no changes at all.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"

WHEEL_HOSS = FIXTURES / "wheel_hoss_2430_packed_tracks.tef"


def notes_at(otf: dict, track: str, measure: int) -> list[tuple[int, int, int]]:
    """(tick, string, fret) triples for one measure of one track."""
    out = []
    for m in otf["notation"][track]:
        if m["measure"] == measure:
            for ev in m["events"]:
                for n in ev["notes"]:
                    out.append((ev["tick"], n["s"], n["f"]))
    return sorted(out)


@pytest.fixture(scope="module")
def wheel_hoss():
    return TEFReader(str(WHEEL_HOSS)).parse()


@pytest.fixture(scope="module")
def wheel_hoss_otf(wheel_hoss):
    return tef_to_otf(wheel_hoss).to_dict()


def test_ts_changes_detected(wheel_hoss):
    changes = [(c.measure, c.numerator, c.denominator)
               for c in wheel_hoss.time_signature_changes]
    assert changes == [(17, 2, 4), (36, 2, 4), (60, 2, 4), (70, 2, 4)]


def test_ts_changes_in_otf_metadata(wheel_hoss_otf):
    assert wheel_hoss_otf["metadata"]["time_signature"] == "4/4"
    assert wheel_hoss_otf["metadata"]["time_signature_changes"] == [
        {"measure": 17, "time_signature": "2/4"},
        {"measure": 36, "time_signature": "2/4"},
        {"measure": 60, "time_signature": "2/4"},
        {"measure": 70, "time_signature": "2/4"},
    ]


def test_short_measure_notes_left_aligned(wheel_hoss_otf):
    """Oracle (TablEdit MusicXML): m17 guitar = ticks 0 and 480 — before the
    fix they sat right-aligned at 960/1440 (the empty half came FIRST).
    """
    assert notes_at(wheel_hoss_otf, "guitar", 17) == [(0, 5, 2), (480, 5, 0)]
    assert notes_at(wheel_hoss_otf, "guitar", 36) == [
        (0, 4, 4), (240, 4, 0), (480, 4, 2), (720, 5, 4)]
    assert notes_at(wheel_hoss_otf, "bass", 17) == [(0, 2, 0), (480, 3, 0)]


def test_regular_measures_untouched(wheel_hoss_otf):
    """tsMove applies only inside the changed measure; m18 (back to 4/4)
    keeps its full-measure spread.
    """
    m18 = notes_at(wheel_hoss_otf, "guitar", 18)
    assert m18, "m18 should have notes"
    assert max(t for t, _, _ in m18) > 960, m18


@pytest.mark.skipif(not (DOWNLOADS / "23602.tef").exists(),
                    reason="downloads corpus not present")
def test_23602_quarter_measure_in_two_four_tune():
    """Header is 2/4; m26 is a single 1/4 measure (grid 128 -> 64).
    Its four 16th notes must start at tick 0, not half a measure in.
    """
    tef = TEFReader(str(DOWNLOADS / "23602.tef")).parse()
    changes = [(c.measure, c.numerator, c.denominator)
               for c in tef.time_signature_changes]
    assert changes == [(26, 1, 4)]
    otf = tef_to_otf(tef).to_dict()
    track = next(iter(otf["notation"]))
    ticks = [t for t, _, _ in notes_at(otf, track, 26)]
    # Four consecutive 16ths from the measure start (16th = 120 ticks);
    # before the fix they started half a 2/4 measure in (480..840).
    assert ticks == [0, 120, 240, 360], ticks


@pytest.mark.skipif(not (DOWNLOADS / "21874.tef").exists(),
                    reason="downloads corpus not present")
def test_no_op_explicit_header_ts_markers_ignored():
    """21874 carries an explicit 4/4 marker on every measure (d3=0) — these
    match the header signature and must produce no changes and no shifts.
    """
    tef = TEFReader(str(DOWNLOADS / "21874.tef")).parse()
    assert tef.time_signature_changes == []
    otf = tef_to_otf(tef).to_dict()
    assert "time_signature_changes" not in otf["metadata"]


@pytest.mark.skipif(not (DOWNLOADS / "27493.tef").exists(),
                    reason="downloads corpus not present")
def test_v3_ts_changes_exported_to_otf_metadata():
    """27493 is V3 with 2/4 measures at m30/m49 (oracle-confirmed; the
    continuous-slot mapping was validated against these). The reader
    extracts them into TEFFile.time_signature_changes, but tef_to_otf
    only emitted metadata.time_signature_changes in the V2 branch —
    V3 files silently dropped their overrides.
    """
    tef = TEFReader(str(DOWNLOADS / "27493.tef")).parse()
    changes = [(c.measure, c.numerator, c.denominator)
               for c in tef.time_signature_changes]
    assert changes == [(30, 2, 4), (49, 2, 4)]
    otf = tef_to_otf(tef).to_dict()
    assert otf["metadata"]["time_signature_changes"] == [
        {"measure": 30, "time_signature": "2/4"},
        {"measure": 49, "time_signature": "2/4"},
    ]
