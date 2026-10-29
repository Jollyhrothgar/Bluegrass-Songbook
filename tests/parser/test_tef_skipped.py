"""G15e: the importer counts what a .tef holds that OTF does not keep.

Fixtures are built by ``make_skipped_fixtures.py`` (real fixtures with note
records overwritten), each feature at a distinct count so a miscount shows.
The JS importer is held to the same numbers in
``docs/js/__tests__/tef-skipped.test.js`` and by the golden gate.
"""
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))
sys.path.insert(0, str(HERE))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.skipped import SKIPPED_KEYS  # noqa: E402
import make_skipped_fixtures as fx  # noqa: E402

FIXTURES = HERE / "fixtures"


def skipped(name):
    return TEFReader(str(FIXTURES / name)).parse().skipped


@pytest.mark.parametrize("key,count", sorted(fx.EXPECTED_V3.items()))
def test_v3_counts_each_feature(key, count):
    assert skipped("skipped_v3_all.tef")[key] == count


@pytest.mark.parametrize("key,count", sorted(fx.EXPECTED_V2.items()))
def test_v2_counts_each_feature(key, count):
    assert skipped("skipped_v2_all.tef")[key] == count


def test_nothing_else_is_counted():
    assert skipped("skipped_v3_all.tef") == fx.EXPECTED_V3
    assert skipped("skipped_v2_all.tef") == fx.EXPECTED_V2


def test_fixtures_are_current():
    """The committed fixtures are what the generator writes."""
    assert (FIXTURES / "skipped_v3_all.tef").read_bytes() == fx.v3()
    assert (FIXTURES / "skipped_v2_all.tef").read_bytes() == fx.v2()


def test_layout_and_ported_components_are_not_counted():
    """Rests, line breaks, spacing, beam/stem marks, text, chord diagrams and
    reading guides are in the fixtures and must stay out of the counts."""
    for name in ("skipped_v3_all.tef", "skipped_v2_all.tef"):
        assert "chord_diagrams" not in skipped(name)


@pytest.mark.parametrize("name", [
    "cherokee_shuffle_21874_v3.tef", "18998_dup_banjo.tef",
    "wheel_hoss_2430_packed_tracks.tef", "2927_gold_rush_percussion.tef"])
def test_a_file_with_nothing_skipped_has_no_x_source(name):
    tef = TEFReader(str(FIXTURES / name)).parse()
    assert tef.skipped == {}
    assert "x_source" not in tef_to_otf(tef).to_dict()


def test_x_source_skipped_is_written_in_key_order():
    doc = tef_to_otf(TEFReader(str(FIXTURES / "skipped_v3_all.tef")).parse()).to_dict()
    assert list(doc["x_source"]) == ["skipped"]
    assert list(doc["x_source"]["skipped"]) == [
        k for k in SKIPPED_KEYS if k in fx.EXPECTED_V3]


def test_a_key_added_by_another_importer_is_kept_and_ordered():
    """chord_diagrams is set by the chord-diagram importer on tef.skipped."""
    tef = TEFReader(str(FIXTURES / "skipped_v3_all.tef")).parse()
    tef.skipped["chord_diagrams"] = 2
    keys = list(tef_to_otf(tef).to_dict()["x_source"]["skipped"])
    assert keys.index("chord_diagrams") == keys.index("percussion") + 1


def test_the_schema_description_lists_every_key():
    schema = json.loads((REPO_ROOT / "docs/schema/otf.schema.json").read_text())
    description = schema["properties"]["x_source"]["description"]
    positions = [description.index(f"{k} = ") for k in SKIPPED_KEYS]
    assert positions == sorted(positions), "keys are listed in SKIPPED_KEYS order"


def test_skipped_survives_the_converter(tmp_path):
    """converter.py rewrites x_source; the count must come through it."""
    sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))
    from converter import convert_single  # noqa: E402
    out = tmp_path / "out.otf.json"
    convert_single(FIXTURES / "skipped_v3_all.tef", out)
    x_source = json.loads(out.read_text())["x_source"]
    assert x_source["skipped"] == fx.EXPECTED_V3
    assert x_source["type"] == "local"
