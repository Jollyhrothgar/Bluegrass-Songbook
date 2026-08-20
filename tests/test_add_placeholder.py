"""Tests for add_placeholder.py — CLI placeholder creation.

A placeholder is a work with metadata and ``parts: []``. It now writes
through :mod:`works_writer`, so the interesting half of this suite is the
REFUSALS it inherited: this script used to author ``work.yaml`` itself and
asked neither the suppression registry nor the redirect map, so it could
mint a work at an id an admin had deleted or the merge tool had already
pointed elsewhere.
"""

import json

import pytest
import yaml

import works_writer
from add_placeholder import PLACEHOLDER_STATUS, create_placeholder, main


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


class TestCreatePlaceholder:

    def test_creates_work_directory(self, tmp_path):
        result = create_placeholder('Rebecca', repo_root=tmp_path,
                                    artist='Jim Mills', key='B')
        assert result.written
        assert result.work_id == 'rebecca'
        assert result.part_file is None
        assert (result.work_dir / 'work.yaml').exists()

    def test_work_yaml_content(self, tmp_path):
        create_placeholder(
            'Rebecca', repo_root=tmp_path, artist='Jim Mills', key='B',
            tags=['Bluegrass', 'Instrumental'],
            notes='Classic banjo tune.',
        )
        data = read_work(tmp_path, 'rebecca')
        assert data['id'] == 'rebecca'
        assert data['title'] == 'Rebecca'
        assert data['artist'] == 'Jim Mills'
        assert data['default_key'] == 'B'
        assert data['tags'] == ['Bluegrass', 'Instrumental']
        assert data['notes'] == 'Classic banjo tune.'
        assert data['parts'] == []

    def test_status_placeholder_survives_into_the_yaml(self, tmp_path):
        """``status: placeholder`` is what utils.isPlaceholder and the bounty
        board read. It rides through works_writer's ``extra``, so it is worth
        asserting on the FILE rather than on the call."""
        create_placeholder('Ground Hog', repo_root=tmp_path)
        text = (tmp_path / 'works' / 'ground-hog' / 'work.yaml').read_text()
        assert 'status: placeholder' in text
        assert yaml.safe_load(text)['status'] == PLACEHOLDER_STATUS

    def test_no_content_file_is_written(self, tmp_path):
        result = create_placeholder('Ground Hog', repo_root=tmp_path)
        assert sorted(p.name for p in result.work_dir.iterdir()) == \
            ['work.yaml']

    def test_external_links(self, tmp_path):
        create_placeholder(
            'Test Song', repo_root=tmp_path,
            youtube='https://youtube.com/watch?v=abc',
            strum_machine='https://strummachine.com/app/songs/xyz',
        )
        data = read_work(tmp_path, 'test-song')
        assert data['external']['youtube'] == 'https://youtube.com/watch?v=abc'
        assert data['external']['strum_machine'] == \
            'https://strummachine.com/app/songs/xyz'

    def test_no_external_when_empty(self, tmp_path):
        create_placeholder('Simple Song', repo_root=tmp_path)
        assert 'external' not in read_work(tmp_path, 'simple-song')

    def test_composers(self, tmp_path):
        create_placeholder('Test', repo_root=tmp_path,
                           composers=['Bill Monroe', 'Lester Flatt'])
        assert read_work(tmp_path, 'test')['composers'] == \
            ['Bill Monroe', 'Lester Flatt']

    def test_comma_in_composer_stays_one_composer(self, tmp_path):
        """Inherited from works_writer's dumper: the hand-rolled yaml.dump
        this script used would emit `[Smith, John]` as a flow sequence."""
        create_placeholder('Test', repo_root=tmp_path,
                           composers=['Smith, John'])
        assert read_work(tmp_path, 'test')['composers'] == ['Smith, John']

    def test_title_is_required(self, tmp_path):
        from add_placeholder import AddPlaceholderError
        with pytest.raises(AddPlaceholderError):
            create_placeholder('   ', repo_root=tmp_path)


