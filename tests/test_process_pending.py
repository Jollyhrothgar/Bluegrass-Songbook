"""Tests for the pending_songs -> works/ dispatch handler.

``process_pending.apply_row`` is the thin script the ``pending-commit``
repository_dispatch runs. It owns no writing logic of its own — everything
lands through ``works_writer`` — so what is worth guarding here is:

- each dispatched mode reaches the right writer entry point
- a fork never touches the original chart (the "hard to destroy" rule)
- a replayed dispatch is a no-op, not a second work / a stacked part
- a genuine second edit of the same row is NOT mistaken for a replay
- refusals are typed and loud (bad mode, empty content, no title)
- the phase-3b dedup backstop diverts, holds, or stays out of the way
- a tablature row reaches the writer as a tab: created, added beside what is
  there, or updated in place — never overwriting a stranger's take
- an OTF is validated before it is written, and the lyric-based dedup
  backstop stays away from it
- owning one KIND of part never buys edit rights over another kind

The backstop tests use the ``tests/fixtures/dedup/`` charts, whose provenance
is documented in ``tests/test_dedup_scorer.py``: the ``how-long-blues`` pair is
the real #208 miss (a lyrics-only scrape and the same song submitted with
chords), so "would this have been caught?" is asked here with the actual text
that wasn't.
"""

import json

import pytest
import yaml

