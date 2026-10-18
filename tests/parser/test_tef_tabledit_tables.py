"""TEF decoding that follows TablEdit's own tables and masks (fix-it A13).

Ground truth: TablEdit 3.06, decompiled with REA/Ghidra, plus TablEdit's
MusicXML exports in spike/oracle/batch/ where they cover the field.

- Durations: TablEdit indexes a 32-entry table (0x1000f38b8) with
  `note_cell[1] & 0x1f`. Codes 16-31 are not the (straight, dotted,
  triplet) pattern the old formula extrapolated: code 18 is a 64th.
- V2 effect enum is `effect1 & 0x0f` (FUN_10001f594); bits 4-5 are flags.
- V2 fingering: notes whose fret-byte flags are exactly 0x20 carry the
  same base-6 pluck/fretting byte that V3 stores at record offset 10
  (V2 upgrade FUN_1000459c4). TablEdit exports code 24 as pluck "a" (R).
- V3 special components are `type & 0x3f >= 0x33`, whatever the top bits.
- V3 drum tracks set bit 7 of track-record byte +4.
- The V3 measure table has an 8-byte header; record j is measure j+1.
- Triplets: V3 notes retime by duration code exactly like V2 (byte 5).
"""

import re
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.reader import decode_duration_code  # noqa: E402

BANJO = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"
FIDDLE = REPO_ROOT / "sources" / "fiddle-hangout" / "downloads"
ORACLE = REPO_ROOT / "spike" / "oracle" / "batch"


def _otf(path):
    return tef_to_otf(TEFReader(str(path)).parse()).to_dict()


def _notes(otf, track=None):
    for tid, measures in otf["notation"].items():
        if track and tid != track:
            continue
        for m in measures:
            for ev in m["events"]:
                yield from ev["notes"]


def test_duration_table_matches_tablEdit():
    # 480 ticks per quarter = 2x TablEdit's 960-per-whole table.
    assert [decode_duration_code(c) for c in (0, 3, 6, 9, 12, 15)] == [
        1920, 960, 480, 240, 120, 60]
    assert decode_duration_code(13) == 90       # dotted 32nd
    assert decode_duration_code(14) == 80       # 16th triplet
    assert decode_duration_code(22) == 840      # double-dotted quarter
    assert decode_duration_code(18) == 30       # 64th (old formula: 2240)
    assert decode_duration_code(16) == 44       # dotted 64th
    assert decode_duration_code(31) == 2880     # dotted whole


def test_mandolin_chops_are_64ths():
    """19150's mandolin chops on every beat use code 18: 64th notes,
    not notes ringing past the end of the measure."""
    otf = _otf(BANJO / "19150_tef_brown_county_breakdown.tef")
    durs = Counter(n["dur"] for n in _notes(otf, "mandolin"))
    assert durs[30] == 244 and 2240 not in durs


def test_flagged_effects_keep_their_technique():
    """643 stores hammer/pull/slide as 0x31-0x33 (flags in bits 4-5)."""
    otf = _otf(FIDDLE / "643_tef_soldier_s_joy.tef")
    techs = Counter(n.get("tech") for n in _notes(otf) if n.get("tech"))
    assert techs == {"/": 44, "h": 16, "p": 4}


def test_v2_fingering_matches_tablEdit_export():
    """10658: TablEdit exports 74 p, 96 i and 63 a plucks — code 24 is the
    ring finger 'a', which the old 6/12/18-only map dropped."""
    otf = _otf(BANJO / "10658.tef")
    xml = (ORACLE / "10658.xml").read_text()
    letters = {"p": "T", "i": "I", "m": "M", "a": "R", "c": "P"}
    expected = Counter(letters[v] for v in
                       re.findall(r"<pluck[^>]*>([^<]*)</pluck>", xml))
    assert Counter(n["finger"] for n in _notes(otf) if n.get("finger")) == expected


def test_v3_special_with_high_bits_is_not_a_note():
    """28267's three `f5 70 10` records are type 0x35 specials, not fret 20."""
    tef = TEFReader(str(BANJO / "28267_tef_ragtime_annie.tef")).parse()
    assert not [e for e in tef.note_events if e.raw_data[4] == 0xF5]


