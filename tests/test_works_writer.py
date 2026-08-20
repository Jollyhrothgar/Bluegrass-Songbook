"""Tests for the shared works/ writer (scripts/lib/works_writer.py).

The writer is the one place that may create or change a work, so this
suite guards its refusals as much as its writes:

- create-new: suffix vs fail on collision, never a silent overwrite
- add-part: enrichment, and refusal when the part is already there
- update-part: correction flows that own the content
- update-metadata: the work's OWN fields, and structurally no part
- fork-to-arrangement: incoming chart lands as a NEW version part, the
  original untouched
- suppression / redirect guards
- YAML round trip, including `composers: [Smith, John]` — ONE composer
"""

import json

import pytest
import yaml

import works_writer
from works_writer import (
    Guards,
    PartSpec,
    PartExistsError,
    ProvenanceRequiredError,
    SuppressedWorkError,
    WorkExistsError,
    WorkNotFoundError,
    add_part,
    apply_version_metadata,
    create_work,
    dump_work_yaml,
    fork_to_arrangement,
    load_work,
    update_metadata,
    update_part,
)

CHORDPRO = "{meta: title My Song}\n[G]Some words here\n"


def lead_sheet(content=CHORDPRO, **kw):
    kw.setdefault('provenance', {'source': 'manual', 'submitted_by': 'github:someone'})
    return PartSpec(file='lead-sheet.pro', type='lead-sheet', format='chordpro',
                    default=True, content=content, **kw)


def write_registry(tmp_path, **sections):
    path = tmp_path / 'curation' / 'registry.yaml'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump({'groups': {}, **sections}))


def write_redirects(tmp_path, mapping):
    path = tmp_path / 'docs' / 'data' / 'redirects.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(mapping))


def read_work(tmp_path, work_id):
    return yaml.safe_load(
        (tmp_path / 'works' / work_id / 'work.yaml').read_text())


# ============================================
# YAML serialization
# ============================================


class TestYamlSerialization:
    def test_comma_in_composer_stays_one_composer(self):
        """The auto-commit-song bug: `composers: [Smith, John]` read back as
        two people. Serialized properly it must round-trip as one, quoted."""
        text = dump_work_yaml({'id': 'x', 'title': 'X',
                               'composers': ['Smith, John']})
        assert "'Smith, John'" in text
        assert yaml.safe_load(text)['composers'] == ['Smith, John']

    def test_round_trip_of_tricky_strings(self, tmp_path):
        tricky = {
            'id': 'tricky',
            'title': 'Yes, [Sir]: A Song {Live}',
            'artist': 'Flatt & Scruggs',
            'composers': ['Smith, John', 'A. P. Carter'],
            'notes': 'Line one\nline two',
            'default_key': 'C',
            'tags': ['Bluegrass'],
        }
        assert yaml.safe_load(dump_work_yaml(tricky)) == tricky

    def test_numeric_looking_strings_survive(self):
        text = dump_work_yaml({'id': 'x', 'title': '1929', 'default_key': 'E'})
        assert yaml.safe_load(text)['title'] == '1929'

    def test_canonical_key_order(self, tmp_path):
        create_work(tmp_path, 'ordered', 'Ordered', lead_sheet(),
                    artist='Someone', composers=['A. Person'],
                    default_key='G', tags=['Bluegrass'])
        keys = list(read_work(tmp_path, 'ordered'))
        assert keys == ['id', 'title', 'artist', 'composers', 'default_key',
                        'tags', 'parts']

    def test_written_work_round_trips_through_work_schema(self, tmp_path):
        from work_schema import Work
        create_work(tmp_path, 'schema-work', 'Schema Work', lead_sheet(),
                    composers=['Smith, John'])
        text = (tmp_path / 'works' / 'schema-work' / 'work.yaml').read_text()
        parsed = Work.from_yaml(text)
        assert parsed.composers == ['Smith, John']
        assert parsed.parts[0].provenance.source == 'manual'


