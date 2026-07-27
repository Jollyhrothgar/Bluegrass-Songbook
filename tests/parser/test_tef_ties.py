"""V2 tie-detection regression tests.

Ground truth: TablEdit MusicXML exports (spike/oracle/batch/).

V2 byte3 layout: bits 0-4 duration code, bits 5-7 dynamic. Dynamics
0-5 are real volume levels; dynamic 7 is the TIE sentinel. The old
`byte3 & 0x80` rule also caught dynamics 4 and 5 (0x80-0xBF) and
dropped those notes as phantom ties — 23439 m5/m14 (0xac, dyn 5),
21999 m10 (0x86, dyn 4), 21690 m4 (0x89, dyn 4) all export as plain
notes, while every true XML tie in the corpus is a dynamic-7 byte
(21690 m4 0xe9, wheel_hoss 0xe3).
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"


def _notes(path: Path) -> list[tuple[int, int, int, int, bool]]:
    tef = TEFReader(str(path)).parse()
    d = tef_to_otf(tef).to_dict()
    out = []
    for track in d["notation"]:
        for m in d["notation"][track]:
            for ev in m["events"]:
                for n in ev["notes"]:
                    out.append((m["measure"], ev["tick"], n["s"], n["f"],
                                bool(n.get("tie"))))
    return out


def test_dynamic_4_and_5_notes_are_not_ties():
    """23439: s2 f0 at tick 720 in m5/m14 carry byte3=0xac (dynamic 5)
    — plain notes in the oracle, not ties."""
    notes = _notes(DOWNLOADS / "23439.tef")
    for m in (5, 14):
        match = [n for n in notes if n[:4] == (m, 720, 2, 0)]
        assert match, f"missing (m{m}, 720, s2, f0)"
        assert match[0][4] is False, f"phantom tie on {match[0]}"


def test_dynamic_7_notes_are_ties():
    """15313 has 24 dynamic-7 notes — they must still come through as
    ties (tie=True), matching the oracle's tie count."""
    tef = TEFReader(str(DOWNLOADS / "15313.tef")).parse()
    dyn7 = [e for e in tef.note_events
            if len(e.raw_data) == 6 and (e.raw_data[3] >> 5) & 7 == 7]
    assert len(dyn7) == 24
    notes = _notes(DOWNLOADS / "15313.tef")
    assert sum(1 for n in notes if n[4]) == 24