import works_writer
from process_pending import (
    DEDUP_HOLD_REASON,
    DedupBackstop,
    ProcessPendingError,
    already_applied,
    apply_row,
    content_marker,
    otf_document,
    owns_content,
    validate_otf,
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
# Which chart an update rewrites
# ============================================


PRIMARY = '{meta: title Original}\n[G]the primary chart\n'


def seed_forked_work(tmp_path, work_id='blue-moon-of-kentucky', *,
                     primary_by=OTHER_USER, fork_by=SUBMITTER,
                     fork_source_id='pending:some-other-row:beef'):
    """A work with somebody's primary chart and somebody's fork of it."""
    seed_work(tmp_path, work_id, submitted_by=primary_by, content=PRIMARY)
    works_writer.fork_to_arrangement(
        tmp_path, work_id, '{meta: title Original}\n[C]my own take\n',
        {'source': 'user-submission', 'source_id': fork_source_id,
         'submitted_by': fork_by, 'submitted_at': '2026-08-01'},
        version_label="Tim's arrangement", arrangement_by='Tim',
        verbose=False)
    return work_id


class TestUpdateTargeting:
    """An ``update`` rewrites the chart the actor OWNS.

    Ownership classification (``owns_content`` here, ``classifyChange`` in
    the edge function) answers "update" as soon as the caller appears in ANY
    part's provenance — so a user who owns nothing but a FORK is dispatched
    in update mode. Before this rule the update path matched
    ``{'type': 'lead-sheet'}`` and, default-preferred, landed on the PRIMARY:
    a fork owner's second edit silently overwrote somebody else's chart,
    straight through the "hard to destroy" rule.
    """

    def test_fork_owner_edits_their_fork_not_the_primary(self, tmp_path):
        seed_forked_work(tmp_path)
        work_dir = tmp_path / 'works' / 'blue-moon-of-kentucky'
        fork_file = read_work(tmp_path, 'blue-moon-of-kentucky')['parts'][1]['file']

        new = '{meta: title Blue Moon of Kentucky}\n[D]my take, revised\n'
        result = apply_row(tmp_path, row(content=new, title='Renamed By Me',
                                         artist='Not Bill', key='B'),
                           'update', 'blue-moon-of-kentucky', actor='Tim',
                           verbose=False)

        assert result.written
        assert result.part_file == fork_file
        # The primary is byte-identical — nothing about it was read-modify-written.
        assert (work_dir / 'lead-sheet.pro').read_text() == PRIMARY
        assert (work_dir / fork_file).read_text() == new

        work = read_work(tmp_path, 'blue-moon-of-kentucky')
        assert len(work['parts']) == 2
        primary, fork = work['parts']
        assert primary['default'] is True
        assert primary['provenance']['submitted_by'] == OTHER_USER
        assert fork.get('default') is not True
        # Work-level metadata belongs to the song, not to one arrangement:
        # editing a fork must not retitle or re-key the whole work.
        assert work['title'] == 'Blue Moon of Kentucky'
        assert work['artist'] == 'Bill Monroe'
        assert 'default_key' not in work

    def test_primary_owner_edits_the_primary(self, tmp_path):
        seed_forked_work(tmp_path, primary_by=SUBMITTER, fork_by=OTHER_USER)
        work_dir = tmp_path / 'works' / 'blue-moon-of-kentucky'
        fork_file = read_work(tmp_path, 'blue-moon-of-kentucky')['parts'][1]['file']
        forked_before = (work_dir / fork_file).read_text()

        new = '{meta: title Blue Moon of Kentucky}\n[A]new words\n'
        result = apply_row(tmp_path, row(content=new, key='B'), 'update',
                           'blue-moon-of-kentucky', actor='Tim', verbose=False)

        assert result.part_file == 'lead-sheet.pro'
        assert (work_dir / 'lead-sheet.pro').read_text() == new
        assert (work_dir / fork_file).read_text() == forked_before
        # An edit of the primary still carries the work-level fields.
        assert read_work(tmp_path, 'blue-moon-of-kentucky')['default_key'] == 'B'

    def test_trusted_non_owner_edits_the_primary(self, tmp_path):
        """The trusted branch of classifyChange: they own nothing here, and
        an in-place edit right is about the work's main chart."""
        third_party = 'cccccccc-9999-0000-1111-222222222222'
        seed_forked_work(tmp_path, primary_by=OTHER_USER, fork_by=third_party)
        work_dir = tmp_path / 'works' / 'blue-moon-of-kentucky'
        fork_file = read_work(tmp_path, 'blue-moon-of-kentucky')['parts'][1]['file']
        forked_before = (work_dir / fork_file).read_text()

        new = '{meta: title Blue Moon of Kentucky}\n[A]tidied up\n'
        result = apply_row(tmp_path, row(content=new, key='B'), 'update',
                           'blue-moon-of-kentucky', actor='Mod', verbose=False)

        assert result.part_file == 'lead-sheet.pro'
        assert (work_dir / 'lead-sheet.pro').read_text() == new
        assert (work_dir / fork_file).read_text() == forked_before
        assert read_work(tmp_path, 'blue-moon-of-kentucky')['default_key'] == 'B'

    def test_owner_of_both_edits_the_primary(self, tmp_path):
        """Rule 2: owning the primary AND a fork lands on the primary — an
        owner correcting the main chart is the ordinary case."""
        seed_forked_work(tmp_path, primary_by=SUBMITTER, fork_by=SUBMITTER)
        work_dir = tmp_path / 'works' / 'blue-moon-of-kentucky'
        fork_file = read_work(tmp_path, 'blue-moon-of-kentucky')['parts'][1]['file']
        forked_before = (work_dir / fork_file).read_text()

        new = '{meta: title Blue Moon of Kentucky}\n[A]both are mine\n'
        result = apply_row(tmp_path, row(content=new), 'update',
                           'blue-moon-of-kentucky', actor='Tim', verbose=False)

        assert result.part_file == 'lead-sheet.pro'
        assert (work_dir / 'lead-sheet.pro').read_text() == new
        assert (work_dir / fork_file).read_text() == forked_before

    def test_the_row_returns_to_the_part_it_landed_on(self, tmp_path):
        """Rule 1 beats rule 2: when THIS row already wrote a part, a
        re-edit of the row goes back to that part even though the actor also
        owns the primary."""
        seed_forked_work(tmp_path, primary_by=SUBMITTER, fork_by=SUBMITTER,
                         fork_source_id=content_marker(
                             'blue-moon-of-kentucky', 'earlier draft'))
        work_dir = tmp_path / 'works' / 'blue-moon-of-kentucky'
        fork_file = read_work(tmp_path, 'blue-moon-of-kentucky')['parts'][1]['file']

        new = '{meta: title Blue Moon of Kentucky}\n[D]revised draft\n'
        result = apply_row(tmp_path, row(content=new), 'update',
                           'blue-moon-of-kentucky', actor='Tim', verbose=False)

        assert result.part_file == fork_file
        assert (work_dir / 'lead-sheet.pro').read_text() == PRIMARY

    def test_most_recent_of_several_forks_wins(self, tmp_path):
        """Rule 3: several arrangements of their own, none of them the
        primary and none carrying this row's marker."""
        seed_forked_work(tmp_path, primary_by=OTHER_USER, fork_by=SUBMITTER)
        works_writer.fork_to_arrangement(
            tmp_path, 'blue-moon-of-kentucky', '[E]a later take\n',
            {'source': 'user-submission', 'source_id': 'pending:another:cafe',
             'submitted_by': SUBMITTER, 'submitted_at': '2026-08-10'},
            version_label='Second take', verbose=False)

        parts = read_work(tmp_path, 'blue-moon-of-kentucky')['parts']
        older, newer = parts[1]['file'], parts[2]['file']

        result = apply_row(tmp_path, row(content='[F]newest\n'), 'update',
                           'blue-moon-of-kentucky', actor='Tim', verbose=False)

        assert result.part_file == newer
        work_dir = tmp_path / 'works' / 'blue-moon-of-kentucky'
        assert (work_dir / 'lead-sheet.pro').read_text() == PRIMARY
        assert '[C]my own take' in (work_dir / older).read_text()

    def test_anonymous_row_falls_back_to_the_primary(self, tmp_path):
        seed_forked_work(tmp_path)

        result = apply_row(tmp_path, row(content='[G]no identity\n',
                                         created_by=None),
                           'update', 'blue-moon-of-kentucky', verbose=False)

        assert result.part_file == 'lead-sheet.pro'


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


# ============================================
# Dedup backstop (phase 3b)
# ============================================


@pytest.fixture
def dedup_fixtures(fixtures_path):
    return fixtures_path / 'dedup'


def seed_chart(tmp_path, work_id, title, content, *, submitted_by=OTHER_USER):
    """An existing work carrying an arbitrary chart, for the scorer to find."""
    works_writer.create_work(
        tmp_path, work_id, title,
        works_writer.PartSpec(
            file='lead-sheet.pro', type='lead-sheet', format='chordpro',
            default=True, content=content,
            provenance={'source': 'user-submission',
                        'source_id': f'pending:seed-{work_id}:0',
                        'submitted_by': submitted_by},
        ),
        on_collision='fail', verbose=False)


def hlb_row(content, **kw):
    """A submission of How Long Blues under a fresh slug."""
    base = dict(id='how-long-blues-1', title='How Long Blues',
                artist='Del McCoury', composer='Leroy Carr', content=content,
                key='E')
    base.update(kw)
    return row(**base)


class TestBackstopRedirectsAnEnrichment:
    """The #208 case: a richer chart must land ON the sparse work, not beside it."""

    def test_unowned_enrichment_forks_onto_the_matched_work(
            self, tmp_path, dedup_fixtures):
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues',
                   (dedup_fixtures / 'how-long-blues.pro').read_text(),
                   submitted_by=OTHER_USER)
        incoming = (dedup_fixtures / 'how-long-blues-1.pro').read_text()

        result = apply_row(tmp_path, hlb_row(incoming), 'create',
                           'how-long-blues-1', actor='Tim', verbose=False)

        # No second slug — the whole point.
        assert result.written
        assert result.work_id == 'how-long-blues'
        assert not (tmp_path / 'works' / 'how-long-blues-1').exists()

        # Unowned, so it lands as an arrangement part: additive, and the
        # original lyrics-only chart is untouched.
        assert result.mode == 'fork-to-arrangement'
        work = read_work(tmp_path, 'how-long-blues')
        assert len(work['parts']) == 2
        original, added = work['parts']
        assert original['file'] == 'lead-sheet.pro'
        assert original['default'] is True
        assert added.get('default') is not True
        assert added['provenance']['submitted_by'] == SUBMITTER

    def test_owned_enrichment_updates_in_place(self, tmp_path, dedup_fixtures):
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues',
                   (dedup_fixtures / 'how-long-blues.pro').read_text(),
                   submitted_by=SUBMITTER)
        incoming = (dedup_fixtures / 'how-long-blues-1.pro').read_text()

        result = apply_row(tmp_path, hlb_row(incoming), 'create',
                           'how-long-blues-1', actor='Tim', verbose=False)

        assert result.written
        assert result.work_id == 'how-long-blues'
        work = read_work(tmp_path, 'how-long-blues')
        assert len(work['parts']) == 1
        assert (tmp_path / 'works' / 'how-long-blues' /
                'lead-sheet.pro').read_text() == incoming

    def test_the_decision_says_what_it_did_and_why(self, tmp_path, dedup_fixtures):
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues',
                   (dedup_fixtures / 'how-long-blues.pro').read_text())
        incoming = (dedup_fixtures / 'how-long-blues-1.pro').read_text()

        backstop = DedupBackstop(tmp_path)
        apply_row(tmp_path, hlb_row(incoming), 'create', 'how-long-blues-1',
                  verbose=False, backstop=backstop)

        decision = backstop.decision
        assert decision.action == 'redirect'
        assert decision.mode == 'fork'
        assert decision.work_id == 'how-long-blues'
        assert decision.verdict.outcome == 'enrich'
        assert decision.verdict.auto_actionable
        assert 'how-long-blues' in decision.reason
        assert decision.outputs()['dedup_matched_work'] == 'how-long-blues'

    def test_a_redispatch_of_a_redirected_row_is_a_no_op(
            self, tmp_path, dedup_fixtures):
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues',
                   (dedup_fixtures / 'how-long-blues.pro').read_text())
        incoming = (dedup_fixtures / 'how-long-blues-1.pro').read_text()

        first = apply_row(tmp_path, hlb_row(incoming), 'create',
                          'how-long-blues-1', verbose=False)
        second = apply_row(tmp_path, hlb_row(incoming), 'create',
                           'how-long-blues-1', verbose=False)

        assert first.written
        assert not second.written
        assert second.skipped_reason == 'already-applied'
        assert len(read_work(tmp_path, 'how-long-blues')['parts']) == 2


