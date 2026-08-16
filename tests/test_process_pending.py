"""Tests for the pending_songs -> works/ dispatch handler.

``process_pending.apply_row`` is the thin script the ``pending-commit``
repository_dispatch runs. It owns no writing logic of its own — everything
lands through ``works_writer`` — so what is worth guarding here is:

- each dispatched mode reaches the right writer entry point
- a fork never touches the original chart (the "hard to destroy" rule)
- a replayed dispatch is a no-op, not a second work / a stacked part
- a genuine second edit of the same row is NOT mistaken for a replay
- refusals are typed and loud (bad mode, empty content, no title)
"""

import pytest
import yaml

import works_writer
from process_pending import (
    ProcessPendingError,
    already_applied,
    apply_row,
    content_marker,
)

CHORDPRO = "{meta: title Blue Moon of Kentucky}\n[G]Blue moon of Kentucky\n"
OTHER_USER = 'aaaaaaaa-1111-2222-3333-444444444444'
SUBMITTER = 'bbbbbbbb-5555-6666-7777-888888888888'


def row(**kw):
    base = {
        'id': 'blue-moon-of-kentucky',
        'replaces_id': None,
        'title': 'Blue Moon of Kentucky',
        'artist': 'Bill Monroe',
        'composer': 'Bill Monroe',
        'content': CHORDPRO,
        'key': 'A',
        'created_by': SUBMITTER,
        'created_at': '2026-08-15T12:00:00+00:00',
    }
    base.update(kw)
    return base


def read_work(tmp_path, work_id):
    return yaml.safe_load(
        (tmp_path / 'works' / work_id / 'work.yaml').read_text())


def seed_work(tmp_path, work_id, *, submitted_by, content=CHORDPRO):
    """An existing work, as if a previous submission had landed it."""
    works_writer.create_work(
        tmp_path, work_id, 'Blue Moon of Kentucky',
        works_writer.PartSpec(
            file='lead-sheet.pro', type='lead-sheet', format='chordpro',
            default=True, content=content,
            provenance={'source': 'user-submission',
                        'source_id': 'pending:seed:0',
                        'submitted_by': submitted_by},
        ),
        artist='Bill Monroe', on_collision='fail', verbose=False)


# ============================================
# create
# ============================================


class TestCreate:
    def test_creates_a_new_work(self, tmp_path):
        result = apply_row(tmp_path, row(), 'create', 'blue-moon-of-kentucky',
                           actor='Tim', verbose=False)

        assert result.written
        assert result.work_id == 'blue-moon-of-kentucky'

        work = read_work(tmp_path, 'blue-moon-of-kentucky')
        assert work['title'] == 'Blue Moon of Kentucky'
        assert work['artist'] == 'Bill Monroe'
        assert work['composers'] == ['Bill Monroe']
        assert work['default_key'] == 'A'

        part = work['parts'][0]
        assert part['file'] == 'lead-sheet.pro'
        assert part['default'] is True
        # The verified auth.uid(), not a display name — the edge function
        # reads this field back to decide who may edit in place.
        assert part['provenance']['submitted_by'] == SUBMITTER
        assert part['provenance']['submitted_at'] == '2026-08-15'
        assert (tmp_path / 'works' / 'blue-moon-of-kentucky' / 'lead-sheet.pro') \
            .read_text() == CHORDPRO

    def test_collision_suffixes_rather_than_overwriting(self, tmp_path):
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=OTHER_USER,
                  content='{meta: title Original}\n[G]original\n')

        result = apply_row(tmp_path, row(), 'create', 'blue-moon-of-kentucky',
                           verbose=False)

        assert result.work_id == 'blue-moon-of-kentucky-1'
        original = (tmp_path / 'works' / 'blue-moon-of-kentucky' /
                    'lead-sheet.pro').read_text()
        assert original == '{meta: title Original}\n[G]original\n'


# ============================================
# update
# ============================================


class TestUpdate:
    def test_replaces_the_default_lead_sheet_in_place(self, tmp_path):
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=SUBMITTER,
                  content='{meta: title Old}\n[G]old words\n')

        new = "{meta: title Blue Moon of Kentucky}\n[A]new words\n"
        result = apply_row(tmp_path, row(content=new, key='B'), 'update',
                           'blue-moon-of-kentucky', actor='Tim', verbose=False)

        assert result.written
        work = read_work(tmp_path, 'blue-moon-of-kentucky')
        # Still exactly one part: an update is not a fork.
        assert len(work['parts']) == 1
        assert work['default_key'] == 'B'
        assert (tmp_path / 'works' / 'blue-moon-of-kentucky' /
                'lead-sheet.pro').read_text() == new

    def test_adds_the_part_when_the_work_has_none(self, tmp_path):
        works_writer.write_work_yaml(tmp_path, {
            'id': 'blue-moon-of-kentucky',
            'title': 'Blue Moon of Kentucky',
            'status': 'placeholder',
            'parts': [],
        })

        result = apply_row(tmp_path, row(), 'update', 'blue-moon-of-kentucky',
                           verbose=False)

        assert result.written
        work = read_work(tmp_path, 'blue-moon-of-kentucky')
        assert [p['file'] for p in work['parts']] == ['lead-sheet.pro']


