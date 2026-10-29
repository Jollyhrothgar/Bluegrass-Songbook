"""CI & Deploy: PR checks must not queue behind each other or behind deploys.

A concurrency group holds one running and one waiting run, and a newer waiting
run cancels the older one. Until 2026-10-28 the whole workflow sat in one group,
"pages" (GitHub's starter template for Pages), so a PR's checks were cancelled
by the next PR's, or by a deploy on main, and PRs had to be merged one at a
time. Only the deploy job belongs in "pages".
"""
from pathlib import Path

import yaml

BUILD = Path(__file__).parent.parent / '.github' / 'workflows' / 'build.yml'


def _workflow():
    return yaml.safe_load(BUILD.read_text())


def test_each_pull_request_has_its_own_queue():
    group = _workflow()['concurrency']['group']
    assert group != 'pages'
    assert 'github.event.pull_request.number' in group


def test_a_push_to_a_pr_cancels_only_its_own_older_run():
    cancel = _workflow()['concurrency']['cancel-in-progress']
    assert cancel == "${{ github.event_name == 'pull_request' }}"


def test_deploys_never_overlap_and_are_never_cancelled():
    deploy = _workflow()['jobs']['deploy']['concurrency']
    assert deploy == {'group': 'pages', 'cancel-in-progress': False}
