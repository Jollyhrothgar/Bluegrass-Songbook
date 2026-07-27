"""Multiple tablature arrangements per instrument on one work.

Hierarchy the frontend renders: instrument (pill) -> arrangement
(selector, curated default) -> tracks (mixer). This suite guards the data
side of that:

- works_importer: the duplicate check is per ARRANGEMENT (source_id), not
  per instrument, and alternates get source_id-suffixed filenames
- work_schema: (instrument, source_id) is unique within a work
- curation: default arrangement = registry tab_pin, else first listed
- build_works_index: the index contract (source_id-suffixed published
  file, difficulty/tuning, exactly one default per instrument)
"""

import json
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from build_works_index import (  # noqa: E402
    _tab_provenance_mismatch,
    build_song_from_work,
    published_tab_name,
)
from catalog import TabEntry  # noqa: E402
from curation import (  # noqa: E402
    Registry,
    apply_tab_defaults,
    load_registry,
    resolve_tab_defaults,
    save_registry,
    tab_pin,
)
from site_config import get_site  # noqa: E402
from work_schema import Part, Provenance, Work, tablature_key, validate_work  # noqa: E402
from works_importer import (  # noqa: E402
    add_part_to_work,
    part_filename,
    tab_source_ids,
)


# ---------------------------------------------------------------- helpers

def write_otf(path: Path, instrument='5-string-banjo', source_id=None,
              url=None):
    """Minimal OTF with one melodic track (enough for instrument detection).

    ``source_id`` goes where the converter puts it — ``x_source.source_id``.
    ``url`` mimics a real Hangout storage URL, whose embedded number is an
    attachment id from a DIFFERENT namespace than the tab id.
    """
    doc = {
        'metadata': {'title': 'Test Tune'},
        'tracks': [{'id': instrument, 'instrument': instrument}],
        'notation': {instrument: [{'measure': 1, 'events': [{'t': 0}]}]},
    }
    if source_id or url:
        doc['x_source'] = {'type': 'banjo-hangout'}
        if source_id:
            doc['x_source']['source_id'] = str(source_id)
        if url:
            doc['x_source']['url'] = url
            doc['x_source']['download_file'] = url.rsplit('/', 1)[-1]
    path.write_text(json.dumps(doc))
    return path


def tab_entry(tab_id, **kw):
    fields = {
        'id': tab_id,
        'title': 'Test Tune',
        'author': 'picker',
        'format': 'tef',
        'source_url': f'https://example.test/{tab_id}.tef',
    }
    fields.update(kw)
    return TabEntry(**fields)


def make_work(tmp_path, work_id='test-tune', parts=None):
    work_dir = tmp_path / 'works' / work_id
    work_dir.mkdir(parents=True)
    (work_dir / 'work.yaml').write_text(yaml.dump({
        'id': work_id,
        'title': 'Test Tune',
        'parts': parts if parts is not None else [],
    }, sort_keys=False))
    return work_dir


def tab_part(instrument, source_id, file=None, **prov):
    provenance = {'source': 'banjo-hangout', 'source_id': source_id}
    provenance.update(prov)
    return {
        'type': 'tablature',
        'instrument': instrument,
        'format': 'otf',
        'file': file or f'{instrument}.otf.json',
        'provenance': provenance,
    }


# -------------------------------------------------- importer duplicate rule

