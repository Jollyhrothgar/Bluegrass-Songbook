"""Tab importer duplicate matching against the dedup scorer (#192 / #226).

``works_importer.find_matching_work`` used to decide "is this tab already a
work?" via exact-string equality on its own weak ``normalize_title`` (#192:
"Blackberry Blossom - Trad." and "soldier-s-joy" slipped past it). It now
asks ``scripts/lib/dedup_scorer.WorkCorpus`` instead.

Banjo Hangout tab imports never carry lyrics (they're OTF tablature, not
ChordPro), so ``score_pair`` always takes the scorer's instrumental /
no-lyrics branch: these tests exercise ``TITLE_ONLY_MIN`` (0.95), not lyric
containment. Threshold values below are pinned against the real scorer
(``uv run python3 -c "from dedup_scorer import title_similarity as s;
print(s('Fine Time', 'Fine Time'), s('Fine Time', 'Fine Times'))"``) so they
don't drift silently if the scorer's normalization changes.
"""

import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

import works_importer as wi  # noqa: E402
from catalog import TabEntry  # noqa: E402
from dedup_scorer import TITLE_ONLY_MIN, WorkCorpus, title_similarity  # noqa: E402
from site_config import get_site  # noqa: E402

SITE = get_site('banjo-hangout')


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_works_dir(monkeypatch, tmp_path):
    """Fresh WORKS_DIR + module caches per test.

    Both the legacy matcher's ``_TITLE_INDEX`` and the scorer corpus
    singleton are process-global caches; without resetting them, two tests
    pointed at different tmp ``works/`` dirs would see each other's state.
    """
    works_dir = tmp_path / 'works'
    works_dir.mkdir()
    monkeypatch.setattr(wi, 'WORKS_DIR', works_dir)
    monkeypatch.setattr(wi, '_TITLE_INDEX', {})
    monkeypatch.setattr(wi, '_WORK_CORPUS', None)
    return works_dir


def make_work(works_dir: Path, work_id: str, title: str) -> Path:
    """A tab-only work: a title and no lead sheet (so: no lyrics)."""
    work_dir = works_dir / work_id
    work_dir.mkdir()
    (work_dir / 'work.yaml').write_text(yaml.dump({
        'id': work_id, 'title': title, 'parts': [],
    }))
    return work_dir


def make_tab(tab_id: str, title: str) -> TabEntry:
    return TabEntry(id=tab_id, title=title, author='someuser', format='tef',
                    source_url='https://www.banjohangout.org/tab/browse.asp?m=detail&v=1')


class FakeCatalog:
    """Just enough of TabCatalog for batch_import's dry-run path."""

    def __init__(self, tabs):
        self._tabs = tabs

    def get_importable(self):
        return self._tabs


# --------------------------------------------------------------------------
# Threshold pins (fail loudly if the scorer's calibration ever moves)
# --------------------------------------------------------------------------


def test_threshold_pins():
    assert title_similarity('Fine Time', 'Fine Time') == 1.0
    assert title_similarity('Fine Time', 'Fine Times') < TITLE_ONLY_MIN
    assert title_similarity("Soldier's Joy", 'Soldiers Joy') == 1.0
    assert title_similarity('Salt Creek', 'Salt Creek Waltz') < TITLE_ONLY_MIN


# --------------------------------------------------------------------------
# 1. Same-title instrumental: matches only above TITLE_ONLY_MIN
# --------------------------------------------------------------------------


class TestInstrumentalTitleThreshold:
    """No usable lyrics on either side, so title similarity alone decides.

    The existing work's directory id is deliberately NOT the slug of the
    incoming title, so these assertions exercise the scorer's fuzzy title
    match rather than the exact-slug fast path.
    """

    def test_same_title_matches_via_scorer(self, isolated_works_dir):
        make_work(isolated_works_dir, 'fine-time-1', 'Fine Time')
        corpus = WorkCorpus(isolated_works_dir)

        match = wi.find_matching_work('Fine Time', SITE, corpus)

        assert match is not None
        assert match.name == 'fine-time-1'

    def test_near_title_below_threshold_does_not_match(self, isolated_works_dir):
        make_work(isolated_works_dir, 'fine-time-1', 'Fine Time')
        corpus = WorkCorpus(isolated_works_dir)

        # 'Fine Time' vs 'Fine Times' scores just under TITLE_ONLY_MIN
        # (0.947 < 0.95) -- a different tune with a near-identical name
        # must not get silently merged onto the existing work.
        match = wi.find_matching_work('Fine Times', SITE, corpus)

        assert match is None


# --------------------------------------------------------------------------
# 2. The #192 class: retitled variants the old equality matcher missed
# --------------------------------------------------------------------------


