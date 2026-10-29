"""Bends (G15d2, closes #184).

TablEdit's note effect 12 is a bend (up and hold) and 13 a bend-release (up
and back). Neither has an amount field: the bend runs into the NEXT note on
the same string of the same track, tied or not, possibly in a later measure,
by target.f - source.f. The target is not picked again.

Decoded from TablEdit 3.06 (MIDI builder FUN_10005d814 -> FUN_10005be90, next
same-string note via FUN_10005bcd8) and confirmed in TablEdit's own Rich-MIDI
export of Welcome to New York (spike/oracle).

Fixtures are corpus files that isolate one case each (tests/parser/fixtures).
"""

import sys
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.otf import (  # noqa: E402
    FX_ORDER, bend_target_keys, fret_changed_tie_keys)

FIXTURES = Path(__file__).parent / "fixtures"


def _otf(name):
    return tef_to_otf(TEFReader(str(FIXTURES / name)).parse()).to_dict()


def _note(otf, track, measure, tick, string):
    m = next(m for m in otf["notation"][track] if m["measure"] == measure)
    ev = next(e for e in m["events"] if e["tick"] == tick)
    return next(n for n in ev["notes"] if n["s"] == string)


def test_bend_is_in_fx_vocabulary():
    assert "bend" in FX_ORDER
    assert FX_ORDER.index("bend") + 1 == FX_ORDER.index("bend-release")


def test_v3_bend_and_bend_release_with_untied_targets():
    """Big Mon (V3): m27 s2 f10 bends to f11, m28 s2 f11 bends and releases
    to f10. Neither target carries the tie bit; both are 'b' and unpicked."""
    otf = _otf("bend_v3_big_mon_29278.tef")
    src = _note(otf, "banjo", 27, 720, 2)
    assert src["fx"] == ["bend"] and src["f"] == 10 and "tech" not in src
    tgt = _note(otf, "banjo", 27, 840, 2)
    assert (tgt["f"], tgt["tech"]) == (11, "b") and not tgt.get("tie")

    src = _note(otf, "banjo", 28, 120, 2)
    assert src["fx"] == ["bend-release"] and src["f"] == 11
    tgt = _note(otf, "banjo", 28, 240, 2)
    assert (tgt["f"], tgt["tech"]) == (10, "b") and not tgt.get("tie")


def test_v3_target_in_the_next_measure():
    otf = _otf("bend_v3_next_measure_26006.tef")
    src = _note(otf, "banjo", 29, 1680, 3)
    assert src["fx"] == ["bend"] and src["f"] == 3
    tgt = _note(otf, "banjo", 30, 0, 3)
    assert (tgt["f"], tgt["tech"]) == (4, "b")


def test_v2_bend_release_target_in_the_next_measure():
    otf = _otf("bend_release_v2_next_measure_10300.tef")
    src = _note(otf, "banjo", 10, 1680, 3)
    assert src["fx"] == ["bend-release"] and src["f"] == 3
    tgt = _note(otf, "banjo", 11, 0, 3)
    assert (tgt["f"], tgt["tech"]) == (4, "b")


def test_v2_bend_into_a_tied_target():
    """Southern Flavor (V2): its bend destinations carry the tie bit. They are
    still 'b', not ties, and the amount is the fret difference."""
    otf = _otf("bend_v2_tied_target_21702.tef")
    src = _note(otf, "banjo", 37, 0, 2)
    assert src["fx"] == ["bend"] and src["f"] == 5
    tgt = _note(otf, "banjo", 37, 240, 2)
    assert (tgt["f"], tgt["tech"]) == (6, "b") and not tgt.get("tie")


def test_bend_to_a_lower_fret_keeps_its_sign():
    """Black Mountain Rag m10: f8 bend into f7. The amount is
    target.f - source.f = -1; the importer stores no amount."""
    otf = _otf("bend_v2_down_11599.tef")
    src = _note(otf, "banjo", 10, 1680, 2)
    assert src["fx"] == ["bend"] and src["f"] == 8
    tgt = _note(otf, "banjo", 11, 0, 2)
    assert (tgt["f"], tgt["tech"]) == (7, "b")


def test_only_bend_targets_are_b():
    """Nothing else in a bend file is marked 'b' (no phantom bends)."""
    otf = _otf("bend_v3_big_mon_29278.tef")
    n_b = n_src = 0
    for ms in otf["notation"].values():
        for m in ms:
            for ev in m["events"]:
                for n in ev["notes"]:
                    n_b += n.get("tech") == "b"
                    n_src += bool({"bend", "bend-release"} & set(n.get("fx") or []))
    assert n_b == n_src == 2


def _evt(track, position, string, fret, effect=0, tied=False):
    """A stand-in note event: only what the bend rules read."""
    raw = bytearray(12)
    raw[6] = effect
    raw[5] = 0xe0 if tied else 0
    return SimpleNamespace(
        track=track, position=position, is_melody=True, raw_data=bytes(raw),
        decode_string_fret=lambda: (string, fret))


def test_bend_with_no_destination_is_left_alone():
    assert bend_target_keys([_evt(0, 10, 2, 5, effect=12)], {}) == set()


def test_target_is_the_next_note_on_the_same_string_and_track_only():
    events = [
        _evt(0, 10, 2, 5, effect=12),
        _evt(0, 11, 3, 9),       # other string
        _evt(1, 12, 2, 9),       # other track
        _evt(0, 40, 2, 7),       # the target, far later
        _evt(0, 90, 2, 9),       # not the target
    ]
    assert bend_target_keys(events, {}) == {(0, 40, 2)}


def test_same_fret_and_legato_owned_targets_are_left_alone():
    same = [_evt(0, 10, 2, 5, effect=13), _evt(0, 20, 2, 5)]
    assert bend_target_keys(same, {}) == set()
    hp = [_evt(0, 10, 2, 5, effect=12), _evt(0, 20, 2, 7)]
    assert bend_target_keys(hp, {(0, 20, 2): "h"}) == set()


def test_tied_target_is_found_without_the_tie_rule():
    events = [_evt(0, 10, 2, 5, effect=12), _evt(0, 20, 2, 6, tied=True)]
    assert bend_target_keys(events, {}) == {(0, 20, 2)}


def test_fret_changed_tie_without_a_bend_is_a_plain_note():
    """The old tie-only rule called these bends. Without an effect-12/13
    source they are not (TablEdit bends nothing here); they must still not
    import as ties, since a tie to a different fret would go silent."""
    events = [_evt(0, 10, 2, 5), _evt(0, 20, 2, 6, tied=True)]
    assert bend_target_keys(events, {}) == set()
    assert fret_changed_tie_keys(events, {}) == {(0, 20, 2)}
