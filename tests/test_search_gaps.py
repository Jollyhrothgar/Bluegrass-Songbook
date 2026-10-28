"""search-gaps: what visitors searched for and could not find.

The events are the ones docs/js/analytics.js already sends (`search`,
`search_result_click`, `song_not_found`); everything here is offline — no
network, a hand-built corpus standing in for docs/data/.
"""

from datetime import datetime, timedelta, timezone

import pytest

import search_gaps as sg

T0 = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def at(minutes):
    return (T0 + timedelta(minutes=minutes)).isoformat().replace('+00:00', 'Z')


def search(visitor, minutes, query, count, scope=None):
    props = {'query': query, 'result_count': count, 'has_results': count > 0}
    if scope:
        props['scope'] = scope
    return {'visitor_id': visitor, 'event_name': 'search',
            'properties': props, 'created_at': at(minutes)}


def click(visitor, minutes, song_id, query='', from_list=None):
    props = {'song_id': song_id, 'position': 0, 'query': query}
    if from_list is not None:
        props['from_list'] = from_list
    return {'visitor_id': visitor, 'event_name': 'search_result_click',
            'properties': props, 'created_at': at(minutes)}


def not_found(visitor, minutes, song_id, source='deep_link', referrer=None):
    return {'visitor_id': visitor, 'event_name': 'song_not_found',
            'properties': {'song_id': song_id, 'source': source,
                           'path': f'/songs/{song_id}/', 'suggestions': 0,
                           'referrer': referrer},
            'created_at': at(minutes)}


CANON = [
    {'id': 'bury-me-beneath-the-willow', 'title': 'Bury Me Beneath the Willow',
     'covering_artists': ['The Carter Family'], 'tags': ['Bluegrass']},
    {'id': 'stoney-lonesome', 'title': 'Stoney Lonesome', 'composer': 'Bill Monroe',
     'tags': ['Bluegrass', 'Instrumental']},
    {'id': 'tall-pines', 'title': 'Tall Pines', 'tags': ['Bluegrass']},
]
ARCHIVE = [
    {'id': 'sittin-in-an-all-nite-cafe', 'title': "Sittin' in an All Nite Cafe",
     'indexed': False},
    {'id': 'annabelle', 'title': 'Annabelle', 'indexed': False},
    {'id': 'no-deposit', 'title': 'No Deposit No Return', 'indexed': False,
     'lyrics': 'rosalind went walking down the road'},
    {'id': 'foggy-tune', 'title': 'A Foggy Tune', 'indexed': False,
     'covering_artists': ['Foghorn Stringband']},
]


@pytest.fixture
def corpus():
    return sg.Corpus(CANON, ARCHIVE)


# --------------------------------------------------------------------------
# Journeys
# --------------------------------------------------------------------------

class TestBuildJourneys:
    def test_a_long_pause_starts_a_new_journey(self):
        events = [search('v1', 0, 'salt spring', 0), search('v1', 45, 'tall pines', 1)]
        journeys = sg.build_journeys(events)
        assert [[s.query for s in j.searches] for j in journeys] == [
            ['salt spring'], ['tall pines']]

    def test_visitors_are_never_mixed(self):
        events = [search('v1', 0, 'salt spring', 0), search('v2', 1, 'tall pines', 1),
                  click('v2', 2, 'tall-pines')]
        journeys = sorted(sg.build_journeys(events), key=lambda j: j.visitor)
        assert [j.visitor for j in journeys] == ['v1', 'v2']
        assert journeys[0].clicks == []
        assert [c.song_id for c in journeys[1].clicks] == ['tall-pines']

    def test_events_are_ordered_by_time_whatever_order_they_arrive_in(self):
        events = [click('v1', 2, 'tall-pines'), search('v1', 1, 'tall pines', 1)]
        [journey] = sg.build_journeys(events)
        assert [s.kind for s in journey.steps] == ['search', 'click']

    def test_clicks_with_no_search_are_not_a_search_journey(self):
        # A click on a list row is logged as a result click too.
        assert sg.build_journeys([click('v1', 0, 'tall-pines')]) == []

    def test_a_click_in_a_list_view_is_not_finding_a_search_result(self):
        # List rows log result clicks too, with whatever is left in the box.
        [j] = sg.build_journeys([search('v1', 0, 'tag:oldtime', 380),
                                 click('v1', 5, 'hey-joe', 'tag:oldtime', from_list=True)])
        assert j.clicks == []

    def test_dungeon_mode_searches_are_exploring_not_failing(self):
        events = [search('v1', 0, 'cafe', 0, scope='dungeon')]
        assert sg.build_journeys(events) == []


