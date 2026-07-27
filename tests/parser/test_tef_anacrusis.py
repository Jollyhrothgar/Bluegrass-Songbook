"""TEF V2 anacrusis (pickup measure) regression tests.

Ground truth: TablEdit's own MusicXML exports (spike/oracle/batch/).

TEF stores a pickup measure's notes RIGHT-ALIGNED in a full header-ts
grid slot (the same storage trick as type-27 shortened measures), and
flags the anacrusis in the header: the u16 at offset 244 is exactly 1
in every corpus file whose oracle export renders measure 1 shortened
(22456, 18926, 21307, 17492, 11557, 11558, 11722, 14613) and takes
other values (0, 2, 9, 16..48) everywhere else.

Bug fixed: the parser left pickup notes right-aligned, so every
measure-1 note landed exactly first_note_position too late vs the
oracle (18926: parser ticks 1440/1600/1760 vs oracle 0/160/320).
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"


@pytest.fixture(scope="module")
def tef_18926():
    return TEFReader(str(DOWNLOADS / "18926.tef")).parse()


def test_anacrusis_flag_detected(tef_18926):
    assert tef_18926.header.v2_anacrusis is True


def test_anacrusis_flag_not_set_on_normal_file():
    tef = TEFReader(str(DOWNLOADS / "23398.tef")).parse()
    assert tef.header.v2_anacrusis is False


def test_pickup_notes_left_aligned(tef_18926):
    """Measure-1 notes start at position 0 after the anacrusis shift.

    Oracle (TablEdit MusicXML): 18926 measure 1 is a 1-beat pickup whose
    triplet notes sit at ticks 0/160/320, not 1440/1600/1760.
    """
    otf = tef_to_otf(tef_18926)
    d = otf.to_dict()
    track = next(iter(d["notation"]))
    m1 = d["notation"][track][0]
    assert m1["measure"] == 1
    ticks = [ev["tick"] for ev in m1["events"]]
    assert ticks[0] == 0, f"pickup not left-aligned: {ticks}"
    assert ticks[:3] == [0, 160, 320], f"got {ticks[:3]}"


def test_pickup_records_shortened_time_signature(tef_18926):
    """The pickup measure gets a time_signature_changes entry (1 beat of
    4/4 -> 1/4) so renderers/players can shorten measure 1."""
    changes = tef_18926.time_signature_changes
    m1 = [c for c in changes if c.measure == 1]
    assert len(m1) == 1
    assert (m1[0].numerator, m1[0].denominator) == (1, 4)


def test_pickup_measure_2_unaffected(tef_18926):
    """Only measure 1 shifts — measure 2+ ticks are unchanged."""
    otf = tef_to_otf(tef_18926)
    d = otf.to_dict()
    track = next(iter(d["notation"]))
    m2 = d["notation"][track][1]
    assert m2["measure"] == 2
    assert m2["events"][0]["tick"] == 0
