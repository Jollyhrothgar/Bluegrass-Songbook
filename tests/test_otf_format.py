"""G15b: the one OTF file layout (scripts/lib/otf_format.py).

The JS twin (docs/js/otf-format.js) is tested against the same fixtures in
docs/js/__tests__/otf-format.test.js, so passing both proves identical bytes.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

import otf_format
from otf_format import serialize

REPO_ROOT = Path(__file__).resolve().parents[1]
LAYOUT = REPO_ROOT / 'tests' / 'fixtures' / 'otf' / 'layout'
SCHEMA = json.loads((REPO_ROOT / 'docs/schema/otf.schema.json').read_text())


def tracked_otf_files():
    """The four places the rewrite covers (G15b), tracked files only."""
    out = subprocess.run(
        ['git', 'ls-files', 'works/*/*.otf.json', 'docs/data/tabs/*_tef.otf.json',
         'tests/parser/fixtures/*.otf.json', 'sources/*/parsed/*.otf.json'],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout
    return [REPO_ROOT / p for p in out.split('\n') if p]


def test_edge_fixture_is_byte_exact():
    doc = json.loads((LAYOUT / 'edge.input.json').read_text(encoding='utf-8'))
    expected = (LAYOUT / 'edge.expected.json').read_bytes()
    assert serialize(doc).encode('utf-8') == expected


def test_one_trailing_newline_and_no_crlf():
    text = serialize({'otf_version': '1.0'})
    assert text == '{\n  "otf_version": "1.0"\n}\n'


def test_empty_containers():
    assert serialize({'a': [], 'b': {}}) == '{\n  "a": [],\n  "b": {}\n}\n'


def test_whole_floats_become_integers_and_fractions_are_refused():
    assert '"tempo": 120\n' in serialize({'metadata': {'tempo': 120.0}})
    with pytest.raises(ValueError):
        serialize({'metadata': {'tempo': 120.5}})


@pytest.mark.parametrize('raw, escaped', [
    ('\x01\x1f', '"\\u0001\\u001f"'),
    ('\x7f', '"\x7f"'),
    ('a"b\\c', '"a\\"b\\\\c"'),
    ('\n\r\t\b\f', '"\\n\\r\\t\\b\\f"'),
    ('  ', '"  "'),
    ('café \U0001f3b5', '"café \U0001f3b5"'),
    ('\ud800', '"\\ud800"'),          # a lone surrogate: JS escapes it, so must we
    ('🎵', '"\U0001f3b5"'),  # a pair is one emoji
])
def test_string_escaping(raw, escaped):
    assert otf_format._string(raw) == escaped


def test_underscore_keys_are_dropped_and_unknown_x_source_keys_keep_order():
    doc = {'_partFile': 'x', 'x_source': {'z': 1, 'a': 2, '_c': 3}, 'otf_version': '1.0'}
    assert serialize(doc) == (
        '{\n  "otf_version": "1.0",\n  "x_source": {\n    "z": 1,\n    "a": 2\n  }\n}\n')


def test_key_order_is_the_schemas():
    note = SCHEMA['$defs']['note']['properties']
    assert otf_format.KEY_ORDER['note'] == list(note)
    assert otf_format.KEY_ORDER['doc'] == list(SCHEMA['properties'])
    meta = SCHEMA['properties']['metadata']['properties']
    assert otf_format.KEY_ORDER['metadata'] == list(meta)
    assert list(meta)[list(meta).index('composer') + 1] == 'tab_by'
    assert otf_format.KEY_ORDER['tab_by'] == list(meta['tab_by']['properties']) == ['name', 'url']


def test_every_tracked_file_is_already_in_the_canonical_layout():
    """Corpus sweep (reads live files on purpose: it catches a writer that
    drifts, or a hand edit in the wrong layout). Also the CI fence."""
    files = tracked_otf_files()
    assert len(files) > 1000
    off = [str(p.relative_to(REPO_ROOT)) for p in files
           if serialize(json.loads(p.read_text(encoding='utf-8')))
           != p.read_bytes().decode('utf-8')]
    assert off == [], f'{len(off)} files not in canonical layout; run scripts/lib/reformat_otf.py'


def test_tef_parser_writes_the_same_bytes():
    """OTFDocument.to_json is the canonical layout (one serializer, G15b)."""
    sys.path.insert(0, str(REPO_ROOT / 'sources' / 'banjo-hangout' / 'src'))
    from tef_parser.otf import OTFDocument
    doc = OTFDocument()
    text = doc.to_json()
    assert text.endswith('\n') and not text.endswith('\n\n')
    assert text == serialize(doc.to_dict())
