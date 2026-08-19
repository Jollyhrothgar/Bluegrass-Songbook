"""Tests for add_song.py — the local "add a .pro to the collection" command.

The bug this suite exists to keep dead: `add-song` copied the file into
`songs/manual/parsed/`, a directory NO build has ever read (the primary
builder reads `works/`, the legacy one reads `sources/*/parsed/`), printed
"Added:" and exited 0. So the assertions here are about the corpus, not
about a file landing somewhere: a work directory under `works/`, with the
chart's own metadata on it, and a refusal rather than a clobber when the id
is taken.
"""

import pytest
import yaml

import works_writer
from add_song import AddSongError, add_song, parse_song_metadata

CHART = """{meta: title Roustabout}
{meta: artist Blue Canyon Boys}
{meta: composer Lester Flatt & Earl Scruggs}
{key: G}
{meta: x_source manual}

{start_of_verse: Verse 1}
Fog is [G]rolling [C]down the [G]river
{end_of_verse}
"""


def write_chart(tmp_path, name='roustabout.pro', content=CHART):
    path = tmp_path / 'inbox' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


def read_work(repo, work_id):
    return yaml.safe_load((repo / 'works' / work_id / 'work.yaml').read_text())


class TestParseSongMetadata:

    def test_meta_directives(self):
        meta = parse_song_metadata(CHART)
        assert meta['title'] == 'Roustabout'
        assert meta['artist'] == 'Blue Canyon Boys'
        assert meta['composer'] == 'Lester Flatt & Earl Scruggs'
        assert meta['key'] == 'G'

    def test_standard_chordpro_directives(self):
        meta = parse_song_metadata(
            '{title: Salt Creek}\n{artist: Bill Monroe}\n{meta: key A}\n')
        assert meta['title'] == 'Salt Creek'
        assert meta['artist'] == 'Bill Monroe'
        assert meta['key'] == 'A'

    def test_missing_fields_are_none(self):
        meta = parse_song_metadata('{title: Bare}\n[G]words\n')
        assert meta['title'] == 'Bare'
        assert meta['artist'] is None
        assert meta['composer'] is None
        assert meta['key'] is None

    def test_keyboard_is_not_a_key(self):
        # The key regex must not read {meta: keyboard ...} as key "board ..."
        assert parse_song_metadata('{meta: keyboard Nope}\n')['key'] is None


