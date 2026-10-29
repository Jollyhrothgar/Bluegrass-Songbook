"""The one file layout for OTF tab files (G15b).

``serialize(document)`` is the ONLY way an OTF becomes file bytes in Python:
``tef_parser`` (``OTFDocument.to_json``), ``converter.py`` and
``process_pending.otf_document`` all call it. Its JS twin is
``docs/js/otf-format.js``; both must produce identical bytes, which
``tests/fixtures/otf/layout/`` and the corpus sweep in each language prove.

Where it lives and who imports it: ``scripts/lib/`` is already on the path of
``process_pending.py`` (it runs from there, in CI too) and of pytest
(``tests/conftest.py``). ``tef_parser`` lives elsewhere, so
``tef_parser/otf.py`` puts ``scripts/lib`` on ``sys.path`` before importing it.

The layout
----------
UTF-8, non-ASCII left as is, 2-space indent, ``": "`` after keys, exactly one
trailing ``"\\n"``. Keys go in the order of ``docs/schema/otf.schema.json``
(unknown keys, only inside ``x_source``, keep their order after the known
ones); keys starting with ``_`` are runtime view caches and are dropped.
One line each for: an event, an annotation, a reading_list entry, a
time_signature_changes entry, a measure_marks / chords / chord_diagrams entry,
and every array whose items are all scalars.
The document is integers-only (a whole float such as ``120.0`` is written
``120``, as JS would; any other float is an error).
"""

import json
import re
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[2] / 'docs' / 'schema' / 'otf.schema.json'

# Shared, dependency-free helpers for everything that writes OTF (the TEF
# importers import them from here; otf_schema re-exports them). Their JS twins
# are in docs/js/otf-editor/otf-validate.js.

#: The version every writer stamps (schema 1.2: dynamics, bend, measure_marks,
#: chords, chord_diagrams).
OTF_VERSION = '1.2'

#: Dynamic levels, loudest first (TablEdit codes 0-6). Equal to the schema's
#: enum for ``tracks[].dyn`` and ``note.dyn`` (tests/test_otf_schema.py).
DYN_LEVELS = ['fff', 'ff', 'f', 'mf', 'mp', 'p', 'pp']

_JUMPS = {0x10: 'da-signo', 0x18: 'signo', 0x20: 'al-coda', 0x28: 'coda'}


def decode_mark_raw(raw: int) -> dict:
    """The ``measure_marks`` fields TablEdit's flag byte ``raw`` stands for.

    Returns only the fields that are present: ``repeat_start`` (0x40),
    ``repeat_end`` (0x80), ``ending`` (``raw & 7`` when 1-6; 0 and 7 give
    none), ``end_bar`` (``raw & 0x38 == 0x08``) and ``jump`` (``raw & 0x38``
    in 0x10 da-signo, 0x18 signo, 0x20 al-coda, 0x28 coda). The ``mark_raw``
    rule requires an entry's fields to equal this; importers build entries
    with it (``{'measure': m, **decode_mark_raw(raw), 'raw': raw}``).
    """
    out = {}
    if raw & 0x40:
        out['repeat_start'] = True
    if raw & 0x80:
        out['repeat_end'] = True
    if 1 <= raw & 7 <= 6:
        out['ending'] = raw & 7
    if raw & 0x38 == 0x08:
        out['end_bar'] = True
    if raw & 0x38 in _JUMPS:
        out['jump'] = _JUMPS[raw & 0x38]
    return out


def _minor(version):
    m = re.fullmatch(r'1\.([0-9]+)', version) if isinstance(version, str) else None
    return int(m.group(1)) if m else None


def ensure_version_at_least(doc: dict, minimum: str) -> bool:
    """Raise ``doc['otf_version']`` to ``minimum`` ("1.2") if it is lower.

    Call it whenever a field newer than the document's version is set (the
    optional fields keep older files valid; a file that uses one says so).
    Returns True when it changed the version. A version that is not "1.x" is
    left alone for the validator to report.
    """
    have, want = _minor(doc.get('otf_version')), _minor(minimum)
    if have is None or want is None or have >= want:
        return False
    doc['otf_version'] = minimum
    return True


def _keys(props: dict) -> list:
    return list(props)


