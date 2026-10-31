"""OTF validation: the JSON Schema plus the rules a schema cannot express.

The format is written down once, in ``docs/schema/otf.schema.json`` (human
guide: ``docs/schema/otf.md``). This module is its Python validator;
``validateOTF`` in ``docs/js/otf-editor/otf-validate.js`` is the hand-written JS
twin. Both enforce the same rules, and ``tests/test_otf_schema.py`` /
``docs/js/__tests__/otf-editor/otf-validate.test.js`` check they agree on every
file in ``tests/fixtures/otf/``.

Cross-field rules (each message carries its id in ``[brackets]`` so the
fixtures can name the rule they break):

``string_count``       a note's ``s`` is at most its track's string count
                       (``tuning`` length; ``lines`` for a percussion track)
``notation_keys``      every ``notation`` key names a track id (a track may have
                       no key: an empty track)
``track_ids``          track ids are unique
``measure_order``      measure numbers are unique and ascending per track
``tick_order``         event ticks are unique and ascending within a measure
``tick_range``         every event tick falls inside the measure's length
``duplicate_string``   at most one note per string per event
``chord_index``        ``chord_diagrams[].chord`` is an index into ``chords``
``chord_track``        ``chord_diagrams[].track`` names a track
``chord_tick``         a diagram's tick lies inside its measure
``chord_fingers``      ``fingers`` needs ``frets`` and has the same length
``mark_order``         ``measure_marks`` measures are strictly ascending
``mark_raw``           a mark's decoded fields agree with its ``raw`` byte
                       (``decode_mark_raw``)
``annotation_track``   ``annotations[].track`` names a track
``annotation_chord``   ``annotations[].kind: "chord"`` has a text the shared chord
                       parser accepts (``tab_chord.parse_tab_chord``)

Warning only (#263): ``reading_list_overrun``.

The cross-field rules run only on a document the schema accepts, so they can
assume its shape.
"""

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

from tab_chord import parse_tab_chord

# Re-exported so a caller that already has this module gets the shared helpers.
from otf_format import (  # noqa: F401
    DYN_LEVELS, OTF_VERSION, decode_mark_raw, ensure_version_at_least)

SCHEMA_PATH = Path(__file__).resolve().parents[2] / 'docs' / 'schema' / 'otf.schema.json'


@lru_cache(maxsize=1)
def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding='utf-8'))


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    return Draft202012Validator(load_schema())


def _where(error) -> str:
    return '/'.join(str(p) for p in error.absolute_path) or '(document)'


def schema_errors(otf) -> list:
    """Messages for everything the JSON Schema rejects (empty = accepted)."""
    errors = sorted(_validator().iter_errors(otf), key=lambda e: list(e.absolute_path))
    return [f'[schema] {_where(e)}: {e.message}' for e in errors]


def measure_length(otf: dict, measure: int) -> int:
    """Length of ``measure`` in ticks (time-signature changes are per-measure)."""
    meta = otf['metadata']
    signature = meta['time_signature']
    for change in meta.get('time_signature_changes', []):
        if change['measure'] == measure:
            signature = change['time_signature']
    beats, unit = (int(x) for x in signature.split('/'))
    return otf['timing']['ticks_per_beat'] * 4 * beats // unit


def _string_count(track: dict) -> int:
    return track['lines'] if track.get('percussion') else len(track['tuning'])


_MARK_FIELDS = ('repeat_start', 'repeat_end', 'ending', 'jump', 'end_bar')


def _chord_rules(otf: dict, ids: list, errors: list) -> None:
    chords = otf.get('chords', [])
    for i, c in enumerate(chords):
        if 'fingers' in c and 'frets' not in c:
            errors.append(f'[chord_fingers] chords/{i}: fingers needs frets')
        elif 'fingers' in c and len(c['fingers']) != len(c['frets']):
            errors.append(f'[chord_fingers] chords/{i}: {len(c["fingers"])} fingers '
                          f'for {len(c["frets"])} frets')
    for i, d in enumerate(otf.get('chord_diagrams', [])):
        if d['chord'] >= len(chords):
            errors.append(f'[chord_index] chord_diagrams/{i}: chord {d["chord"]} '
                          f'but there are {len(chords)} chords')
        if d['track'] not in ids:
            errors.append(f'[chord_track] chord_diagrams/{i}: no track {d["track"]!r}')
        length = measure_length(otf, d['measure'])
        if d['tick'] >= length:
            errors.append(f'[chord_tick] chord_diagrams/{i} m{d["measure"]}: tick '
                          f'{d["tick"]} is outside the {length}-tick measure')