# ============================================
# Provenance is required
# ============================================


class TestProvenanceRequired:
    def test_missing_provenance_refused(self, tmp_path):
        with pytest.raises(ProvenanceRequiredError):
            create_work(tmp_path, 'no-prov', 'No Prov',
                        PartSpec(file='lead-sheet.pro', provenance=None,
                                 content=CHORDPRO))
        assert not (tmp_path / 'works' / 'no-prov').exists()

    def test_provenance_without_source_refused(self, tmp_path):
        with pytest.raises(ProvenanceRequiredError):
            create_work(tmp_path, 'no-source', 'No Source',
                        PartSpec(file='lead-sheet.pro', content=CHORDPRO,
                                 provenance={'submitted_by': 'someone'}))

    def test_empty_provenance_values_are_dropped(self, tmp_path):
        create_work(tmp_path, 'sparse', 'Sparse',
                    lead_sheet(provenance={'source': 'manual',
                                           'github_issue': None,
                                           'submitted_by': ''}))
        prov = read_work(tmp_path, 'sparse')['parts'][0]['provenance']
        assert prov == {'source': 'manual'}


# ============================================
# Mode: create-new
# ============================================


class TestCreateWork:
    def test_writes_work_and_part_file(self, tmp_path):
        result = create_work(tmp_path, 'my-song', 'My Song', lead_sheet(),
                             artist='Artist')
        assert result.written and result.mode == 'create-new'
        assert result.work_dir == tmp_path / 'works' / 'my-song'
        assert (result.work_dir / 'lead-sheet.pro').read_text() == CHORDPRO
        work = read_work(tmp_path, 'my-song')
        assert work['id'] == 'my-song'
        assert work['parts'][0]['default'] is True

    def test_collision_suffixes_and_never_overwrites(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        original = (tmp_path / 'works' / 'my-song' / 'lead-sheet.pro').read_text()

        second = create_work(tmp_path, 'my-song', 'My Song',
                             lead_sheet(content='{meta: title Other}\n[C]Other\n'))
        assert second.work_id == 'my-song-1'
        assert read_work(tmp_path, 'my-song-1')['id'] == 'my-song-1'
        # The original is byte-for-byte untouched
        assert (tmp_path / 'works' / 'my-song' / 'lead-sheet.pro').read_text() == original

    def test_collision_fail_mode_refuses(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        with pytest.raises(WorkExistsError):
            create_work(tmp_path, 'my-song', 'My Song', lead_sheet(),
                        on_collision='fail')
        assert not (tmp_path / 'works' / 'my-song-1').exists()

    def test_collision_skips_suppressed_suffix(self, tmp_path):
        (tmp_path / 'works' / 'my-song').mkdir(parents=True)
        write_registry(tmp_path, suppressed={'my-song-1': {'reason': 'bad copy'}})
        result = create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        assert result.work_id == 'my-song-2'

    def test_allow_existing_dir_adopts_a_dir_without_work_yaml(self, tmp_path):
        """The tab flow: the OTF is committed into works/<id>/ before any
        work.yaml exists, so the directory must be adopted, not suffixed."""
        work_dir = tmp_path / 'works' / 'tabbed'
        work_dir.mkdir(parents=True)
        (work_dir / 'banjo.otf.json').write_text('{}')
        result = create_work(
            tmp_path, 'tabbed', 'Tabbed',
            PartSpec(file='banjo.otf.json', type='tablature', format='otf',
                     instrument='banjo', default=True,
                     provenance={'source': 'user-submission'}),
            allow_existing_dir=True, on_collision='fail')
        assert result.work_id == 'tabbed'

    def test_allow_existing_dir_still_refuses_an_existing_work_yaml(self, tmp_path):
        create_work(tmp_path, 'tabbed', 'Tabbed', lead_sheet())
        with pytest.raises(WorkExistsError):
            create_work(tmp_path, 'tabbed', 'Tabbed', lead_sheet(),
                        allow_existing_dir=True, on_collision='fail')

    def test_schema_violations_are_refused(self, tmp_path):
        with pytest.raises(works_writer.WorksWriterError):
            create_work(tmp_path, '', 'No Id', lead_sheet())


class TestCreateWorkWithoutAPart:
    """``part=None`` mints a placeholder: metadata, ``parts: []``, no file.

    It lives inside create_work rather than beside it so a placeholder is
    asked the same three minting questions (suppressed? redirected? taken?)
    as every other new work — add_placeholder.py answered the last one on
    its own and the first two not at all.
    """

    def test_no_part_means_empty_parts_and_no_file(self, tmp_path):
        result = create_work(tmp_path, 'stub', 'Stub', None,
                             artist='Somebody',
                             extra={'status': 'placeholder'})
        assert result.written and result.part_file is None
        work = read_work(tmp_path, 'stub')
        assert work['parts'] == []
        assert work['status'] == 'placeholder'
        assert [p.name for p in result.work_dir.iterdir()] == ['work.yaml']

    def test_guards_apply_to_a_part_less_work(self, tmp_path):
        write_registry(tmp_path, suppressed={'stub': {'reason': 'gone'}})
        result = create_work(tmp_path, 'stub', 'Stub', None)
        assert not result.written and result.skipped_reason == 'suppressed'
        assert not (tmp_path / 'works' / 'stub').exists()

    def test_collision_rules_apply_to_a_part_less_work(self, tmp_path):
        create_work(tmp_path, 'stub', 'Stub', None)
        assert create_work(tmp_path, 'stub', 'Stub', None).work_id == 'stub-1'
        with pytest.raises(WorkExistsError):
            create_work(tmp_path, 'stub', 'Stub', None, on_collision='fail')

    def test_a_part_less_work_can_later_be_enriched(self, tmp_path):
        """The placeholder's whole point: content arrives later, through the
        normal add-part path."""
        create_work(tmp_path, 'stub', 'Stub', None,
                    extra={'status': 'placeholder'})
        add_part(tmp_path, 'stub', lead_sheet())
        work = read_work(tmp_path, 'stub')
        assert len(work['parts']) == 1
        assert work['status'] == 'placeholder'


# ============================================
# Guards: suppression + redirects
# ============================================


class TestGuards:
    def test_suppressed_id_is_not_created(self, tmp_path, capsys):
        write_registry(tmp_path, suppressed={'my-song': {'reason': 'gone'}})
        result = create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        assert not result.written
        assert result.skipped_reason == 'suppressed'
        assert result.work_dir is None
        assert not (tmp_path / 'works' / 'my-song').exists()
        assert 'suppressed' in capsys.readouterr().out.lower()

    def test_soft_deleted_id_is_not_created(self, tmp_path):
        deleted = tmp_path / 'docs' / 'data' / 'deleted_songs.json'
        deleted.parent.mkdir(parents=True)
        deleted.write_text(json.dumps({'my-song': {'reason': 'removed'}}))
        assert not create_work(tmp_path, 'my-song', 'My Song', lead_sheet())

    def test_collision_suffix_of_a_suppressed_base_is_refused(self, tmp_path):
        write_registry(tmp_path, suppressed={'my-song': {'reason': 'gone'}})
        assert not create_work(tmp_path, 'my-song-1', 'My Song', lead_sheet())

    def test_redirected_id_is_not_created(self, tmp_path, capsys):
        write_redirects(tmp_path, {'old-song': 'new-song'})
        result = create_work(tmp_path, 'old-song', 'Old Song', lead_sheet())
        assert result.skipped_reason == 'redirected'
        assert 'merged away' in capsys.readouterr().out
        assert not (tmp_path / 'works' / 'old-song').exists()

    def test_on_suppressed_raise(self, tmp_path):
        write_registry(tmp_path, suppressed={'my-song': {'reason': 'gone'}})
        with pytest.raises(SuppressedWorkError):
            create_work(tmp_path, 'my-song', 'My Song', lead_sheet(),
                        on_suppressed='raise')

    def test_every_mode_honours_the_guard(self, tmp_path):
        """A work whose OWN id is suppressed is closed to every mode.

        Deliberate, not incidental: the next build drops it from both
        published indexes, so a part added here would exist nowhere a
        reader — or its own submitter — could reach it.
        """
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        write_registry(tmp_path, suppressed={'my-song': {'reason': 'gone'}})
        guards = Guards.load(tmp_path)
        assert not add_part(tmp_path, 'my-song', lead_sheet(), guards=guards)
        assert not update_part(tmp_path, 'my-song', match={'type': 'lead-sheet'},
                               content='x', guards=guards)
        assert not fork_to_arrangement(tmp_path, 'my-song', CHORDPRO,
                                       {'source': 'manual'},
                                       version_label='Mine', guards=guards)
        assert not update_metadata(tmp_path, 'my-song', updates={'artist': 'X'},
                                   provenance={'source': 'manual'},
                                   guards=guards)

    def test_every_mode_honours_a_redirect_on_the_target_itself(self, tmp_path):
        """Merged away is the same story: the id is a tombstone."""
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        write_redirects(tmp_path, {'my-song': 'other-song'})
        guards = Guards.load(tmp_path)
        for result in (
            add_part(tmp_path, 'my-song',
                     PartSpec(file='banjo.otf.json', type='tablature',
                              format='otf', instrument='banjo', content='{}',
                              provenance={'source': 'user-submission'}),
                     guards=guards),
            update_metadata(tmp_path, 'my-song', updates={'artist': 'X'},
                            provenance={'source': 'manual'}, guards=guards),
        ):
            assert not result.written
            assert result.skipped_reason == 'redirected'


class TestSuffixedWorkThatAlreadyExists:
    """The `dark-hollow-1` regression (2026-08-19).

    A guitar tab was submitted for `dark-hollow-1` — a real, published,
    curated work — and refused, because the UNRELATED `dark-hollow` had been
    soft-deleted and the mint-time collision-suffix rule read `-1` as an
    attempt to resurrect it. The row could never succeed, and the hourly
    reconciler re-dispatched it anyway.

    The rule now splits: minting asks the base, touching does not.
    """

    def deleted(self, tmp_path, ids):
        path = tmp_path / 'docs' / 'data' / 'deleted_songs.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({i: {'reason': None} for i in ids}))

    def test_add_part_to_an_existing_suffixed_work_succeeds(self, tmp_path):
        create_work(tmp_path, 'dark-hollow-1', 'Dark Hollow', lead_sheet())
        self.deleted(tmp_path, ['dark-hollow'])

        result = add_part(
            tmp_path, 'dark-hollow-1',
            PartSpec(file='guitar.otf.json', type='tablature', format='otf',
                     instrument='guitar', content='{}',
                     provenance={'source': 'user-submission'}))

        assert result.written
        assert result.part_file == 'guitar.otf.json'
        assert [p['type'] for p in load_work(tmp_path, 'dark-hollow-1')['parts']] \
            == ['lead-sheet', 'tablature']

    def test_the_other_existing_modes_reach_it_too(self, tmp_path):
        create_work(tmp_path, 'dark-hollow-1', 'Dark Hollow', lead_sheet())
        self.deleted(tmp_path, ['dark-hollow'])

        assert update_part(tmp_path, 'dark-hollow-1',
                           match={'type': 'lead-sheet'}, content=CHORDPRO)
        assert update_metadata(tmp_path, 'dark-hollow-1',
                               updates={'artist': 'Bill Browning'},
                               provenance={'source': 'user-submission'})
        assert fork_to_arrangement(tmp_path, 'dark-hollow-1', CHORDPRO,
                                   {'source': 'user-submission'},
                                   version_label='Mine')

    def test_the_importer_path_is_NOT_weakened(self, tmp_path):
        """Minting a new `foo-1` beside a suppressed `foo` is still refused.

        This is the rule's whole reason to exist; only its scope changed.
        """
        self.deleted(tmp_path, ['dark-hollow'])
        result = create_work(tmp_path, 'dark-hollow-1', 'Dark Hollow',
                             lead_sheet(), on_collision='fail')
        assert not result.written
        assert result.skipped_reason == 'suppressed'
        assert not (tmp_path / 'works' / 'dark-hollow-1').exists()

    def test_a_suffixed_work_whose_OWN_id_is_deleted_stays_closed(self, tmp_path):
        create_work(tmp_path, 'dark-hollow-1', 'Dark Hollow', lead_sheet())
        self.deleted(tmp_path, ['dark-hollow-1'])

        result = add_part(
            tmp_path, 'dark-hollow-1',
            PartSpec(file='guitar.otf.json', type='tablature', format='otf',
                     instrument='guitar', content='{}',
                     provenance={'source': 'user-submission'}))
        assert not result.written
        assert result.skipped_reason == 'suppressed'


# ============================================
# Mode: add-part
# ============================================


class TestAddPart:
    def test_enriches_an_existing_work(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        result = add_part(tmp_path, 'my-song', PartSpec(
            file='banjo.otf.json', type='tablature', format='otf',
            instrument='banjo', content='{"tracks": []}',
            provenance={'source': 'user-submission', 'source_id': '42'}))
        assert result.written and result.mode == 'add-part'
        work = read_work(tmp_path, 'my-song')
        assert [p['type'] for p in work['parts']] == ['lead-sheet', 'tablature']
        assert (result.work_dir / 'banjo.otf.json').exists()
        # The lead sheet keeps its content and its default flag
        assert work['parts'][0]['default'] is True
        assert (result.work_dir / 'lead-sheet.pro').read_text() == CHORDPRO

    def test_duplicate_part_is_refused(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        with pytest.raises(PartExistsError):
            add_part(tmp_path, 'my-song',
                     lead_sheet(content='{meta: title Sneaky}\n[D]Nope\n'))
        assert (tmp_path / 'works' / 'my-song' / 'lead-sheet.pro').read_text() == CHORDPRO

    def test_duplicate_tab_arrangement_is_refused(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        tab = PartSpec(file='banjo.otf.json', type='tablature', format='otf',
                       instrument='banjo', content='{}',
                       provenance={'source': 'banjo-hangout', 'source_id': '7'})
        add_part(tmp_path, 'my-song', tab)
        with pytest.raises(PartExistsError):
            add_part(tmp_path, 'my-song', tab)

    def test_missing_work_is_refused(self, tmp_path):
        with pytest.raises(WorkNotFoundError):
            add_part(tmp_path, 'nobody-home', lead_sheet())

    def test_new_part_never_steals_the_default(self, tmp_path, capsys):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        add_part(tmp_path, 'my-song', PartSpec(
            file='banjo.otf.json', type='tablature', format='otf',
            instrument='banjo', default=True, content='{}',
            provenance={'source': 'user-submission'}))
        parts = read_work(tmp_path, 'my-song')['parts']
        assert parts[0]['default'] is True
        assert 'default' not in parts[1]


# ============================================
# Mode: update-part
# ============================================


class TestUpdatePart:
    def test_replaces_content_and_stamps_provenance(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        result = update_part(
            tmp_path, 'my-song', match={'type': 'lead-sheet'},
            content='{meta: title My Song}\n[C]Fixed chord\n',
            provenance_updates={'corrected_by': 'github:fixer',
                                'correction_issue': 12},
            work_updates={'title': 'My Song', 'default_key': 'C'})
        assert result.written and result.mode == 'update-part'
        assert 'Fixed chord' in (result.work_dir / 'lead-sheet.pro').read_text()
        work = read_work(tmp_path, 'my-song')
        assert work['default_key'] == 'C'
        prov = work['parts'][0]['provenance']
        assert prov['source'] == 'manual'  # original provenance survives
        assert prov['corrected_by'] == 'github:fixer'

    def test_prefers_the_default_part_when_several_match(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        fork_to_arrangement(tmp_path, 'my-song', CHORDPRO,
                            {'source': 'manual'}, version_label='Simplified')
        update_part(tmp_path, 'my-song', match={'type': 'lead-sheet'},
                    provenance_updates={'corrected_by': 'github:fixer'})
        parts = read_work(tmp_path, 'my-song')['parts']
        assert parts[0]['provenance']['corrected_by'] == 'github:fixer'
        assert 'corrected_by' not in parts[1]['provenance']

    def test_add_if_missing_appends_the_part(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        update_part(
            tmp_path, 'my-song',
            match={'type': 'tablature', 'instrument': 'banjo'},
            file='banjo.otf.json', content='{}',
            provenance_updates={'x_corrected': '2026-08-15'},
            add_if_missing=PartSpec(
                file='banjo.otf.json', type='tablature', format='otf',
                instrument='banjo',
                provenance={'source': 'user-submission'}))
        parts = read_work(tmp_path, 'my-song')['parts']
        assert parts[1]['instrument'] == 'banjo'
        assert parts[1]['provenance']['source'] == 'user-submission'
        assert parts[1]['provenance']['x_corrected'] == '2026-08-15'

    def test_no_match_and_no_fallback_is_refused(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        with pytest.raises(WorkNotFoundError):
            update_part(tmp_path, 'my-song',
                        match={'type': 'tablature', 'instrument': 'fiddle'},
                        content='{}')

    def test_directory_without_work_yaml_still_gets_its_file(self, tmp_path):
        """Historical correction behavior: works/<id>/ with no work.yaml."""
        work_dir = tmp_path / 'works' / 'bare'
        work_dir.mkdir(parents=True)
        result = update_part(tmp_path, 'bare', match={'type': 'lead-sheet'},
                             file='lead-sheet.pro', content=CHORDPRO)
        assert result.written
        assert (work_dir / 'lead-sheet.pro').read_text() == CHORDPRO
        assert not (work_dir / 'work.yaml').exists()

    def test_missing_work_directory_is_refused(self, tmp_path):
        with pytest.raises(WorkNotFoundError):
            update_part(tmp_path, 'nobody-home', match={'type': 'lead-sheet'},
                        content=CHORDPRO)


# ============================================
# Mode: fork-to-arrangement
# ============================================


class TestForkToArrangement:
    def test_adds_a_version_part_and_leaves_the_original_alone(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        before = (tmp_path / 'works' / 'my-song' / 'lead-sheet.pro').read_text()

        result = fork_to_arrangement(
            tmp_path, 'my-song', '{meta: title My Song}\n[C]Capo 2\n',
            {'source': 'manual', 'submitted_by': 'github:forker'},
            version_label='Capo 2 Simplified', version_type='simplified',
            arrangement_by='Jane Picker', version_notes='Easier voicings')

        assert result.mode == 'fork-to-arrangement'
        assert result.part_file == 'lead-sheet-capo-2-simplified.pro'
        # Original untouched: same file, same content, still the default
        assert (tmp_path / 'works' / 'my-song' / 'lead-sheet.pro').read_text() == before
        work = read_work(tmp_path, 'my-song')
        assert len(work['parts']) == 2
        assert work['parts'][0]['file'] == 'lead-sheet.pro'
        assert work['parts'][0]['default'] is True

        forked = work['parts'][1]
        assert 'default' not in forked
        assert forked['label'] == 'Capo 2 Simplified'
        assert forked['version_type'] == 'simplified'
        assert forked['arrangement_by'] == 'Jane Picker'
        assert forked['version_notes'] == 'Easier voicings'
        assert forked['provenance']['submitted_by'] == 'github:forker'

    def test_chart_carries_x_version_metadata(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        result = fork_to_arrangement(
            tmp_path, 'my-song', CHORDPRO, {'source': 'manual'},
            version_label='Golden Standard', arrangement_by='Ryan S',
            version_notes='From the fakebook')
        text = (result.work_dir / result.part_file).read_text()
        assert '{meta: x_version_label Golden Standard}' in text
        assert '{meta: x_version_type alternate}' in text
        assert '{meta: x_arrangement_by Ryan S}' in text
        assert '{meta: x_version_notes From the fakebook}' in text
        # Inserted after the existing meta block, before the music
        assert text.index('x_version_label') < text.index('[G]Some words')

    def test_forking_a_fork_replaces_the_version_directives(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        first = fork_to_arrangement(tmp_path, 'my-song', CHORDPRO,
                                    {'source': 'manual'}, version_label='One')
        forked_text = (first.work_dir / first.part_file).read_text()
        second = fork_to_arrangement(tmp_path, 'my-song', forked_text,
                                     {'source': 'manual'}, version_label='Two')
        text = (second.work_dir / second.part_file).read_text()
        assert text.count('x_version_label') == 1
        assert '{meta: x_version_label Two}' in text

    def test_two_forks_with_the_same_label_get_distinct_files(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        a = fork_to_arrangement(tmp_path, 'my-song', CHORDPRO,
                                {'source': 'manual'}, version_label='Mine')
        b = fork_to_arrangement(tmp_path, 'my-song', CHORDPRO,
                                {'source': 'manual'}, version_label='Mine')
        assert a.part_file != b.part_file
        assert len(read_work(tmp_path, 'my-song')['parts']) == 3

    def test_tab_fork_keeps_arrangements_distinguishable(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', PartSpec(
            file='banjo.otf.json', type='tablature', format='otf',
            instrument='banjo', default=True, content='{}',
            provenance={'source': 'banjo-hangout', 'source_id': '1'}))
        result = fork_to_arrangement(
            tmp_path, 'my-song', '{"tracks": []}',
            {'source': 'user-submission', 'source_id': '2'},
            version_label='Melodic', part_type='tablature',
            part_format='otf', instrument='banjo')
        assert result.part_file == 'banjo-melodic.otf.json'
        assert (result.work_dir / 'banjo-melodic.otf.json').read_text() == '{"tracks": []}'

    def test_fork_of_a_missing_work_is_refused(self, tmp_path):
        with pytest.raises(WorkNotFoundError):
            fork_to_arrangement(tmp_path, 'nobody-home', CHORDPRO,
                                {'source': 'manual'}, version_label='Mine')

    def test_fork_requires_provenance(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        with pytest.raises(ProvenanceRequiredError):
            fork_to_arrangement(tmp_path, 'my-song', CHORDPRO, {},
                                version_label='Mine')

    def test_fork_requires_a_label(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        with pytest.raises(ValueError):
            fork_to_arrangement(tmp_path, 'my-song', CHORDPRO,
                                {'source': 'manual'}, version_label='')


# ============================================
# Mode: update-metadata
# ============================================


PROV = {'source': 'user-submission', 'source_id': 'pending:meta:x:abc123',
        'submitted_by': '11111111-1111-4111-8111-111111111111'}


class TestUpdateMetadata:
    """Work-level fields, and — structurally — nothing else.

    This exists because `update_part(..., work_updates=...)` cannot serve the
    case: it has to find a part to rewrite before it writes anything, and the
    works this is for (a song minted by a tab, with a title and no artist)
    have no part their editor wants to touch. Reaching the work-level fields
    through a loose part match would rewrite whichever part the match picked.
    """

    def test_it_writes_the_work_fields_and_no_part(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        before = read_work(tmp_path, 'my-song')['parts']
        chart = (tmp_path / 'works/my-song/lead-sheet.pro').read_bytes()

        result = update_metadata(
            tmp_path, 'my-song',
            updates={'artist': 'Bill Monroe', 'default_key': 'A'},
            provenance=PROV, verbose=False)

        assert result.written
        assert result.mode == 'update-metadata'
        assert result.part_file is None

        work = read_work(tmp_path, 'my-song')
        assert work['artist'] == 'Bill Monroe'
        assert work['default_key'] == 'A'
        assert work['parts'] == before
        assert (tmp_path / 'works/my-song/lead-sheet.pro').read_bytes() == chart

    def test_only_whitelisted_fields(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())

        # `parts` is the one that matters — it is what makes "touches no part"
        # a property of the function rather than of its callers.
        for bad in ({'parts': []}, {'id': 'somebody-else'},
                    {'tags': ['Bluegrass']}, {'artist': 'ok', 'status': 'x'}):
            with pytest.raises(ValueError):
                update_metadata(tmp_path, 'my-song', updates=bad,
                                provenance=PROV, verbose=False)

        assert len(read_work(tmp_path, 'my-song')['parts']) == 1
        assert read_work(tmp_path, 'my-song')['id'] == 'my-song'

    def test_empty_values_are_dropped_never_written(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet(),
                    artist='Bill Monroe')

        update_metadata(tmp_path, 'my-song',
                        updates={'artist': None, 'notes': '',
                                 'composers': [], 'title': 'Renamed'},
                        provenance=PROV, verbose=False)

        work = read_work(tmp_path, 'my-song')
        assert work['title'] == 'Renamed'
        assert work['artist'] == 'Bill Monroe'
        assert 'notes' not in work
        assert 'composers' not in work

    def test_nothing_to_apply_is_refused(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        with pytest.raises(ValueError, match='no fields'):
            update_metadata(tmp_path, 'my-song', updates={'artist': None},
                            provenance=PROV, verbose=False)

    def test_provenance_is_required_here_too(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        with pytest.raises(ProvenanceRequiredError):
            update_metadata(tmp_path, 'my-song', updates={'artist': 'X'},
                            provenance={}, verbose=False)

    def test_a_missing_work_is_refused(self, tmp_path):
        with pytest.raises(WorkNotFoundError):
            update_metadata(tmp_path, 'nobody-home', updates={'artist': 'X'},
                            provenance=PROV, verbose=False)

    def test_a_suppressed_work_is_skipped(self, tmp_path):
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        write_registry(tmp_path, suppressed={'my-song': {'reason': 'gone'}})

        result = update_metadata(tmp_path, 'my-song',
                                 updates={'artist': 'X'}, provenance=PROV,
                                 guards=Guards.load(tmp_path), verbose=False)

        assert not result.written
        assert 'artist' not in read_work(tmp_path, 'my-song')

    def test_metadata_provenance_sits_above_parts_in_the_file(self, tmp_path):
        # Canonical key order: the work's own fields, then its parts. A reader
        # opening work.yaml should not have to scroll past a tab to find out
        # who last renamed the song.
        create_work(tmp_path, 'my-song', 'My Song', lead_sheet())
        update_metadata(tmp_path, 'my-song', updates={'artist': 'X'},
                        provenance=PROV, verbose=False)

        text = (tmp_path / 'works/my-song/work.yaml').read_text()
        assert text.index('metadata_provenance:') < text.index('parts:')


def test_apply_version_metadata_is_idempotent():
    once = apply_version_metadata(CHORDPRO, label='A', version_type='alternate')
    twice = apply_version_metadata(once, label='A', version_type='alternate')
    assert once == twice


def test_load_work_returns_none_when_absent(tmp_path):
    assert load_work(tmp_path, 'nope') is None
