"""Forked lead sheets in the index (issue #232).

``works_writer.fork_to_arrangement`` lands somebody else's take on a song as
an ADDITIONAL lead-sheet part on the same work. These tests pin the other
half of that: the index build has to emit those extra charts, and it has to
do so without moving a single byte for the works that have only one lead
sheet (which, as of 2026-08-15, is every work in the corpus).
"""

import json
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

import works_writer  # noqa: E402
from build_works_index import (  # noqa: E402
    arrangement_slug,
    build_song_from_work,
    published_arrangement_name,
    version_meta_from_content,
    write_outputs,
)

ORIGINAL = ('{meta: title How Long Blues}\n'
            '{meta: artist Jimmy Rushing}\n'
            '[G]How long, how [C]long has that evening train been [G]gone\n')

FORK = ('{meta: title How Long Blues}\n'
        '[G]How long, how long has that evening train been [D7]gone\n')


def write_work(root: Path, work: dict, files: dict) -> Path:
    work_dir = root / work['id']
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / 'work.yaml').write_text(yaml.dump(work, sort_keys=False))
    for name, text in files.items():
        (work_dir / name).write_text(text)
    return work_dir


def single_sheet_work(root: Path) -> Path:
    return write_work(root, {
        'id': 'how-long-blues',
        'title': 'How Long Blues',
        'artist': 'Jimmy Rushing',
        'tags': ['Bluegrass'],
        'parts': [{'type': 'lead-sheet', 'format': 'chordpro',
                   'file': 'lead-sheet.pro', 'default': True,
                   'provenance': {'source': 'manual'}}],
    }, {'lead-sheet.pro': ORIGINAL})


# ------------------------------------------------------- naming helpers

class TestNaming:
    def test_slug_comes_from_the_part_filename(self):
        assert arrangement_slug('lead-sheet-simplified.pro', 0, set()) == \
            'simplified'

    def test_slug_falls_back_to_position(self):
        assert arrangement_slug('lead-sheet.pro', 3, set()) == 'p3'

    def test_slugs_are_deduped_within_a_work(self):
        taken = set()
        assert arrangement_slug('lead-sheet-two_takes.pro', 0, taken) == \
            'two-takes'
        assert arrangement_slug('lead-sheet-two-takes.pro', 1, taken) == \
            'two-takes-2'

    def test_published_name_cannot_collide_with_a_work_id(self):
        # slugify() collapses runs of dashes, so no minted work id holds '--'
        assert published_arrangement_name('how-long-blues', 'simplified') == \
            'how-long-blues--simplified.pro'

    def test_version_meta_is_read_off_the_chart(self):
        meta = version_meta_from_content(works_writer.apply_version_metadata(
            ORIGINAL, label='Simplified', version_type='simplified',
            arrangement_by='Jane Picker', notes='Three chords only'))
        assert meta == {'label': 'Simplified', 'version_type': 'simplified',
                        'arrangement_by': 'Jane Picker',
                        'notes': 'Three chords only'}


# ------------------------------------------------------- the row itself

class TestSingleLeadSheetIsUntouched:
    def test_no_arrangements_key(self, tmp_path):
        song = build_song_from_work(single_sheet_work(tmp_path / 'works'))
        assert 'arrangements' not in song

    def test_row_is_byte_identical_before_and_after_a_fork_elsewhere(
            self, tmp_path):
        """A fork on ANOTHER work must not perturb this one."""
        works = tmp_path / 'works'
        before = json.dumps(build_song_from_work(single_sheet_work(works)),
                            ensure_ascii=False, sort_keys=True)
        write_work(works, {
            'id': 'other-song', 'title': 'Other Song',
            'parts': [
                {'type': 'lead-sheet', 'file': 'lead-sheet.pro'},
                {'type': 'lead-sheet', 'file': 'lead-sheet-alt.pro',
                 'label': 'Alt'},
            ]}, {'lead-sheet.pro': ORIGINAL, 'lead-sheet-alt.pro': FORK})
        after = json.dumps(build_song_from_work(works / 'how-long-blues'),
                           ensure_ascii=False, sort_keys=True)
        assert after == before


