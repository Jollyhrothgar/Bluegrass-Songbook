"""Tests for the containment-based dedup scorer (scripts/lib/dedup_scorer.py).

Fixture provenance — every file in ``tests/fixtures/dedup/`` is a verbatim copy,
so a reviewer can re-derive it:

* ``how-long-blues.pro`` / ``how-long-blues-1.pro`` — the pre-merge texts of the
  #208 pair, taken from git before the works were merged::

      git show 2e8373a39^:works/how-long-blues/lead-sheet.pro
      git show 2e8373a39^:works/how-long-blues-1/lead-sheet.pro

  ``how-long-blues`` is the Feb 2026 bluegrasslyrics.com scrape (lyrics only);
  ``how-long-blues-1`` is issue #208's submission (same song, with chords and
  an artist). The pipeline minted a second slug instead of enriching the first.
  This is the golden case: ``dedup_works.py`` scored it 0.043 against a 0.5
  threshold.

* ``i-walk-alone.pro`` / ``i-walk-the-line.pro`` / ``good-hearted-woman.pro`` /
  ``good-hearted-man.pro`` — copies of ``works/<id>/lead-sheet.pro``. These are
  the known false positives called out in the ``fuzzy_group_songs`` docstring at
  ``scripts/lib/build_works_index.py:570``: similar titles, different songs.

* ``blackberry-blossom-abc.pro`` — copy of
  ``works/blackberry-blossom/lead-sheet.pro`` (a tunearch ABC instrumental, no
  lyrics at all).
* ``blackberry-blossom-chords.pro`` — **constructed**, not from the corpus: only
  one ``blackberry-blossom`` work exists, so the second same-title instrumental
  chart is hand-written to exercise the no-lyrics path.
"""

import pytest

from dedup_scorer import (
    CONTAINMENT_DUPLICATE,
    CONTAINMENT_MATCH,
    MIN_LYRIC_WORDS,
    Chart,
    Outcome,
    Warning_,
    WorkCorpus,
    chordpro_lyric_words,
    containment,
    has_chords,
    jaccard,
    lyric_words,
    main,
    normalize_title,
    score_pair,
    title_similarity,
)

FIXTURES = 'dedup'


@pytest.fixture
def dedup_fixtures(fixtures_path):
    return fixtures_path / FIXTURES


@pytest.fixture
def chart_of(dedup_fixtures):
    def _load(name, **kwargs):
        return Chart.from_file(dedup_fixtures / f'{name}.pro', **kwargs)
    return _load


# ---------------------------------------------------------------------------
# Normalization primitives
# ---------------------------------------------------------------------------


class TestNormalization:
    def test_lyric_words_is_order_independent(self):
        assert lyric_words('how long baby') == lyric_words('baby long how')

    def test_lyric_words_folds_curly_and_straight_apostrophes(self):
        assert lyric_words('mean ol’ blues') == lyric_words("mean ol' blues")

    def test_chordpro_extraction_drops_directives_and_chords(self):
        words = chordpro_lyric_words(
            '{meta: title How Long Blues}\n'
            '{start_of_verse: Verse 1}\n'
            '[E]How long, how [E7]long\n'
            '{end_of_verse}\n'
        )
        assert words == {'how', 'long'}

    def test_chordpro_extraction_drops_hash_comments(self):
        assert chordpro_lyric_words('# transcribed by somebody\nhow long\n') == {
            'how', 'long'
        }

    def test_chordpro_extraction_drops_abc_blocks(self, chart_of):
        # A tunearch ABC instrumental has no lyrics whatsoever.
        assert len(chart_of('blackberry-blossom-abc').words) == 0

    def test_normalize_title_strips_articles_and_punctuation(self):
        assert normalize_title("I Walk The Line") == 'i walk line'
        assert normalize_title('Blue Moon of Kentucky (Live)') == 'blue moon of kentucky'

    def test_containment_uses_the_smaller_side(self):
        small, big = frozenset('ab'), frozenset('abcd')
        assert containment(small, big) == 1.0
        assert jaccard(small, big) == 0.5

    def test_containment_of_empty_set_is_zero(self):
        assert containment(frozenset(), frozenset('ab')) == 0.0


class TestChordDetection:
    def test_real_chords_are_detected(self):
        assert has_chords('[E]How long, how [E7]long') is True

    def test_annotations_are_not_chords(self):
        assert has_chords('[Verse 1] sing it\n[x2] again') is False

    def test_plain_lyrics_have_no_chords(self):
        assert has_chords('How long, how long') is False

    def test_fixture_chord_presence(self, chart_of):
        assert chart_of('how-long-blues').chords is False
        assert chart_of('how-long-blues-1').chords is True


# ---------------------------------------------------------------------------
# The golden case: issue #208
# ---------------------------------------------------------------------------


