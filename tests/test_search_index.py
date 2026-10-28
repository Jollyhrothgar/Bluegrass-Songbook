"""search_index.py must match what the site matches.

search-gaps classifies real visitors' failed searches by re-running them here,
so a drift from docs/js/search-core.js turns into a wrong verdict ("now in the
songbook" for a song the site still cannot find). F9 (2026-10-26) moved the
site off the scraped `artist`: free text and `artist:` match covering artists
and writers, the things a result row shows.
"""

import search_index as si

CANON = [
    {'id': 'bury-me', 'title': 'Bury Me Beneath the Willow',
     'covering_artists': ['The Carter Family'], 'composer': 'A.P. Carter',
     'lyrics': 'my heart is sad and I am lonely'},
    {'id': 'scraped', 'title': 'Some Song', 'artist': 'Johnny Cash',
     'lyrics': 'nothing to see'},
]


def ids(rows):
    return [r['id'] for r in rows]


class TestF9Fields:
    def test_free_text_ignores_the_scraped_artist(self):
        assert si.search(CANON, 'johnny cash') == []

    def test_free_text_matches_a_covering_artist(self):
        assert ids(si.search(CANON, 'carter family')) == ['bury-me']

    def test_artist_filter_matches_a_covering_artist_or_a_writer(self):
        assert ids(si.search(CANON, 'artist:carter family')) == ['bury-me']
        assert ids(si.search(CANON, 'artist:a.p. carter')) == ['bury-me']

    def test_artist_filter_ignores_the_scraped_artist(self):
        assert si.search(CANON, 'artist:johnny cash') == []


class TestSearchParsed:
    def test_takes_an_already_parsed_query(self):
        parsed = si.parse_query('willow tag:Bluegrass')
        assert si.search_parsed(CANON, parsed) == si.search(CANON, 'willow tag:Bluegrass')

    def test_dropping_filters_from_a_parsed_query_loosens_it(self):
        parsed = si.parse_query('willow tag:Bluegrass')
        assert si.search_parsed(CANON, parsed) == []
        loose = {**parsed, 'tag_filters': []}
        assert ids(si.search_parsed(CANON, loose)) == ['bury-me']