def _annotation_rules(otf: dict, ids: list, errors: list) -> None:
    for i, a in enumerate(otf.get('annotations', [])):
        if 'track' in a and a['track'] not in ids:
            errors.append(f'[annotation_track] annotations/{i}: no track {a["track"]!r}')
        if a.get('kind') == 'chord' and not parse_tab_chord(a['text']):
            errors.append(f'[annotation_chord] annotations/{i}: {a["text"]!r} is not a chord')


def _mark_rules(otf: dict, errors: list) -> None:
    previous = 0
    for i, m in enumerate(otf.get('measure_marks', [])):
        if m['measure'] <= previous:
            errors.append(f'[mark_order] measure_marks/{i}: measure {m["measure"]} '
                          f'follows measure {previous}')
        previous = max(previous, m['measure'])
        decoded = decode_mark_raw(m['raw'])
        for field in _MARK_FIELDS:
            if m.get(field) != decoded.get(field):
                errors.append(f'[mark_raw] measure_marks/{i} m{m["measure"]}: {field} is '
                              f'{m.get(field)!r} but raw {m["raw"]} says {decoded.get(field)!r}')


def cross_field(otf: dict) -> tuple:
    """``(errors, warnings)`` for a document that already passed the schema."""
    errors, warnings = [], []
    tracks = otf['tracks']
    ids = [t['id'] for t in tracks]
    notation = otf['notation']

    for tid in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f'[track_ids] track {tid}: id used more than once')
    extra = sorted(set(notation) - set(ids))
    if extra:
        errors.append(f'[notation_keys] notation keys with no track: {extra}')

    written = 0
    for track in tracks:
        tid = track['id']
        measures = notation.get(tid)
        if measures is None:
            continue
        nstrings = _string_count(track)
        previous = 0
        for m in measures:
            num = m['measure']
            written = max(written, num)
            if num <= previous:
                errors.append(f'[measure_order] track {tid}: measure {num} '
                              f'follows measure {previous}')
            previous = max(previous, num)
            length = measure_length(otf, num)
            last_tick = -1
            for e in m['events']:
                tick = e['tick']
                if tick <= last_tick:
                    errors.append(f'[tick_order] track {tid} m{num}: tick {tick} '
                                  f'follows tick {last_tick}')
                last_tick = max(last_tick, tick)
                if tick >= length:
                    errors.append(f'[tick_range] track {tid} m{num}: tick {tick} '
                                  f'is outside the {length}-tick measure')
                seen = set()
                for n in e['notes']:
                    if n['s'] > nstrings:
                        errors.append(f'[string_count] track {tid} m{num}: bad string '
                                      f'{n["s"]} (track has {nstrings})')
                    if n['s'] in seen:
                        errors.append(f'[duplicate_string] track {tid} m{num} tick '
                                      f'{tick}: two notes on string {n["s"]}')
                    seen.add(n['s'])

    _chord_rules(otf, ids, errors)
    _annotation_rules(otf, ids, errors)
    _mark_rules(otf, errors)

    for r in otf.get('reading_list', []):
        if r['to_measure'] > written or r['from_measure'] > written:
            warnings.append(f'[reading_list_overrun] measures {r["from_measure"]}-'
                            f'{r["to_measure"]} run past the last written measure '
                            f'({written})')
    return errors, warnings


def check(otf) -> tuple:
    """``(errors, warnings)``: the schema first, then the cross-field rules."""
    if not isinstance(otf, dict):
        return ['not an object'], []
    errors = schema_errors(otf)
    if errors:
        return errors, []
    return cross_field(otf)
