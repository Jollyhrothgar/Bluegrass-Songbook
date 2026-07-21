"""Slide-timing normalization regression tests.

TablEdit fakes the SOUND of a slide by storing rendering-hostile microtiming:
for a slide 5->8 it emits a straight source note, a short rest gap, then the
slide TARGET compressed to a triplet value and shifted OFF the beat grid (a
MIDI-playback hack, not a musical triplet). Confirmed against TablEdit's own
MusicXML export of salt-creek (20627 m1: source dur240 @0, target dur160 @320).

OTF stores the musical truth instead — the slide target as a normal on-grid
note of its real length, carrying only the "/" articulation — via
`normalize_slide_timing` (tef_parser.otf). We gate on the slide technique so
genuine musical triplets (never slides) are untouched, and the oracle applies
the same transform to the MusicXML side so exact-match verification survives.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.otf import retimed_slide_target  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"
TPB = 480  # ticks per quarter for these tabs


def _measure(doc_dict, track, measure_num):
    for m in doc_dict["notation"][track]:
        if m["measure"] == measure_num:
            return m
    raise AssertionError(f"measure {measure_num} not found")


def _slide_notes(measure):
    return [(ev["tick"], n) for ev in measure["events"]
            for n in ev["notes"] if n.get("tech") == "/"]


@pytest.fixture(scope="module")
def salt_creek():
    import json
    return json.loads(tef_to_otf(TEFReader(str(DOWNLOADS / "20627.tef")).parse()).to_json())


@pytest.fixture(scope="module")
def ground_speed():
    import json
    return json.loads(tef_to_otf(TEFReader(str(DOWNLOADS / "15313.tef")).parse()).to_json())


# ── the pure rule ───────────────────────────────────────────────────────────

def test_retime_triplet_compress_slide():
    """salt-creek's hack (target 320/160, source 0/240) -> clean 240/240."""
    assert retimed_slide_target(320, 160, "/", 0, 240, TPB) == (240, 240)


def test_retime_leaves_on_grid_slide():
    """An already-clean on-grid slide (m7: 1440/240) is unchanged."""
    assert retimed_slide_target(1440, 240, "/", 1200, 240, TPB) == (1440, 240)


def test_retime_ignores_non_slides():
    """A triplet note that is NOT a slide is never re-timed (spares real
    triplets that share the salt-creek target's exact tick/dur)."""
    assert retimed_slide_target(320, 160, None, 0, 240, TPB) == (320, 160)


def test_retime_is_idempotent():
    """Re-running on the normalized output is a no-op."""
    assert retimed_slide_target(240, 240, "/", 0, 240, TPB) == (240, 240)


# ── end-to-end through the parser ───────────────────────────────────────────

@pytest.mark.parametrize("measure_num", [1, 5])
def test_salt_creek_hack_slides_normalized(salt_creek, measure_num):
    """m1 and m5 slide targets land on the & of beat 1 with a full eighth."""
    slides = _slide_notes(_measure(salt_creek, "banjo", measure_num))
    assert len(slides) == 1
    tick, note = slides[0]
    assert (tick, note["dur"]) == (240, 240)
    assert note["s"] == 2 and note["f"] == 8


def test_salt_creek_clean_slide_untouched(salt_creek):
    """m7's on-grid slide (in a chord) is left exactly as parsed."""
    slides = _slide_notes(_measure(salt_creek, "banjo", 7))
    assert len(slides) == 1
    tick, note = slides[0]
    assert (tick, note["dur"], note["s"], note["f"]) == (1440, 240, 3, 7)


def test_no_sixteenth_rest_gap(salt_creek):
    """After normalization m1 is eight contiguous eighth notes (no gap)."""
    ticks = sorted(ev["tick"] for ev in _measure(salt_creek, "banjo", 1)["events"])
    assert ticks == [0, 240, 480, 720, 960, 1200, 1440, 1680]


def test_genuine_triplets_untouched(ground_speed):
    """ground-speed (15313) has real off-grid triplet notes that are NOT
    slides; normalization must not move them."""
    off_grid_triplets = [
        (m["measure"], ev["tick"], n["dur"])
        for m in ground_speed["notation"]["banjo"]
        for ev in m["events"] for n in ev["notes"]
        if n.get("dur") in (160, 320) and n.get("tech") != "/"
        and ev["tick"] % (TPB // 4) != 0
    ]
    # these are the genuine musical triplets — still present and off-grid
    assert (53, 640, 160) in off_grid_triplets
    assert (56, 640, 320) in off_grid_triplets


# ── parser <-> oracle agreement ─────────────────────────────────────────────

def test_oracle_still_verifies_salt_creek(salt_creek, tmp_path):
    """The normalized OTF still matches TablEdit's MusicXML exactly, because
    oracle_verify applies the identical slide policy to the XML side."""
    import json
    sys.path.insert(0, str(REPO_ROOT / "spike"))
    import oracle_verify

    otf_path = tmp_path / "salt_creek.otf.json"
    otf_path.write_text(json.dumps(salt_creek))
    result = oracle_verify.compare(
        str(otf_path), str(REPO_ROOT / "spike" / "oracle" / "batch" / "20627.xml"))
    assert result["verdict"] == "VERIFIED"
