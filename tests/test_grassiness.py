"""Tests for grassiness score formatting (scripts/lib/tagging/grassiness.py).

`compute_grassiness` returns its artists as `(name, earliest_year)` tuples.
Both CLI paths used to `', '.join()` that list, so `--test` and `--lookup`
raised `TypeError: sequence item 0: expected str instance, tuple found` the
moment a title matched anything. These tests pin the rendering, including
the sentinel year that must never be printed as a date.
"""

from tagging.grassiness import (
    TIER_WEIGHTS,
    UNKNOWN_YEAR,
    compute_grassiness,
    format_artists,
)


class TestFormatArtists:

    def test_tuples_render_name_and_year(self):
        assert format_artists([('Bill Monroe', 1947), ('Tony Rice', 1975)]) \
            == 'Bill Monroe (1947), Tony Rice (1975)'

    def test_unknown_year_prints_no_year(self):
        assert format_artists([('Alison Krauss', UNKNOWN_YEAR)]) \
            == 'Alison Krauss'

    def test_empty_is_a_dash(self):
        assert format_artists([]) == '-'
        assert format_artists(None) == '-'

    def test_limit_adds_an_overflow_count(self):
        artists = [(f'Artist {i}', 1960 + i) for i in range(5)]
        assert format_artists(artists, limit=3) == (
            'Artist 0 (1960), Artist 1 (1961), Artist 2 (1962) +2')

    def test_limit_without_overflow_has_no_suffix(self):
        assert format_artists([('Doc Watson', 1961)], limit=3) \
            == 'Doc Watson (1961)'

    def test_cache_shapes_the_scores_file_has_held(self):
        # dicts (current grassiness_scores.json) and bare names (pre-year)
        assert format_artists([{'name': 'Del McCoury', 'year': 1967}]) \
            == 'Del McCoury (1967)'
        assert format_artists([{'name': 'Del McCoury'}]) == 'Del McCoury'
        assert format_artists(['Jimmy Martin']) == 'Jimmy Martin'


class TestComputeGrassinessOutputIsPrintable:
    """The regression itself: what the scorer returns must survive the
    formatter the CLI hands it to."""

    CACHE = {'blue moon of kentucky': [('Bill Monroe', 5, 1947)]}

    def test_scorer_returns_tuples(self):
        artist_score, artists, tag_score = compute_grassiness(
            'Blue Moon of Kentucky', self.CACHE, {'blue moon of kentucky': 4})
        assert artists == [('Bill Monroe', 1947)]
        # Tier 1 weight, capped at 3 recordings: 4 * 3.
        assert artist_score == TIER_WEIGHTS[1] * 3
        assert tag_score == 4

    def test_formatting_the_scorer_output_does_not_raise(self):
        _, artists, _ = compute_grassiness('Blue Moon of Kentucky', self.CACHE)
        assert format_artists(artists, limit=3) == 'Bill Monroe (1947)'

    def test_no_match_formats_as_a_dash(self):
        _, artists, _ = compute_grassiness('Not A Song', self.CACHE)
        assert format_artists(artists) == '-'


class TestTierWeights:
    """The module docstring claimed "Tier 1 (weight 3)"; the table says 4.
    The table is the code, so the docstring was the wrong one."""

    def test_tier_one_is_four(self):
        assert TIER_WEIGHTS == {1: 4, 2: 2, 3: 1}
