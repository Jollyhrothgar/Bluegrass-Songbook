"""Every workflow that pushes to main must be wired to trigger a deploy.

GitHub does not start workflows for pushes made with the default GITHUB_TOKEN
(recursive-workflow prevention). So a workflow that commits to main produces a
commit that nothing rebuilds — the change is durable in git and invisible on
the site. `build.yml` compensates with a `workflow_run` trigger listing the
content workflows by name.

That list matches the triggering workflow's `name:` field, not its filename,
and GitHub reports nothing at all when an entry matches no workflow. It has
silently drifted twice:

  - b1f61d46e (2026-08-15) deleted "Process Song Submission" / "Process Song
    Correction"; their replacement "Process Pending Submission" was never
    added, so every song and tab submission landed in works/ and never
    deployed.
  - 365d6bc4a (2026-08-14) renamed "Sync Deleted Songs" to "Sync Deleted +
    Promoted Songs", unhooking admin deletes and Dungeon promotions.

These tests make the next rename a red CI run instead of a stranded feature.
"""

import re
from pathlib import Path

import pytest
import yaml

WORKFLOW_DIR = Path(__file__).parent.parent / '.github' / 'workflows'
BUILD_WORKFLOW = WORKFLOW_DIR / 'build.yml'

# build.yml itself deploys; it must never appear in its own trigger list.
SELF_NAME = 'CI & Deploy'


def _load(path):
    # PyYAML parses the `on:` key as the boolean True (YAML 1.1 truthiness).
    return yaml.safe_load(path.read_text())


def _triggers(cfg):
    return cfg.get('on', cfg.get(True, {})) or {}


def _workflow_files():
    return sorted(
        p for p in WORKFLOW_DIR.glob('*.y*ml') if p.name not in {'build.yml'}
    )


def _pushes_to_main(path):
    """True if the workflow runs `git push` in a job step."""
    return re.search(r'^\s*(?:if\s+)?git push\b', path.read_text(), re.M) is not None


def _name_of(path):
    name = _load(path).get('name')
    assert name, f'{path.name} has no `name:` field'
    return name


@pytest.fixture(scope='module')
def listed_names():
    trig = _triggers(_load(BUILD_WORKFLOW))
    assert 'workflow_run' in trig, (
        'build.yml lost its workflow_run trigger — bot commits will stop deploying'
    )
    return list(trig['workflow_run']['workflows'])


@pytest.fixture(scope='module')
def pushing_names():
    return {_name_of(p): p.name for p in _workflow_files() if _pushes_to_main(p)}


def test_every_pushing_workflow_triggers_a_deploy(listed_names, pushing_names):
    missing = {n: f for n, f in pushing_names.items() if n not in listed_names}
    assert not missing, (
        'These workflows push commits to main but are not in build.yml\'s '
        f'workflow_run list, so their commits will never deploy: {missing}. '
        'Add the exact `name:` string to .github/workflows/build.yml.'
    )


def test_no_dead_entries_in_the_trigger_list(listed_names):
    """An entry naming no existing workflow is dead weight that reads as coverage."""
    real = {_name_of(p) for p in _workflow_files()} | {SELF_NAME}
    dead = [n for n in listed_names if n not in real]
    assert not dead, (
        f'build.yml lists workflows that do not exist: {dead}. '
        'They were renamed or retired; the entry silently matches nothing.'
    )


def test_listed_workflows_actually_push(listed_names, pushing_names):
    """A non-pushing workflow in the list fires a build on every completion."""
    extra = [n for n in listed_names if n not in pushing_names]
    assert not extra, (
        f'These are in build.yml\'s workflow_run list but never `git push`: {extra}. '
        'They trigger a gated no-op build on every run — drop them. '
        '(Reconcile Pending Songs is the classic case: it commits only '
        'indirectly, via a repository_dispatch to Process Pending Submission.)'
    )


def test_build_never_triggers_itself(listed_names):
    """A self-trigger would loop forever; a push-to-main by build.yml would too."""
    assert SELF_NAME not in listed_names
    assert not _pushes_to_main(BUILD_WORKFLOW), (
        'build.yml pushes to main. Combined with its workflow_run triggers that '
        'is a deploy->commit->deploy loop.'
    )