class TestAddSong:

    def test_creates_a_work(self, tmp_path):
        chart = write_chart(tmp_path)
        result = add_song(chart, repo_root=tmp_path)

        assert result.written
        assert result.work_id == 'roustabout'
        work_dir = tmp_path / 'works' / 'roustabout'
        assert (work_dir / 'work.yaml').exists()
        assert (work_dir / 'lead-sheet.pro').read_text() == CHART

    def test_metadata_lands_on_the_work(self, tmp_path):
        add_song(write_chart(tmp_path), repo_root=tmp_path)
        work = read_work(tmp_path, 'roustabout')

        assert work['id'] == 'roustabout'
        assert work['title'] == 'Roustabout'
        assert work['artist'] == 'Blue Canyon Boys'
        # One composer, not two — the flow-sequence quoting works_writer does.
        assert work['composers'] == ['Lester Flatt & Earl Scruggs']
        assert work['default_key'] == 'G'

    def test_part_is_the_default_lead_sheet(self, tmp_path):
        add_song(write_chart(tmp_path), repo_root=tmp_path)
        part, = read_work(tmp_path, 'roustabout')['parts']

        assert part['type'] == 'lead-sheet'
        assert part['format'] == 'chordpro'
        assert part['file'] == 'lead-sheet.pro'
        assert part['default'] is True

    def test_provenance_marks_a_local_manual_add(self, tmp_path):
        add_song(write_chart(tmp_path), repo_root=tmp_path)
        prov = read_work(tmp_path, 'roustabout')['parts'][0]['provenance']

        assert prov['source'] == 'manual'
        assert prov['source_file'] == 'roustabout.pro'
        assert prov['imported_at']
        # A local add is not a user submission and must not look like one.
        assert 'submitted_by' not in prov

    def test_explicit_arguments_win_over_the_chart(self, tmp_path):
        chart = write_chart(tmp_path)
        add_song(chart, repo_root=tmp_path, work_id='roustabout-bcb',
                 title='Roustabout (Blue Canyon)', artist='The Blue Canyon Boys',
                 composer='Traditional', key='A')
        work = read_work(tmp_path, 'roustabout-bcb')

        assert work['title'] == 'Roustabout (Blue Canyon)'
        assert work['artist'] == 'The Blue Canyon Boys'
        assert work['composers'] == ['Traditional']
        assert work['default_key'] == 'A'

    def test_id_defaults_to_slugified_title(self, tmp_path):
        chart = write_chart(tmp_path, 'x.pro', '{meta: title Salt Creek!}\n[G]a\n')
        assert add_song(chart, repo_root=tmp_path).work_id == 'salt-creek'

    def test_refuses_to_clobber_an_existing_work(self, tmp_path):
        chart = write_chart(tmp_path)
        add_song(chart, repo_root=tmp_path)
        before = (tmp_path / 'works' / 'roustabout' / 'lead-sheet.pro').read_text()

        other = write_chart(tmp_path, 'other.pro',
                            '{meta: title Roustabout}\n[C]different words\n')
        with pytest.raises(works_writer.WorkExistsError):
            add_song(other, repo_root=tmp_path)

        # Untouched: no rewrite, no extra work.
        assert (tmp_path / 'works' / 'roustabout' / 'lead-sheet.pro').read_text() \
            == before
        assert not (tmp_path / 'works' / 'roustabout-1').exists()

    def test_on_collision_suffix_when_asked(self, tmp_path):
        chart = write_chart(tmp_path)
        add_song(chart, repo_root=tmp_path)
        result = add_song(chart, repo_root=tmp_path, on_collision='suffix')

        assert result.work_id == 'roustabout-1'
        assert read_work(tmp_path, 'roustabout')['title'] == 'Roustabout'

    def test_suppressed_id_is_refused_loudly(self, tmp_path):
        registry = tmp_path / 'curation' / 'registry.yaml'
        registry.parent.mkdir(parents=True, exist_ok=True)
        registry.write_text(yaml.dump({
            'groups': {},
            'suppressed': {'roustabout': {'reason': 'nope'}},
        }))

        with pytest.raises(works_writer.SuppressedWorkError):
            add_song(write_chart(tmp_path), repo_root=tmp_path)
        assert not (tmp_path / 'works' / 'roustabout').exists()

    def test_missing_title_is_an_error(self, tmp_path):
        chart = write_chart(tmp_path, 'untitled.pro', '[G]just some words\n')
        with pytest.raises(AddSongError, match='no title'):
            add_song(chart, repo_root=tmp_path)
        assert not (tmp_path / 'works').exists()

    def test_bad_id_is_an_error(self, tmp_path):
        with pytest.raises(AddSongError, match='not a slug'):
            add_song(write_chart(tmp_path), repo_root=tmp_path,
                     work_id='Not A Slug')

    def test_missing_file_is_an_error(self, tmp_path):
        with pytest.raises(AddSongError, match='not found'):
            add_song(tmp_path / 'nope.pro', repo_root=tmp_path)

    def test_non_pro_extension_is_an_error(self, tmp_path):
        chart = write_chart(tmp_path, 'song.txt')
        with pytest.raises(AddSongError, match='.pro extension'):
            add_song(chart, repo_root=tmp_path)

    def test_empty_file_is_an_error(self, tmp_path):
        chart = write_chart(tmp_path, 'empty.pro', '   \n')
        with pytest.raises(AddSongError, match='empty'):
            add_song(chart, repo_root=tmp_path)

    def test_nothing_is_written_under_songs_manual_parsed(self, tmp_path):
        """The dead directory the old command wrote to stays dead."""
        add_song(write_chart(tmp_path), repo_root=tmp_path)
        assert not (tmp_path / 'songs').exists()
