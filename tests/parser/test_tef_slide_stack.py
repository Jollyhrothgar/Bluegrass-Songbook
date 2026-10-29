"""G15d5: a slide source the triplet retime stacks on its target (#318).

TablEdit stores a fiddle slide as two records at different file positions
(f6 as an eighth triplet with the slide effect, then f7). The triplet retime
moves f6 onto f7's tick, which is also what TablEdit's MusicXML export does,
so we keep the timing. OTF allows one note per string per event, so the
source is folded into the target as `grace: {f, kind: 'slide'}`.

Fixtures (frozen copies, see tests/parser/fixtures):
  3098_jerusalem_ridge_slide_stack.tef  fiddle-hangout 3098, fiddle m40, 2026-10-29
  3302_beaumont_rag_triplet_slot3.tef   flatpicker-hangout 3302, m88 (control)
  synthetic_v2_slide_stack.tef          10676 with two records patched in
                                        (string 1: f6 slide eighth triplet at
                                        pos 48, f7 quarter at pos 64)
JS counterpart: docs/js/__tests__/tef-import-slide-stack.test.js
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


def convert(name):
    return tef_to_otf(TEFReader(str(FIXTURES / name)).parse()).to_dict()


def measure(otf, track, number):
    return next(m for m in otf["notation"][track] if m["measure"] == number)


def string_counts(m):
    return [(e["tick"], n["s"]) for e in m["events"] for n in e["notes"]]


def test_synthetic_pattern_folds_source_into_grace():
    otf = convert("synthetic_v2_slide_stack.tef")
    ev = next(e for e in measure(otf, "banjo", 1)["events"] if e["tick"] == 480)
    s1 = [n for n in ev["notes"] if n["s"] == 1]
    assert s1 == [{"s": 1, "f": 7, "dur": 480, "grace": {"f": 6, "kind": "slide"}}]


def test_3098_m40_has_no_duplicate_string_and_carries_the_grace():
    m = measure(convert("3098_jerusalem_ridge_slide_stack.tef"), "fiddle", 40)
    counts = string_counts(m)
    assert len(counts) == len(set(counts))
    s2 = {e["tick"]: n for e in m["events"] for n in e["notes"] if n["s"] == 2}
    for tick in (480, 960):
        assert s2[tick] == {"s": 2, "f": 7, "dur": 480, "grace": {"f": 6, "kind": "slide"}}
    assert not any(n.get("f") == 6 for e in m["events"] for n in e["notes"])


def test_triplet_slots_zero_to_two_unchanged():
    """Wheel Hoss-style thirds of a beat: the synthetic file's beat 1 still
    holds 0/160/... and 3098's non-colliding notes keep their ticks."""
    m = measure(convert("synthetic_v2_slide_stack.tef"), "banjo", 1)
    ticks = {e["tick"] for e in m["events"]}
    assert {0, 160, 640} <= ticks


def test_3302_m88_index3_note_stays_on_beat_4():
    """The other index-3 triplet note (a hammer-on, not a slide) lands on beat 4
    exactly as TablEdit's export has it, and nothing is folded."""
    ev = next(e for e in measure(convert("3302_beaumont_rag_triplet_slot3.tef"),
                                 "bryan-sutton", 88)["events"] if e["tick"] == 1440)
    # Compare only the fields this test is about: the track is `ff`, so the
    # note also carries `dyn: "f"` (G15d1).
    want = {"s": 5, "f": 4, "tech": "h", "dur": 160}
    assert any(all(n.get(k) == v for k, v in want.items()) for n in ev["notes"])
    assert not any("grace" in n for n in ev["notes"])


# ── G15d5: a triplet retime may not push a note onto/past the barline ────────
# 10676_doug_s_tune_slot3_barline.tef (banjo-hangout 10676, frozen 2026-10-29).
# TablEdit's MusicXML export keeps m7's slot-3 string-1 note at 945/240 divisions
# (inside the measure, which overflows to 1025), not at the barline.

def test_10676_slot3_note_stays_inside_its_measure():
    from tef_parser.otf import tef_to_otf as _t  # noqa: F401
    sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))
    import otf_schema
    otf = convert("10676_doug_s_tune_slot3_barline.tef")
    errors, _ = otf_schema.check(otf)
    assert not [e for e in errors if "tick_range" in e], errors
    for n in (7, 8):
        assert max(e["tick"] for e in measure(otf, "banjo", n)["events"]) < 1920
    m7 = measure(otf, "banjo", 7)
    assert any(e["tick"] == 1800 and any(x["s"] == 1 for x in e["notes"])
               for e in m7["events"])
