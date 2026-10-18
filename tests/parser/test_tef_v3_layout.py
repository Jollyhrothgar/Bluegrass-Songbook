"""TEF V2/V3 routing and V3 note layout, as TablEdit's own loaders read them.

Ground truth: TablEdit 3.06's loaders, decompiled with REA/Ghidra.
FUN_10004632c reads the V2 header at offset 200 for every file and hands
the file to the V3 loader FUN_100047dbc when the format byte at 205 is 10
or more. The V3 loader seeks to the u32 at header offset 0x3C for the note
records; each record's location is 8 * (pos * total_strings + string),
with pos in 64ths of a whole note.

Bugs fixed:
- Routing on "first byte printable" sent 22 untitled V2 files (first byte
  0x00) down the V3 path, where they parsed to 0 notes.
- Searching the file for b'debt' (written at 0x38 but never read by
  TablEdit) missed the 77 of 88 V3 files carrying b'tbed' there instead;
  they parsed to 0 notes.
- Decoding positions as 16th slots (32 * total_strings) put every note on
  an odd 32nd onto a phantom string 2 * total_strings higher (206 notes in
  17 files; 109 of them in 21206).
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.reader import is_v3_layout  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"


def test_untitled_v2_file_routes_to_v2():
    """11775 has an empty title, so its first byte is 0x00 like a V3
    file — but its format byte (205) is 3, so TablEdit reads it as V2."""
    path = DOWNLOADS / "11775_tef_soldier_s_joy.tef"
    data = path.read_bytes()
    assert data[0] == 0x00 and data[205] == 3
    tef = TEFReader(str(path)).parse()
    assert tef.header.is_v2
    assert len(tef.note_events) > 0


def test_v3_notes_found_without_debt_magic():
    """25151 carries b'tbed' at 0x38 and no b'debt' anywhere; its notes
    are found through the header pointer at 0x3C."""
    path = DOWNLOADS / "25151_tef_red_wing.tef"
    data = path.read_bytes()
    assert data[0x38:0x3C] == b"tbed" and b"debt" not in data
    tef = TEFReader(str(path)).parse()
    assert not tef.header.is_v2
    assert len(tef.note_events) > 0


def test_v3_32nd_note_lands_on_its_real_string():
    """Katy Hill 27391 m1: the 32nd-note hammer-on at tick 540 is on
    string 1. The 16th-slot decode stacked it at tick 480 on a phantom
    string 6 of the 5-string banjo."""
    otf = tef_to_otf(TEFReader(str(DOWNLOADS / "27391_tef_katy_hill.tef")).parse())
    m1 = otf.to_dict()["notation"]["banjo"][0]
    by_tick = {ev["tick"]: ev["notes"] for ev in m1["events"]}
    assert by_tick[480] == [{"dur": 60, "f": 7, "s": 1}]
    assert by_tick[540] == [{"dur": 60, "f": 9, "s": 1, "tech": "h"}]


V3_FILES = sorted(
    p for p in DOWNLOADS.glob("*.tef") if is_v3_layout(p.read_bytes()))


@pytest.mark.parametrize("path", V3_FILES, ids=lambda p: p.stem)
def test_v3_notes_stay_within_their_track(path):
    """Every decoded V3 note sits on a string its track actually has."""
    tef = TEFReader(str(path)).parse()
    assert tef.note_events, "V3 file parsed to no notes"
    strings = [inst.num_strings for inst in tef.instruments] or [5]
    off = [e for e in tef.note_events
           if e.track >= len(strings) or not 1 <= e.extra <= strings[e.track]]
    assert not off, f"{len(off)} notes off their track's strings"
