"""V2 accompaniment/strum note regression tests.

Ground truth: TablEdit MusicXML exports (spike/oracle/batch/).

Two V2 note classes were being dropped even though TablEdit exports
them as plain notes:

1. effect1 == 0x0e on strummed chords (20853 m34, 11829's mandolin
   chop chords). The rhythm-marker skip belongs to V3 only.
2. effect2 == 0x07 with fret-byte bit 7 set (11514/11245 bass modules,
   b2=0x81/0x83): real accompaniment-pattern notes, not chord
   overlays. The 0x07 skip only applies when bit 7 is clear.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"


def _track_notes(pid: str, track: str) -> list[tuple[int, int, int, int]]:
    tef = TEFReader(str(DOWNLOADS / f"{pid}.tef")).parse()
    d = tef_to_otf(tef).to_dict()
    return [(m["measure"], ev["tick"], n["s"], n["f"])
            for m in d["notation"].get(track, [])
            for ev in m["events"] for n in ev["notes"]]


def test_bass_accompaniment_pattern_notes_kept():
    """11514 bass: alternating root-fifth notes carry e2=0x07 with
    fret-byte bit 7 — the oracle has 64 of them, the old filter kept 1."""
    notes = _track_notes("11514", "bass")
    assert (1, 0, 3, 0) in notes
    assert (1, 960, 2, 2) in notes
    assert len(notes) >= 64


def test_mandolin_chop_chords_kept():
    """11829 mandolin: chop chords carry effect1=0x0e — real notes in
    the oracle (144), zero after the old rhythm-marker skip."""
    notes = _track_notes("11829", "mandolin")
    assert (1, 480, 1, 0) in notes
    assert len(notes) == 144