def test_v3_drum_track_detected():
    otf = _otf(BANJO / "25014_tef_blackberry_blossom.tef")
    drums = [t for t in otf["tracks"] if t.get("percussion")]
    assert [t["id"] for t in drums] == ["percussion"]
    assert drums[0]["tuning"] == []


def test_v3_measure_table_keeps_last_measure():
    """27499 closes on a 3/4 measure 19 after 2/2 — the old reader stopped
    one record short and lost it."""
    tef = TEFReader(str(BANJO / "27499_tef_temperance_reel__standard_g_.tef")).parse()
    last = tef.time_signature_changes[-1]
    assert (last.measure, last.numerator, last.denominator) == (19, 3, 4)


def test_v3_tie_is_dynamic_seven_not_bit_seven():
    """V3 cell byte 1 is the V2 duration byte copied unchanged: bits 5-7
    are the dynamic and only 7 means tie. 11721's guitar plays its beat-3
    chord at dynamic 4 (0x86); the bit-7 test hid it as a tie, and
    TablEdit's export of all modules plays it."""
    otf = _otf(BANJO / "11721_tef_the_tennessee_waltz.tef")
    m2 = next(m for m in otf["notation"]["guitar"] if m["measure"] == 2)
    beat3 = next(ev for ev in m2["events"] if ev["tick"] == 960)
    assert [n.get("tie", False) for n in beat3["notes"]] == [False] * 3


def test_v2_positions_floor_to_the_64th_grid():
    """TablEdit's V2 loader places a record at (loc << 1) & ~3 — the V3
    64th-note grid. 10545 is an old file that stored its m11 eighth
    triplet at true positions 192/213/234 (of 256); TablEdit shows
    them at 192/212/232 and does not retime them again, because only a
    triplet sitting on the straight storage step is compressed. Its
    all-modules MusicXML export places them at ticks 1440/1590/1740."""
    otf = _otf(BANJO / "10545_tef_arkansas_traveler.tef")
    m11 = next(m for m in otf["notation"]["banjo"] if m["measure"] == 11)
    assert [ev["tick"] for ev in m11["events"]][-3:] == [1440, 1590, 1740]


def test_v3_long_measure_keeps_its_second_half():
    """3404 has 6/4 measures (27, 34) in a 4/4 tune: 96 sixty-fourths.
    Re-encoding positions as measure*64 + offset spilled offsets 64-95
    into the next measure; TablEdit's export keeps them in m34 at ticks
    1920-2640."""
    otf = _otf(FIDDLE / "3404_tef_wheel_hoss.tef")
    m34 = next(m for m in otf["notation"]["banjo"] if m["measure"] == 34)
    assert [ev["tick"] for ev in m34["events"]][-4:] == [1920, 2160, 2400, 2640]


def test_v2_fret_25_is_a_note_unless_bare_0x1a():
    """The fret field is 5 bits; TablEdit's V2 upgrade turns only the BARE
    byte 0x1a into a special (type 0x33) and keeps a flagged 0x1a as fret
    25. 11056 m9 has 0x5a at tick 1200 (exported as fret 25) and a bare
    0x1a at 1680 (not a note)."""
    otf = _otf(BANJO / "11056_tef_red_apple_rag.tef")
    m9 = next(m for m in otf["notation"]["banjo"] if m["measure"] == 9)
    s3 = [(ev["tick"], n["f"]) for ev in m9["events"] for n in ev["notes"] if n["s"] == 3]
    assert (1200, 25) in s3 and not any(t == 1680 for t, _ in s3)


def test_v3_triplets_follow_the_duration_code():
    """25151 m15 opens with three eighth-triplet notes (code 11) stored on
    the straight 16th grid. Their middle note carries a different dynamic
    ('+' not 'K'), which the old K-marker group rule missed; TablEdit's
    MusicXML export places them at ticks 0/160/320."""
    otf = _otf(BANJO / "25151_tef_red_wing.tef")
    m15 = next(m for m in otf["notation"]["banjo"] if m["measure"] == 15)
    assert [ev["tick"] for ev in m15["events"]][:3] == [0, 160, 320]
