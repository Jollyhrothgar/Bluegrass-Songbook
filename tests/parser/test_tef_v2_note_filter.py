"""V2 note-filter regression tests.

Ground truth: TablEdit MusicXML exports (spike/oracle/batch/).

V2 byte3 is duration + dynamic (plus tie bit 0x80), NOT a marker byte.
The V3-style marker filter read byte3 as a char and silently dropped
every note whose duration+dynamic combination didn't spell one of
I/F/L/K/O/C — e.g. 0x47 'G' (23408), 0x41 'A' (21678), 0x40 '@'
(12124), and whole strummed chords in 10770. In V2, every fret
component in the stream is a real note; only the chord-overlay skip
(effect2 == 0x07) applies.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"


def _notes(pid: str) -> list[tuple[int, int, int, int]]:
    """[(measure, tick, string, fret)] from the OTF conversion."""
    tef = TEFReader(str(DOWNLOADS / f"{pid}.tef")).parse()
    d = tef_to_otf(tef).to_dict()
    out = []
    for track in d["notation"]:
        for m in d["notation"][track]:
            for ev in m["events"]:
                for n in ev["notes"]:
                    out.append((m["measure"], ev["tick"], n["s"], n["f"]))
    return out


def test_duration_byte_0x47_notes_kept():
    """23408: oracle has s1 f0 at tick 120 in measures 1/5/8/9 — these
    notes carry byte3=0x47 ('G') and were dropped by the marker filter."""
    notes = _notes("23408")
    for m in (1, 5, 8, 9):
        assert (m, 120, 1, 0) in notes, f"missing (m{m}, 120, s1, f0)"


def test_duration_byte_0x40_notes_kept():
    """12124: oracle has s4 f0 at measure 18 tick 0 — byte3=0x40 ('@')
    was routed to the V3 chord-diagram heuristic and dropped."""
    notes = _notes("12124")
    assert (18, 0, 4, 0) in notes
