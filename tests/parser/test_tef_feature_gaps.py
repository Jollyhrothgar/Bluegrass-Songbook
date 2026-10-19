"""TablEdit features the importer used to drop (fix-it A15).

Names and layouts come from TablEdit 3.06 itself (REA/Ghidra: the effect
string table at 0x1000f57e0, the special-type table at 0x1000f3cbc and the
V2 upgrade FUN_1000459c4); expected values were read from TablEdit's own
MusicXML export of each file (spike/tabledit_export).
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

BANJO = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"


def _otf(path):
    return tef_to_otf(TEFReader(str(path)).parse()).to_dict()


def test_v2_dead_notes_are_x():
    """The note effect is effect1 & 0x0f in V2 too, and 15 is TablEdit's
    'Dead note'. 10750's rhythm guitar (guitar-3) chops m74 beat 2 with
    all six strings dead; they imported as ringing open strings."""
    otf = _otf(BANJO / "10750_tef_katy_hill.tef")
    m74 = next(m for m in otf["notation"]["guitar-3"] if m["measure"] == 74)
    chop = next(ev for ev in m74["events"] if ev["tick"] == 480)
    assert [n.get("tech") for n in chop["notes"]] == ["x"] * 6


def test_v2_text_becomes_annotations():
    """V2 code 0x1d is TablEdit's Text component (type 0x39 after the V2
    upgrade). Byte 3 indexes the text table that follows the reading list
    (count = u16 at header 228, entries are u16 length + NUL-terminated
    bytes). Rawhide's chord names, as TablEdit exports them."""
    otf = _otf(BANJO / "11051_tef_rawhide.tef")
    got = [(a["measure"], a["text"]) for a in otf["annotations"]]
    assert got == [
        (2, "G"), (6, "C"), (8, "G"), (10, "C"), (12, "G"), (14, "D"),
        (16, "G"), (18, "G"), (22, "C"), (24, "G"), (26, "C"), (28, "G"),
        (30, "D"), (34, "B"), (38, "E"), (42, "A"), (46, "D")]


FIDDLE = REPO_ROOT / "sources" / "fiddle-hangout" / "downloads"


def _note(otf, track, measure, tick, string):
    m = next(m for m in otf["notation"][track] if m["measure"] == measure)
    ev = next(e for e in m["events"] if e["tick"] == tick)
    return next(n for n in ev["notes"] if n["s"] == string)


# (file, track, measure, tick, string, expected fx). Effect = byte6 / V2
# effect1 & 0x0f (4 choke, 5 brush, 6 harmonic, 8 muted, 11 tremolo,
# 14 roll); attribute = V3 byte 8 / V2 effect2 under fret flag 0x80 (1 let
# ring, 4 ghost, 7 staccato).
EFFECT_CASES = [
    (BANJO / "10300_tef_cluck_old_hen.tef", "guitar", 2, 1440, 1, ["brush"]),
    (BANJO / "11721_tef_the_tennessee_waltz.tef", "banjo", 16, 0, 2, ["brush"]),
    (BANJO / "10301_tef_cluck_old_hen.tef", "banjo", 5, 1440, 3, ["choke"]),
    (BANJO / "10327_tef_cripple_creek.tef", "banjo", 1, 0, 5, ["roll"]),
    (BANJO / "10301_tef_cluck_old_hen.tef", "banjo", 2, 0, 1, ["staccato"]),
    (BANJO / "10346_tef_cuckoos_nest.tef", "banjo", 8, 360, 4, ["let-ring"]),
    (BANJO / "10300_tef_cluck_old_hen.tef", "banjo", 5, 720, 3, ["ghost"]),
    (BANJO / "11600_tef_black_mountain_rag.tef", "banjo", 27, 0, 1, ["harmonic"]),
    (FIDDLE / "1836_tef_tennessee_waltz.tef", "mandolin", 9, 0, 1, ["tremolo"]),
    (BANJO / "11047_tef_ragtime_annie.tef", "banjo", 1, 720, 5, ["muted"]),
]


def test_note_effects_import_as_fx():
    """TablEdit's per-note effects reach OTF as `fx`, in TablEdit's own
    vocabulary (string table at 0x1000f57e0, attribute reader
    FUN_10001f594). They all imported as plain notes before (fix-it A15)."""
    for path, track, measure, tick, string, fx in EFFECT_CASES:
        note = _note(_otf(path), track, measure, tick, string)
        assert note.get("fx") == fx, (path.name, note)


def test_second_effect_dead_is_x():
    """High nibble 10 of the attribute byte is a second effect 'dead note'
    (21417 mandolin m2 beat 2: effect2 0xa0 under flag 0x80)."""
    note = _note(_otf(BANJO / "21417_tef_golden_slippers.tef"), "mandolin", 2, 480, 1)
    assert note.get("tech") == "x"


def test_grace_note_rides_on_its_main_note():
    """Grace = flag 0x40 on the MAIN note (V2 fret byte, V3 type byte); the
    grace's fret is bits 0-4 of V2 effect2 / V3 byte 7 and its kind bits
    5-7. Rawhide m2: a C#4 hammer-on grace (s2 f2) into D4 (s2 f3), exactly
    as TablEdit's export spells it. Tennessee Waltz (V3) carries both kinds
    a TablEdit user picks most: hammer/pull and slide."""
    note = _note(_otf(BANJO / "11051_tef_rawhide.tef"), "banjo", 2, 480, 2)
    assert note["f"] == 3 and note.get("grace") == {"f": 2, "kind": "hp"}
    kinds = {n["grace"]["kind"] for m in _otf(BANJO / "11721_tef_the_tennessee_waltz.tef")["notation"]["banjo"]
             for e in m["events"] for n in e["notes"] if n.get("grace")}
    assert kinds == {"hp", "slide"}
