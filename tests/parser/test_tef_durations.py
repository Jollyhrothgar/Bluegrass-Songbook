"""Note durations from the TEF duration byte (V2 byte3 / V3 byte5).

The byte's bits 0-4 are a duration code; upper bits are dynamics (V2's
dynamic 7 = tie sentinel, V3's bit 7 = tie flag). Both format branches
historically misread this byte as a 'marker char' (0x49 'I' is just an
eighth note with dynamics) and emitted NO durations — the renderer then
inferred lengths from gaps, drawing wrong stems/flags wherever notes
sustain (Mike caught 25635). Decoding:

    base = 1920 >> (code // 3)
    code % 3 == 0 -> base (straight)
    code % 3 == 1 -> base * 3/4  (dotted of the next-shorter value;
                     a naive base * 3/2 verified 2x long on every
                     dotted note in 23408/27165/11245/11514/17713)
    code % 3 == 2 -> base * 2/3  (triplet)

Oracle-validated against TablEdit MusicXML <duration> corpus-wide:
all 41 downloads-backed files VERIFIED/PARTIAL with (measure, tick,
string, fret, dur) tuples.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.reader import decode_duration_code  # noqa: E402

DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"
FIXTURES = Path(__file__).parent / "fixtures"


def test_decode_duration_code_table():
    assert decode_duration_code(0) == 1920   # whole
    assert decode_duration_code(3) == 960    # half
    assert decode_duration_code(6) == 480    # quarter
    assert decode_duration_code(9) == 240    # eighth
    assert decode_duration_code(12) == 120   # 16th
    assert decode_duration_code(15) == 60    # 32nd
    # dotted = 3/4 of the base (dotted of the next-shorter value)
    assert decode_duration_code(7) == 360    # dotted eighth
    assert decode_duration_code(4) == 720    # dotted quarter
    assert decode_duration_code(1) == 1440   # dotted half
    # triplet = 2/3 of the base
    assert decode_duration_code(11) == 160   # eighth triplet
    assert decode_duration_code(8) == 320    # quarter triplet


@pytest.mark.skipif(not (DOWNLOADS / "25635.tef").exists(),
                    reason="downloads corpus not present")
def test_v3_notes_carry_durations():
    """25635 (V3): every note gets a written duration; the histogram
    matches TablEdit's MusicXML export (mostly eighths, some quarters,
    16ths, 4 halves, 1 whole on the banjo track)."""
    otf = tef_to_otf(TEFReader(str(DOWNLOADS / "25635.tef")).parse()).to_dict()
    tid = otf["tracks"][0]["id"]
    durs = [n.get("dur")
            for m in otf["notation"][tid] for ev in m["events"]
            for n in ev["notes"] if not n.get("tie")]
    assert all(d is not None for d in durs)
    assert durs.count(240) > 400          # roll eighths dominate
    assert durs.count(1920) == 1          # the one whole note


@pytest.mark.skipif(not (DOWNLOADS / "25635.tef").exists(),
                    reason="downloads corpus not present")
def test_header_tempo_replaces_the_100bpm_hardcode():
    """Tempo comes from the file: V2 = header tempo field, V3 = u16 at
    0x06. Oracle-verified 40/40 across the corpus (25635's 260 equals
    its Rich-MIDI export tempo meta exactly). The old hardcoded 100
    played 25635 at ~38% speed."""
    v3 = tef_to_otf(TEFReader(str(DOWNLOADS / "25635.tef")).parse()).to_dict()
    assert v3["metadata"]["tempo"] == 260
    v2 = tef_to_otf(TEFReader(str(DOWNLOADS / "21874.tef")).parse()).to_dict()
    assert v2["metadata"]["tempo"] == 200


@pytest.mark.skipif(not (DOWNLOADS / "25635.tef").exists(),
                    reason="downloads corpus not present")
def test_v3_articulations_from_byte6():
    """V3 techniques live in byte 6 of the record, on the SOURCE note
    (1 = hammer, 2 = pull-off, 3 = slide), attributed to the next note
    on the same string. They had silently died: the V2 effect1 gate
    always trips on V3 (byte 4 is the fret byte), and the old fallback
    misread byte 5 — the DURATION byte. Oracle: 25635's export has
    exactly 22 destination marks (14 sl + 5 h + 3 p); 27493's has none.
    """
    d = tef_to_otf(TEFReader(str(DOWNLOADS / "25635.tef")).parse()).to_dict()
    techs = [(m["measure"], e["tick"], n["s"], n["f"], n["tech"])
             for m in d["notation"]["banjo"] for e in m["events"]
             for n in e["notes"] if n.get("tech")]
    assert len(techs) == 22
    from collections import Counter
    assert Counter(t[-1] for t in techs) == {"/": 14, "h": 5, "p": 3}
    # TablEdit's m2 "Sl 4->5" lands on the destination note
    assert (2, 720, 4, 5, "/") in techs
    # the m9 hammer chain 0->2->4: both destinations marked
    assert (9, 1560, 4, 2, "h") in techs and (9, 1680, 4, 4, "h") in techs

    d27 = tef_to_otf(TEFReader(str(DOWNLOADS / "27493.tef")).parse()).to_dict()
    assert not any(n.get("tech")
                   for ms in d27["notation"].values() for m in ms
                   for e in m["events"] for n in e["notes"])


@pytest.mark.skipif(not (DOWNLOADS / "21874.tef").exists(),
                    reason="downloads corpus not present")
def test_v2_notes_carry_durations():
    """21874 (V2): byte3 bits 0-4 decode the same way."""
    otf = tef_to_otf(TEFReader(str(DOWNLOADS / "21874.tef")).parse()).to_dict()
    tid = otf["tracks"][0]["id"]
    durs = [n.get("dur")
            for m in otf["notation"][tid] for ev in m["events"]
            for n in ev["notes"]]
    assert durs and all(d is not None for d in durs)
    assert set(durs) <= {1920, 1440, 960, 720, 480, 360, 320, 240, 160, 120, 90, 80, 60}