class Test192Class:
    """Titles the legacy exact-normalized-string matcher missed, which the
    scorer's generous punctuation/whitespace normalization now catches."""

    def test_apostrophe_variant_now_matches(self, isolated_works_dir):
        # Real corpus shape from #192: slugify("Soldier's Joy") produces
        # "soldier-s-joy" (the apostrophe becomes a hyphen), which never
        # equals slugify("Soldiers Joy") == "soldiers-joy".
        make_work(isolated_works_dir, 'soldier-s-joy', "Soldier's Joy")
        corpus = WorkCorpus(isolated_works_dir)

        assert wi._find_matching_work_legacy('Soldiers Joy', SITE) is None

        match = wi.find_matching_work('Soldiers Joy', SITE, corpus)

        assert match is not None
        assert match.name == 'soldier-s-joy'

    def test_trailing_artist_segment_now_matches(self, isolated_works_dir):
        # #192's other named example: a trailing " - Trad." attribution
        # that strip_title_decorations doesn't touch (it's not an
        # instrument decoration).
        make_work(isolated_works_dir, 'blackberry-blossom', 'Blackberry Blossom')
        corpus = WorkCorpus(isolated_works_dir)

        assert wi._find_matching_work_legacy(
            'Blackberry Blossom - Trad.', SITE) is None

        match = wi.find_matching_work('Blackberry Blossom - Trad.', SITE, corpus)

        assert match is not None
        assert match.name == 'blackberry-blossom'


# --------------------------------------------------------------------------
# 3. Unrelated same-title-prefix song: must not match
# --------------------------------------------------------------------------


class TestUnrelatedTitleDoesNotMatch:
    def test_shared_prefix_different_tune_does_not_match(self, isolated_works_dir):
        make_work(isolated_works_dir, 'salt-creek', 'Salt Creek')
        corpus = WorkCorpus(isolated_works_dir)

        # A real, different tune that happens to share a title prefix.
        match = wi.find_matching_work('Salt Creek Waltz', SITE, corpus)

        assert match is None


# --------------------------------------------------------------------------
# 4. Behavior guard: this only changes NEW-import matching, and any
#    disagreement between the two matchers is logged, not silent.
# --------------------------------------------------------------------------


class TestDivergenceLogging:
    def test_logs_when_scorer_and_legacy_disagree(self, isolated_works_dir, capsys):
        make_work(isolated_works_dir, 'soldier-s-joy', "Soldier's Joy")
        corpus = WorkCorpus(isolated_works_dir)

        wi.find_matching_work('Soldiers Joy', SITE, corpus)

        out = capsys.readouterr().out
        assert '[dedup-scorer]' in out
        assert 'legacy=None' in out
        assert 'scorer=soldier-s-joy' in out

    def test_no_log_when_matchers_agree(self, isolated_works_dir, capsys):
        make_work(isolated_works_dir, 'fine-time', 'Fine Time')
        corpus = WorkCorpus(isolated_works_dir)

        wi.find_matching_work('Fine Time', SITE, corpus)

        out = capsys.readouterr().out
        assert '[dedup-scorer]' not in out


# --------------------------------------------------------------------------
# 5. Performance: one corpus for the whole run, never rebuilt per file
# --------------------------------------------------------------------------


class TestCorpusReuse:
    def test_get_work_corpus_is_a_singleton(self, isolated_works_dir):
        assert wi.get_work_corpus() is wi.get_work_corpus()

    def test_title_index_built_once_across_many_lookups(self, isolated_works_dir, monkeypatch):
        make_work(isolated_works_dir, 'fine-time-1', 'Fine Time')
        make_work(isolated_works_dir, 'salt-creek-1', 'Salt Creek')

        build_calls = []
        real_build = WorkCorpus._build_index

        def counting_build(self):
            build_calls.append(1)
            return real_build(self)

        monkeypatch.setattr(WorkCorpus, '_build_index', counting_build)

        corpus = wi.get_work_corpus()
        for title in ('Fine Time', 'Salt Creek', 'Angeline the Baker'):
            wi.find_matching_work(title, SITE, corpus)

        assert len(build_calls) == 1


# --------------------------------------------------------------------------
# 6. Dry-run reporting shows the scorer's decisions
# --------------------------------------------------------------------------


class TestDryRunReflectsScorerMatch:
    def test_dry_run_reports_scorer_match_old_equality_would_have_missed(
        self, isolated_works_dir, capsys
    ):
        make_work(isolated_works_dir, 'soldier-s-joy', "Soldier's Joy")
        catalog = FakeCatalog([make_tab('999', 'Soldiers Joy')])

        result = wi.batch_import(catalog, dry_run=True, site=SITE)

        out = capsys.readouterr().out
        assert result == 0  # dry-run imports nothing
        assert 'Soldiers Joy -> add to soldier-s-joy' in out
