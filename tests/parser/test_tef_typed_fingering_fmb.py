"""Foggy Mountain Breakdown's typed m/i letters become banjo fingering (G21b).

Foggy Mountain Breakdown 1481 (V2) has 426 m/i letters on the banjo, all
`place: "below"`, each over a single note. tests/fixtures/tab-fingering/
fmb-banjo-fingering.json is the frozen answer: where every letter was
([measure, tick, string, finger]), and how many annotations are left. It was
frozen from the file before G21b, not from the new code.

JS counterpart: docs/js/__tests__/tef-import-typed-fingering-fmb.test.js
"""

import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
import otf_schema  # noqa: E402

FROZEN = json.loads((REPO_ROOT / "tests/fixtures/tab-fingering/fmb-banjo-fingering.json").read_text())
FMB = REPO_ROOT / FROZEN["source"]


def convert():
    return tef_to_otf(TEFReader(str(FMB)).parse()).to_dict()


def fingered(otf, track):
    return sorted([m["measure"], e["tick"], n["s"], n["finger"]]
                  for m in otf["notation"][track] for e in m["events"]
                  for n in e["notes"] if "finger" in n)


def test_the_426_letters_become_the_banjo_notes_finger():
    otf = convert()
    assert len(FROZEN["fingering"]) == 426
    assert fingered(otf, "banjo") == FROZEN["fingering"]
    assert Counter(f for *_, f in FROZEN["fingering"]) == {"M": 226, "I": 200}
    # no other track gains fingering
    assert not any(fingered(otf, t) for t in otf["notation"] if t != "banjo")


def test_the_letters_leave_the_annotations_and_nothing_else_does():
    otf = convert()
    assert len(otf["annotations"]) == FROZEN["annotations_after"] == 551
    assert not [a for a in otf["annotations"] if a["text"].strip().lower() in ("m", "i")]
    assert FROZEN["annotations_before"] - len(FROZEN["fingering"]) == FROZEN["annotations_after"]


def test_chord_names_are_chords_and_the_rest_stays_text():
    otf = convert()
    chords = [a for a in otf["annotations"] if a.get("kind") == "chord"]
    assert len(chords) == 415
    assert {a["text"] for a in otf["annotations"] if "kind" not in a} >= {
        "etc.", "G: Lead Guitar...", "G: Rhythm Guitar...", "G: Bass...", "Blank for now..."}
    assert otf_schema.check(otf) == ([], [])