class TestCollapseTyping:
    def test_keeps_only_the_end_of_a_typing_burst(self):
        events = [search('v1', 0, 'appalach', 0), search('v1', 0.5, 'appalachian', 0),
                  search('v1', 1, 'appalachian road show', 0)]
        [journey] = sg.build_journeys(events)
        assert [s.query for s in journey.searches] == ['appalachian road show']

    def test_a_half_typed_filter_is_part_of_the_burst(self):
        events = [search('v1', 0, 'salt spring ta', 0),
                  search('v1', 1, 'salt spring tag:instrumental', 0)]
        [journey] = sg.build_journeys(events)
        assert [s.query for s in journey.searches] == ['salt spring tag:instrumental']

    def test_backspacing_through_a_filter_is_part_of_the_burst(self):
        # A real sequence: the visitor swapped one tag for another.
        events = [search('v1', 0, 'Salt spring tag:JamFriendly', 0),
                  search('v1', 1, 'Salt spring ta', 0),
                  search('v1', 1.1, 'Salt spring ', 0),
                  search('v1', 1.4, 'Salt spring tag:Instrumental', 0)]
        [journey] = sg.build_journeys(events)
        assert [s.query for s in journey.searches] == [
            'Salt spring tag:JamFriendly', 'Salt spring tag:Instrumental']

    def test_shortening_by_whole_words_is_a_second_attempt(self):
        events = [search('v1', 0, 'blue moon of kentuky', 0),
                  search('v1', 1, 'blue moon', 4)]
        [journey] = sg.build_journeys(events)
        assert [s.query for s in journey.searches] == ['blue moon of kentuky', 'blue moon']

    def test_a_reworded_search_is_a_second_attempt(self):
        events = [search('v1', 0, 'burry me beneath the willow', 0),
                  search('v1', 1, 'bury me beneath', 1)]
        [journey] = sg.build_journeys(events)
        assert [s.query for s in journey.searches] == [
            'burry me beneath the willow', 'bury me beneath']

    def test_ignores_case_and_spacing(self):
        events = [search('v1', 0, 'Tall  ', 1), search('v1', 1, 'tall pines', 1)]
        [journey] = sg.build_journeys(events)
        assert [s.query for s in journey.searches] == ['tall pines']


class TestOutcome:
    def test_found(self):
        [j] = sg.build_journeys([search('v1', 0, 'tall pines', 1),
                                 click('v1', 1, 'tall-pines')])
        assert j.outcome == 'found'

    def test_recovered_after_a_miss(self):
        [j] = sg.build_journeys([search('v1', 0, 'burry me', 0),
                                 search('v1', 1, 'bury me', 1),
                                 click('v1', 2, 'bury-me-beneath-the-willow')])
        assert j.outcome == 'recovered'

    def test_gave_up_on_a_search_with_results(self):
        [j] = sg.build_journeys([search('v1', 0, 'willow', 3)])
        assert j.outcome == 'gave_up'

    def test_gave_up_after_nothing_was_found(self):
        [j] = sg.build_journeys([search('v1', 0, 'tag:gospel tag:waltz', 0)])
        assert j.outcome == 'gave_up'

    def test_browsing_a_tag_is_not_giving_up(self):
        [j] = sg.build_journeys([search('v1', 0, 'tag:bluegrassstandard', 175)])
        assert j.outcome == 'browsed'

    def test_browsing_an_artist_is_not_giving_up(self):
        [j] = sg.build_journeys([search('v1', 0, 'artist:alison krauss', 57)])
        assert j.outcome == 'browsed'


# --------------------------------------------------------------------------
# Misses
# --------------------------------------------------------------------------

