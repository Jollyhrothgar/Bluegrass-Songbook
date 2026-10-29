"""Chord charts (G18a): the parser, the canonical form, and the build.

Fixtures are frozen copies in tests/fixtures/chord-chart/. Old Home Place is
the spec's chart; every other fixture is synthetic with placeholder chords.
"""

import json
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

import chord_chart as cc  # noqa: E402
from build_works_index import build_works_index  # noqa: E402

FIX = REPO_ROOT / "tests" / "fixtures" / "chord-chart"
FIXTURES = sorted(FIX.glob("*.chord-chart.yaml"))


def load(name):
    return cc.parse((FIX / f"{name}.chord-chart.yaml").read_text())


def errors_of(text):
    with pytest.raises(cc.ChartError) as e:
        cc.parse(text)
    return e.value.errors


def chart_text(lines="| G \\ | C \\ |", extra="", key="G", meter=None):
    body = "".join(f"    {ln}\n" for ln in lines.split("\n"))
    head = f"key: {key}\n" + (f"meter: {meter}\n" if meter else "")
    return f"{head}{extra}sections:\n  A: |\n{body}"


# ---------------------------------------------------------- chord tokens

TOKENS = json.loads((FIX / "chord-tokens.json").read_text())


@pytest.mark.parametrize("tok", TOKENS["valid"])
def test_valid_tokens(tok):
    assert cc.is_valid_chord(tok)


@pytest.mark.parametrize("tok", TOKENS["invalid"])
def test_invalid_tokens(tok):
    assert not cc.is_valid_chord(tok)


# --------------------------------------------------------------- parsing

def test_old_home_place():
    c = load("old-home-place")
    assert (c.key, c.meter, c.drawn_from) == ("A", "duple", "lead-sheet.pro")
    assert list(c.sections) == ["Verse", "Chorus"]
    assert len(c.sections["Verse"]) == 4 and len(c.sections["Verse"][0]) == 4
    assert c.sections["Verse"][0][1].slots == ("C#7", None)
    assert c.form == ["Verse", "Verse", "Chorus", "Verse", "Verse", "Chorus", "Chorus"]


def test_waltz_has_one_slot_per_cell():
    c = load("synthetic-waltz")
    assert c.meter == "3/4"
    assert all(len(cell.slots) == 1 for ln in c.sections["A"] for cell in ln)


def test_override_cell():
    cell = load("synthetic-override").sections["A"][0][2]
    assert cell.meter == "2/4" and cell.slots == ("D",)


def test_aabb_repeats_and_ten_cell_part():
    c = load("synthetic-aabb")
    assert c.repeats == {"A": 2, "B": 2}
    assert sum(len(ln) for ln in c.sections["B"]) == 10


def test_form_fixture():
    assert load("synthetic-form").form == ["A", "B", "Chorus", "A", "Chorus"]


def test_blank_lines_and_outer_whitespace_are_skipped():
    c = cc.parse(chart_text("\n| G \\ |  \n\n| C \\ |\n"))
    assert len(c.sections["A"]) == 2


@pytest.mark.parametrize("meter,cell,ok", [
    ("duple", "| 2/4 G |", True), ("duple", "| 4/4 G \\ |", True),
    ("3/4", "| 2/4 G |", True), ("6/8", "| 2/4 G |", False),
    ("duple", "| 3/4 G \\ |", False),
])
def test_override_rules(meter, cell, ok):
    text = chart_text(f"| G \\ | C \\ |\n{cell}", meter=meter)
    if meter == "3/4":
        text = chart_text(f"| G | C |\n{cell}", meter=meter)
    if ok:
        cc.parse(text)
    else:
        assert errors_of(text)


# ---------------------------------------------------------------- errors

def test_unknown_top_level_field():
    assert any("unknown field 'sectoins'" in e
               for e in errors_of(chart_text(extra="sectoins: 1\n")))


def test_missing_key_and_sections():
    errs = errors_of("meter: duple\n")
    assert any("'key'" in e for e in errs) and any("'sections'" in e for e in errs)


def test_unknown_key():
    assert any("unknown key" in e for e in errors_of(chart_text(key="H")))


def test_unknown_meter():
    assert any("unknown meter" in e for e in errors_of(chart_text(meter="5/4")))


def test_empty_sections():
    assert any("non-empty" in e for e in errors_of("key: G\nsections: {}\n"))


