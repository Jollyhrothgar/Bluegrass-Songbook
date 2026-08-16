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

The backstop tests use the ``tests/fixtures/dedup/`` charts, whose provenance
is documented in ``tests/test_dedup_scorer.py``: the ``how-long-blues`` pair is
the real #208 miss (a lyrics-only scrape and the same song submitted with
chords), so "would this have been caught?" is asked here with the actual text
that wasn't.
"""

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
    owns_content,
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