# ============================================
# fork
# ============================================


class TestFork:
    def test_lands_as_a_new_version_part(self, tmp_path):
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=OTHER_USER,
                  content='{meta: title Original}\n[G]original\n')

        mine = "{meta: title Blue Moon of Kentucky}\n[A]my version\n"
        result = apply_row(tmp_path, row(content=mine), 'fork',
                           'blue-moon-of-kentucky', actor='Tim', verbose=False)

        assert result.written
        assert result.mode == 'fork-to-arrangement'

        work = read_work(tmp_path, 'blue-moon-of-kentucky')
        assert len(work['parts']) == 2

        original, fork = work['parts']
        # Untouched: same file, still the default, provenance intact.
        assert original['file'] == 'lead-sheet.pro'
        assert original['default'] is True
        assert original['provenance']['submitted_by'] == OTHER_USER
        assert (tmp_path / 'works' / 'blue-moon-of-kentucky' /
                'lead-sheet.pro').read_text() == '{meta: title Original}\n[G]original\n'

        # The fork never displaces the original.
        assert fork.get('default') is not True
        assert fork['label'] == "Tim's arrangement"
        assert fork['version_type'] == 'alternate'
        assert fork['arrangement_by'] == 'Tim'
        assert fork['provenance']['submitted_by'] == SUBMITTER

        forked = (tmp_path / 'works' / 'blue-moon-of-kentucky' /
                  fork['file']).read_text()
        assert '{meta: x_version_label Tim\'s arrangement}' in forked
        assert '{meta: x_arrangement_by Tim}' in forked
        assert '[A]my version' in forked

    def test_anonymous_actor_gets_a_neutral_label(self, tmp_path):
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=OTHER_USER)

        apply_row(tmp_path, row(content='[C]mine\n'), 'fork',
                  'blue-moon-of-kentucky', actor=None, verbose=False)

        work = read_work(tmp_path, 'blue-moon-of-kentucky')
        assert work['parts'][1]['label'] == 'Alternate arrangement'


# ============================================
# Idempotence
# ============================================


class TestReplay:
    def test_second_dispatch_of_the_same_row_is_a_no_op(self, tmp_path):
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=OTHER_USER)

        first = apply_row(tmp_path, row(), 'fork', 'blue-moon-of-kentucky',
                          actor='Tim', verbose=False)
        second = apply_row(tmp_path, row(), 'fork', 'blue-moon-of-kentucky',
                           actor='Tim', verbose=False)

        assert first.written
        assert not second.written
        assert second.skipped_reason == 'already-applied'
        assert len(read_work(tmp_path, 'blue-moon-of-kentucky')['parts']) == 2

    def test_a_real_second_edit_is_not_treated_as_a_replay(self, tmp_path):
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=OTHER_USER)

        apply_row(tmp_path, row(), 'fork', 'blue-moon-of-kentucky',
                  actor='Tim', verbose=False)
        edited = apply_row(tmp_path, row(content='[D]edited again\n'), 'fork',
                           'blue-moon-of-kentucky', actor='Tim', verbose=False)

        assert edited.written
        assert len(read_work(tmp_path, 'blue-moon-of-kentucky')['parts']) == 3

    def test_marker_is_row_and_content_scoped(self, tmp_path):
        assert content_marker('a', 'x') != content_marker('b', 'x')
        assert content_marker('a', 'x') != content_marker('a', 'y')
        assert content_marker('a', 'x').startswith('pending:a:')

    def test_already_applied_is_false_for_an_unknown_work(self, tmp_path):
        assert not already_applied(tmp_path, 'nope', 'pending:nope:0')


# ============================================
# Refusals
# ============================================


class TestRefusals:
    def test_unknown_mode(self, tmp_path):
        with pytest.raises(ProcessPendingError, match='unknown mode'):
            apply_row(tmp_path, row(), 'delete', 'blue-moon-of-kentucky',
                      verbose=False)

    def test_empty_content(self, tmp_path):
        with pytest.raises(ProcessPendingError, match='no content'):
            apply_row(tmp_path, row(content='   '), 'create',
                      'blue-moon-of-kentucky', verbose=False)

    def test_missing_title(self, tmp_path):
        with pytest.raises(ProcessPendingError, match='no title'):
            apply_row(tmp_path, row(title=''), 'create',
                      'blue-moon-of-kentucky', verbose=False)

    def test_fork_of_a_work_that_does_not_exist(self, tmp_path):
        with pytest.raises(works_writer.WorkNotFoundError):
            apply_row(tmp_path, row(), 'fork', 'nothing-here', verbose=False)

    def test_suppressed_work_is_skipped_not_written(self, tmp_path):
        registry = tmp_path / 'curation' / 'registry.yaml'
        registry.parent.mkdir(parents=True, exist_ok=True)
        registry.write_text(yaml.dump({
            'groups': {},
            'suppressed': {'blue-moon-of-kentucky': {'reason': 'merged away'}},
        }))

        result = apply_row(tmp_path, row(), 'create', 'blue-moon-of-kentucky',
                           verbose=False)

        assert not result.written
        assert not (tmp_path / 'works' / 'blue-moon-of-kentucky').exists()
