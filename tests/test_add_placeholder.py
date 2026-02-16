"""Tests for add_placeholder.py — CLI placeholder creation."""

import yaml

from add_placeholder import create_placeholder


class TestCreatePlaceholder:

    def test_creates_work_directory(self, tmp_path):
        work_dir = create_placeholder(title='Rebecca', artist='Jim Mills',
                                       key='B', works_dir=tmp_path)
        assert work_dir.exists()
        assert (work_dir / 'work.yaml').exists()

    def test_work_yaml_content(self, tmp_path):
        work_dir = create_placeholder(
            title='Rebecca', artist='Jim Mills', key='B',
            tags=['Bluegrass', 'Instrumental'],
            notes='Classic banjo tune.',
            works_dir=tmp_path,
        )
        with open(work_dir / 'work.yaml') as f:
            data = yaml.safe_load(f)
        assert data['id'] == 'rebecca'
        assert data['title'] == 'Rebecca'
        assert data['artist'] == 'Jim Mills'
        assert data['default_key'] == 'B'
        assert data['status'] == 'placeholder'
        assert data['notes'] == 'Classic banjo tune.'
        assert data['parts'] == []

    def test_slug_collision_handling(self, tmp_path):
        dir1 = create_placeholder(title='Rebecca', works_dir=tmp_path)
        assert dir1.name == 'rebecca'
        dir2 = create_placeholder(title='Rebecca', works_dir=tmp_path)
        assert dir2.name == 'rebecca-1'

    def test_external_links(self, tmp_path):
        work_dir = create_placeholder(
            title='Test Song',
            youtube='https://youtube.com/watch?v=abc',
            strum_machine='https://strummachine.com/app/songs/xyz',
            works_dir=tmp_path,
        )
        with open(work_dir / 'work.yaml') as f:
            data = yaml.safe_load(f)
        assert data['external']['youtube'] == 'https://youtube.com/watch?v=abc'
        assert data['external']['strum_machine'] == 'https://strummachine.com/app/songs/xyz'

    def test_no_external_when_empty(self, tmp_path):
        work_dir = create_placeholder(title='Simple Song', works_dir=tmp_path)
        with open(work_dir / 'work.yaml') as f:
            data = yaml.safe_load(f)
        assert 'external' not in data

    def test_composers(self, tmp_path):
        work_dir = create_placeholder(
            title='Test', composers=['Bill Monroe', 'Lester Flatt'],
            works_dir=tmp_path,
        )
        with open(work_dir / 'work.yaml') as f:
            data = yaml.safe_load(f)
        assert data['composers'] == ['Bill Monroe', 'Lester Flatt']
