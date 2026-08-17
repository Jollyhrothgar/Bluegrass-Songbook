"""Tab PR finalization (scripts/lib/process_tab.py).

Three shapes arrive on a tab PR branch and only one of them is a
correction. The one Phase 4c added a UI for is the middle case — a NEW
tab for a song that already exists (someone fulfilling a bounty) — which
must land as an extra part on that work, stamped as a submission rather
than as a fix to content that was never published.
"""

import json

import pytest
import yaml

import process_tab
import works_writer


def otf_doc(track_id='banjo'):
    return {
        'otf_version': '1.0',
        'metadata': {'title': 'Salt Creek'},
        'timing': {'ticks_per_beat': 480},
        'tracks': [{
            'id': track_id,
            'instrument': '5-string-banjo',
            'tuning': ['D4', 'B3', 'G3', 'D3', 'G4'],
        }],
        'notation': {track_id: [
            {'measure': 1, 'events': [{'tick': 0, 'notes': [{'s': 1, 'f': 0}]}]},
        ]},
    }


def write_otf(repo, work_id, name, doc=None):
    """``name`` is the works/ filename stem — 'banjo', or a sibling
    arrangement's uniquified 'banjo-mfa3k2px9'."""
    work_dir = repo / 'works' / work_id
    work_dir.mkdir(parents=True, exist_ok=True)
    path = work_dir / f'{name}.otf.json'
    path.write_text(json.dumps(doc or otf_doc()))
    return path


PR_BODY = """## Tab Submission

**Work ID:** salt-creek
**Title:** Salt Creek
**Instrument:** banjo
**Submitted by:** Jane Picker
"""


def run(repo, changed):
    return process_tab.process_changed(
        changed, PR_BODY, '412', 'janepicker', works_dir=repo / 'works')


@pytest.fixture
def repo(tmp_path):
    (tmp_path / 'works').mkdir()
    return tmp_path


def test_new_tab_for_an_existing_work_becomes_an_extra_part(repo):
    """The bounty case: a lead sheet is already published, a tab arrives."""
    works_writer.create_work(
        repo, 'salt-creek', 'Salt Creek',
        works_writer.PartSpec(file='lead-sheet.pro', type='lead-sheet',
                              format='chordpro', content='{meta: title Salt Creek}\n',
                              default=True,
                              provenance={'source': 'manual'}),
        verbose=False)
    write_otf(repo, 'salt-creek', 'banjo')

    run(repo, ['works/salt-creek/banjo.otf.json'])

    work = yaml.safe_load((repo / 'works/salt-creek/work.yaml').read_text())
    assert work['title'] == 'Salt Creek'
    parts = {p['type']: p for p in work['parts']}
    assert set(parts) == {'lead-sheet', 'tablature'}

    tab = parts['tablature']
    assert tab['file'] == 'banjo.otf.json'
    assert tab['instrument'] == 'banjo'
    assert tab['provenance']['source'] == 'user-submission'
    assert tab['provenance']['author'] == 'Jane Picker'
    assert tab['provenance']['submission_pr'] == 412
    # Nothing was corrected — this content had never been published
    assert not [k for k in tab['provenance'] if k.startswith('x_corrected')]
    # The existing lead sheet stays the default part
    assert parts['lead-sheet'].get('default') is True
    assert not tab.get('default')


def test_correcting_a_published_tab_still_stamps_the_correction(repo):
    works_writer.create_work(
        repo, 'salt-creek', 'Salt Creek',
        works_writer.PartSpec(file='banjo.otf.json', type='tablature',
                              format='otf', instrument='banjo', default=True,
                              provenance={'source': 'banjo-hangout'}),
        verbose=False)
    write_otf(repo, 'salt-creek', 'banjo')

    run(repo, ['works/salt-creek/banjo.otf.json'])

    work = yaml.safe_load((repo / 'works/salt-creek/work.yaml').read_text())
    tab = work['parts'][0]
    assert tab['provenance']['source'] == 'banjo-hangout'   # not overwritten
    assert tab['provenance']['x_corrected_by'] == 'github:janepicker'
    assert tab['provenance']['x_correction_pr'] == 412


def test_a_second_instrument_does_not_disturb_the_first(repo):
    works_writer.create_work(
        repo, 'salt-creek', 'Salt Creek',
        works_writer.PartSpec(file='banjo.otf.json', type='tablature',
                              format='otf', instrument='banjo', default=True,
                              provenance={'source': 'banjo-hangout'}),
        verbose=False)
    write_otf(repo, 'salt-creek', 'banjo')
    write_otf(repo, 'salt-creek', 'mandolin', otf_doc('mandolin'))

    run(repo, ['works/salt-creek/mandolin.otf.json'])

    work = yaml.safe_load((repo / 'works/salt-creek/work.yaml').read_text())
    by_instrument = {p['instrument']: p for p in work['parts']}
    assert set(by_instrument) == {'banjo', 'mandolin'}
    assert by_instrument['banjo']['provenance']['source'] == 'banjo-hangout'
    assert 'x_corrected_by' not in by_instrument['banjo']['provenance']
    assert by_instrument['mandolin']['provenance']['source'] == 'user-submission'