class TestHowLongBlues:
    @pytest.fixture
    def lyrics_only(self, chart_of):
        return chart_of('how-long-blues', work_id='how-long-blues')

    @pytest.fixture
    def with_chords(self, chart_of):
        return chart_of('how-long-blues-1', work_id='how-long-blues-1')

    def test_containment_clears_the_match_threshold(self, lyrics_only, with_chords):
        score = containment(with_chords.words, lyrics_only.words)
        assert score >= CONTAINMENT_MATCH
        # The plan measured 0.886 with a slightly different normalization; the
        # point is that it is far above threshold, not the third decimal.
        assert score >= 0.85

    def test_old_scorer_really_did_miss_it(self, dedup_fixtures):
        """Guards the premise: the ordered 300-char window scores ~0.04."""
        from dedup_works import (
            extract_lyrics_from_chordpro,
            normalize_lyrics,
            similarity,
        )

        old = [
            normalize_lyrics(
                extract_lyrics_from_chordpro(
                    (dedup_fixtures / f'{name}.pro').read_text(encoding='utf-8')
                )
            )
            for name in ('how-long-blues', 'how-long-blues-1')
        ]
        assert similarity(*old) < 0.5

    def test_incoming_with_chords_enriches_the_lyrics_only_work(
        self, lyrics_only, with_chords
    ):
        verdict = score_pair(incoming=with_chords, existing=lyrics_only)
        assert verdict.outcome == Outcome.ENRICH
        assert verdict.matched_work_id == 'how-long-blues'
        assert verdict.score >= CONTAINMENT_MATCH
        assert verdict.low_confidence is False
        assert verdict.warnings == ()
        assert verdict.details['lyrics_decided'] is True

    def test_enrichment_is_the_one_auto_actionable_outcome(
        self, lyrics_only, with_chords
    ):
        verdict = score_pair(incoming=with_chords, existing=lyrics_only)
        assert verdict.auto_actionable is True

    def test_reverse_direction_is_a_duplicate_not_an_enrichment(
        self, lyrics_only, with_chords
    ):
        """A lyrics-only submission against a charted work adds nothing."""
        verdict = score_pair(incoming=lyrics_only, existing=with_chords)
        assert verdict.outcome == Outcome.DUPLICATE
        assert verdict.auto_actionable is False

    def test_section_reordering_does_not_matter(self, lyrics_only, with_chords):
        """The two charts order chorus and verse differently — that is exactly
        what broke SequenceMatcher, and it must not affect containment."""
        shuffled = Chart(
            title=with_chords.title,
            words=with_chords.words,
            chords=with_chords.chords,
            work_id=with_chords.work_id,
        )
        assert score_pair(shuffled, lyrics_only).score == score_pair(
            with_chords, lyrics_only
        ).score


# ---------------------------------------------------------------------------
# Known false positives must stay below threshold
# ---------------------------------------------------------------------------


NEGATIVE_PAIRS = [
    ('i-walk-alone', 'i-walk-the-line'),
    ('good-hearted-woman', 'good-hearted-man'),
]


class TestKnownFalsePositives:
    @pytest.mark.parametrize('left,right', NEGATIVE_PAIRS)
    def test_pair_stays_below_the_match_threshold(self, chart_of, left, right):
        a, b = chart_of(left, work_id=left), chart_of(right, work_id=right)
        assert containment(a.words, b.words) < CONTAINMENT_MATCH

    @pytest.mark.parametrize('left,right', NEGATIVE_PAIRS)
    def test_pair_is_no_match_in_both_directions(self, chart_of, left, right):
        a, b = chart_of(left, work_id=left), chart_of(right, work_id=right)
        for incoming, existing in ((a, b), (b, a)):
            verdict = score_pair(incoming, existing)
            assert verdict.outcome == Outcome.NO_MATCH
            assert verdict.matched_work_id is None
            assert verdict.auto_actionable is False

    @pytest.mark.parametrize('left,right', NEGATIVE_PAIRS)
    def test_titles_alone_would_have_flagged_them(self, chart_of, left, right):
        """Shows why title cannot decide: these titles are close. Lyrics are
        the only thing keeping the pairs apart."""
        a, b = chart_of(left), chart_of(right)
        assert title_similarity(a.title, b.title) > 0.6


# ---------------------------------------------------------------------------
# Duplicates and arrangements
# ---------------------------------------------------------------------------