class TestBackstopHoldsADuplicate:
    def test_a_near_identical_resubmission_is_not_written(
            self, tmp_path, dedup_fixtures):
        chart = (dedup_fixtures / 'how-long-blues-1.pro').read_text()
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues', chart)

        backstop = DedupBackstop(tmp_path)
        result = apply_row(tmp_path, hlb_row(chart), 'create',
                           'how-long-blues-1', verbose=False, backstop=backstop)

        assert not result.written
        assert result.skipped_reason == DEDUP_HOLD_REASON
        # Nothing minted, and nothing added to the work it matched.
        assert not (tmp_path / 'works' / 'how-long-blues-1').exists()
        assert len(read_work(tmp_path, 'how-long-blues')['parts']) == 1

        decision = backstop.decision
        assert decision.action == 'hold'
        assert decision.verdict.outcome == 'duplicate'
        assert decision.verdict.score >= 0.85
        outputs = decision.outputs()
        assert outputs['dedup_action'] == 'hold'
        assert outputs['dedup_matched_work'] == 'how-long-blues'


class TestBackstopStaysOutOfTheWay:
    def test_a_sparser_resubmission_is_advisory_only(
            self, tmp_path, dedup_fixtures):
        """Same song, but the corpus copy is the richer one.

        `duplicate` by outcome, yet the word sets are materially different
        sizes (ratio 0.80 is the line), so the backstop reports and steps
        aside rather than refusing a chart that might be a better lyric.
        """
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues',
                   (dedup_fixtures / 'how-long-blues-1.pro').read_text())
        sparse = (dedup_fixtures / 'how-long-blues.pro').read_text()

        backstop = DedupBackstop(tmp_path)
        result = apply_row(tmp_path, hlb_row(sparse), 'create',
                           'how-long-blues-1', verbose=False, backstop=backstop)

        assert result.written
        assert result.work_id == 'how-long-blues-1'
        assert backstop.decision.action == 'proceed'
        assert backstop.decision.verdict.outcome == 'duplicate'
        assert 'advisory' in backstop.decision.reason

    def test_an_instrumental_is_never_diverted(self, tmp_path, dedup_fixtures):
        """No lyrics on either side: identical titles, different tunes.

        The scorer marks this low-confidence and never auto-actionable, so the
        backstop must create as dispatched — diverting on a title collision is
        exactly the "Blackberry Blossom" failure the plan warns about.
        """
        seed_chart(tmp_path, 'blackberry-blossom', 'Blackberry Blossom',
                   (dedup_fixtures / 'blackberry-blossom-abc.pro').read_text())
        incoming = (dedup_fixtures / 'blackberry-blossom-chords.pro').read_text()

        backstop = DedupBackstop(tmp_path)
        result = apply_row(
            tmp_path,
            row(id='blackberry-blossom-1', title='Blackberry Blossom',
                artist=None, composer=None, content=incoming),
            'create', 'blackberry-blossom-1', verbose=False, backstop=backstop)

        assert result.written
        assert result.work_id == 'blackberry-blossom-1'
        assert backstop.decision.action == 'proceed'
        assert backstop.decision.verdict.low_confidence
        assert not backstop.decision.verdict.auto_actionable

    def test_a_different_song_with_a_similar_title_is_untouched(
            self, tmp_path, dedup_fixtures):
        seed_chart(tmp_path, 'i-walk-the-line', 'I Walk The Line',
                   (dedup_fixtures / 'i-walk-the-line.pro').read_text())
        incoming = (dedup_fixtures / 'i-walk-alone.pro').read_text()

        backstop = DedupBackstop(tmp_path)
        result = apply_row(
            tmp_path,
            row(id='i-walk-alone', title='I Walk Alone', artist=None,
                composer=None, content=incoming),
            'create', 'i-walk-alone', verbose=False, backstop=backstop)

        assert result.written
        assert result.work_id == 'i-walk-alone'
        assert backstop.decision.action == 'proceed'
        assert backstop.decision.verdict is None  # no-match: nothing to report

    def test_update_and_fork_skip_the_check_entirely(self, tmp_path, dedup_fixtures):
        """The target is already chosen; there is nothing left to guess."""
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues',
                   (dedup_fixtures / 'how-long-blues.pro').read_text())
        incoming = (dedup_fixtures / 'how-long-blues-1.pro').read_text()

        backstop = DedupBackstop(tmp_path)
        result = apply_row(tmp_path, hlb_row(incoming, id='how-long-blues'),
                           'fork', 'how-long-blues', actor='Tim',
                           verbose=False, backstop=backstop)

        assert result.written
        assert backstop.decision.action == 'proceed'
        assert backstop.decision.verdict is None
        assert 'target already chosen' in backstop.decision.reason


