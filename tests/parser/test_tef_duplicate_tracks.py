"""Duplicate-instrument TEF files must produce unique OTF track ids.

Bug: instrument_to_otf_id() maps every 5-string instrument to "banjo"
(and any guitar to "guitar", etc.). Files with two+ instruments of the
same kind (e.g. 18998 Monroe's Hornpipe: banjo + banjo, or 10750 Katy
Hill: 3 guitars + banjo) either merged notations under one key
(pre-dedupe: impossible same-string fret conflicts, which the editor
then "loses" — the entire 308-note divergence on 10750) or, post-dedupe,
misaligned `doc.tracks[event.track]` indexing and dumped later tracks
into "unknown".

Fixture: tests/parser/fixtures/18998_dup_banjo.tef (two banjo tracks).
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "18998_dup_banjo.tef"


@pytest.fixture(scope="module")
def parsed_18998():
    return TEFReader(str(FIXTURE)).parse()


@pytest.fixture(scope="module")
def otf_18998(parsed_18998):
    otf = tef_to_otf(parsed_18998)
    return otf.to_dict() if hasattr(otf, "to_dict") else otf


def test_header_text_mentions_are_not_instruments(parsed_18998):
    """The comments say 'arranged for banjo by Michael Corcoran' — that
    'banjo' at offset 44 (inside the V2 header text region, header_end=258)
    is not an instrument. Real instrument records live at the file end
    (offsets 4118, 4168). Header says v2_tracks == 2.
    """
    names = [i.name for i in parsed_18998.instruments]
    assert len(names) == 2, f"expected 2 instruments, got {names}"
    assert parsed_18998.header.v2_tracks == 2


def test_track_ids_are_unique(otf_18998, parsed_18998):
    ids = [t["id"] for t in otf_18998["tracks"]]
    assert len(ids) == len(set(ids)), f"duplicate track ids: {ids}"
    # One OTF track per detected instrument keeps event.track indexing aligned.
    assert len(ids) == len(parsed_18998.instruments)


def test_no_unknown_track_and_no_merge(otf_18998):
    """Every instrument keeps its own notation; nothing lands in 'unknown'."""
    keys = set(otf_18998["notation"].keys())
    assert "unknown" not in keys
    track_ids = {t["id"] for t in otf_18998["tracks"]}
    assert keys <= track_ids
    # Both real banjo tracks contribute notes under their own ids.
    non_empty = [k for k, v in otf_18998["notation"].items()
                 if any(ev["notes"] for m in v for ev in m["events"])]
    assert len(non_empty) >= 2, f"expected >=2 populated tracks, got {non_empty}"


def test_no_same_string_fret_conflicts(otf_18998):
    """The merge signature: two different frets on one string at one tick."""
    for track, measures in otf_18998["notation"].items():
        for m in measures:
            for ev in m["events"]:
                by_string = {}
                for n in ev["notes"]:
                    if n["s"] in by_string and by_string[n["s"]] != n["f"]:
                        pytest.fail(
                            f"track {track} m{m['measure']} t{ev['tick']}: "
                            f"string {n['s']} has frets {by_string[n['s']]} and {n['f']}"
                        )
                    by_string[n["s"]] = n["f"]
