"""Chord charts: the `chord-chart` part of a work (G18a).

A chart is bars of chords, one cell per bar, a fixed number of slots per cell
(a slot is a chord or `\\`, "keep playing"). It lives in
`works/<song root>/chord-chart.yaml`. Design: docs/plans/2026-10-29-chord-charts.md.

    chart = parse(text)            # raises ChartError carrying every problem
    errors = validate_for_work(chart, work)
    text = serialize(chart)        # canonical; parse(serialize(c)) == c
    data = to_json(chart)          # what the build publishes
"""

import re
from dataclasses import dataclass, field
from typing import Optional

import yaml

from build_index import KEYS

PART_TYPE = 'chord-chart'
PART_FORMAT = 'chart'

# Slots per cell for each chart meter.
METER_SLOTS = {'duple': 2, '3/4': 1, '6/8': 2}
# Per-cell meter overrides (a bar of a different length) and their slots.
OVERRIDE_SLOTS = {'2/4': 1, '3/4': 1, '4/4': 2}
OVERRIDE_METERS = ('duple', '3/4')  # chart meters that allow overrides

TOP_LEVEL = ('key', 'meter', 'drawn_from', 'sections', 'repeats', 'form')

# Port of isValidChord / CHORD_QUALITY_RE in docs/js/chords.js. Keep them in
# step: tests/fixtures/chord-chart/chord-tokens.json pins both.
CHORD_QUALITY_RE = re.compile(
    r'(?:maj|min|dim|aug|sus|add|M|m|\d{1,2}|[#b]\d{1,2}|[+°øo])*',
    re.ASCII)
_CHORD_RE = re.compile(r'[A-G][#b]?([^/]*)(?:/[A-G][#b]?)?', re.ASCII)


def is_valid_chord(chord) -> bool:
    if not chord:
        return False
    m = _CHORD_RE.fullmatch(chord)
    return bool(m) and CHORD_QUALITY_RE.fullmatch(m.group(1)) is not None


class ChartError(ValueError):
    """A chart that does not parse; `errors` lists every problem found."""

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__('; '.join(self.errors))


@dataclass
class Cell:
    slots: tuple  # chord strings; None is a hold (`\`)
    meter: Optional[str] = None  # override ('2/4', '3/4', '4/4') or None


@dataclass
class Chart:
    key: str
    sections: dict  # name -> list of lines, each a list of Cell
    meter: str = 'duple'
    drawn_from: Optional[str] = None
    repeats: dict = field(default_factory=dict)  # name -> int >= 1
    form: Optional[list] = None


def _parse_cell(text, where, errors, meter):
    tokens = text.split()
    if not tokens:
        errors.append(f"{where}: empty cell")
        return None
    override = None
    if tokens[0] in OVERRIDE_SLOTS:
        override = tokens.pop(0)
        if meter not in OVERRIDE_METERS:
            errors.append(f"{where}: meter override {override} is not allowed "
                          f"in a {meter} chart")
            return None
    expected = OVERRIDE_SLOTS[override] if override else METER_SLOTS[meter]
    if len(tokens) != expected:
        errors.append(f"{where}: expected {expected} slot(s), got {len(tokens)}")
        return None
    slots = []
    for tok in tokens:
        if tok == '\\':
            slots.append(None)
        elif is_valid_chord(tok):
            slots.append(tok)
        else:
            errors.append(f"{where}: invalid chord {tok!r}")
            return None
    return Cell(tuple(slots), override)


def _parse_section(name, text, meter, errors):
    lines = []
    seen = 0
    for n, raw in enumerate(text.split('\n'), 1):
        line = raw.strip()
        if not line:
            continue
        seen += 1
        if len(line) < 2 or line[0] != '|' or line[-1] != '|':
            errors.append(f"section {name!r} line {n}: must start and end "
                          f"with '|'")
            continue
        cells = []
        for c, part in enumerate(line[1:-1].split('|'), 1):
            cell = _parse_cell(part, f"section {name!r} line {n} cell {c}",
                               errors, meter)
            if cell:
                cells.append(cell)
        lines.append(cells)
    if lines and lines[0] and lines[0][0].slots[0] is None:
        errors.append(f"section {name!r}: the first slot must be a chord, "
                      f"not '\\'")
    if not seen:
        errors.append(f"section {name!r}: no chart lines")
    return lines


