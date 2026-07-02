"""TEF parser articulation regression tests.

Ground truth: TablEdit's own MusicXML export of the same file
(spike/oracle/23398.xml), which shows 4 pull-offs + 1 hammer-on on
string 1 in Angeline the Baker (measures 6/9/11/13 p, measure 14 h).

Bug fixed: compute_articulations() paired a legato-marked source note
with the next note on the string only if it was within 2 position units
(a 32nd note) — eighth-note hammer/pull pairs (gap 4) were dropped, so
the parser emitted almost no techniques.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.otf import (  # noqa: E402
    articulation_max_gap,
    compute_articulations,
    has_legato_effect,
)

TEF_23398 = REPO_ROOT / "sources" / "banjo-hangout" / "downloads" / "23398.tef"


@pytest.fixture(scope="module")
def tef_23398():
    return TEFReader(str(TEF_23398)).parse()


def test_legato_sources_detected(tef_23398):
    """The 5 legato-marked source notes (4 pulls + 1 hammer) are flagged."""
    legato = [e for e in tef_23398.note_events if has_legato_effect(e)]
    assert len(legato) == 5


def test_articulations_match_tabledit_oracle(tef_23398):
    """All 5 legato pairs resolve to techniques: 4 pull-offs + 1 hammer-on.

    Eighth-note pairs (gap 32 in native V2 grid units) must pair, not
    just 32nd-note pairs.
    """
    arts = compute_articulations(
        tef_23398.note_events,
        max_gap=articulation_max_gap(tef_23398.header))
    techs = sorted(arts.values())
    assert techs == ["h", "p", "p", "p", "p"], f"got {arts}"


def test_no_false_positives_when_effect_byte_is_not_a_flag_field():
    """27493 (Jerusalem Ridge): TablEdit's MusicXML export shows ZERO
    hammer-ons/pull-offs on the banjo track, but the raw byte read as
    'effect1' takes values 1..15 across melody notes — it is not an
    effects bitfield in this file, and `effect1 & 0x03` fires on most
    notes. The plausibility gate must reject the whole flag set.
    """
    tef = TEFReader(str(TEF_23398.parent / "27493.tef")).parse()
    arts = compute_articulations(tef.note_events)
    assert arts == {}, f"expected no techniques, got {len(arts)}"


def test_otf_carries_techniques(tef_23398):
    """Techniques survive into the OTF output."""
    otf = tef_to_otf(tef_23398)
    d = otf.to_dict() if hasattr(otf, "to_dict") else otf
    track = next(iter(d["notation"]))
    found = []
    for m in d["notation"][track]:
        for ev in m["events"]:
            for n in ev["notes"]:
                if n.get("tech"):
                    found.append((m["measure"], n["tech"]))
    assert sorted(t for _, t in found) == ["h", "p", "p", "p", "p"], f"got {found}"
    # Pull-off destinations land in measures 6/9/11/13, hammer in 14.
    assert sorted(m for m, t in found if t == "p") == [6, 9, 11, 13]
    assert [m for m, t in found if t == "h"] == [14]