class TestOutcomeClassification:
    def test_identical_text_is_a_duplicate(self, chart_of):
        chart = chart_of('i-walk-the-line', work_id='i-walk-the-line')
        verdict = score_pair(chart, chart)
        assert verdict.score == 1.0
        assert verdict.outcome == Outcome.DUPLICATE
        assert verdict.matched_work_id == 'i-walk-the-line'
        assert verdict.auto_actionable is False

    def test_same_song_different_chart_is_an_arrangement_candidate(self, chart_of):
        """Both sides have chords and high (but not identical) overlap."""
        existing = chart_of('how-long-blues-1', work_id='how-long-blues-1')
        incoming = Chart(
            title='How Long Blues',
            words=existing.words | {'darlin', 'weepin', 'yonder', 'railroad', 'whistle',
                                    'mornin', 'sorrow', 'midnight', 'station', 'waitin'},
            chords=True,
            work_id='incoming',
        )
        verdict = score_pair(incoming, existing)
        assert verdict.score == 1.0  # existing is fully contained
        assert verdict.details['size_ratio'] < 0.8
        assert verdict.outcome == Outcome.ARRANGEMENT_CANDIDATE
        assert verdict.auto_actionable is False

    def test_thin_lyrics_are_flagged_and_never_auto_actionable(self):
        words = frozenset(f'word{i}' for i in range(MIN_LYRIC_WORDS + 2))
        incoming = Chart(title='Stub Song', words=words, chords=True, work_id='b')
        existing = Chart(title='Stub Song', words=words, chords=False, work_id='a')
        verdict = score_pair(incoming, existing)
        assert verdict.outcome == Outcome.ENRICH
        assert verdict.score >= CONTAINMENT_DUPLICATE
        assert Warning_.THIN_LYRICS in verdict.warnings
        assert verdict.auto_actionable is False


# ---------------------------------------------------------------------------
# The instrumental gap: no lyrics means no silent fallback to title
# ---------------------------------------------------------------------------


class TestInstrumentals:
    def test_same_title_instrumentals_are_low_confidence_not_a_score(self, chart_of):
        a = chart_of('blackberry-blossom-abc', work_id='blackberry-blossom')
        b = chart_of('blackberry-blossom-chords', work_id='blackberry-blossom-1')
        verdict = score_pair(incoming=b, existing=a)

        assert verdict.low_confidence is True
        assert verdict.auto_actionable is False
        assert verdict.score == 0.0  # lyrics did not decide anything
        assert verdict.details['lyrics_decided'] is False
        assert Warning_.NO_LYRICS in verdict.warnings
        assert Warning_.TITLE_ONLY in verdict.warnings
        # A near-identical title is enough to *surface* it, never to auto-act.
        assert verdict.outcome == Outcome.ARRANGEMENT_CANDIDATE
        assert verdict.matched_work_id == 'blackberry-blossom'

    def test_different_title_instrumentals_do_not_match(self, chart_of):
        a = chart_of('blackberry-blossom-abc', work_id='blackberry-blossom')
        b = Chart(title="Soldier's Joy", words=frozenset(), chords=True, work_id='sj')
        verdict = score_pair(incoming=b, existing=a)
        assert verdict.outcome == Outcome.NO_MATCH
        assert verdict.matched_work_id is None
        assert verdict.low_confidence is True
        assert Warning_.NO_LYRICS in verdict.warnings

    def test_instrumental_against_a_song_flags_the_one_sided_gap(self, chart_of):
        song = chart_of('how-long-blues', work_id='how-long-blues')
        tab = Chart(title='How Long Blues', words=frozenset(), chords=True, work_id='tab')
        verdict = score_pair(incoming=tab, existing=song)
        assert verdict.low_confidence is True
        assert Warning_.NO_LYRICS_ONE_SIDE in verdict.warnings
        assert verdict.auto_actionable is False


# ---------------------------------------------------------------------------
# Candidate narrowing over a corpus
# ---------------------------------------------------------------------------


def _write_work(root, work_id, title, chart_text=None):
    work_dir = root / work_id
    work_dir.mkdir(parents=True)
    parts = ''
    if chart_text is not None:
        (work_dir / 'lead-sheet.pro').write_text(chart_text, encoding='utf-8')
        parts = (
            'parts:\n'
            '  - type: lead-sheet\n'
            '    format: chordpro\n'
            '    file: lead-sheet.pro\n'
            '    default: true\n'
        )
    (work_dir / 'work.yaml').write_text(
        f'id: {work_id}\ntitle: {title!r}\n{parts}', encoding='utf-8'
    )
    return work_dir


@pytest.fixture
def mini_corpus(tmp_path, dedup_fixtures):
    """A works/ tree: the two #208 charts, the false-positive pairs, and 300
    filler works so narrowing has something to narrow."""
    root = tmp_path / 'works'
    root.mkdir()
    for work_id, title in [
        ('how-long-blues', 'How Long Blues'),
        ('i-walk-alone', 'I Walk Alone'),
        ('i-walk-the-line', 'I Walk The Line'),
        ('good-hearted-woman', 'Good Hearted Woman'),
        ('good-hearted-man', 'Good Hearted Man'),
    ]:
        _write_work(
            root, work_id, title,
            (dedup_fixtures / f'{work_id}.pro').read_text(encoding='utf-8'),
        )
    for i in range(300):
        _write_work(root, f'filler-{i}', f'Filler Song Number {i}',
                    '{start_of_verse}\nfiller lyric line number %d\n{end_of_verse}\n' % i)
    return root


