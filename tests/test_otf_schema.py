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
from collections import defaultdict
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
               'tick_order', 'tick_range', 'duplicate_string'}


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
        'annotations', 'reading_list', 'x_source']
    assert list(SCHEMA['$defs']['note']['properties']) == [
        's', 'f', 'dur', 'tie', 'tech', 'fx', 'grace', 'finger', 'lh']


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


# ------------------------------------------------------------------ corpus

def tracked_otf_files():
    out = subprocess.run(['git', 'ls-files', '*.otf.json'], cwd=REPO, text=True,
                         capture_output=True, check=True).stdout.split()
    return sorted(out)


@pytest.mark.xfail(
    strict=True,
    reason='PENDING the orchestrator/Mike decision (G15a hard stop): real files '
           'break duplicate_string, notation_keys, string_count, track_ids and '
           'the schema. Fix the data or relax the rule, then delete this mark.')
def test_every_tracked_otf_validates():
    """Sweep ``git ls-files '*.otf.json'``: works/, docs/data/tabs fixtures,
    docs/js/__tests__/fixtures, tests/parser/fixtures, sources/*/parsed.

    A failure here is a real file breaking a real rule. Warnings (reading-list
    overruns, #263) are reported but do not fail.
    """
    failures = defaultdict(list)
    warned = []
    files = tracked_otf_files()
    assert len(files) > 1000
    for rel in files:
        doc = json.loads((REPO / rel).read_text(encoding='utf-8'))
        errors, warnings = otf_schema.check(doc)
        for e in errors:
            rule = e.split(']')[0].lstrip('[')
            failures[rule].append(f'{rel}: {e}')
        if warnings:
            warned.append(rel)
    summary = [f'{rule}: {len({f.split(": ")[0] for f in v})} files, {len(v)} items; '
               f'e.g. {v[0]}' for rule, v in sorted(failures.items())]
    assert not failures, '\n'.join(summary)


def test_the_example_in_the_field_guide_validates():
    import re
    guide = (REPO / 'docs' / 'schema' / 'otf.md').read_text(encoding='utf-8')
    example = json.loads(re.findall(r'```json\n(.*?)```', guide, re.S)[0])
    assert otf_schema.check(example) == ([], [])
