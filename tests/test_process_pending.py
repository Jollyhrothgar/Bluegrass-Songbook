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
    PERMANENT_SKIP_REASONS,
    PLACEHOLDER_STATUS,
    WORK_EXISTS_SKIP_REASON,
    DedupBackstop,
    ProcessPendingError,
    already_applied,
    apply_row,
    content_marker,
    hold_reason,
    is_placeholder_row,
    otf_document,
    owns_content,
    tab_work_slug,
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
    # A tab row's id is synthetic — `tab:<slug>:<rand>` — because
    # pending_songs is keyed one row per SONG and a tab is a PART. Two
    # people tabbing the same tune must not collide on the primary key.
    base = {
        'id': 'tab:salt-creek:ab12cd',
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
        assert prov['source_id'].startswith('pending:tab:salt-creek:ab12cd:')

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

        row_id = 'tab:salt-creek:ab12cd'
        assert content_marker(row_id, same) == \
            content_marker(row_id, reformatted)
        assert content_marker(row_id, same) != \
            content_marker(row_id, changed)
        # Two people, two rows, same tab: two markers, so both land.
        assert content_marker(row_id, same) != \
            content_marker('tab:salt-creek:zz99xx', same)


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


class TestTabRowIdsAreNotWorkSlugs:
    """`pending_songs.id` is a PK, and for a chart it IS the work slug.

    That shape does not survive contact with parts. Keying a tab row by the
    work id means two people tabbing the same song collide on the primary
    key — and because the update policy gates on `created_by = auth.uid()`,
    the second one fails as a *permissions* error that says nothing about
    what went wrong. A pending chart and a pending tab for one song could
    not coexist either. So tab rows are `tab:<slug>:<rand>`, and the work
    they target comes from `replaces_id` or from the title.
    """

    def test_the_slug_comes_from_the_title_not_the_row_id(self, tmp_path):
        """The dispatch fell back to the row id; the write must not."""
        result = apply_row(tmp_path, tab_row(), 'create',
                           'tab:salt-creek:ab12cd', actor='Jane Picker',
                           verbose=False)

        assert result.work_id == 'salt-creek'
        assert (tmp_path / 'works/salt-creek/banjo.otf.json').exists()
        assert not (tmp_path / 'works/tab:salt-creek:ab12cd').exists()

    def test_a_valid_dispatched_slug_is_left_alone(self, tmp_path):
        result = apply_row(tmp_path, tab_row(title='Salt Creek'), 'create',
                           'salt-creek-2', verbose=False)

        assert result.work_id == 'salt-creek-2'

    def test_a_title_that_slugifies_to_nothing_is_a_typed_refusal(self, tmp_path):
        with pytest.raises(ProcessPendingError, match='not a slug'):
            apply_row(tmp_path, tab_row(title='!!!'), 'create',
                      'tab::ab12cd', verbose=False)

    def test_tab_work_slug_rules(self):
        assert tab_work_slug('salt-creek', 'Salt Creek') == 'salt-creek'
        assert tab_work_slug('tab:salt-creek:ab12cd', 'Salt Creek') == 'salt-creek'
        assert tab_work_slug('', "Foggy Mountain Breakdown") == \
            'foggy-mountain-breakdown'
        # An id that is merely ugly, not a slug, still loses to the title
        assert tab_work_slug('Salt Creek', 'Salt Creek') == 'salt-creek'

    def test_a_colliding_slug_suffixes_rather_than_adopting(self, tmp_path):
        """create_work resolves the real slug against the checkout.

        This is the free-slug hunt create-tab-pr did by probing the Contents
        API from a branch that could not see other branches.
        """
        seed_work(tmp_path, 'salt-creek', submitted_by=OTHER_USER)

        result = apply_row(tmp_path, tab_row(), 'create', 'salt-creek',
                           verbose=False)

        assert result.work_id == 'salt-creek-1'
        # The existing work is untouched — still one chart, no tab
        work = read_work(tmp_path, 'salt-creek')
        assert [p['type'] for p in work['parts']] == ['lead-sheet']

    def test_two_users_tabbing_one_song_both_land(self, tmp_path):
        """The case the shared PK made impossible."""
        seed_work(tmp_path, 'salt-creek', submitted_by=OTHER_USER)

        first = apply_row(
            tmp_path,
            tab_row(id='tab:salt-creek:aaa111', created_by=SUBMITTER),
            'add', 'salt-creek', actor='Alice', verbose=False)
        second = apply_row(
            tmp_path,
            tab_row(id='tab:salt-creek:bbb222', created_by=OTHER_USER,
                    content=json.dumps(otf_doc(fret=5))),
            'add', 'salt-creek', actor='Bob', verbose=False)

        assert first.part_file == 'banjo.otf.json'
        assert second.part_file == 'banjo-2.otf.json'
        work = read_work(tmp_path, 'salt-creek')
        tabs = [p for p in work['parts'] if p['type'] == 'tablature']
        assert [p['provenance']['submitted_by'] for p in tabs] == \
            [SUBMITTER, OTHER_USER]
        assert [p['provenance']['author'] for p in tabs] == ['Alice', 'Bob']

    def test_identical_tabs_from_two_users_are_not_a_replay(self, tmp_path):
        """The marker is row-scoped, and the rows are now distinct.

        Under the old shape these two would have been one row; the second
        submission would have looked like a replay of the first.
        """
        seed_work(tmp_path, 'salt-creek', submitted_by=OTHER_USER)

        apply_row(tmp_path, tab_row(id='tab:salt-creek:aaa111'), 'add',
                  'salt-creek', verbose=False)
        result = apply_row(tmp_path, tab_row(id='tab:salt-creek:bbb222'),
                           'add', 'salt-creek', verbose=False)

        assert result.written
        assert result.part_file == 'banjo-2.otf.json'


class TestTabNotes:
    """The submitter's comment has to survive the move off the PR flow.

    create-tab-pr put it in the PR body and `process_tab` wrote it nowhere,
    because a human read the PR. There is no PR now, so it lands on the
    part — never in the work-level `notes`, which describes the SONG and
    not one take of it.
    """

    def test_a_new_tab_records_the_note_on_its_part(self, tmp_path):
        apply_row(tmp_path, tab_row(notes='Scruggs style, capo 2'), 'create',
                  'salt-creek', actor='Jane Picker', verbose=False)

        work = read_work(tmp_path, 'salt-creek')
        assert work['parts'][0]['provenance']['x_submission_notes'] == \
            'Scruggs style, capo 2'
        assert 'notes' not in work

    def test_a_sibling_records_it_too(self, tmp_path):
        seed_tab_work(tmp_path)

        apply_row(tmp_path,
                  tab_row(part_file='banjo.otf.json', notes='Cleaner rolls',
                          content=json.dumps(otf_doc(fret=5))),
                  'add', 'salt-creek', actor='Jane Picker', verbose=False)

        work = read_work(tmp_path, 'salt-creek')
        assert work['parts'][1]['provenance']['x_submission_notes'] == \
            'Cleaner rolls'
        # The take it was aimed at learned nothing about it
        assert 'x_submission_notes' not in work['parts'][0]['provenance']

    def test_a_correction_names_it_for_what_it_is(self, tmp_path):
        seed_tab_work(tmp_path, submitted_by=SUBMITTER, author='Jane Picker')

        apply_row(tmp_path,
                  tab_row(part_file='banjo.otf.json',
                          notes='Fixed the fret in bar 12',
                          content=json.dumps(otf_doc(fret=5))),
                  'update', 'salt-creek', actor='Jane Picker', verbose=False)

        prov = read_work(tmp_path, 'salt-creek')['parts'][0]['provenance']
        assert prov['x_correction_notes'] == 'Fixed the fret in bar 12'
        assert 'x_submission_notes' not in prov

    def test_no_note_writes_no_key(self, tmp_path):
        apply_row(tmp_path, tab_row(notes='   '), 'create', 'salt-creek',
                  verbose=False)

        prov = read_work(tmp_path, 'salt-creek')['parts'][0]['provenance']
        assert 'x_submission_notes' not in prov


# ============================================
# Metadata
# ============================================
#
# The third column (2026-08-18). A work minted by a TAB had a title and
# nothing else — no artist, no key — and no path to a fix, because every row
# shape this pipeline understood edited a PART and the work-level fields only
# ever rode along with a rewrite of the primary chart. A tab-only work has no
# chart to rewrite.
#
# What is worth guarding here, and what a regression would cost:
#
#   - the write is work-level ONLY. A metadata row that moved, renamed or
#     rewrote a part would be destroying content its sender was never
#     authorized to touch (the ownership question that let them in is
#     deliberately looser than the one a content edit has to pass).
#   - a field the row does not carry must not be blanked. The editor sends
#     what changed; treating "absent" as "clear it" turns a one-field fix
#     into an erasure of somebody else's work.
#   - a replay is a no-op and a genuine re-edit applies, off a marker that
#     cannot hash `content` because there isn't any.


def meta_row(**kw):
    # A metadata row's id is `meta:<slug>:<rand>` — its own namespace, for
    # the same reason tab rows got one: two people fixing one song's details
    # must not collide on the pending_songs primary key.
    base = {
        'id': 'meta:salt-creek:ab12cd',
        'replaces_id': 'salt-creek',
        'part_type': 'metadata',
        'content': None,
        'title': 'Salt Creek',
        'artist': 'Bill Monroe',
        'key': 'A',
        'notes': None,
        'created_by': SUBMITTER,
        'created_at': '2026-08-18T12:00:00+00:00',
    }
    base.update(kw)
    return base


def parts_snapshot(tmp_path, work_id):
    """The work's parts plus the bytes of every file in its directory.

    Compared before and after a metadata write: "no part is created,
    replaced, renamed or reordered, and no part file is written" is one
    assertion this way, and it catches a reordering that a per-field check
    would miss.
    """
    work_dir = tmp_path / 'works' / work_id
    return (
        json.dumps(read_work(tmp_path, work_id).get('parts'), sort_keys=True),
        {p.name: p.read_bytes() for p in sorted(work_dir.iterdir())
         if p.name != 'work.yaml'},
    )


class TestMetadataWrite:
    def test_the_stranded_tab_work_gets_its_details(self, tmp_path):
        """The case the column exists for: title only, nothing else."""
        seed_tab_work(tmp_path)
        before = parts_snapshot(tmp_path, 'salt-creek')

        result = apply_row(tmp_path, meta_row(title='Salt Creek',
                                              artist='Bill Monroe', key='A',
                                              notes='Fiddle tune in A'),
                           'metadata', 'salt-creek', actor='Jane Picker',
                           verbose=False)

        assert result.written
        assert result.mode == 'update-metadata'
        assert result.part_file is None

        work = read_work(tmp_path, 'salt-creek')
        assert work['title'] == 'Salt Creek'
        assert work['artist'] == 'Bill Monroe'
        assert work['default_key'] == 'A'
        assert work['notes'] == 'Fiddle tune in A'

        # ...and not one byte of the tab moved.
        assert parts_snapshot(tmp_path, 'salt-creek') == before

    def test_it_records_who_changed_the_details(self, tmp_path):
        seed_tab_work(tmp_path)

        apply_row(tmp_path, meta_row(), 'metadata', 'salt-creek',
                  actor='Jane Picker', verbose=False)

        prov = read_work(tmp_path, 'salt-creek')['metadata_provenance']
        assert prov['source'] == 'user-submission'
        assert prov['source_id'].startswith('pending:meta:salt-creek:ab12cd:')
        assert prov['submitted_by'] == SUBMITTER
        assert prov['submitted_at'] == '2026-08-18'

    def test_it_works_on_a_work_whose_only_part_is_a_chart(self, tmp_path):
        """Nothing about this column is tab-specific — a chart-only work is
        the same write, and the chart is just as untouched."""
        seed_work(tmp_path, 'blue-moon-of-kentucky', submitted_by=OTHER_USER)
        before = parts_snapshot(tmp_path, 'blue-moon-of-kentucky')

        apply_row(tmp_path,
                  meta_row(id='meta:blue-moon-of-kentucky:ab12cd',
                           replaces_id='blue-moon-of-kentucky',
                           title='Blue Moon of Kentucky', artist='Bill Monroe',
                           key='A'),
                  'metadata', 'blue-moon-of-kentucky', verbose=False)

        assert read_work(tmp_path, 'blue-moon-of-kentucky')['artist'] == \
            'Bill Monroe'
        assert parts_snapshot(tmp_path, 'blue-moon-of-kentucky') == before


class TestMetadataPartialUpdates:
    """An absent field means "I didn't touch this", never "blank it"."""

    def test_a_field_the_row_does_not_carry_survives(self, tmp_path):
        seed_tab_work(tmp_path)
        works_writer.update_metadata(
            tmp_path, 'salt-creek',
            updates={'artist': 'Kenny Baker', 'default_key': 'A',
                     'notes': 'From the 1974 record'},
            provenance={'source': 'manual', 'source_id': 'seed'},
            verbose=False)

        apply_row(tmp_path,
                  meta_row(title='Salt Creek', artist=None, key=None,
                           notes=None),
                  'metadata', 'salt-creek', verbose=False)

        work = read_work(tmp_path, 'salt-creek')
        assert work['title'] == 'Salt Creek'
        assert work['artist'] == 'Kenny Baker'
        assert work['default_key'] == 'A'
        assert work['notes'] == 'From the 1974 record'

    def test_an_empty_string_is_not_a_clear_either(self, tmp_path):
        # A client that sends '' for an untouched input must not erase it —
        # there is no "clear this field" gesture in this pipeline, and if one
        # is ever wanted it has to be explicit rather than a side effect of a
        # blank form control.
        seed_tab_work(tmp_path)
        works_writer.update_metadata(
            tmp_path, 'salt-creek', updates={'artist': 'Kenny Baker'},
            provenance={'source': 'manual', 'source_id': 'seed'},
            verbose=False)

        apply_row(tmp_path, meta_row(artist='   ', key=''), 'metadata',
                  'salt-creek', verbose=False)

        work = read_work(tmp_path, 'salt-creek')
        assert work['artist'] == 'Kenny Baker'
        assert 'default_key' not in work

    def test_a_row_carrying_nothing_at_all_is_refused(self, tmp_path):
        seed_tab_work(tmp_path)

        with pytest.raises(ProcessPendingError, match='no fields to apply'):
            apply_row(tmp_path,
                      meta_row(title=None, artist=None, key=None, notes=None),
                      'metadata', 'salt-creek', verbose=False)


class TestMetadataReplay:
    """The marker cannot hash `content` — there is none. It hashes the fields.

    Hashing the (always null) content would give every metadata row in the
    table the same marker, so the first edit of a work would make every later
    edit of it look like a replay and silently do nothing.
    """

    def test_a_second_dispatch_of_the_same_row_is_a_no_op(self, tmp_path):
        seed_tab_work(tmp_path)

        first = apply_row(tmp_path, meta_row(), 'metadata', 'salt-creek',
                          verbose=False)
        after_first = (tmp_path / 'works/salt-creek/work.yaml').read_text()
        second = apply_row(tmp_path, meta_row(), 'metadata', 'salt-creek',
                           verbose=False)

        assert first.written
        assert not second.written
        assert second.skipped_reason == 'already-applied'
        assert (tmp_path / 'works/salt-creek/work.yaml').read_text() \
            == after_first

    def test_a_real_second_edit_is_not_treated_as_a_replay(self, tmp_path):
        seed_tab_work(tmp_path)

        apply_row(tmp_path, meta_row(artist='Bill Monroe'), 'metadata',
                  'salt-creek', verbose=False)
        edited = apply_row(tmp_path, meta_row(artist='Kenny Baker'),
                           'metadata', 'salt-creek', verbose=False)

        assert edited.written
        assert read_work(tmp_path, 'salt-creek')['artist'] == 'Kenny Baker'

    def test_two_rows_editing_one_work_do_not_shadow_each_other(self, tmp_path):
        # Different rows, identical fields: the marker is row-scoped, so the
        # second one is a genuine write rather than "already applied".
        seed_tab_work(tmp_path)

        apply_row(tmp_path, meta_row(), 'metadata', 'salt-creek',
                  verbose=False)
        other = apply_row(tmp_path, meta_row(id='meta:salt-creek:zz99xx'),
                          'metadata', 'salt-creek', verbose=False)

        assert other.written

    def test_the_marker_is_field_scoped_not_order_scoped(self, tmp_path):
        # Canonical (sorted-key) serialization: the same edit described in a
        # different column order is the same edit.
        from process_pending import metadata_marker

        assert metadata_marker('r', {'title': 'T', 'artist': 'A'}) == \
            metadata_marker('r', {'artist': 'A', 'title': 'T'})
        assert metadata_marker('r', {'artist': 'A'}) != \
            metadata_marker('r', {'artist': 'B'})
        assert metadata_marker('r', {'artist': 'A'}) != \
            metadata_marker('s', {'artist': 'A'})
        assert metadata_marker('r', {'artist': 'A'}).startswith('pending:r:')

    def test_the_marker_is_not_the_null_content_marker(self, tmp_path):
        """The bug this whole scheme exists to avoid, stated directly."""
        from process_pending import metadata_marker

        assert metadata_marker('r', {'artist': 'A'}) != content_marker('r', '')


class TestMetadataSkipsTheDedupBackstop:
    def test_the_backstop_is_never_consulted(self, tmp_path):
        """Not "it happened to say proceed" — it is not asked at all.

        The backstop guards ONE thing: a `create` minting a slug for a song
        already in the corpus. A metadata row mints nothing — it names an
        existing work in replaces_id — so there is no slug to guard. It also
        scores lyric containment over ChordPro, and this row has no content
        at all to score.
        """
        seed_chart(tmp_path, 'salt-creek', 'Salt Creek', CHORDPRO)
        backstop = DedupBackstop(tmp_path)

        result = apply_row(tmp_path, meta_row(), 'metadata', 'salt-creek',
                           verbose=False, backstop=backstop)

        assert result.written
        assert backstop.decision is None


class TestMetadataRefusals:
    def test_a_mode_from_another_column(self, tmp_path):
        seed_tab_work(tmp_path)
        for mode in ('create', 'update', 'fork', 'add'):
            with pytest.raises(ProcessPendingError,
                               match='unknown metadata mode'):
                apply_row(tmp_path, meta_row(), mode, 'salt-creek',
                          verbose=False)

    def test_the_row_id_is_never_used_as_a_work_slug(self, tmp_path):
        # `meta:salt-creek:ab12cd` is a pending_songs primary key. If a stale
        # dispatch (or a hand-fired one) puts it where the work id belongs,
        # refuse — do not mint `works/meta:salt-creek:ab12cd/`.
        seed_tab_work(tmp_path)

        with pytest.raises(ProcessPendingError, match='not a slug'):
            apply_row(tmp_path, meta_row(), 'metadata',
                      'meta:salt-creek:ab12cd', verbose=False)

        assert not (tmp_path / 'works' / 'meta:salt-creek:ab12cd').exists()

    def test_a_work_that_is_not_there(self, tmp_path):
        (tmp_path / 'works').mkdir()

        with pytest.raises(works_writer.WorkNotFoundError):
            apply_row(tmp_path, meta_row(replaces_id='nothing-here'),
                      'metadata', 'nothing-here', verbose=False)

    def test_a_suppressed_work_is_skipped_not_written(self, tmp_path):
        seed_tab_work(tmp_path)
        registry = tmp_path / 'curation' / 'registry.yaml'
        registry.parent.mkdir(parents=True, exist_ok=True)
        registry.write_text(yaml.dump({
            'groups': {},
            'suppressed': {'salt-creek': {'reason': 'merged away'}},
        }))

        result = apply_row(tmp_path, meta_row(artist='Kenny Baker'),
                           'metadata', 'salt-creek', verbose=False)

        assert not result.written
        assert 'artist' not in read_work(tmp_path, 'salt-creek')


class TestMetadataTouchesNoPart:
    """The structural guarantee, asked of the writer rather than the caller.

    `works_writer.update_metadata` accepts a whitelist of work-level keys and
    `parts` is not on it, so "a metadata edit touches no part" is a property
    of the function — not a promise `process_pending` has to keep.
    """

    def test_the_writer_refuses_to_write_parts(self, tmp_path):
        seed_tab_work(tmp_path)

        with pytest.raises(ValueError, match='cannot write parts'):
            works_writer.update_metadata(
                tmp_path, 'salt-creek', updates={'parts': []},
                provenance={'source': 'user-submission', 'source_id': 'x'},
                verbose=False)

    def test_a_work_with_several_parts_keeps_all_of_them_in_order(self, tmp_path):
        seed_work(tmp_path, 'salt-creek', submitted_by=OTHER_USER)
        apply_row(tmp_path, tab_row(), 'add', 'salt-creek', actor='Alice',
                  verbose=False)
        apply_row(tmp_path,
                  tab_row(id='tab:salt-creek:ef34gh',
                          content=json.dumps(otf_doc(fret=7))),
                  'add', 'salt-creek', actor='Bob', verbose=False)
        before = parts_snapshot(tmp_path, 'salt-creek')

        apply_row(tmp_path, meta_row(artist='Kenny Baker', key='A'),
                  'metadata', 'salt-creek', verbose=False)

        assert parts_snapshot(tmp_path, 'salt-creek') == before
        assert len(read_work(tmp_path, 'salt-creek')['parts']) == 3


# ============================================
# Suppressed targets: the dark-hollow-1 incident
# ============================================


def _deleted_songs(tmp_path, ids):
    path = tmp_path / 'docs' / 'data' / 'deleted_songs.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({i: {'reason': None} for i in ids}))


class TestASuffixedWorkIsNotAResurrection:
    """The real 2026-08-19 case, end to end through the dispatch.

    A guitar tab was submitted for `dark-hollow-1` — a live, curated,
    golden-standard work — while the UNRELATED `dark-hollow` sat in
    `deleted_songs.json`. The mint-time collision-suffix rule read `-1` as an
    attempt to resurrect the deleted song and refused the write; the row
    stayed uncommitted and the reconciler re-fired it hourly.
    """

    def test_a_tab_lands_on_an_existing_suffixed_work(self, tmp_path):
        seed_work(tmp_path, 'dark-hollow-1', submitted_by=OTHER_USER)
        _deleted_songs(tmp_path, ['dark-hollow'])

        result = apply_row(
            tmp_path,
            tab_row(id='tab:dark-hollow-1:85ltxlug',
                    replaces_id='dark-hollow-1',
                    title='Dark Hollow', instrument='guitar'),
            'add', 'dark-hollow-1', actor='Jane Picker', verbose=False)

        assert result.written
        assert result.skipped_reason is None
        work = read_work(tmp_path, 'dark-hollow-1')
        assert [p['type'] for p in work['parts']] == ['lead-sheet', 'tablature']
        assert work['parts'][1]['instrument'] == 'guitar'

    def test_a_tab_MINTING_a_new_suffixed_work_is_still_refused(self, tmp_path):
        """The importer path keeps the base rule: nothing is weakened."""
        _deleted_songs(tmp_path, ['dark-hollow'])

        result = apply_row(
            tmp_path,
            tab_row(id='tab:dark-hollow:zz99', title='Dark Hollow',
                    instrument='guitar'),
            'create', 'dark-hollow', verbose=False)

        assert not result.written
        assert result.skipped_reason == 'suppressed'


# ============================================
# Placeholder — a song request
# ============================================
#
# This column replaced a hand-written GitHub Contents-API PUT in
# `create-song-request` that passed the EXISTING file's sha when the path was
# taken — i.e. overwrote a real work with an empty `parts: []` stub whenever a
# request's client-generated slug collided. Everything below is either "the
# placeholder gets made properly" or "it is never made on top of anything".


def placeholder_row(**kw):
    """A song REQUEST: no content, status placeholder, id IS the work slug."""
    base = row(
        id='salt-creek-bill-monroe',
        title='Salt Creek',
        artist='Bill Monroe',
        composer=None,
        content=None,
        key='A',
        notes='Wanted for the Tuesday jam',
        status=PLACEHOLDER_STATUS,
        part_type='lead-sheet',
    )
    base.update(kw)
    return base


class TestIsPlaceholderRow:
    """Which writer a row reaches. Mirrors commit-song.ts:isPlaceholderRow."""

    def test_status_plus_no_content(self):
        assert is_placeholder_row(placeholder_row())
        assert is_placeholder_row(placeholder_row(content=''))
        assert is_placeholder_row(placeholder_row(content='   \n'))

    def test_an_ordinary_chart_row_is_not_one(self):
        assert not is_placeholder_row(row())
        assert not is_placeholder_row(row(status='complete'))

    def test_CONTENT_WINS_over_a_stale_status_column(self):
        """The trap that makes this two questions instead of one.

        A chart row's id IS its work slug, and so is a request's, so the
        editor's save upserts onto the very row a request created — and
        PostgREST only overwrites the columns in its payload. A row that has
        since grown a real chart can still read `status: placeholder`, and
        believing it would drop that submitter's ChordPro and mint an empty
        work in its place.
        """
        assert not is_placeholder_row(placeholder_row(content=CHORDPRO))

    def test_only_the_chart_column_can_hold_a_request(self):
        assert not is_placeholder_row(placeholder_row(part_type='tablature'))
        assert not is_placeholder_row(placeholder_row(part_type='metadata'))
        # Absent means chart: every row written before 2026-08-18 has none.
        assert is_placeholder_row(placeholder_row(part_type=None))


class TestPlaceholderCreate:

    def test_mints_a_work_with_no_parts_at_all(self, tmp_path):
        result = apply_row(tmp_path, placeholder_row(), 'placeholder',
                           'salt-creek-bill-monroe', actor='Jane Picker',
                           verbose=False)

        assert result.written
        assert result.work_id == 'salt-creek-bill-monroe'
        assert result.part_file is None
        work = read_work(tmp_path, 'salt-creek-bill-monroe')
        assert work['parts'] == []
        assert not (tmp_path / 'works' / 'salt-creek-bill-monroe'
                    / 'lead-sheet.pro').exists()

    def test_status_placeholder_survives_into_work_yaml(self, tmp_path):
        """What `utils.isPlaceholder` and the bounty board actually read."""
        apply_row(tmp_path, placeholder_row(), 'placeholder',
                  'salt-creek-bill-monroe', verbose=False)
        assert read_work(tmp_path, 'salt-creek-bill-monroe')['status'] == \
            'placeholder'

    def test_the_metadata_the_requester_typed_lands(self, tmp_path):
        apply_row(tmp_path, placeholder_row(), 'placeholder',
                  'salt-creek-bill-monroe', verbose=False)
        work = read_work(tmp_path, 'salt-creek-bill-monroe')
        assert work['title'] == 'Salt Creek'
        assert work['artist'] == 'Bill Monroe'
        assert work['default_key'] == 'A'
        assert work['notes'] == 'Wanted for the Tuesday jam'
        assert work['tags'] == []

    def test_fields_the_requester_left_blank_are_not_written(self, tmp_path):
        """A null column is 'they didn't say', never a blank value."""
        apply_row(tmp_path,
                  placeholder_row(artist=None, key='', notes=None),
                  'placeholder', 'salt-creek-bill-monroe', verbose=False)
        work = read_work(tmp_path, 'salt-creek-bill-monroe')
        assert 'artist' not in work
        assert 'default_key' not in work
        assert 'notes' not in work

    def test_the_requester_is_recorded(self, tmp_path):
        """A placeholder has no part to hang provenance on, so this work-level
        stamp is the ONLY record that the work was minted by a request."""
        apply_row(tmp_path, placeholder_row(), 'placeholder',
                  'salt-creek-bill-monroe', actor='Jane Picker', verbose=False)
        prov = read_work(tmp_path, 'salt-creek-bill-monroe')[
            'metadata_provenance']
        assert prov['submitted_by'] == SUBMITTER
        assert prov['source'] == 'user-submission'
        assert prov['source_id'].startswith('pending:salt-creek-bill-monroe:')

    def test_the_work_validates_against_the_schema(self, tmp_path):
        """`create_work` runs validate_work; a parts-less work must pass it."""
        result = apply_row(tmp_path, placeholder_row(), 'placeholder',
                           'salt-creek-bill-monroe', verbose=False)
        assert result.written


class TestPlaceholderNeverOverwrites:
    """THE bug. A request must never land on a work that already exists."""

    def test_an_existing_work_is_refused_not_overwritten(self, tmp_path):
        seed_work(tmp_path, 'salt-creek-bill-monroe', submitted_by=OTHER_USER)
        before = read_work(tmp_path, 'salt-creek-bill-monroe')

        result = apply_row(tmp_path, placeholder_row(), 'placeholder',
                           'salt-creek-bill-monroe', verbose=False)

        assert not result.written
        assert result.skipped_reason == WORK_EXISTS_SKIP_REASON
        # Byte for byte what it was: parts, artist, title, provenance.
        assert read_work(tmp_path, 'salt-creek-bill-monroe') == before
        assert before['parts'], 'the fixture must actually have had parts'

    def test_it_does_not_land_beside_the_work_either(self, tmp_path):
        """`on_collision='suffix'` would be SAFE but wrong — an empty
        placeholder at `foo-1` is a bounty-board entry asking for a song the
        site already has."""
        seed_work(tmp_path, 'salt-creek-bill-monroe', submitted_by=OTHER_USER)
        apply_row(tmp_path, placeholder_row(), 'placeholder',
                  'salt-creek-bill-monroe', verbose=False)
        assert not (tmp_path / 'works' / 'salt-creek-bill-monroe-1').exists()

    def test_the_refusal_is_HELD_not_retried_hourly(self, tmp_path):
        seed_work(tmp_path, 'salt-creek-bill-monroe', submitted_by=OTHER_USER)
        result = apply_row(tmp_path, placeholder_row(), 'placeholder',
                           'salt-creek-bill-monroe', verbose=False)

        held = hold_reason(result)
        assert held
        assert 'salt-creek-bill-monroe' in held
        # It has to tell the admin what to do about it.
        assert 'delete the row' in held

    def test_a_suppressed_id_is_refused(self, tmp_path):
        """Requesting a song an admin deleted must not resurrect it."""
        _deleted_songs(tmp_path, ['salt-creek-bill-monroe'])
        result = apply_row(tmp_path, placeholder_row(), 'placeholder',
                           'salt-creek-bill-monroe', verbose=False)
        assert not result.written
        assert result.skipped_reason == 'suppressed'
        assert not (tmp_path / 'works' / 'salt-creek-bill-monroe').exists()

    def test_a_redirected_id_is_refused(self, tmp_path):
        """...and must not re-mint a work that was merged away."""
        (tmp_path / 'docs' / 'data').mkdir(parents=True, exist_ok=True)
        (tmp_path / 'docs' / 'data' / 'redirects.json').write_text(
            json.dumps({'salt-creek-bill-monroe': 'salt-creek'}))
        result = apply_row(tmp_path, placeholder_row(), 'placeholder',
                           'salt-creek-bill-monroe', verbose=False)
        assert not result.written
        assert result.skipped_reason == 'redirected'


class TestPlaceholderReplay:
    """A dispatch can arrive twice; the second must be a no-op."""

    def test_a_replayed_dispatch_writes_nothing_new(self, tmp_path):
        entry = placeholder_row()
        first = apply_row(tmp_path, entry, 'placeholder',
                          'salt-creek-bill-monroe', verbose=False)
        assert first.written
        before = read_work(tmp_path, 'salt-creek-bill-monroe')

        second = apply_row(tmp_path, entry, 'placeholder',
                           'salt-creek-bill-monroe', verbose=False)

        assert not second.written
        assert second.skipped_reason == 'already-applied'
        assert read_work(tmp_path, 'salt-creek-bill-monroe') == before
        # And emphatically not a second work at a suffixed id.
        assert not (tmp_path / 'works' / 'salt-creek-bill-monroe-1').exists()

    def test_the_marker_is_over_the_FIELDS_not_the_absent_content(self, tmp_path):
        """Hashing the always-null content would give every request in the
        table the same marker, so the first would make every later one look
        like a replay."""
        one = apply_row(tmp_path, placeholder_row(), 'placeholder',
                        'salt-creek-bill-monroe', verbose=False)
        two = apply_row(tmp_path, placeholder_row(id='rebecca-jim-mills',
                                                  title='Rebecca'),
                        'placeholder', 'rebecca-jim-mills', verbose=False)
        assert one.written and two.written
        markers = {
            read_work(tmp_path, w)['metadata_provenance']['source_id']
            for w in ('salt-creek-bill-monroe', 'rebecca-jim-mills')
        }
        assert len(markers) == 2


class TestPlaceholderRefusals:

    def test_a_mode_from_another_column_is_refused(self, tmp_path):
        """`create` is the chart column's word for this gesture, and a
        placeholder dispatched as one must not fall through to it."""
        for mode in ('create', 'update', 'fork', 'add', 'metadata'):
            with pytest.raises(ProcessPendingError, match='placeholder mode'):
                apply_row(tmp_path, placeholder_row(), mode,
                          'salt-creek-bill-monroe', verbose=False)

    def test_a_CHART_row_dispatched_as_placeholder_is_refused(self, tmp_path):
        """The other direction: a row with real ChordPro is not a request, so
        `placeholder` is not one of its modes and its content is never lost."""
        with pytest.raises(ProcessPendingError, match='unknown mode'):
            apply_row(tmp_path, row(), 'placeholder',
                      'blue-moon-of-kentucky', verbose=False)
        assert not (tmp_path / 'works').exists()

    def test_a_work_id_that_is_not_a_slug_never_becomes_a_directory(self, tmp_path):
        """The id is client-supplied and becomes a path inside works/."""
        for work_id in ('', '  ', 'Salt Creek', 'salt/creek', 'salt--creek',
                        '-salt-creek', 'tab:salt-creek:9f3c2a'):
            with pytest.raises(ProcessPendingError, match='not a slug'):
                apply_row(tmp_path, placeholder_row(), 'placeholder', work_id,
                          verbose=False)
        assert not (tmp_path / 'works').exists()

    def test_a_request_with_no_title_is_refused(self, tmp_path):
        with pytest.raises(ProcessPendingError, match='no title'):
            apply_row(tmp_path, placeholder_row(title=None), 'placeholder',
                      'salt-creek-bill-monroe', verbose=False)


class TestPlaceholderSkipsTheDedupBackstop:

    def test_the_corpus_index_is_never_built(self, tmp_path):
        """No ChordPro to score, and 'is this song already here?' has just
        been answered exactly by looking. Building the ~1.6s title index to
        produce advice it cannot give would be pure cost."""
        class Exploding(DedupBackstop):
            def check(self, *a, **kw):
                raise AssertionError('the backstop must not see a request')

        result = apply_row(tmp_path, placeholder_row(), 'placeholder',
                           'salt-creek-bill-monroe', verbose=False,
                           backstop=Exploding(tmp_path))
        assert result.written


class TestPermanentRefusalsAreHeld:
    """A refusal that cannot change by waiting must stop being re-dispatched.

    `hold_reason` is what main() writes to `pending_songs.dedup_hold`, which
    the reconciler skips (`commit-song.ts:holdReason`) and the Bluegrass
    Dungeon renders with Release-hold / Reject.
    """

    def result(self, reason, work_id='dark-hollow-1'):
        return works_writer.WriteResult(
            mode='add-part', work_id=work_id, skipped_reason=reason)

    def test_a_suppressed_target_is_held_and_says_why(self):
        held = hold_reason(self.result('suppressed'))
        assert held
        assert 'dark-hollow-1' in held
        assert 'suppressed' in held
        # The admin has to know clearing the hold alone will not help.
        assert 'Retrying cannot change that' in held

    def test_a_redirected_target_is_held_too(self):
        assert hold_reason(self.result('redirected'))

    def test_both_permanent_reasons_are_the_documented_set(self):
        assert PERMANENT_SKIP_REASONS == ('suppressed', 'redirected')

    def test_the_dedup_hold_keeps_its_own_wording(self, tmp_path):
        backstop = DedupBackstop(tmp_path)
        assert hold_reason(self.result(DEDUP_HOLD_REASON), backstop) == \
            'held by the dedup backstop'

    def test_a_transient_failure_is_NOT_held(self):
        """Only decisions are parked; everything else retries next hour."""
        assert hold_reason(self.result(None)) is None
        assert hold_reason(self.result('already-applied')) is None

    def test_a_written_row_is_never_held(self, tmp_path):
        seed_work(tmp_path, 'dark-hollow-1', submitted_by=OTHER_USER)
        _deleted_songs(tmp_path, ['dark-hollow'])
        result = apply_row(
            tmp_path, tab_row(replaces_id='dark-hollow-1', instrument='guitar'),
            'add', 'dark-hollow-1', verbose=False)
        assert result.written
        assert hold_reason(result) is None