class TestOwnership:
    def test_reads_submitted_by_out_of_every_part(self, tmp_path):
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=OTHER_USER)

        assert owns_content(tmp_path, 'blue-moon-of-kentucky', OTHER_USER)
        assert not owns_content(tmp_path, 'blue-moon-of-kentucky', SUBMITTER)
        assert not owns_content(tmp_path, 'blue-moon-of-kentucky', None)
        assert not owns_content(tmp_path, 'no-such-work', OTHER_USER)


# ============================================
# Tablature
# ============================================
#
# Tabs joined this pipeline on 2026-08-18, replacing the create-tab-pr /
# process-tab-pr.yml pull-request flow. The shapes that used to be
# process_tab.py's job — a tab that mints its own work, a tab added to a
# song that already exists, a same-instrument sibling, a correction to a
# published take — all arrive here now, decided server-side and carried in
# a pending_songs row.


def otf_doc(track_id='banjo', fret=0, **extra):
    doc = {
        'otf_version': '1.0',
        'metadata': {'title': 'Salt Creek'},
        'timing': {'ticks_per_beat': 480},
        'tracks': [{
            'id': track_id,
            'instrument': '5-string-banjo',
            'tuning': ['D4', 'B3', 'G3', 'D3', 'G4'],
        }],
        'notation': {track_id: [
            {'measure': 1,
             'events': [{'tick': 0, 'notes': [{'s': 1, 'f': fret}]}]},
        ]},
    }
    doc.update(extra)
    return doc