class TestCollisions:
    """What the CLI promised before the conversion: foo -> foo-1."""

    def test_slug_collision_handling(self, tmp_path):
        first = create_placeholder('Rebecca', repo_root=tmp_path)
        assert first.work_id == 'rebecca'
        second = create_placeholder('Rebecca', repo_root=tmp_path)
        assert second.work_id == 'rebecca-1'
        third = create_placeholder('Rebecca', repo_root=tmp_path)
        assert third.work_id == 'rebecca-2'

    def test_on_collision_fail(self, tmp_path):
        create_placeholder('Rebecca', repo_root=tmp_path)
        with pytest.raises(works_writer.WorkExistsError):
            create_placeholder('Rebecca', repo_root=tmp_path,
                               on_collision='fail')

    def test_collision_skips_a_suppressed_candidate(self, tmp_path):
        """New behaviour, and the point of the conversion: the suffix hunt
        steps over an id that is itself suppressed instead of resurrecting
        it."""
        write_registry(tmp_path, suppressed={'rebecca-1': {'reason': 'bad'}})
        create_placeholder('Rebecca', repo_root=tmp_path)
        assert create_placeholder(
            'Rebecca', repo_root=tmp_path).work_id == 'rebecca-2'
        assert not (tmp_path / 'works' / 'rebecca-1').exists()

    def test_existing_work_is_never_overwritten(self, tmp_path):
        create_placeholder('Rebecca', repo_root=tmp_path, artist='Jim Mills')
        create_placeholder('Rebecca', repo_root=tmp_path, artist='Somebody')
        assert read_work(tmp_path, 'rebecca')['artist'] == 'Jim Mills'


class TestGuards:
    """The two questions this script never asked."""

    def test_suppressed_id_is_refused(self, tmp_path):
        write_registry(tmp_path, suppressed={'rebecca': {'reason': 'deleted'}})
        with pytest.raises(works_writer.SuppressedWorkError):
            create_placeholder('Rebecca', repo_root=tmp_path)
        assert not (tmp_path / 'works' / 'rebecca').exists()

    def test_soft_deleted_id_is_refused(self, tmp_path):
        """deleted_songs.json is the admin delete path — the same refusal."""
        path = tmp_path / 'docs' / 'data' / 'deleted_songs.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'rebecca': {'reason': 'admin delete'}}))
        with pytest.raises(works_writer.SuppressedWorkError):
            create_placeholder('Rebecca', repo_root=tmp_path)
        assert not (tmp_path / 'works' / 'rebecca').exists()

    def test_redirected_id_is_refused(self, tmp_path):
        write_redirects(tmp_path, {'rebecca': 'rebecca-canonical'})
        with pytest.raises(works_writer.SuppressedWorkError) as exc:
            create_placeholder('Rebecca', repo_root=tmp_path)
        assert 'merged away' in str(exc.value)
        assert not (tmp_path / 'works' / 'rebecca').exists()

    def test_a_suppressed_id_cannot_be_reached_by_suffixing_either(self, tmp_path):
        """A leftover directory must not turn the refusal into a quiet
        `rebecca-1`: the mint guard refuses the base AND its suffixes."""
        write_registry(tmp_path, suppressed={'rebecca': {'reason': 'gone'}})
        (tmp_path / 'works' / 'rebecca').mkdir(parents=True)
        with pytest.raises(works_writer.SuppressedWorkError):
            create_placeholder('Rebecca', repo_root=tmp_path)
        assert not (tmp_path / 'works' / 'rebecca-1').exists()


class TestCli:

    def test_main_creates_and_reports(self, tmp_path, capsys):
        rc = main(['Ground Hog', '--artist', 'Doc Watson', '--key', 'A',
                   '--tags', 'OldTime,Instrumental',
                   '--repo-root', str(tmp_path), '--skip-index-rebuild'])
        out = capsys.readouterr().out
        assert rc == 0
        assert 'Created placeholder: ground-hog' in out
        data = read_work(tmp_path, 'ground-hog')
        assert data['artist'] == 'Doc Watson'
        assert data['tags'] == ['OldTime', 'Instrumental']
        assert data['status'] == PLACEHOLDER_STATUS

    def test_main_reports_a_refusal_and_exits_nonzero(self, tmp_path, capsys):
        write_registry(tmp_path, suppressed={'rebecca': {'reason': 'gone'}})
        rc = main(['Rebecca', '--repo-root', str(tmp_path),
                   '--skip-index-rebuild'])
        assert rc == 1
        assert 'suppressed' in capsys.readouterr().out.lower()