class TestForkedWork:
    @pytest.fixture
    def forked(self, tmp_path):
        works = tmp_path / 'works'
        work_dir = single_sheet_work(works)
        works_writer.fork_to_arrangement(
            tmp_path, 'how-long-blues', FORK,
            {'source': 'user-submission', 'submitted_by': 'uuid-jane'},
            version_label='Simplified', version_type='simplified',
            arrangement_by='Jane Picker', version_notes='Three chords only',
            verbose=False)
        return work_dir

    def test_the_primary_still_owns_the_row(self, forked):
        song = build_song_from_work(forked)
        # content, key, chords and lyrics all still come from lead-sheet.pro
        assert song['content'] == ORIGINAL
        assert 'IV' in song['nashville']       # the C the fork dropped

    def test_every_lead_sheet_is_listed(self, forked):
        arrangements = build_song_from_work(forked)['arrangements']
        assert [a['slug'] for a in arrangements] == ['default', 'simplified']
        assert arrangements[0]['default'] is True
        assert arrangements[0]['file'] == 'data/songs/how-long-blues.pro'
        assert 'default' not in arrangements[1]

    def test_the_fork_carries_its_version_metadata(self, forked):
        fork = build_song_from_work(forked)['arrangements'][1]
        assert fork['label'] == 'Simplified'
        assert fork['version_type'] == 'simplified'
        assert fork['arrangement_by'] == 'Jane Picker'
        assert fork['notes'] == 'Three chords only'
        assert fork['submitted_by'] == 'uuid-jane'
        assert fork['file'] == 'data/songs/how-long-blues--simplified.pro'

    def test_each_arrangement_gets_its_own_key_and_chord_count(self, forked):
        arrangements = build_song_from_work(forked)['arrangements']
        assert arrangements[0]['chord_count'] == 2   # G, C
        assert arrangements[1]['chord_count'] == 2   # G, D7 — a DIFFERENT two
        assert all(a['key'] for a in arrangements)

    def test_the_chart_text_is_published_beside_the_primary(
            self, forked, tmp_path):
        song = build_song_from_work(forked)
        index_file = tmp_path / 'docs' / 'data' / 'index.jsonl'
        index_file.parent.mkdir(parents=True)
        write_outputs([song], index_file)

        songs_dir = index_file.parent / 'songs'
        assert (songs_dir / 'how-long-blues.pro').read_text() == ORIGINAL
        published = (songs_dir / 'how-long-blues--simplified.pro').read_text()
        assert '[D7]gone' in published
        assert '{meta: x_version_label Simplified}' in published

        row = json.loads(index_file.read_text().strip())
        # the chart text never rides along on the row
        assert all('_content' not in a for a in row['arrangements'])
        assert row['arrangements'][1]['file'] == \
            'data/songs/how-long-blues--simplified.pro'

    def test_arrangement_files_are_not_pruned_as_orphans(
            self, forked, tmp_path):
        song = build_song_from_work(forked)
        index_file = tmp_path / 'docs' / 'data' / 'index.jsonl'
        index_file.parent.mkdir(parents=True)
        write_outputs([song], index_file)
        write_outputs([build_song_from_work(forked)], index_file)
        assert (index_file.parent / 'songs' /
                'how-long-blues--simplified.pro').exists()

    def test_a_removed_fork_is_pruned(self, forked, tmp_path):
        index_file = tmp_path / 'docs' / 'data' / 'index.jsonl'
        index_file.parent.mkdir(parents=True)
        write_outputs([build_song_from_work(forked)], index_file)

        work = yaml.safe_load((forked / 'work.yaml').read_text())
        work['parts'] = work['parts'][:1]
        (forked / 'work.yaml').write_text(yaml.dump(work, sort_keys=False))
        (forked / 'lead-sheet-simplified.pro').unlink()
        write_outputs([build_song_from_work(forked)], index_file)

        assert not (index_file.parent / 'songs' /
                    'how-long-blues--simplified.pro').exists()
        assert (index_file.parent / 'songs' / 'how-long-blues.pro').exists()


class TestNonStandardPrimaryFilename:
    """A work whose only lead sheet isn't named lead-sheet.pro used to build
    with no content at all. Nothing in the corpus is shaped that way today —
    a fork never displaces the original — but the fallback keeps a hand-made
    work from silently losing its chart."""

    def test_the_default_part_is_used_when_lead_sheet_pro_is_absent(
            self, tmp_path):
        work_dir = write_work(tmp_path / 'works', {
            'id': 'odd-one', 'title': 'Odd One',
            'parts': [{'type': 'lead-sheet', 'file': 'chart.pro',
                       'default': True}],
        }, {'chart.pro': ORIGINAL})
        song = build_song_from_work(work_dir)
        assert song['content'] == ORIGINAL
        assert 'arrangements' not in song