class TestImporterDuplicateRule:
    def test_same_source_id_is_skipped(self, tmp_path):
        work_dir = make_work(tmp_path, parts=[tab_part('banjo', '111')])
        otf = write_otf(tmp_path / '111.otf.json')
        assert add_part_to_work(work_dir, tab_entry('111_tef'), otf,
                               get_site('banjo-hangout')) is False
        data = yaml.safe_load((work_dir / 'work.yaml').read_text())
        assert len(data['parts']) == 1

    def test_same_source_id_skipped_even_on_another_instrument(self, tmp_path):
        """The same upstream tab must not land twice under two detections."""
        work_dir = make_work(tmp_path, parts=[tab_part('mandolin', '111')])
        otf = write_otf(tmp_path / '111.otf.json')  # detects banjo
        assert add_part_to_work(work_dir, tab_entry('111_tef'), otf,
                               get_site('banjo-hangout')) is False

    def test_second_arrangement_of_same_instrument_is_added(self, tmp_path):
        work_dir = make_work(tmp_path, parts=[tab_part('banjo', '111')])
        existing = write_otf(work_dir / 'banjo.otf.json', source_id='111')
        before = existing.read_text()
        otf = write_otf(tmp_path / '222.otf.json')
        assert add_part_to_work(work_dir, tab_entry('222_tef'), otf,
                               get_site('banjo-hangout')) is True

        data = yaml.safe_load((work_dir / 'work.yaml').read_text())
        assert len(data['parts']) == 2
        added = data['parts'][1]
        assert added['instrument'] == 'banjo'
        assert added['provenance']['source_id'] == '222'
        # first arrangement keeps the bare name, the alternate is suffixed
        assert data['parts'][0]['file'] == 'banjo.otf.json'
        assert added['file'] == 'banjo-222.otf.json'
        assert (work_dir / 'banjo-222.otf.json').exists()
        assert existing.read_text() == before  # wave-1 arrangement untouched

    def test_third_arrangement_gets_its_own_name(self, tmp_path):
        work_dir = make_work(tmp_path, parts=[
            tab_part('banjo', '111'),
            tab_part('banjo', '222', file='banjo-222.otf.json'),
        ])
        otf = write_otf(tmp_path / '333.otf.json')
        assert add_part_to_work(work_dir, tab_entry('333_tef'), otf,
                               get_site('banjo-hangout')) is True
        data = yaml.safe_load((work_dir / 'work.yaml').read_text())
        assert [p['file'] for p in data['parts']] == [
            'banjo.otf.json', 'banjo-222.otf.json', 'banjo-333.otf.json']

    def test_provenance_carries_difficulty_and_tuning(self, tmp_path):
        work_dir = make_work(tmp_path)
        otf = write_otf(tmp_path / '444.otf.json')
        add_part_to_work(
            work_dir,
            tab_entry('444_tef', difficulty='Intermediate',
                      tuning='Standard Open G (gDGBD)'),
            otf, get_site('banjo-hangout'))
        prov = yaml.safe_load(
            (work_dir / 'work.yaml').read_text())['parts'][0]['provenance']
        assert prov['difficulty'] == 'Intermediate'
        assert prov['tuning'] == 'Standard Open G (gDGBD)'

    def test_tab_source_ids_ignores_non_tablature(self):
        work = {'parts': [
            {'type': 'lead-sheet', 'file': 'lead-sheet.pro',
             'provenance': {'source': 'manual', 'source_id': 'nope'}},
            tab_part('banjo', '111'),
        ]}
        assert tab_source_ids(work) == {'111'}

    def test_part_filename_without_source_id_numbers_up(self):
        work = {'parts': [{'file': 'banjo.otf.json'}]}
        assert part_filename(work, 'banjo', None) == 'banjo-2.otf.json'


# ------------------------------------------------------------ work_schema

class TestWorkSchemaValidation:
    def test_multiple_arrangements_per_instrument_are_valid(self):
        work = Work(id='w', title='W', parts=[
            Part(type='tablature', format='otf', file='banjo.otf.json',
                 instrument='banjo',
                 provenance=Provenance(source='banjo-hangout', source_id='111')),
            Part(type='tablature', format='otf', file='banjo-222.otf.json',
                 instrument='banjo',
                 provenance=Provenance(source='banjo-hangout', source_id='222')),
        ])
        assert validate_work(work) == []

    def test_duplicate_instrument_and_source_id_is_invalid(self):
        work = {'id': 'w', 'parts': [
            tab_part('banjo', '111'),
            tab_part('banjo', '111', file='banjo-111.otf.json'),
        ]}
        errors = validate_work(work)
        assert len(errors) == 1
        assert "source_id='111'" in errors[0]

    def test_two_source_id_less_parts_for_one_instrument_is_invalid(self):
        work = {'id': 'w', 'parts': [
            {'type': 'tablature', 'instrument': 'banjo', 'file': 'a.otf.json'},
            {'type': 'tablature', 'instrument': 'banjo', 'file': 'b.otf.json'},
        ]}
        assert any('no provenance.source_id' in e for e in validate_work(work))

    def test_duplicate_part_file_is_invalid(self):
        work = {'id': 'w', 'parts': [
            tab_part('banjo', '111'),
            tab_part('banjo', '222'),  # same default filename
        ]}
        assert any('duplicate part file' in e for e in validate_work(work))

    def test_provenance_round_trips_source_id_difficulty_tuning(self):
        work = Work(id='w', title='W', parts=[
            Part(type='tablature', format='otf', file='banjo.otf.json',
                 instrument='banjo',
                 provenance=Provenance(source='banjo-hangout', source_id='111',
                                       difficulty='Expert', tuning='Double C')),
        ])
        prov = Work.from_yaml(work.to_yaml()).parts[0].provenance
        assert (prov.source_id, prov.difficulty, prov.tuning) == (
            '111', 'Expert', 'Double C')

    def test_tablature_key_accepts_dataclass_and_dict(self):
        part = Part(type='tablature', format='otf', file='banjo.otf.json',
                    instrument='banjo',
                    provenance=Provenance(source='bh', source_id=111))
        assert tablature_key(part) == ('banjo', '111')
        assert tablature_key(tab_part('banjo', '111')) == ('banjo', '111')