class TestSameInstrumentSibling:
    """A second banjo tab for a song that already has one.

    The corpus has always carried these (foggy-mountain-breakdown has
    eight banjo takes, rendered as selectable arrangements), but
    create-tab-pr used to 409 the submission — a late block, discovered
    only after the contributor had arranged the whole tab. It now
    uniquifies the filename and lands the tab as a NEW part, so this is
    the shape process_tab has to get right: append, never adopt.
    """

    @pytest.fixture
    def repo_with_banjo(self, repo):
        works_writer.create_work(
            repo, 'salt-creek', 'Salt Creek',
            works_writer.PartSpec(file='banjo.otf.json', type='tablature',
                                  format='otf', instrument='banjo', default=True,
                                  provenance={'source': 'banjo-hangout',
                                              'author': 'schlange'}),
            verbose=False)
        write_otf(repo, 'salt-creek', 'banjo')
        return repo

    def test_lands_as_a_new_part_with_its_own_provenance(self, repo_with_banjo):
        write_otf(repo_with_banjo, 'salt-creek', 'banjo-mfa3k2px9')

        run(repo_with_banjo, ['works/salt-creek/banjo-mfa3k2px9.otf.json'])

        work = yaml.safe_load(
            (repo_with_banjo / 'works/salt-creek/work.yaml').read_text())
        assert [p['file'] for p in work['parts']] == [
            'banjo.otf.json', 'banjo-mfa3k2px9.otf.json']

        sibling = work['parts'][1]
        # The uniquifying suffix is a FILENAME detail, not the instrument
        assert sibling['instrument'] == 'banjo'
        assert sibling['type'] == 'tablature'
        assert sibling['provenance']['source'] == 'user-submission'
        assert sibling['provenance']['author'] == 'Jane Picker'
        assert sibling['provenance']['submission_pr'] == 412
        # Nothing was corrected — this content had never been published
        assert not [k for k in sibling['provenance'] if k.startswith('x_corrected')]
        # A sibling never displaces the take that's already pinned
        assert not sibling.get('default')

    def test_the_existing_take_is_untouched(self, repo_with_banjo):
        before = (repo_with_banjo / 'works/salt-creek/banjo.otf.json').read_text()
        write_otf(repo_with_banjo, 'salt-creek', 'banjo-mfa3k2px9')

        run(repo_with_banjo, ['works/salt-creek/banjo-mfa3k2px9.otf.json'])

        work = yaml.safe_load(
            (repo_with_banjo / 'works/salt-creek/work.yaml').read_text())
        original = work['parts'][0]
        assert original['file'] == 'banjo.otf.json'      # not repointed
        assert original['default'] is True
        assert original['provenance']['source'] == 'banjo-hangout'
        assert original['provenance']['author'] == 'schlange'
        assert 'x_corrected_by' not in original['provenance']
        assert (repo_with_banjo / 'works/salt-creek/banjo.otf.json').read_text() \
            == before

    def test_correcting_a_sibling_stamps_that_sibling_only(self, repo_with_banjo):
        """The other half of the same rule: corrections are keyed on the
        file too, so fixing take #2 must not stamp take #1."""
        works_writer.add_part(
            repo_with_banjo, 'salt-creek',
            works_writer.PartSpec(file='banjo-22352.otf.json', type='tablature',
                                  format='otf', instrument='banjo',
                                  provenance={'source': 'banjo-hangout',
                                              'source_id': '22352'}),
            verbose=False)
        write_otf(repo_with_banjo, 'salt-creek', 'banjo-22352')

        run(repo_with_banjo, ['works/salt-creek/banjo-22352.otf.json'])

        work = yaml.safe_load(
            (repo_with_banjo / 'works/salt-creek/work.yaml').read_text())
        by_file = {p['file']: p for p in work['parts']}
        assert len(work['parts']) == 2                    # no third part minted
        assert by_file['banjo-22352.otf.json']['provenance']['x_correction_pr'] == 412
        assert 'x_corrected_by' not in by_file['banjo.otf.json']['provenance']

    def test_a_true_overwrite_is_still_refused(self, repo_with_banjo):
        """Same instrument, same file, no correction intent — the one case
        that stays an error rather than becoming a sibling."""
        work = works_writer.load_work(repo_with_banjo, 'salt-creek')
        # Two parts claiming one file can only come from a bad write; the
        # writer refuses to add a third onto the same name.
        with pytest.raises(works_writer.PartExistsError):
            works_writer.add_part(
                repo_with_banjo, 'salt-creek',
                works_writer.PartSpec(file='banjo.otf.json', type='tablature',
                                      format='otf', instrument='banjo',
                                      provenance={'source': 'user-submission'}),
                verbose=False)
        assert len(work['parts']) == 1


def test_instrument_comes_from_the_pr_body_when_the_filename_is_suffixed():
    """The filename stem is no longer the instrument once siblings exist."""
    from pathlib import Path
    assert process_tab.part_instrument(
        Path('works/x/banjo-mfa3k2px9.otf.json'), 'banjo') == 'banjo'
    assert process_tab.part_instrument(
        Path('works/x/banjo.otf.json'), 'banjo') == 'banjo'
    # A declared instrument that doesn't match the file is not trusted
    assert process_tab.part_instrument(
        Path('works/x/mandolin.otf.json'), 'banjo') == 'mandolin'
    # Hand-opened PR with no declaration: the stem still answers
    assert process_tab.part_instrument(
        Path('works/x/dobro.otf.json'), None) == 'dobro'


def test_a_tab_with_no_work_yet_mints_its_own_work(repo):
    write_otf(repo, 'salt-creek', 'banjo')

    run(repo, ['works/salt-creek/banjo.otf.json'])

    work = yaml.safe_load((repo / 'works/salt-creek/work.yaml').read_text())
    assert work['title'] == 'Salt Creek'
    assert work['parts'][0]['default'] is True
    assert work['parts'][0]['provenance']['submission_pr'] == 412


def test_paths_outside_works_are_refused(repo):
    with pytest.raises(SystemExit):
        run(repo, ['../../etc/passwd.otf.json'])
    with pytest.raises(SystemExit):
        run(repo, ['works/salt-creek/nested/banjo.otf.json'])
