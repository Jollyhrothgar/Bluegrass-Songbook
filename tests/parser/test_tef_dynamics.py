"""G15d1: per-note dynamics.

Ground truth: V3 cell byte 5 / V2 byte 3, bits 5-7. Code 0 is the LOUDEST
(0 fff, 1 ff, 2 f, 3 mf, 4 mp, 5 p, 6 pp), 7 is the tie sentinel. Measured
from TablEdit's Rich-MIDI export (velocity 127 - 16 * code); see issue #318.

OTF: tracks[].dyn = the track's most common level among non-tie notes;
note.dyn only where it differs; tied notes carry none.
"""

import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.otf import DYN_LEVELS  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


def _doc(name):
    return tef_to_otf(TEFReader(str(FIX / name)).parse()).to_dict()


def _notes(d, track):
    out = {}
    for m in d["notation"].get(track, []):
        for ev in m["events"]:
            for n in ev["notes"]:
                out[(m["measure"], ev["tick"], n["s"])] = n
    return out


def _track(d, tid):
    return next(t for t in d["tracks"] if t["id"] == tid)


def test_dyn_levels_loudest_first():
    assert DYN_LEVELS == ["fff", "ff", "f", "mf", "mp", "p", "pp"]


def test_v3_mixed_levels():
    d = _doc("dynamics_v3_mixed.tef")
    assert _track(d, "banjo")["dyn"] == "f"
    notes = _notes(d, "banjo")
    # (file index) -> (measure, tick, string): positions are 64ths, 64/measure
    expect = {
        (1, 1440, 4): "mf",    # index 0, code 3
        (2, 960, 3): "fff",    # index 5, code 0
        (2, 1200, 3): "fff",   # index 6
        (3, 240, 3): "pp",     # index 10, code 6
        (4, 1200, 3): "ff",     # index 20, code 1
        (4, 1440, 1): "mp",     # index 21, code 4
        (5, 0, 1): "p",        # index 22, code 5
    }
    for key, level in expect.items():
        assert notes[key].get("dyn") == level, key
    assert Counter(n["dyn"] for n in notes.values() if "dyn" in n) == {
        "fff": 2, "ff": 1, "mf": 1, "mp": 1, "p": 1, "pp": 1}


def test_v3_tied_note_carries_no_dyn():
    d = _doc("dynamics_v3_mixed.tef")
    ties = [n for n in _notes(d, "banjo").values() if n.get("tie")]
    assert len(ties) == 1
    assert "dyn" not in ties[0]


def test_note_dyn_never_equals_its_tracks():
    for name in ("dynamics_v3_mixed.tef", "wheel_hoss_2430_packed_tracks.tef",
                 "10591_fire_on_the_mountain_v2_4byte.tef"):
        d = _doc(name)
        for t in d["tracks"]:
            for n in _notes(d, t["id"]).values():
                assert n.get("dyn") != t.get("dyn", "f"), (name, t["id"])


def test_v2_six_byte_track_modes():
    """wheel_hoss: banjo track is ff 388 / fff 69 (+1 tie), the second
    track is all ff."""
    d = _doc("wheel_hoss_2430_packed_tracks.tef")
    first, second = d["tracks"][0], d["tracks"][1]
    assert first["dyn"] == "ff" and second["dyn"] == "ff"
    notes = _notes(d, first["id"])
    assert Counter(n.get("dyn") for n in notes.values() if not n.get("tie")) == {
        None: 388, "fff": 69}
    assert all("dyn" not in n for n in _notes(d, second["id"]).values())
    assert all("dyn" not in n for n in notes.values() if n.get("tie"))


def test_v2_four_byte_records_read_byte3():
    """10591's 4-byte sub-variant: byte 3 still holds duration + dynamic."""
    d = _doc("10591_fire_on_the_mountain_v2_4byte.tef")
    guitar, bass = d["tracks"][0], d["tracks"][1]
    assert guitar["dyn"] == "fff" and bass["dyn"] == "ff"
    g = Counter(n.get("dyn") for n in _notes(d, guitar["id"]).values())
    assert g["mf"] == 3 and g["mp"] == 2 and g[None] > 400
    b = Counter(n.get("dyn") for n in _notes(d, bass["id"]).values())
    assert b["fff"] == 1 and b[None] > 100


def test_single_level_file_has_track_dyn_only():
    d = _doc("21802_fingering_annotations.tef")
    assert d["tracks"][0]["dyn"] == "f"
    assert all("dyn" not in n for n in _notes(d, d["tracks"][0]["id"]).values())


def test_dyn_present_stamps_version_1_2():
    assert _doc("dynamics_v3_mixed.tef")["otf_version"] >= "1.2"
