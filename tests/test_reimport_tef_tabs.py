"""Decision logic of scripts/lib/reimport_tef_tabs.py (G15d)."""

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / 'scripts' / 'lib'))

import reimport_tef_tabs as r  # noqa: E402


def doc(**over):
    base = {
        'otf_version': '1.0',
        'metadata': {'title': 'Hand Title', 'key': 'G', 'tempo': 100},
        'timing': {'ticks_per_beat': 480},
        'tracks': [{'id': 'banjo', 'instrument': '5-string-banjo',
                    'tuning': ['D4', 'B3', 'G3', 'D3', 'G4'], 'capo': 0, 'role': 'lead'}],
        'notation': {'banjo': [{'measure': 1, 'events': [
            {'tick': 0, 'notes': [{'s': 1, 'f': 0, 'dur': 480}]}]}]},
        'x_source': {'type': 'banjo-hangout', 'source_id': '1', 'author': 'a'},
    }
    base.update(over)
    return base


def newer(existing):
    n = copy.deepcopy(existing)
    n['metadata'] = {'title': 'Parser Title'}
    n['notation']['banjo'][0]['events'][0]['notes'][0]['dyn'] = 'f'
    n['measure_marks'] = [{'measure': 1, 'repeat_start': True, 'raw': 64}]
    n['x_source'] = {'type': 'local', 'skipped': {'tempo_changes': 2}}
    return n


def test_submitted_and_corrected_are_off_limits():
    assert r.provenance_skip({'submitted_by': 'u'}) == 'submitted'
    assert r.provenance_skip({'x_corrected_by': 'u'}) == 'corrected'
    assert r.provenance_skip({'x_derived_from': 'banjo-hangout:1'}) == 'corrected'
    assert r.provenance_skip({'source': 'banjo-hangout'}) is None
    action, _ = r.decide_part({'submitted_by': 'u'}, doc(), doc(), newer(doc()))
    assert action == 'submitted'
    action, _ = r.decide_part({'x_corrected_by': 'u'}, doc(), doc(), newer(doc()))
    assert action == 'corrected'


def test_mismatch_names_the_first_differing_field():
    existing = doc()
    old = doc()
    old['notation']['banjo'][0]['events'][0]['notes'][0]['f'] = 2
    assert r.decide_part({}, existing, old, newer(old)) == ('mismatch', 'notation')
    old = doc(tracks=[{'id': 'x'}])
    assert r.decide_part({}, existing, old, newer(old)) == ('mismatch', 'tracks')


def test_absent_and_empty_annotations_are_equal():
    assert r.decide_part({}, doc(), doc(annotations=[]), newer(doc())) == ('refresh', None)


def test_refresh_takes_new_fields_keeps_metadata_and_drops_skipped():
    existing = doc()
    out = r.refreshed(existing, newer(existing))
    assert out['metadata'] == existing['metadata']
    assert out['notation']['banjo'][0]['events'][0]['notes'][0]['dyn'] == 'f'
    assert out['measure_marks'][0]['repeat_start'] is True
    assert out['otf_version'] == '1.2'
    assert 'skipped' not in out['x_source']
    assert out['x_source']['author'] == 'a'
    assert out['timing'] == existing['timing']


def test_refresh_never_writes_skipped_even_if_existing_had_it():
    existing = doc()
    existing['x_source']['skipped'] = {'old': 1}
    assert 'skipped' not in r.refreshed(existing, newer(existing))['x_source']


def test_refresh_removes_a_field_the_new_importer_no_longer_produces():
    existing = doc(chords=[{'measure': 1}])
    assert 'chords' not in r.refreshed(existing, newer(doc()))


def test_regenerated_parsed_keeps_skipped_title_and_x_source():
    existing = doc()
    out = r.regenerated(existing, newer(existing), 'x.tef')
    assert out['x_source']['skipped'] == {'tempo_changes': 2}
    assert out['x_source']['author'] == 'a'
    assert out['x_source']['source_id'] == '1'
    assert out['metadata']['title'] == 'Hand Title'
    assert out['otf_version'] == '1.2'


def test_tef_lookup_by_tab_id(tmp_path):
    (tmp_path / '10277.tef').write_bytes(b'')
    (tmp_path / '10300_tef_cluck.tef').write_bytes(b'')
    (tmp_path / '1030_tef_other.tef').write_bytes(b'')
    assert r.tef_for_tab_id(tmp_path, '10277').name == '10277.tef'
    assert r.tef_for_tab_id(tmp_path, '10300').name == '10300_tef_cluck.tef'
    assert r.tef_for_tab_id(tmp_path, '103') is None