def test_line_must_start_and_end_with_bar():
    errs = errors_of(chart_text("| G \\ | C \\\n  G \\ |"))
    assert len(errs) == 2 and "line 1" in errs[0] and "line 2" in errs[1]


def test_wrong_slot_count_names_section_line_cell():
    errs = errors_of(chart_text("| G \\ | C \\ |\n| G \\ | C |"))
    assert errs == ["section 'A' line 2 cell 2: expected 2 slot(s), got 1"]


def test_wrong_slot_count_after_override():
    assert any("expected 1" in e for e in errors_of(chart_text("| 2/4 G \\ |")))


def test_invalid_chord_named():
    assert any("'H7'" in e for e in errors_of(chart_text("| H7 \\ |")))


def test_empty_cell():
    assert any("empty cell" in e for e in errors_of(chart_text("| G \\ | |")))


def test_first_slot_must_be_a_chord():
    assert any("first slot" in e for e in errors_of(chart_text("| \\ G |")))


def test_repeats_must_be_positive_integer_for_known_section():
    for bad in ("A: 0", "A: x", "A: 1.5", "B: 2"):
        assert errors_of(chart_text(extra=f"repeats: {{{bad}}}\n")), bad


def test_form_names_must_exist():
    assert any("'Z'" in e for e in errors_of(chart_text(extra="form: [A, Z]\n")))


def test_all_errors_reported_not_just_the_first():
    errs = errors_of(chart_text("| H \\ |\n| G |\n| G \\", key="Q"))
    assert len(errs) >= 4


def test_not_a_mapping():
    assert errors_of("- a\n- b\n")


def test_drawn_from_must_be_a_lead_sheet_of_the_work():
    c = load("old-home-place")
    work = {"parts": [{"type": "lead-sheet", "file": "lead-sheet.pro"}]}
    assert cc.validate_for_work(c, work) == []
    assert cc.validate_for_work(c, {"parts": [{"type": "tablature", "file": "lead-sheet.pro"}]})
    assert cc.validate_for_work(load("synthetic-waltz"), {"parts": []}) == []


def test_work_part_rules():
    part = {"type": "chord-chart", "file": "chord-chart.yaml"}
    assert cc.validate_work_parts({"parts": [part]}) == []
    assert cc.validate_work_parts({"parts": [part, part]})
    assert cc.validate_work_parts({"song": "root", "parts": [part]})


# ------------------------------------------------- serialize / round trip

@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_round_trip_and_idempotence(path):
    c = cc.parse(path.read_text())
    text = cc.serialize(c)
    assert cc.parse(text) == c
    assert cc.serialize(cc.parse(text)) == text


def test_canonical_spacing():
    text = cc.serialize(cc.parse(chart_text("|G   \\|  C#7 \\  |")))
    assert "| G \\ | C#7 \\ |" in text


# ------------------------------------------------------------------ JSON

def test_to_json_shape():
    data = cc.to_json(load("old-home-place"))
    assert list(data) == ["key", "meter", "drawn_from", "sections", "form"]
    assert data["sections"][0]["name"] == "Verse"
    assert data["sections"][0]["repeat"] == 1
    assert data["sections"][0]["lines"][0][:2] == [
        {"slots": ["A", None]}, {"slots": ["C#7", None]}]
    assert data["form"][0] == "Verse"


def test_to_json_omits_absent_fields_and_carries_overrides_and_repeats():
    data = cc.to_json(load("synthetic-override"))
    assert "drawn_from" not in data and "form" not in data
    assert data["sections"][0]["lines"][0][2] == {"slots": ["D"], "meter": "2/4"}
    assert [s["repeat"] for s in cc.to_json(load("synthetic-aabb"))["sections"]] == [2, 2]


# ----------------------------------------------------------------- build

LEAD = '{meta: title Test Tune}\n[G]Way down [C]yonder\n'


def make_work(works, wid, parts, chart=None, **extra):
    d = works / wid
    d.mkdir(parents=True)
    (d / "work.yaml").write_text(yaml.dump(
        {"id": wid, "title": wid.title(), "parts": parts, **extra}, sort_keys=False))
    (d / "lead-sheet.pro").write_text(LEAD + f"[D]{wid}\n")  # distinct: no dedup
    if chart is not None:
        (d / "chord-chart.yaml").write_text(chart)