def tab_row(**kw):
    base = {
        'id': 'salt-creek',
        'replaces_id': None,
        'title': 'Salt Creek',
        'artist': 'Bill Monroe',
        'part_type': 'tablature',
        'instrument': 'banjo',
        'part_file': None,
        'content': json.dumps(otf_doc()),
        'created_by': SUBMITTER,
        'created_at': '2026-08-18T12:00:00+00:00',
    }
    base.update(kw)
    return base


def seed_tab_work(tmp_path, work_id='salt-creek', *, file='banjo.otf.json',
                  source='banjo-hangout', source_id='11059',
                  submitted_by=None, author='schlange', content=None):
    """A work whose only part is a published banjo tab."""
    provenance = {'source': source, 'source_id': source_id, 'author': author}
    if submitted_by:
        provenance['submitted_by'] = submitted_by
    works_writer.create_work(
        tmp_path, work_id, 'Salt Creek',
        works_writer.PartSpec(
            file=file, type='tablature', format='otf', instrument='banjo',
            default=True, content=content or json.dumps(otf_doc()),
            provenance=provenance),
        on_collision='fail', verbose=False)


class TestTablatureCreate:
    def test_a_tab_mints_its_own_work(self, tmp_path):
        result = apply_row(tmp_path, tab_row(), 'create', 'salt-creek',
                           actor='Jane Picker', verbose=False)

        assert result.written
        assert result.part_file == 'banjo.otf.json'
        work = read_work(tmp_path, 'salt-creek')
        assert work['title'] == 'Salt Creek'
        assert work['artist'] == 'Bill Monroe'
        assert work['tags'] == ['Instrumental']

        part = work['parts'][0]
        assert part['type'] == 'tablature'
        assert part['format'] == 'otf'
        assert part['instrument'] == 'banjo'
        assert part['default'] is True
        assert part['provenance']['source'] == 'user-submission'
        assert part['provenance']['submitted_by'] == SUBMITTER
        assert part['provenance']['author'] == 'Jane Picker'

    def test_the_otf_lands_as_readable_json(self, tmp_path):
        apply_row(tmp_path, tab_row(), 'create', 'salt-creek', verbose=False)

        text = (tmp_path / 'works/salt-creek/banjo.otf.json').read_text()
        assert text.endswith('\n')
        assert '\n  "tracks"' in text          # indent=2, like the corpus
        assert json.loads(text)['tracks'][0]['id'] == 'banjo'

    def test_x_source_is_dropped_so_the_build_gate_cannot_trip(self, tmp_path):
        """An edited Hangout tab still claims to be that TEF conversion.

        build_works_index fails the whole build when the OTF's x_source id
        disagrees with the part's provenance.source_id — which is the
        pending marker here — so the stale claim has to go, and the
        identity it carried is kept in provenance instead.
        """
        row_ = tab_row(content=json.dumps(
            otf_doc(x_source={'source': 'banjo-hangout', 'source_id': '11059'})))

        apply_row(tmp_path, row_, 'create', 'salt-creek', verbose=False)

        doc = json.loads((tmp_path / 'works/salt-creek/banjo.otf.json').read_text())
        assert 'x_source' not in doc