# ------------------------------------------------------- pin resolution

def index_parts(*specs):
    """Index-row tab entries: (instrument, source_id) tuples in work.yaml order."""
    return [{'instrument': i, 'source_id': s} for i, s in specs]


class TestTabPinResolution:
    def test_no_pin_defaults_to_first_listed(self):
        parts = index_parts(('banjo', '111'), ('banjo', '222'))
        resolve_tab_defaults('test-tune', parts, Registry())
        assert [p['default'] for p in parts] == [True, False]

    def test_pin_selects_the_named_arrangement(self):
        registry = Registry(tab_pins={'test-tune': {'banjo': '222'}})
        parts = index_parts(('banjo', '111'), ('banjo', '222'))
        resolve_tab_defaults('test-tune', parts, registry)
        assert [p['default'] for p in parts] == [False, True]

    def test_pin_is_per_instrument(self):
        registry = Registry(tab_pins={'test-tune': {'banjo': '222'}})
        parts = index_parts(('banjo', '111'), ('banjo', '222'),
                            ('mandolin', '333'), ('mandolin', '444'))
        resolve_tab_defaults('test-tune', parts, registry)
        assert [p['default'] for p in parts] == [False, True, True, False]

    def test_pin_for_another_work_is_ignored(self):
        registry = Registry(tab_pins={'other-tune': {'banjo': '222'}})
        parts = index_parts(('banjo', '111'), ('banjo', '222'))
        resolve_tab_defaults('test-tune', parts, registry)
        assert [p['default'] for p in parts] == [True, False]

    def test_dangling_pin_falls_back_and_warns(self, capsys):
        registry = Registry(tab_pins={'test-tune': {'banjo': '999'}})
        parts = index_parts(('banjo', '111'), ('banjo', '222'))
        resolve_tab_defaults('test-tune', parts, registry)
        assert [p['default'] for p in parts] == [True, False]
        assert 'tab pin' in capsys.readouterr().err

    def test_numeric_pin_matches_string_source_id(self):
        registry = Registry(tab_pins={'test-tune': {'banjo': 222}})
        assert tab_pin('test-tune', 'banjo', registry) == '222'
        parts = index_parts(('banjo', '111'), ('banjo', '222'))
        resolve_tab_defaults('test-tune', parts, registry)
        assert [p['default'] for p in parts] == [False, True]

    def test_apply_tab_defaults_over_songs(self):
        songs = [
            {'id': 'a', 'tablature_parts': index_parts(('banjo', '1'), ('banjo', '2'))},
            {'id': 'b'},  # no tabs — must not blow up
        ]
        apply_tab_defaults(songs, Registry(tab_pins={'a': {'banjo': '2'}}))
        assert [p['default'] for p in songs[0]['tablature_parts']] == [False, True]

    def test_tab_pins_survive_a_registry_round_trip(self, tmp_path):
        registry = load_registry(tmp_path)
        registry.tab_pins['test-tune'] = {'banjo': '222'}
        save_registry(registry)
        assert load_registry(tmp_path).tab_pins == {'test-tune': {'banjo': '222'}}


# -------------------------------------------------- provenance integrity gate

class TestProvenanceGate:
    """The gate compares two RECORDED ids, never a number parsed out of a
    filename: on the older Hangout storage scheme ({slug}-{n}.tef) that
    number is a per-file ATTACHMENT id from a disjoint namespace (tab 10545
    ships arkansas_traveller-426.tef), so a filename regex could only ever
    false-positive there — it could never catch a real swap."""

    def test_old_shape_storage_url_passes(self, tmp_path):
        otf = write_otf(
            tmp_path / 'a.otf.json', source_id='11598',
            url='https://www.hangoutstorage.com/banjohangout.org/storage/'
                'tabs/b/billy_in_the_lowground-2802.tef')
        assert _tab_provenance_mismatch(otf, '11598') is None

    def test_title_ending_in_digits_passes(self, tmp_path):
        """'...capo 2' / '...(1971)' download names used to fake a tab id."""
        otf = write_otf(
            tmp_path / 'b.otf.json', source_id='11519',
            url='https://example.test/11519_tef_soldier_s_joy__in_d___capo_2_.tef')
        assert _tab_provenance_mismatch(otf, '11519') is None

    def test_genuine_swap_fails(self, tmp_path):
        otf = write_otf(tmp_path / 'c.otf.json', source_id='24068')
        assert _tab_provenance_mismatch(otf, '11598') == ('11598', {'24068'})

    def test_abstains_without_a_recorded_id(self, tmp_path):
        otf = write_otf(
            tmp_path / 'd.otf.json',
            url='https://example.test/tabs/b/billy_in_the_lowground-2802.tef')
        assert _tab_provenance_mismatch(otf, '11598') is None

    def test_abstains_without_provenance(self, tmp_path):
        otf = write_otf(tmp_path / 'e.otf.json', source_id='24068')
        assert _tab_provenance_mismatch(otf, None) is None