LS = {"type": "lead-sheet", "format": "chordpro", "file": "lead-sheet.pro"}
CH = {"type": "chord-chart", "format": "chart", "file": "chord-chart.yaml"}
GOOD = (FIX / "synthetic-form.chord-chart.yaml").read_text()


class TestBuild:
    @pytest.fixture
    def repo(self, tmp_path, monkeypatch):
        (tmp_path / "docs" / "data").mkdir(parents=True)
        (tmp_path / "docs" / "index.html").write_text(
            (REPO_ROOT / "docs" / "index.html").read_text(encoding="utf-8"),
            encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        return tmp_path

    def build(self):
        build_works_index(Path("works"), Path("docs/data/index.jsonl"),
                          enrich_tags=False, fuzzy_grouping=False, num_workers=1)

    def rows(self):
        out = {}
        for name in ("index.jsonl", "archive.jsonl"):
            for line in Path("docs/data", name).read_text().splitlines():
                r = json.loads(line)
                out[r["id"]] = r
        return out

    def test_publishes_json_and_sets_row_field(self, repo):
        make_work(repo / "works", "with-chart", [LS, CH], GOOD)
        make_work(repo / "works", "no-chart", [LS])
        self.build()
        rows = self.rows()
        assert rows["with-chart"]["chord_chart"] == "data/charts/with-chart.json"
        assert "chord_chart" not in rows["no-chart"]
        assert "_chart" not in rows["with-chart"]
        published = json.loads(Path("docs/data/charts/with-chart.json").read_text())
        assert published == cc.to_json(cc.parse(GOOD))
        assert not Path("docs/data/charts/no-chart.json").exists()

    def test_orphans_are_pruned(self, repo):
        make_work(repo / "works", "with-chart", [LS, CH], GOOD)
        charts = repo / "docs" / "data" / "charts"
        charts.mkdir()
        (charts / "gone.json").write_text("{}")
        self.build()
        assert not (charts / "gone.json").exists()
        assert (charts / "with-chart.json").exists()

    def test_chart_alone_does_not_publish_a_work(self, repo):
        d = repo / "works" / "chart-only"
        d.mkdir(parents=True)
        (d / "work.yaml").write_text(yaml.dump(
            {"id": "chart-only", "title": "Chart Only", "parts": [CH]}))
        (d / "chord-chart.yaml").write_text(GOOD)
        self.build()
        assert "chart-only" not in self.rows()

    @pytest.mark.parametrize("case", ["invalid", "two", "version", "drawn_from", "missing"])
    def test_bad_charts_fail_the_build(self, repo, capsys, case):
        works = repo / "works"
        make_work(works, "fine", [LS, CH], GOOD)
        if case == "invalid":
            make_work(works, "bad", [LS, CH], chart_text("| H \\ |"))
        elif case == "two":
            make_work(works, "bad", [LS, CH, {**CH, "file": "other.yaml"}], GOOD)
        elif case == "version":
            make_work(works, "bad", [LS, CH], GOOD, song="fine", version="2")
        elif case == "drawn_from":
            make_work(works, "bad", [LS, CH], GOOD.replace("key: G", "key: G\ndrawn_from: nope.pro"))
        else:
            make_work(works, "bad", [LS, CH])
        with pytest.raises(SystemExit) as e:
            self.build()
        assert e.value.code == 1
        assert "bad/" in capsys.readouterr().out
        # Nothing was written.
        assert not Path("docs/data/charts").exists()
        assert not Path("docs/data/index.jsonl").exists()


# ----------------------------------------------------------- corpus sweep

def test_every_chart_in_works_is_valid():
    # Live-data smoke test (.claude/rules/tests.md): none exist yet. Same rules
    # as the build gate, so a hand-edited chart fails in PR checks, not deploy.
    problems = []
    for wy in sorted((REPO_ROOT / "works").glob("*/work.yaml")):
        work = yaml.safe_load(wy.read_text(encoding="utf-8")) or {}
        parts = cc.chart_parts(work)
        if not parts:
            continue
        errors = cc.validate_work_parts(work)
        try:
            chart = cc.parse((wy.parent / parts[0]["file"]).read_text(encoding="utf-8"))
            errors += cc.validate_for_work(chart, work)
        except (OSError, cc.ChartError) as e:
            errors += getattr(e, "errors", [str(e)])
        problems += [f"{wy.parent.name}: {m}" for m in errors]
    assert not problems, "\n".join(problems)