class TestTablatureAdd:
    def test_a_tab_for_a_song_that_has_none(self, tmp_path):
        """The bounty case: a chart is published, a tab arrives."""
        seed_work(tmp_path, 'salt-creek', submitted_by=OTHER_USER)

        result = apply_row(tmp_path, tab_row(), 'add', 'salt-creek',
                           actor='Jane Picker', verbose=False)

        assert result.written
        assert result.part_file == 'banjo.otf.json'
        work = read_work(tmp_path, 'salt-creek')
        types = [p['type'] for p in work['parts']]
        assert types == ['lead-sheet', 'tablature']
        # The published chart keeps its default flag; a tab is not a chart.
        assert work['parts'][0]['default'] is True
        assert work['parts'][1].get('default') is not True

    def test_a_second_take_becomes_a_sibling_not_an_overwrite(self, tmp_path):
        seed_tab_work(tmp_path)
        before = (tmp_path / 'works/salt-creek/banjo.otf.json').read_text()

        result = apply_row(tmp_path, tab_row(content=json.dumps(otf_doc(fret=5))),
                           'add', 'salt-creek', actor='Jane Picker',
                           verbose=False)

        assert result.part_file == 'banjo-2.otf.json'
        work = read_work(tmp_path, 'salt-creek')
        assert [p['file'] for p in work['parts']] == [
            'banjo.otf.json', 'banjo-2.otf.json']

        original, sibling = work['parts']
        assert original['default'] is True
        assert original['provenance']['source'] == 'banjo-hangout'
        assert original['provenance']['author'] == 'schlange'
        assert (tmp_path / 'works/salt-creek/banjo.otf.json').read_text() == before

        # The suffix is a filename detail, never the instrument
        assert sibling['instrument'] == 'banjo'
        assert sibling.get('default') is not True
        assert sibling['provenance']['submitted_by'] == SUBMITTER

    def test_a_non_owners_correction_lands_beside_the_original(self, tmp_path):
        """The 'hard to destroy' rule in the tab column.

        The user meant to fix somebody else's take, so the row names its
        file — but they do not own it and are not trusted, so the edge
        function classified this `add`. It must not touch what it names.
        """
        seed_tab_work(tmp_path)
        before = (tmp_path / 'works/salt-creek/banjo.otf.json').read_text()

        apply_row(tmp_path,
                  tab_row(part_file='banjo.otf.json',
                          content=json.dumps(otf_doc(fret=7))),
                  'add', 'salt-creek', actor='Jane Picker', verbose=False)

        work = read_work(tmp_path, 'salt-creek')
        assert len(work['parts']) == 2
        assert (tmp_path / 'works/salt-creek/banjo.otf.json').read_text() == before
        assert 'x_corrected_by' not in work['parts'][0]['provenance']

    def test_adding_to_a_work_that_is_not_there_is_a_typed_refusal(self, tmp_path):
        with pytest.raises(ProcessPendingError):
            apply_row(tmp_path, tab_row(), 'add', 'salt-creek', verbose=False)


class TestTablatureUpdate:
    def test_rewrites_the_named_part_in_place(self, tmp_path):
        seed_tab_work(tmp_path, submitted_by=SUBMITTER, author='Jane Picker')

        result = apply_row(
            tmp_path,
            tab_row(part_file='banjo.otf.json',
                    content=json.dumps(otf_doc(fret=5))),
            'update', 'salt-creek', actor='Jane Picker', verbose=False)

        assert result.written
        work = read_work(tmp_path, 'salt-creek')
        assert len(work['parts']) == 1            # no sibling minted
        doc = json.loads((tmp_path / 'works/salt-creek/banjo.otf.json').read_text())
        assert doc['notation']['banjo'][0]['events'][0]['notes'][0]['f'] == 5

    def test_a_correction_records_who_fixed_it_without_taking_the_credit(
            self, tmp_path):
        seed_tab_work(tmp_path)   # arranged by 'schlange', from the Hangout

        apply_row(tmp_path,
                  tab_row(part_file='banjo.otf.json',
                          content=json.dumps(otf_doc(fret=5))),
                  'update', 'salt-creek', actor='Trusted Tim', verbose=False)

        prov = read_work(tmp_path, 'salt-creek')['parts'][0]['provenance']
        assert prov['author'] == 'schlange'       # the arranger, untouched
        assert prov['x_corrected_by'] == SUBMITTER
        assert prov['x_corrected_attribution'] == 'Trusted Tim'
        # The take started life as a Hangout conversion; source_id had to
        # become the idempotence marker, so the lineage is kept beside it.
        assert prov['x_derived_from'] == 'banjo-hangout:11059'
        assert prov['source'] == 'user-submission'
        assert prov['source_id'].startswith('pending:salt-creek:')

    def test_a_vanished_target_falls_back_to_add(self, tmp_path):
        """main moved under the dispatch: the named part is gone.

        Guessing at a substitute target would let update_part pick the
        default take and overwrite a stranger's arrangement, so the write
        lands beside what is actually there instead.
        """
        seed_tab_work(tmp_path, file='banjo-11059.otf.json')

        result = apply_row(
            tmp_path,
            tab_row(part_file='banjo-gone.otf.json',
                    content=json.dumps(otf_doc(fret=5))),
            'update', 'salt-creek', actor='Jane Picker', verbose=False)

        work = read_work(tmp_path, 'salt-creek')
        assert len(work['parts']) == 2
        assert result.part_file == 'banjo.otf.json'
        assert work['parts'][0]['provenance']['author'] == 'schlange'