class TestMisses:
    def test_every_zero_result_search_is_a_miss(self):
        journeys = sg.build_journeys([search('v1', 0, 'salt spring', 0),
                                      search('v1', 1, 'every humble knee', 0)])
        assert [m.query for m in sg.find_misses(journeys)] == [
            'salt spring', 'every humble knee']

    def test_a_miss_remembers_what_was_opened_next(self):
        journeys = sg.build_journeys([search('v1', 0, 'burry me', 0),
                                      search('v1', 1, 'bury me', 1),
                                      click('v1', 2, 'bury-me-beneath-the-willow')])
        [miss] = sg.find_misses(journeys)
        assert miss.then_opened == 'bury-me-beneath-the-willow'

    def test_giving_up_on_results_is_a_separate_weaker_signal(self):
        journeys = sg.build_journeys([search('v1', 0, 'willow', 3)])
        [miss] = sg.find_misses(journeys)
        assert (miss.query, miss.kind, miss.result_count) == ('willow', 'unopened', 3)

    def test_only_the_last_unopened_search_counts(self):
        journeys = sg.build_journeys([search('v1', 0, 'willow', 3),
                                      search('v1', 1, 'weeping willow', 2)])
        assert [m.query for m in sg.find_misses(journeys)] == ['weeping willow']

    def test_browsing_produces_no_miss(self):
        journeys = sg.build_journeys([search('v1', 0, 'tag:bluegrass', 784)])
        assert sg.find_misses(journeys) == []


# --------------------------------------------------------------------------
# Classification against the local corpus
# --------------------------------------------------------------------------

class TestClassify:
    def test_missing(self, corpus):
        assert corpus.classify('salt spring').category == 'missing'

    def test_in_the_dungeon(self, corpus):
        verdict = corpus.classify('all nite cafe')
        assert verdict.category == 'dungeon'
        assert verdict.ids == ['sittin-in-an-all-nite-cafe']

    def test_in_the_dungeon_under_another_spelling(self, corpus):
        verdict = corpus.classify('sitting in an all night cafe')
        assert (verdict.category, verdict.ids) == ('dungeon', ['sittin-in-an-all-nite-cafe'])

    def test_a_typo_of_a_song_we_have(self, corpus):
        verdict = corpus.classify('burry me beneath the willow')
        assert (verdict.category, verdict.ids) == ('misspelled', ['bury-me-beneath-the-willow'])

    def test_the_song_exists_but_not_with_those_filters(self, corpus):
        # The site said 0: there is no mandolin take. The song is here.
        verdict = corpus.classify('stoney lonesome tag:mandolin')
        assert (verdict.category, verdict.ids) == ('filtered', ['stoney-lonesome'])

    def test_an_artist_with_no_songs(self, corpus):
        assert corpus.classify('artist:ralph stanley').category == 'artist'

    def test_an_artist_whose_songs_are_in_the_dungeon(self, corpus):
        verdict = corpus.classify('artist:foghorn tag:bluegrass')
        assert (verdict.category, verdict.ids) == ('artist', ['foggy-tune'])

    def test_a_lyric_mention_in_the_dungeon_is_not_the_song(self, corpus):
        # "annabelle" once matched an archived song whose lyrics named her
        # and the report said to promote it. The song itself is missing.
        verdict = corpus.classify('rosalind')
        assert (verdict.category, verdict.ids) == ('missing', ['no-deposit'])

    def test_now_in_the_songbook(self, corpus):
        # The site found nothing then; the canon has it now.
        verdict = corpus.classify('tall pines')
        assert (verdict.category, verdict.ids) == ('resolved', ['tall-pines'])

    def test_a_filter_only_query_is_its_own_kind_of_miss(self, corpus):
        # A mistyped tag, or a combination nothing has: no song to add.
        assert corpus.classify('tag:bluegrassstandardbl').category == 'filters'
        assert corpus.classify('tag:gospel tag:waltz').category == 'filters'


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------

class FakeQuery:
    def __init__(self, rows, calls):
        self.rows, self.calls, self.lo, self.hi = rows, calls, 0, 0

    def select(self, *_a, **_k): return self
    def in_(self, *_a): return self
    def gte(self, *_a): return self
    def order(self, *_a, **_k): return self

    def range(self, lo, hi):
        self.lo, self.hi = lo, hi
        self.calls.append((lo, hi))
        return self

    def execute(self):
        return type('R', (), {'data': self.rows[self.lo:self.hi + 1]})()


