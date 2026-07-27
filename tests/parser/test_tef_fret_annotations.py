"""V2 fret-byte bit-5 semantics + triplet-span regression tests.

Ground truth: TablEdit MusicXML exports (spike/oracle/batch/).

Bit 5 of the V2 fret byte means "effect2 carries an annotation"
(left-hand fingering digit, text=0x06, chord=0x07), NEVER a fret
extension — fret_raw already spans the full 0..24 range. The old
`fret += effect2` shifted 22446's notes to wrong frets (f1+2=3,
f2+3=5, f3+5=8) and silently DROPPED 21802's m26/m28 notes
(e2=0xa2/0xa4 pushed frets past 24, failing is_melody).

Triplet spans: the x4/3 straight-grid correction applies within the
triplet SPAN (2 x base duration from the duration code), not always
within one beat. code 11 = eighth triplet (span 480), code 8 = quarter
triplet (span 960 — 15313 m53/56: tick 1440 belongs at 1600).
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"
FIXTURES = Path(__file__).parent / "fixtures"


def _notes(path: Path) -> list[tuple[int, int, int, int]]:
    tef = TEFReader(str(path)).parse()
    d = tef_to_otf(tef).to_dict()
    out = []
    for track in d["notation"]:
        for m in d["notation"][track]:
            for ev in m["events"]:
                for n in ev["notes"]:
                    out.append((m["measure"], ev["tick"], n["s"], n["f"]))
    return out


def test_bit5_effect2_is_not_a_fret_extension():
    """21802 (Tennessee Mountain Fox Chase): m26/m28 notes carry bit 5
    with e2=0xa2/0xa4; the oracle has them at their plain frets."""
    notes = _notes(FIXTURES / "21802_fingering_annotations.tef")
    for want in [(26, 0, 3, 8), (26, 480, 2, 7), (26, 480, 3, 9),
                 (28, 1440, 2, 7)]:
        assert want in notes, f"missing {want}"
    # And no phantom high-fret versions anywhere
    assert not [n for n in notes if n[3] > 24]


def test_quarter_note_triplet_span():
    """15313: duration code 8 = quarter triplet — the second triplet
    note (straight tick 1440) belongs at 1600 (span 960, x4/3)."""
    notes = _notes(DOWNLOADS / "15313.tef")
    assert (53, 1600, 4, 3) in notes
    assert (56, 640, 1, 4) in notes
    assert (53, 1440, 4, 3) not in notes
