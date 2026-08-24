"""The dispatch asks one ownership question twice — hold both sides to it.

``classifyChange`` (TypeScript, before the dispatch) and ``apply_row``
(Python, after it) both need to know *has this user already contributed a part
of this kind to this work?* Before this file, the two answers were kept in
agreement by a comment on each side saying they mirrored each other:

    supabase/functions/_shared/pending-dispatch.ts  submittersOf(yaml, partType)
    scripts/lib/process_pending.py                  owns_content(..., part_type)

That is exactly the arrangement that produced the escalation both docstrings
now describe: while ``submitted_by`` appeared on lead-sheet parts alone, an
UNSCOPED question was safe by accident, and both sides asked it unscoped. Once
tab rows started carrying ``submitted_by`` too, "Alice submitted a banjo tab
here" would have read as "Alice owns content here" — ``update`` instead of
``fork`` — an in-place overwrite of a stranger's lyrics, plus the work's
title/artist/key riding along.

So the expectations now live in ONE table, in the fixture directory the edge
functions own, and both suites answer from it:

    supabase/functions/_shared/testdata/how-long-blues.work.yaml   the work
    supabase/functions/_shared/testdata/ownership-cases.json       the answers

The TypeScript half is
``supabase/functions/_shared/pending-dispatch.test.ts`` ("shared parity
table"). Add a row to the JSON and both sides must agree or one goes red.
"""

import json
from pathlib import Path

import pytest

from process_pending import owns_content

TESTDATA = (Path(__file__).parent.parent
            / 'supabase' / 'functions' / '_shared' / 'testdata')


def _cases():
    return json.loads((TESTDATA / 'ownership-cases.json').read_text())


CASES = _cases()


@pytest.fixture
def repo(tmp_path):
    """A repo root holding just the shared fixture work."""
    work_dir = tmp_path / 'works' / CASES['work_id']
    work_dir.mkdir(parents=True)
    (work_dir / 'work.yaml').write_text(
        (TESTDATA / CASES['work_yaml']).read_text())
    # The parts' files never need to exist for an ownership question, but the
    # work is only honest if they do.
    for name in ('lead-sheet.pro', 'lead-sheet-simplified.pro'):
        (work_dir / name).write_text('{title: How Long Blues}\n')
    (work_dir / 'banjo.otf.json').write_text('{"tracks":[]}\n')
    return tmp_path


@pytest.mark.parametrize(
    'user_key,part_type,expected,why',
    [(c['user'], c['part_type'], c['owns'], c['why']) for c in CASES['cases']],
    ids=[f"{c['user']}-{c['part_type']}" for c in CASES['cases']],
)
def test_owns_content_matches_the_shared_table(repo, user_key, part_type,
                                               expected, why):
    user_id = CASES['users'][user_key]
    assert owns_content(repo, CASES['work_id'], user_id, part_type) is expected, why


def test_the_fixture_really_holds_three_owners_and_two_charts():
    """Guard the fixture itself — a table is only as good as what it describes.

    If someone regenerates ``how-long-blues.work.yaml`` and flattens it to one
    part, every parametrized case above would still pass while testing nothing.
    """
    import yaml

    work = yaml.safe_load((TESTDATA / CASES['work_yaml']).read_text())
    parts = work['parts']
    charts = [p for p in parts if p['type'] == 'lead-sheet']
    tabs = [p for p in parts if p['type'] == 'tablature']
    assert len(charts) == 2, 'need a primary chart AND a fork'
    assert len(tabs) == 1
    submitters = {p['provenance']['submitted_by'] for p in parts}
    assert len(submitters) == 3, 'three different owners is the whole point'
    assert submitters == set(CASES['users'].values()) - {CASES['users']['stranger']}


def test_owns_content_is_false_without_a_user():
    """An anonymous actor owns nothing — the write path requires login, but
    the classifier must not fall open if that ever changes."""
    assert owns_content(Path('/nonexistent'), 'x', None) is False
    assert owns_content(Path('/nonexistent'), 'x', '') is False


def test_owns_content_is_false_for_a_work_that_is_not_there(tmp_path):
    (tmp_path / 'works').mkdir()
    assert owns_content(tmp_path, 'no-such-work',
                        CASES['users']['primary_chart_owner']) is False


def test_owns_content_defaults_to_the_chart_question(repo):
    """The default part_type is 'lead-sheet' — the same default
    ``pending_songs.part_type`` carries, and the same one ``classifyChange``
    falls into when part_type is absent."""
    users = CASES['users']
    assert owns_content(repo, CASES['work_id'], users['primary_chart_owner']) is True
    assert owns_content(repo, CASES['work_id'], users['tab_owner']) is False