# ------------------------------------------------------- index contract

class TestIndexContract:
    @pytest.fixture
    def work_dir(self, tmp_path):
        work_dir = make_work(tmp_path, parts=[
            tab_part('banjo', '111', difficulty='Intermediate',
                     tuning='Standard Open G (gDGBD)', author='picker'),
            tab_part('banjo', '222', file='banjo-222.otf.json', author='other'),
            tab_part('mandolin', '333', file='mandolin.otf.json'),
        ])
        for name in ('banjo.otf.json', 'banjo-222.otf.json', 'mandolin.otf.json'):
            write_otf(work_dir / name)
        return work_dir

    def test_published_filenames_carry_the_source_id(self, work_dir):
        song = build_song_from_work(work_dir)
        assert [p['file'] for p in song['tablature_parts']] == [
            'data/tabs/test-tune-banjo-111.otf.json',
            'data/tabs/test-tune-banjo-222.otf.json',
            'data/tabs/test-tune-mandolin-333.otf.json',
        ]

    def test_contract_fields(self, work_dir):
        first = build_song_from_work(work_dir)['tablature_parts'][0]
        assert first['instrument'] == 'banjo'
        assert first['source'] == 'banjo-hangout'
        assert first['source_id'] == '111'
        assert first['author'] == 'picker'
        assert first['difficulty'] == 'Intermediate'
        assert first['tuning'] == 'Standard Open G (gDGBD)'
        assert first['source_page_url'].endswith('m=detail&v=111')
        assert first['author_url'].endswith('/my/picker')

    def test_difficulty_and_tuning_are_omitted_when_unknown(self, work_dir):
        second = build_song_from_work(work_dir)['tablature_parts'][1]
        assert 'difficulty' not in second
        assert 'tuning' not in second

    def test_exactly_one_default_per_instrument(self, work_dir):
        song = build_song_from_work(work_dir)
        apply_tab_defaults([song], Registry())
        by_instrument = {}
        for part in song['tablature_parts']:
            by_instrument.setdefault(part['instrument'], []).append(part['default'])
        assert by_instrument == {'banjo': [True, False], 'mandolin': [True]}
        for defaults in by_instrument.values():
            assert sum(defaults) == 1

    def test_source_path_is_carried_for_the_copy_step(self, work_dir):
        song = build_song_from_work(work_dir)
        assert [p['_src'] for p in song['tablature_parts']] == [
            'banjo.otf.json', 'banjo-222.otf.json', 'mandolin.otf.json']

    def test_published_name_falls_back_when_source_id_missing(self):
        part = {'instrument': 'mandolin', 'file': 'mandolin.otf.json'}
        assert published_tab_name('foggy-mountain-breakdown', part, 3) == \
            'foggy-mountain-breakdown-mandolin-p3.otf.json'

    def test_the_real_corpus_has_no_duplicate_arrangements(self):
        """Every work carrying tab files must satisfy the schema — a repeated
        (instrument, source_id) would collide on the published filename."""
        problems = []
        work_dirs = {p.parent for p in REPO_ROOT.glob('works/*/*.otf.json')}
        assert work_dirs, 'no tablature works found — check the glob'
        for work_dir in sorted(work_dirs):
            work = yaml.safe_load((work_dir / 'work.yaml').read_text())
            errors = validate_work(work)
            if errors:
                problems.append((work_dir.name, errors))
        assert problems == []

    def test_published_name_sanitizes_odd_source_ids(self):
        part = {'instrument': 'banjo',
                'provenance': {'source_id': 'issue #42/v2'}}
        assert published_tab_name('w', part) == 'w-banjo-issue-42-v2.otf.json'
