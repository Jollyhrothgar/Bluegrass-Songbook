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


def test_no_false_positives_for_v3_records():
    """27493 (Jerusalem Ridge, V3): its export shows ZERO slurs, and V3
    records' byte 4 is the fret/type byte — if the V2 enum read ever
    touched 12-byte records it would alias frets 0-2 as h/p/slide.
    compute_articulations must skip non-V2 records entirely (V3 goes
    through compute_articulations_v3).
    """
    tef = TEFReader(str(TEF_23398.parent / "27493.tef")).parse()
    arts = compute_articulations(tef.note_events)
    assert arts == {}, f"expected no techniques, got {len(arts)}"


def test_enum_not_direction_and_no_bitmask_and_adjacency():
    """The oracle-fit V2 model, pinned on its discovery files:
    - 11245: descending hammer-ons (effect1=1, fret 3->2) — the old
      direction rule inverted them to pull-offs; TablEdit's export
      says hammer-on. Exact-enum totals match the export: 32 marks.
    - 24112: 138 notes carry effect1=0x05 (an unrelated effect); the
      old `& 0x03` mask fabricated hammers from them. Exact enum
      yields the export's 14 marks.
    - 11830: a slide flag whose next same-string note starts AFTER the
      source's written duration (rest between) must not pair: 5 marks,
      not 6.
    """
    from tef_parser import tef_to_otf

    def tech_count(sid):
        d = tef_to_otf(TEFReader(str(TEF_23398.parent / f"{sid}.tef")).parse()).to_dict()
        tid = next(iter(d["notation"]))
        return [(m["measure"], e["tick"], n["s"], n["f"], n["tech"])
                for m in d["notation"][tid] for e in m["events"]
                for n in e["notes"] if n.get("tech") in ("h", "p", "/")]

    t11245 = tech_count("11245")
    assert len(t11245) == 32
    assert (2, 840, 3, 2, "h") in t11245  # descending hammer-on kept as h

    assert len(tech_count("24112")) == 14  # 0x05 notes contribute nothing
    assert len(tech_count("11830")) == 5   # rest-gapped slide not paired


def test_double_stop_slides_mark_both_strings():
    """18779 m8: s2 f1->3 slides OVER s4 f3->5 (both sources flagged
    effect1=3, both destinations adjacent). TablEdit's MusicXML export
    carries the slur on only ONE string of the pair — the export is
    lossy; the parse keeps both."""
    from tef_parser import tef_to_otf
    d = tef_to_otf(TEFReader(str(TEF_23398.parent / "18779.tef")).parse()).to_dict()
    tid = next(iter(d["notation"]))
    techs = {(m["measure"], e["tick"], n["s"], n["f"]): n["tech"]
             for m in d["notation"][tid] for e in m["events"]
             for n in e["notes"] if n.get("tech")}
    assert techs.get((8, 240, 2, 3)) == "/"  # the string the export marks
    assert techs.get((8, 240, 4, 5)) == "/"  # the one it drops


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
