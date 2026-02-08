"""Tests for work_schema.py — Work dataclass serialization."""

from work_schema import Work, ExternalLinks, slugify


class TestWorkRoundTrip:
    """Test YAML serialization round-trips."""

    def test_minimal_work(self):
        work = Work(id='test-song', title='Test Song')
        parsed = Work.from_yaml(work.to_yaml())
        assert parsed.id == 'test-song'
        assert parsed.title == 'Test Song'
        assert parsed.status == 'complete'
        assert parsed.notes is None
        assert parsed.parts == []

    def test_placeholder_work(self):
        work = Work(
            id='rebecca',
            title='Rebecca',
            artist='Jim Mills',
            default_key='B',
            tags=['Bluegrass', 'Instrumental'],
            status='placeholder',
            notes='Classic Jim Mills banjo instrumental.',
            parts=[],
        )
        yaml_str = work.to_yaml()
        parsed = Work.from_yaml(yaml_str)
        assert parsed.status == 'placeholder'
        assert parsed.notes == 'Classic Jim Mills banjo instrumental.'
        assert parsed.parts == []
        assert parsed.artist == 'Jim Mills'
        assert parsed.default_key == 'B'
        assert parsed.tags == ['Bluegrass', 'Instrumental']

    def test_complete_work_omits_status(self):
        work = Work(id='test', title='Test', status='complete')
        yaml_str = work.to_yaml()
        assert 'status' not in yaml_str

    def test_placeholder_includes_status(self):
        work = Work(id='test', title='Test', status='placeholder')
        yaml_str = work.to_yaml()
        assert 'status: placeholder' in yaml_str

    def test_notes_none_not_serialized(self):
        work = Work(id='test', title='Test', notes=None)
        yaml_str = work.to_yaml()
        assert 'notes' not in yaml_str

    def test_notes_serialized_when_present(self):
        work = Work(id='test', title='Test', notes='Some notes here.')
        yaml_str = work.to_yaml()
        assert 'notes' in yaml_str
        parsed = Work.from_yaml(yaml_str)
        assert parsed.notes == 'Some notes here.'

    def test_external_links_round_trip(self):
        work = Work(
            id='test',
            title='Test',
            status='placeholder',
            external=ExternalLinks(
                youtube='https://youtube.com/watch?v=abc',
                strum_machine='https://strummachine.com/app/songs/xyz',
            ),
            parts=[],
        )
        parsed = Work.from_yaml(work.to_yaml())
        assert parsed.external.youtube == 'https://youtube.com/watch?v=abc'
        assert parsed.external.strum_machine == 'https://strummachine.com/app/songs/xyz'

    def test_exclude_tags_round_trip(self):
        work = Work(
            id='test',
            title='Test',
            exclude_tags=['Bluegrass', 'Folk'],
        )
        parsed = Work.from_yaml(work.to_yaml())
        assert parsed.exclude_tags == ['Bluegrass', 'Folk']


class TestSlugify:

    def test_basic(self):
        assert slugify('Hello World') == 'hello-world'

    def test_special_chars(self):
        assert slugify("Don't Stop") == 'don-t-stop'

    def test_spaces_and_dashes(self):
        assert slugify('Blue Moon of Kentucky') == 'blue-moon-of-kentucky'

    def test_multiple_spaces(self):
        assert slugify('Too   Many   Spaces') == 'too-many-spaces'