class TestTablatureValidation:
    """The OTF gets its structural check here or nowhere.

    These cases came over from the retired tests/parser/test_process_tab.py
    along with validate_otf itself.
    """

    def test_a_good_document_has_no_problems(self):
        assert validate_otf(otf_doc()) == []

    def test_no_tracks(self):
        assert validate_otf({'tracks': []})
        assert validate_otf('not an object') == ['not an object']

    def test_a_string_off_the_neck(self):
        doc = otf_doc()
        doc['notation']['banjo'][0]['events'][0]['notes'][0]['s'] = 9
        assert any('bad string' in p for p in validate_otf(doc))

    def test_a_fret_past_the_end(self):
        doc = otf_doc()
        doc['notation']['banjo'][0]['events'][0]['notes'][0]['f'] = 99
        assert any('bad fret' in p for p in validate_otf(doc))

    def test_an_invalid_otf_is_refused_before_anything_is_written(self, tmp_path):
        doc = otf_doc()
        doc['notation']['banjo'][0]['events'][0]['notes'][0]['f'] = 99

        with pytest.raises(ProcessPendingError, match='OTF validation'):
            apply_row(tmp_path, tab_row(content=json.dumps(doc)), 'create',
                      'salt-creek', verbose=False)
        assert not (tmp_path / 'works' / 'salt-creek').exists()

    def test_content_that_is_not_json_at_all(self, tmp_path):
        with pytest.raises(ProcessPendingError, match='not valid JSON'):
            apply_row(tmp_path, tab_row(content='{meta: title Salt Creek}'),
                      'create', 'salt-creek', verbose=False)

    def test_a_tab_with_no_instrument_is_refused(self, tmp_path):
        with pytest.raises(ProcessPendingError, match='instrument'):
            apply_row(tmp_path, tab_row(instrument=None), 'create',
                      'salt-creek', verbose=False)

    def test_an_instrument_that_is_not_a_slug_is_refused(self, tmp_path):
        """It becomes a filename inside works/."""
        with pytest.raises(ProcessPendingError, match='instrument'):
            apply_row(tmp_path, tab_row(instrument='../../etc/passwd'),
                      'create', 'salt-creek', verbose=False)

    def test_a_mode_from_the_chart_column_is_refused(self, tmp_path):
        seed_tab_work(tmp_path)
        with pytest.raises(ProcessPendingError, match='tablature mode'):
            apply_row(tmp_path, tab_row(), 'fork', 'salt-creek', verbose=False)


class TestTablatureReplay:
    def test_a_second_dispatch_of_the_same_row_is_a_no_op(self, tmp_path):
        apply_row(tmp_path, tab_row(), 'create', 'salt-creek', verbose=False)

        result = apply_row(tmp_path, tab_row(), 'add', 'salt-creek',
                           verbose=False)

        assert not result.written
        assert result.skipped_reason == 'already-applied'
        assert len(read_work(tmp_path, 'salt-creek')['parts']) == 1

    def test_a_reserialized_but_identical_tab_is_still_a_replay(self, tmp_path):
        """The marker is a sha of the CANONICAL text, not of what arrived.

        An OTF is machine-serialized; its whitespace is nobody's intent, so
        a client that re-saves an unchanged tab must not mint a sibling.
        """
        apply_row(tmp_path, tab_row(), 'create', 'salt-creek', verbose=False)

        result = apply_row(
            tmp_path,
            tab_row(content=json.dumps(otf_doc(), indent=4)),
            'add', 'salt-creek', verbose=False)

        assert result.skipped_reason == 'already-applied'

    def test_a_genuine_second_edit_is_not_a_replay(self, tmp_path):
        apply_row(tmp_path, tab_row(), 'create', 'salt-creek', verbose=False)

        result = apply_row(tmp_path,
                           tab_row(part_file='banjo.otf.json',
                                   content=json.dumps(otf_doc(fret=5))),
                           'update', 'salt-creek', verbose=False)

        assert result.written
        doc = json.loads((tmp_path / 'works/salt-creek/banjo.otf.json').read_text())
        assert doc['notation']['banjo'][0]['events'][0]['notes'][0]['f'] == 5

    def test_the_marker_is_canonical_and_content_scoped(self):
        same = otf_document(tab_row())[1]
        reformatted = otf_document(tab_row(content=json.dumps(otf_doc(), indent=4)))[1]
        changed = otf_document(tab_row(content=json.dumps(otf_doc(fret=5))))[1]

        assert content_marker('salt-creek', same) == \
            content_marker('salt-creek', reformatted)
        assert content_marker('salt-creek', same) != \
            content_marker('salt-creek', changed)
        assert content_marker('salt-creek', same) != \
            content_marker('other-row', same)