class TestWorkCorpus:
    def test_title_index_reads_every_work(self, mini_corpus):
        corpus = WorkCorpus(mini_corpus)
        assert len(corpus.titles) == 305
        assert corpus.titles['how-long-blues'] == 'How Long Blues'

    def test_candidates_narrow_by_title(self, mini_corpus):
        corpus = WorkCorpus(mini_corpus)
        ids = [work_id for work_id, _ in corpus.candidates('How Long Blues')]
        assert ids == ['how-long-blues']

    def test_candidates_can_exclude_self(self, mini_corpus):
        corpus = WorkCorpus(mini_corpus)
        assert corpus.candidates('How Long Blues', exclude={'how-long-blues'}) == []

    def test_best_match_finds_the_enrichment(self, mini_corpus, chart_of):
        corpus = WorkCorpus(mini_corpus)
        incoming = chart_of('how-long-blues-1')
        verdict = corpus.best_match(incoming)
        assert verdict.matched_work_id == 'how-long-blues'
        assert verdict.outcome == Outcome.ENRICH
        assert verdict.auto_actionable is True

    def test_best_match_returns_no_match_for_an_unknown_song(self, mini_corpus):
        corpus = WorkCorpus(mini_corpus)
        incoming = Chart(
            title='A Song Nobody Has Written',
            words=lyric_words('a song nobody has written about anything at all here now'),
            chords=True,
        )
        assert corpus.best_match(incoming).outcome == Outcome.NO_MATCH

    def test_false_positive_titles_are_scored_but_rejected(self, mini_corpus, chart_of):
        corpus = WorkCorpus(mini_corpus)
        incoming = chart_of('good-hearted-man')
        # The sibling title survives narrowing...
        assert 'good-hearted-woman' in dict(corpus.candidates(incoming.title))
        # ...and lyrics throw it out.
        assert corpus.best_match(
            incoming, exclude={'good-hearted-man'}
        ).outcome == Outcome.NO_MATCH

    def test_only_narrowed_candidates_have_their_lyrics_read(
        self, mini_corpus, chart_of, monkeypatch
    ):
        """The whole corpus must never be loaded to score one submission."""
        import dedup_scorer

        loaded = []
        original = dedup_scorer.Chart.from_work_dir

        def counting(work_dir):
            loaded.append(str(work_dir))
            return original(work_dir)

        monkeypatch.setattr(dedup_scorer.Chart, 'from_work_dir', staticmethod(counting))

        corpus = WorkCorpus(mini_corpus)
        corpus.best_match(chart_of('how-long-blues-1'))
        assert len(loaded) <= 5, loaded

    def test_charts_are_memoized(self, mini_corpus):
        corpus = WorkCorpus(mini_corpus)
        assert corpus.chart('how-long-blues') is corpus.chart('how-long-blues')

    def test_missing_work_id_returns_none(self, mini_corpus):
        assert WorkCorpus(mini_corpus).chart('nope') is None

    def test_missing_works_dir_is_empty_not_an_error(self, tmp_path):
        assert WorkCorpus(tmp_path / 'absent').titles == {}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


class TestCli:
    def test_compares_two_files_as_json(self, dedup_fixtures, capsys):
        import json

        exit_code = main([
            str(dedup_fixtures / 'how-long-blues-1.pro'),
            str(dedup_fixtures / 'how-long-blues.pro'),
            '--json',
        ])
        assert exit_code == 0
        payload = json.loads(capsys.readouterr().out)
        assert payload['outcome'] == Outcome.ENRICH
        assert payload['score'] >= CONTAINMENT_MATCH

    def test_compares_two_work_ids(self, mini_corpus, capsys):
        assert main(['i-walk-alone', 'i-walk-the-line',
                     '--works-dir', str(mini_corpus)]) == 0
        assert Outcome.NO_MATCH in capsys.readouterr().out

    def test_scan_against_a_corpus(self, mini_corpus, dedup_fixtures, capsys):
        assert main(['--scan', str(dedup_fixtures / 'how-long-blues-1.pro'),
                     '--works-dir', str(mini_corpus)]) == 0
        out = capsys.readouterr().out
        assert Outcome.ENRICH in out
        assert 'how-long-blues' in out

    def test_unknown_ref_is_an_error(self, mini_corpus):
        with pytest.raises(SystemExit):
            main(['nope', 'also-nope', '--works-dir', str(mini_corpus)])