def parse(text: str) -> Chart:
    """Parse chart YAML text; raise ChartError listing every problem."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise ChartError([f"not valid YAML: {e}"])
    if not isinstance(data, dict):
        raise ChartError(["chart must be a YAML mapping"])
    errors = []
    for k in data:
        if k not in TOP_LEVEL:
            errors.append(f"unknown field {k!r}")

    key = data.get('key')
    if key is None:
        errors.append("missing required field 'key'")
    elif key not in KEYS:
        errors.append(f"unknown key {key!r}")

    meter = data.get('meter', 'duple')
    if meter not in METER_SLOTS:
        errors.append(f"unknown meter {meter!r} (duple, 3/4 or 6/8)")
        meter = 'duple'

    drawn_from = data.get('drawn_from')
    if drawn_from is not None and not isinstance(drawn_from, str):
        errors.append("drawn_from must be a file name")
        drawn_from = None

    sections = {}
    raw_sections = data.get('sections')
    if raw_sections is None:
        errors.append("missing required field 'sections'")
    elif not isinstance(raw_sections, dict) or not raw_sections:
        errors.append("sections must be a non-empty mapping")
    else:
        for name, body in raw_sections.items():
            name = str(name)
            if not isinstance(body, str):
                errors.append(f"section {name!r}: chart lines must be a "
                              f"block string")
                continue
            sections[name] = _parse_section(name, body, meter, errors)

    repeats = {}
    raw_repeats = data.get('repeats')
    if raw_repeats is not None:
        if not isinstance(raw_repeats, dict):
            errors.append("repeats must be a mapping")
        else:
            for name, n in raw_repeats.items():
                if str(name) not in (raw_sections or {}):
                    errors.append(f"repeats names unknown section {name!r}")
                elif not isinstance(n, int) or isinstance(n, bool) or n < 1:
                    errors.append(f"repeats for {name!r} must be an integer "
                                  f">= 1")
                else:
                    repeats[str(name)] = n

    form = data.get('form')
    if form is not None:
        if not isinstance(form, list):
            errors.append("form must be a list of section names")
            form = None
        else:
            form = [str(n) for n in form]
            for name in form:
                if name not in (raw_sections or {}):
                    errors.append(f"form names unknown section {name!r}")

    if errors:
        raise ChartError(errors)
    return Chart(key=key, sections=sections, meter=meter,
                 drawn_from=drawn_from, repeats=repeats, form=form)


def validate_for_work(chart: Chart, work: dict) -> list:
    """Problems that need the work: `drawn_from` must be one of its lead sheets."""
    if chart.drawn_from is None:
        return []
    files = {p.get('file') for p in work.get('parts') or []
             if p.get('type') == 'lead-sheet'}
    if chart.drawn_from not in files:
        return [f"drawn_from {chart.drawn_from!r} is not a lead-sheet part of "
                f"this work"]
    return []


def chart_parts(work: dict) -> list:
    return [p for p in work.get('parts') or [] if p.get('type') == PART_TYPE]


def validate_work_parts(work: dict) -> list:
    """Part-level rules: at most one chart, and only on a song root."""
    parts = chart_parts(work)
    errors = []
    if len(parts) > 1:
        errors.append(f"{len(parts)} chord-chart parts (at most one)")
    if parts and work.get('song'):
        errors.append("chord-chart on a version (only a song root has one)")
    return errors


def _cell_text(cell: Cell) -> str:
    slots = ' '.join(s or '\\' for s in cell.slots)
    return f"{cell.meter} {slots}" if cell.meter else slots


def _lines_text(lines) -> str:
    return ''.join('| ' + ' | '.join(_cell_text(c) for c in cells) + ' |\n'
                   for cells in lines)


class _Dumper(yaml.SafeDumper):
    pass


def _str_repr(dumper, value):
    style = '|' if '\n' in value else None
    return dumper.represent_scalar('tag:yaml.org,2002:str', value, style=style)


_Dumper.add_representer(str, _str_repr)


def serialize(chart: Chart) -> str:
    """Canonical YAML text: fixed field order, single spaces inside lines."""
    data = {'key': chart.key, 'meter': chart.meter}
    if chart.drawn_from:
        data['drawn_from'] = chart.drawn_from
    data['sections'] = {n: _lines_text(ls) for n, ls in chart.sections.items()}
    if chart.repeats:
        data['repeats'] = {n: chart.repeats[n] for n in chart.sections
                           if n in chart.repeats}
    if chart.form is not None:
        data['form'] = list(chart.form)
    return yaml.dump(data, Dumper=_Dumper, sort_keys=False,
                     default_flow_style=None, allow_unicode=True)


def to_json(chart: Chart) -> dict:
    """The published form (docs/data/charts/<work-id>.json)."""
    def cell(c):
        out = {'slots': list(c.slots)}
        if c.meter:
            out['meter'] = c.meter
        return out

    out = {'key': chart.key, 'meter': chart.meter}
    if chart.drawn_from:
        out['drawn_from'] = chart.drawn_from
    out['sections'] = [
        {'name': n, 'repeat': chart.repeats.get(n, 1),
         'lines': [[cell(c) for c in cells] for cells in lines]}
        for n, lines in chart.sections.items()]
    if chart.form is not None:
        out['form'] = list(chart.form)
    return out