class TestTablatureSkipsTheDedupBackstop:
    def test_the_backstop_is_never_consulted_for_a_tab(self, tmp_path):
        """Not "it happened to say proceed" — it is not asked at all.

        The scorer measures lyric containment. An OTF has no lyrics, so the
        only thing running it could do is spend 1.6s building a title index
        and then risk diverting a write on a title collision.
        """
        seed_chart(tmp_path, 'salt-creek', 'Salt Creek', CHORDPRO)
        backstop = DedupBackstop(tmp_path)

        result = apply_row(tmp_path, tab_row(), 'add', 'salt-creek',
                           verbose=False, backstop=backstop)

        assert result.written
        assert backstop.decision is None

    def test_a_tab_for_a_title_already_in_the_corpus_still_lands(self, tmp_path):
        """A create-mode tab is exactly what the backstop would have eaten."""
        seed_chart(tmp_path, 'salt-creek-chart', 'Salt Creek', CHORDPRO)

        result = apply_row(tmp_path, tab_row(), 'create', 'salt-creek',
                           verbose=False)

        assert result.written
        assert result.work_id == 'salt-creek'


# ============================================
# Cross-type ownership
# ============================================


class TestTabOwnershipDoesNotBuyChartEdits:
    """Owning a tab must not confer edit rights over a stranger's chart.

    Before tabs joined this pipeline, ``submitted_by`` appeared on
    lead-sheet parts alone, so "owns a part of this work" and "owns a chart
    of this work" were the same sentence and both classifiers asked the
    loose version. Tab rows carry ``submitted_by`` now — the idempotence
    marker and the owner id are written together — and the loose question
    would have answered:

      1. Alice submits a banjo tab to works/foo.
      2. Alice edits foo's LEAD SHEET, which belongs to someone else, and
         she is not trusted.
      3. Ownership says "she has a part here" -> update, not fork.
      4. update_target finds she owns no CHART -> None -> "she must be
         trusted" -> the match falls back to the work's primary chart.
      5. Editing the primary carries work_updates, so her title/artist/key
         overwrite the work's as well.

    Net: contributing a tab bought an in-place overwrite of somebody else's
    lyrics. Both classifiers now count only parts of the kind being edited.
    """

    def test_owns_content_is_scoped_to_the_part_type(self, tmp_path):
        seed_work(tmp_path, 'salt-creek', submitted_by=OTHER_USER)
        apply_row(tmp_path, tab_row(), 'add', 'salt-creek',
                  actor='Alice', verbose=False)

        # Alice owns the tab...
        assert owns_content(tmp_path, 'salt-creek', SUBMITTER, 'tablature')
        # ...and nothing else.
        assert not owns_content(tmp_path, 'salt-creek', SUBMITTER, 'lead-sheet')
        assert owns_content(tmp_path, 'salt-creek', OTHER_USER, 'lead-sheet')
        # The default is the chart question, which is what every existing
        # caller was asking.
        assert not owns_content(tmp_path, 'salt-creek', SUBMITTER)

    def test_a_tab_contributors_chart_edit_still_forks(
            self, tmp_path, dedup_fixtures):
        """The full sequence, through the Python classifier.

        The dedup backstop's redirect is the one place in this process that
        decides update-vs-fork on its own, so it is where the escalation is
        reachable end to end: Alice owns a tab on the matched work and
        nothing else, and her chart must still land as an arrangement with
        the original untouched.
        """
        seed_chart(tmp_path, 'how-long-blues', 'How Long Blues',
                   (dedup_fixtures / 'how-long-blues.pro').read_text(),
                   submitted_by=OTHER_USER)
        works_writer.update_part(
            tmp_path, 'how-long-blues', match={'type': 'lead-sheet'},
            work_updates={'artist': 'Leroy Carr', 'default_key': 'C'},
            verbose=False)
        apply_row(tmp_path,
                  tab_row(id='hlb-tab', title='How Long Blues',
                          replaces_id='how-long-blues'),
                  'add', 'how-long-blues', actor='Alice', verbose=False)
        original = (tmp_path / 'works/how-long-blues/lead-sheet.pro').read_text()

        backstop = DedupBackstop(tmp_path)
        result = apply_row(
            tmp_path,
            hlb_row((dedup_fixtures / 'how-long-blues-1.pro').read_text(),
                    artist='Somebody Else', key='G'),
            'create', 'how-long-blues-1', actor='Alice',
            verbose=False, backstop=backstop)

        assert backstop.decision.action == 'redirect'
        assert backstop.decision.mode == 'fork'
        assert result.mode == 'fork-to-arrangement'

        # Nothing of somebody else's moved.
        work = read_work(tmp_path, 'how-long-blues')
        assert work['artist'] == 'Leroy Carr'
        assert work['default_key'] == 'C'
        assert work['title'] == 'How Long Blues'
        assert (tmp_path / 'works/how-long-blues/lead-sheet.pro').read_text() \
            == original
        charts = [p for p in work['parts'] if p['type'] == 'lead-sheet']
        assert charts[0]['file'] == 'lead-sheet.pro'
        assert charts[0]['default'] is True
        assert charts[0]['provenance']['submitted_by'] == OTHER_USER