class FakeClient:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def table(self, name):
        assert name == 'analytics_events'
        return FakeQuery(self.rows, self.calls)


class TestFetchEvents:
    def test_pages_until_a_short_page(self):
        client = FakeClient([{'n': i} for i in range(5)])
        rows = sg.fetch_events(client, '2026-10-01', page_size=2)
        assert len(rows) == 5
        assert client.calls == [(0, 1), (2, 3), (4, 5)]

    def test_a_full_last_page_costs_one_empty_request(self):
        client = FakeClient([{'n': i} for i in range(4)])
        assert len(sg.fetch_events(client, '2026-10-01', page_size=2)) == 4
        assert client.calls == [(0, 1), (2, 3), (4, 5)]


# --------------------------------------------------------------------------
# The report
# --------------------------------------------------------------------------

class TestReport:
    @pytest.fixture
    def text(self, corpus):
        events = [
            # two visitors miss the same tune, one with a filter on
            search('v1', 0, 'salt spring', 0),
            search('v2', 0, 'salt spring tag:instrumental', 0),
            search('v3', 0, 'all nite cafe', 0),
            search('v4', 0, 'burry me beneath the willow', 0),
            search('v4', 1, 'bury me', 1),
            click('v4', 2, 'bury-me-beneath-the-willow'),
            search('v5', 0, 'tag:bluegrass', 784),
            # opened an archived song from an "Include the dungeon" search
            search('v6', 0, 'annabelle', 1, scope='canon+dungeon'),
            click('v6', 1, 'annabelle'),
            search('v9', 0, 'tag:oldtime', 380),
            click('v9', 5, 'no-deposit', 'tag:oldtime', from_list=True),
            not_found('v7', 0, 'gone-song', referrer='https://www.google.com/'),
            not_found('v8', 0, 'gone-song'),
        ]
        return sg.render_report(events, corpus, since='2026-10-01', until='2026-10-28')

    def test_counts_visitors_not_searches(self, text):
        line = next(l for l in text.splitlines() if 'salt spring' in l)
        assert line.split()[0] == '2'

    def test_merges_one_tune_searched_with_and_without_filters(self, text):
        assert sum('salt spring' in l and 'add-placeholder' not in l
                   for l in text.splitlines()) == 1

    def test_suggests_adding_what_is_missing(self, text):
        assert './scripts/utility add-placeholder "Salt Spring"' in text

    def test_suggests_promoting_what_is_in_the_dungeon(self, text):
        assert ('./scripts/utility curate unprune sittin-in-an-all-nite-cafe '
                '--reason "searched for: all nite cafe"') in text

    def test_shows_what_a_misspeller_opened_next(self, text):
        assert 'then opened bury-me-beneath-the-willow' in text

    def test_counts_an_archived_song_opened_from_an_include_the_dungeon_search(self, text):
        section = text.split('IN THE DUNGEON')[1].split('\n\n')[0]
        line = next(l for l in section.splitlines() if l.split()[1:2] == ['annabelle'])
        assert 'opened by 1' in line
        assert './scripts/utility curate unprune annabelle' in section

    def test_ignores_an_archived_song_opened_from_a_list(self, text):
        assert 'no-deposit' not in text

    def test_lists_one_archived_song_once_however_it_was_searched_for(self, corpus):
        events = [search('v1', 0, 'all nite cafe', 0),
                  search('v2', 0, 'sitting in an all night cafe', 0)]
        text = sg.render_report(events, corpus, since='a', until='b')
        section = text.split('IN THE DUNGEON')[1]
        assert section.count('  sittin-in-an-all-nite-cafe  ') == 1
        assert '  2  sittin-in-an-all-nite-cafe' in section

    def test_capitalises_a_suggested_title_without_mangling_it(self, corpus):
        text = sg.render_report([search('v1', 0, '15th street blues', 0)], corpus,
                                since='a', until='b')
        assert 'add-placeholder "15th Street Blues"' in text

    def test_lists_song_pages_that_were_not_found(self, text):
        section = text.split('SONG PAGES NOT FOUND')[1]
        assert '2  gone-song' in section
        assert 'google.com' in section

    def test_summarises_outcomes(self, text):
        assert 'browsed 2' in text
        assert 'recovered 1' in text
