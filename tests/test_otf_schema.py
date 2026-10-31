"""The OTF schema, its validator, and the corpus (G15a, issue #318).

Three jobs:

* the conformance fixtures in ``tests/fixtures/otf/`` say what is valid and
  what breaks which rule (``docs/js/__tests__/otf-editor/otf-validate.test.js``
  runs the same files through the JS validator);
* every copy of an allowed-value list in the code equals the schema's enum;
* every tracked ``.otf.json`` passes (the corpus sweep).

Fixture names carry the rule: ``schema--<what>`` is rejected by the JSON Schema
alone, ``cross--<rule>[--variant]`` passes the schema and breaks a cross-field
rule named ``<rule>`` (underscores), ``warn--<rule>`` is valid with a warning.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / 'sources' / 'banjo-hangout' / 'src'))

import otf_schema  # noqa: E402
from process_pending import validate_otf  # noqa: E402

FIXTURES = REPO / 'tests' / 'fixtures' / 'otf'
VALID = sorted((FIXTURES / 'valid').glob('*.json'))
INVALID = sorted((FIXTURES / 'invalid').glob('*.json'))
SCHEMA = otf_schema.load_schema()
SCHEMA_VALIDATOR = Draft202012Validator(SCHEMA)

CROSS_RULES = {'string_count', 'notation_keys', 'track_ids', 'measure_order',
               'tick_order', 'tick_range', 'duplicate_string', 'chord_index', 'chord_track',
               'chord_tick', 'chord_fingers', 'mark_order', 'mark_raw', 'annotation_track'}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def rule_of(path):
    kind, _, rest = path.stem.partition('--')
    return kind, rest.split('--')[0].replace('-', '_')


# ---------------------------------------------------------------- the schema

def test_the_schema_is_itself_valid_and_closed():
    Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA['$schema'] == 'https://json-schema.org/draft/2020-12/schema'
    assert SCHEMA['$id'] == 'https://bluegrassbook.com/schema/otf.schema.json'

    def walk(node, path):
        if isinstance(node, dict):
            if node.get('type') == 'object' and 'properties' in node:
                assert node.get('additionalProperties') is False, path
                for name, sub in node['properties'].items():
                    assert 'description' in sub, f'{path}/{name} has no description'
            for key, sub in node.items():
                walk(sub, f'{path}/{key}')
        elif isinstance(node, list):
            for i, sub in enumerate(node):
                walk(sub, f'{path}/{i}')
    walk(SCHEMA, '')


def test_the_canonical_key_order():
    assert list(SCHEMA['properties']) == [
        'otf_version', 'metadata', 'timing', 'tracks', 'notation',
        'annotations', 'reading_list', 'measure_marks', 'chords', 'chord_diagrams',
        'x_source']
    assert list(SCHEMA['$defs']['note']['properties']) == [
        's', 'f', 'dur', 'tie', 'tech', 'fx', 'grace', 'finger', 'lh', 'dyn']
    assert list(SCHEMA['properties']['tracks']['items']['properties']) == [
        'id', 'instrument', 'tuning', 'capo', 'role', 'dyn', 'percussion', 'lines']
    assert list(SCHEMA['properties']['annotations']['items']['properties']) == [
        'measure', 'tick', 'text', 'track', 'kind', 'place']
    assert list(SCHEMA['properties']['measure_marks']['items']['properties']) == [
        'measure', 'repeat_start', 'repeat_end', 'ending', 'jump', 'end_bar', 'raw']
    assert list(SCHEMA['properties']['chords']['items']['properties']) == [
        'name', 'frets', 'fingers', 'first_fret']
    assert list(SCHEMA['properties']['chord_diagrams']['items']['properties']) == [
        'measure', 'tick', 'track', 'chord', 'dx', 'dy']


def test_the_version_rule_is_written_in_the_schema():
    text = SCHEMA['description']
    for phrase in ('OPTIONAL field bumps the minor version', 'major',
                   'earlier 1.x stay valid', 'accept any 1.x'):
        assert phrase in text


# ------------------------------------------------------- conformance fixtures

def test_there_is_a_fixture_for_every_rule():
    names = [p.stem for p in INVALID]
    for rule in CROSS_RULES:
        assert any(rule_of(p) == ('cross', rule) for p in INVALID), rule
    assert len([n for n in names if n.startswith('schema--')]) >= 20


@pytest.mark.parametrize('path', VALID, ids=lambda p: p.stem)
def test_valid_fixtures_are_valid(path):
    doc = load(path)
    assert list(SCHEMA_VALIDATOR.iter_errors(doc)) == []
    errors, warnings = otf_schema.check(doc)
    assert errors == []
    assert validate_otf(doc) == []
    assert bool(warnings) == path.stem.startswith('warn--')


@pytest.mark.parametrize('path', INVALID, ids=lambda p: p.stem)
def test_invalid_fixtures_break_the_rule_they_are_named_for(path):
    doc = load(path)
    kind, rule = rule_of(path)
    schema_rejects = bool(list(SCHEMA_VALIDATOR.iter_errors(doc)))
    errors, _ = otf_schema.check(doc)
    assert errors, 'validator accepted an invalid fixture'
    assert validate_otf(doc) == errors
    if kind == 'schema':
        assert schema_rejects
        assert all(e.startswith('[schema]') for e in errors)
    else:
        assert kind == 'cross' and rule in CROSS_RULES
        assert not schema_rejects, 'a cross-field fixture must pass the schema'
        assert any(f'[{rule}]' in e for e in errors), errors


def test_the_reading_list_overrun_is_a_warning_not_an_error():
    doc = load(FIXTURES / 'valid' / 'warn--reading-list-overrun.json')
    errors, warnings = otf_schema.check(doc)
    assert errors == []
    assert len(warnings) == 1 and '[reading_list_overrun]' in warnings[0]


def test_validate_otf_keeps_its_contract():
    assert validate_otf('not an object') == ['not an object']
    assert validate_otf({'tracks': []})


def test_measure_length_follows_per_measure_overrides():
    doc = load(FIXTURES / 'valid' / 'valid--time-signature-change-lengths.json')
    assert otf_schema.measure_length(doc, 1) == 1440      # 6/8
    assert otf_schema.measure_length(doc, 2) == 960       # 2/4, this measure only
    assert otf_schema.measure_length(doc, 3) == 1440


# ------------------------------------------------------------- enum fences

def note_enum(name):
    return SCHEMA['$defs']['note']['properties'][name]['enum']


def test_python_enum_copies_equal_the_schema():
    from tef_parser import otf as tef_otf
    fx = SCHEMA['$defs']['note']['properties']['fx']['items']['enum']
    grace = SCHEMA['$defs']['note']['properties']['grace']['properties']['kind']['enum']
    assert tef_otf.FX_ORDER == fx
    assert [k for k in tef_otf.GRACE_KINDS if k is not None] == grace
    assert tef_otf.GRACE_KINDS[0] is None
    assert list(tef_otf.V3_PLUCK_LETTERS.values()) == note_enum('finger')


def test_dynamic_levels_equal_the_schema_loudest_first():
    import otf_format
    from tef_parser import otf as tef_otf
    track = SCHEMA['properties']['tracks']['items']['properties']['dyn']['enum']
    assert track == note_enum('dyn') == otf_format.DYN_LEVELS == tef_otf.DYN_LEVELS
    assert track == ['fff', 'ff', 'f', 'mf', 'mp', 'p', 'pp']      # TablEdit codes 0-6


def test_bend_sits_just_before_bend_release():
    fx = SCHEMA['$defs']['note']['properties']['fx']['items']['enum']
    assert fx[fx.index('bend-release') - 1] == 'bend'


def test_annotation_enums_equal_the_schema():
    props = SCHEMA['properties']['annotations']['items']['properties']
    assert props['kind']['enum'] == ['text', 'chord']
    assert props['place']['enum'] == ['above', 'below']
    assert 'track' not in SCHEMA['properties']['annotations']['items']['required']


def test_marks_enums_equal_the_schema():
    props = SCHEMA['properties']['measure_marks']['items']['properties']
    assert props['jump']['enum'] == ['da-signo', 'signo', 'al-coda', 'coda']
    assert (props['ending']['minimum'], props['ending']['maximum']) == (1, 6)
    assert (props['raw']['minimum'], props['raw']['maximum']) == (0, 255)


@pytest.mark.parametrize('raw, fields', [
    (0, {}),
    (0x07, {}),                                       # ending 7 = unspecified
    (0x40, {'repeat_start': True}),
    (0x80, {'repeat_end': True}),
    (0x81, {'repeat_end': True, 'ending': 1}),
    (0x0a, {'ending': 2, 'end_bar': True}),            # Red Haired Boy's 2nd ending
    (0x03, {'ending': 3}),
    (0x06, {'ending': 6}),
    (0x08, {'end_bar': True}),
    (0x10, {'jump': 'da-signo'}),
    (0x18, {'jump': 'signo'}),
    (0x20, {'jump': 'al-coda'}),
    (0x28, {'jump': 'coda'}),
    (0x30, {}),
    (0x38, {}),
    (0xce, {'repeat_start': True, 'repeat_end': True, 'ending': 6, 'end_bar': True}),
])
def test_decode_mark_raw(raw, fields):
    assert otf_schema.decode_mark_raw(raw) == fields


def test_ensure_version_at_least():
    ensure = otf_schema.ensure_version_at_least
    doc = {'otf_version': '1.0'}
    assert ensure(doc, '1.1') is True and doc['otf_version'] == '1.1'
    assert ensure(doc, '1.1') is False and ensure(doc, '1.0') is False
    assert ensure(doc, '1.2') is True and doc['otf_version'] == '1.2'
    assert ensure(doc, '1.3') is True and doc['otf_version'] == '1.3'
    assert ensure({'otf_version': '1.10'}, '1.2') is False        # numeric, not text
    odd = {'otf_version': '2.0'}
    assert ensure(odd, '1.2') is False and odd['otf_version'] == '2.0'
    assert ensure({}, '1.2') is False


def test_writers_stamp_the_current_version():
    from tef_parser.otf import OTFDocument
    assert otf_schema.OTF_VERSION == '1.3'
    assert OTFDocument().to_dict()['otf_version'] == '1.3'


# ------------------------------------------------------------------ corpus

CORPUS_PREFIXES = ('works/', 'docs/data/tabs/', 'tests/parser/fixtures/')
KNOWN_INVALID = FIXTURES / 'known_invalid.txt'


def tracked_otf_files():
    """The spec's four locations. docs/js/__tests__/fixtures/ is left out:
    those are partial test inputs, not documents."""
    out = subprocess.run(['git', 'ls-files', '*.otf.json'], cwd=REPO, text=True,
                         capture_output=True, check=True).stdout.split()
    return sorted(f for f in out
                  if f.startswith(CORPUS_PREFIXES)
                  or (f.startswith('sources/') and '/parsed/' in f))


def rule_ids(errors):
    return sorted({e.split(']')[0].lstrip('[') for e in errors})


def read_known_invalid():
    known = {}
    for line in KNOWN_INVALID.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            path, *rules = line.split()
            known[path] = sorted(rules)
    return known


def test_every_tracked_otf_validates_or_is_pinned_as_known_invalid():
    """Sweep the corpus with every rule strict, as a ratchet.

    ``known_invalid.txt`` pins the files that fail today and the rule ids each
    breaks. This fails if a file NOT on the list fails, if a listed file's set
    of rule ids changes, or if a listed ``sources/*/parsed/`` file starts passing
    (delete its line). A listed ``works/`` file that passes or is gone is fine:
    readers edit works on main, and that must not block a deploy.
    Warnings (reading-list overruns, #263) never fail.
    """
    known = read_known_invalid()
    files = tracked_otf_files()
    assert len(files) > 1000
    actual = {}
    for rel in files:
        doc = json.loads((REPO / rel).read_text(encoding='utf-8'))
        errors, _ = otf_schema.check(doc)
        if errors:
            actual[rel] = rule_ids(errors)
    new = {f: r for f, r in actual.items() if f not in known}
    # A works/ file can be fixed or deleted by a reader's edit (a bot commit on
    # main, .claude/rules/tests.md), so only the frozen sources/*/parsed/ lines
    # must be pruned when they stop failing; a fixed works/ line just goes stale.
    fixed = sorted(f for f in known if f not in actual and not f.startswith('works/'))
    changed = {f: (known[f], actual[f]) for f in known if f in actual and known[f] != actual[f]}
    problems = []
    if new:
        problems.append('NEW failures (fix the file; do not add it to the list): '
                        + '; '.join(f'{f} {r}' for f, r in sorted(new.items())[:10]))
    if fixed:
        problems.append(f'now passing, remove from known_invalid.txt: {fixed[:10]}')
    if changed:
        problems.append(f'rule ids changed: {dict(list(changed.items())[:10])}')
    assert not problems, '\n'.join(problems)


def test_the_example_in_the_field_guide_validates():
    import re
    guide = (REPO / 'docs' / 'schema' / 'otf.md').read_text(encoding='utf-8')
    example = json.loads(re.findall(r'```json\n(.*?)```', guide, re.S)[0])
    assert otf_schema.check(example) == ([], [])