def _orders() -> dict:
    schema = json.loads(SCHEMA_PATH.read_text(encoding='utf-8'))
    top = schema['properties']
    note = schema['$defs']['note']['properties']
    measure = top['notation']['additionalProperties']['items']['properties']
    return {
        'doc': _keys(top),
        'metadata': _keys(top['metadata']['properties']),
        'timing': _keys(top['timing']['properties']),
        'track': _keys(top['tracks']['items']['properties']),
        'measure': _keys(measure),
        'event': _keys(measure['events']['items']['properties']),
        'note': _keys(note),
        'grace': _keys(note['grace']['properties']),
        'annotation': _keys(top['annotations']['items']['properties']),
        'reading': _keys(top['reading_list']['items']['properties']),
        'tab_by': _keys(top['metadata']['properties']['tab_by']['properties']),
        'mark': _keys(top['measure_marks']['items']['properties']),
        'chord': _keys(top['chords']['items']['properties']),
        'diagram': _keys(top['chord_diagrams']['items']['properties']),
        'tsc': _keys(top['metadata']['properties']['time_signature_changes']
                     ['items']['properties']),
    }


KEY_ORDER = _orders()

# (parent context, key) -> context of the value (or of its items, for an array)
_CHILD = {
    ('doc', 'metadata'): 'metadata',
    ('doc', 'timing'): 'timing',
    ('doc', 'tracks'): 'track',
    ('doc', 'notation'): 'notation',
    ('doc', 'annotations'): 'annotation',
    ('doc', 'reading_list'): 'reading',
    ('doc', 'measure_marks'): 'mark',
    ('doc', 'chords'): 'chord',
    ('doc', 'chord_diagrams'): 'diagram',
    ('metadata', 'time_signature_changes'): 'tsc',
    ('metadata', 'tab_by'): 'tab_by',
    ('measure', 'events'): 'event',
    ('event', 'notes'): 'note',
    ('note', 'grace'): 'grace',
}
_INLINE = {'event', 'annotation', 'reading', 'tsc', 'mark', 'chord', 'diagram'}

# JSON.stringify and json.dumps agree on everything but a lone surrogate:
# JS writes it as a lowercase \udXXX escape, Python would emit it raw.
_LONE_SURROGATE = re.compile('[\ud800-\udfff]')


def _string(s: str) -> str:
    out = json.dumps(s, ensure_ascii=False)
    return _LONE_SURROGATE.sub(lambda m: '\\u%04x' % ord(m.group()), out)


def _scalar(v) -> str:
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        raise ValueError(f'OTF numbers are integers; got {v!r}')
    if isinstance(v, str):
        return _string(v)
    raise TypeError(f'not JSON: {type(v).__name__}')


def _is_scalar(v) -> bool:
    return not isinstance(v, (dict, list))


def _entries(obj: dict, ctx) -> list:
    """(key, value) pairs in canonical order, `_` keys dropped."""
    known = KEY_ORDER.get(ctx, [])
    keys = [k for k in known if k in obj]
    keys += [k for k in obj if k not in known]
    return [(k, obj[k]) for k in keys if not k.startswith('_')]


def _child_ctx(ctx, key):
    if ctx == 'notation':
        return 'measure'
    return _CHILD.get((ctx, key))


def _inline(v, ctx) -> str:
    if isinstance(v, dict):
        parts = [f'{_string(k)}: {_inline(x, _child_ctx(ctx, k))}'
                 for k, x in _entries(v, ctx)]
        return '{' + ', '.join(parts) + '}'
    if isinstance(v, list):
        return '[' + ', '.join(_inline(x, ctx) for x in v) + ']'
    return _scalar(v)


def _block(v, ctx, depth) -> str:
    if isinstance(v, list):
        if all(_is_scalar(x) for x in v):
            return _inline(v, ctx)
        pad = '  ' * (depth + 1)
        items = [pad + (_inline(x, ctx) if ctx in _INLINE else _block(x, ctx, depth + 1))
                 for x in v]
        return '[\n' + ',\n'.join(items) + '\n' + '  ' * depth + ']'
    if isinstance(v, dict):
        entries = _entries(v, ctx) if ctx != 'notation' else list(v.items())
        if not entries:
            return '{}'
        pad = '  ' * (depth + 1)
        lines = [f'{pad}{_string(k)}: {_block(x, _child_ctx(ctx, k), depth + 1)}'
                 for k, x in entries]
        return '{\n' + ',\n'.join(lines) + '\n' + '  ' * depth + '}'
    return _scalar(v)


def serialize(document: dict) -> str:
    """The canonical text of an OTF document (ends with one newline)."""
    if not isinstance(document, dict):
        raise TypeError('an OTF document is a JSON object')
    return _block(document, 'doc', 0) + '\n'
