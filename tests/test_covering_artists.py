"""tag_enrichment.merge_covering_artists: a song's "Recorded by" list (F9) —
grassiness covering artists plus a MusicBrainz-confirmed scraped artist,
ordered by first recording year, with parallel years for display."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts" / "lib"))

from tag_enrichment import UNKNOWN_YEAR, merge_covering_artists, unchecked_artist_count  # noqa: E402


def by_year(e):
    return (e.get("year") or UNKNOWN_YEAR, e["name"].lower())


SUNSHINE = [{"name": "Mac Wiseman", "year": 2008}, {"name": "Richard Greene", "year": 1979},
            {"name": "Tom Adams", "year": UNKNOWN_YEAR}]


def test_orders_by_first_recording_and_keeps_years_parallel():
    names, years = merge_covering_artists(SUNSHINE, None, "Johnny Cash", by_year)
    assert names == ["Richard Greene", "Mac Wiseman", "Tom Adams"]
    assert years == [1979, 2008, None]          # the 9999 sentinel is not a year


def test_adds_the_confirmed_scraped_artist_in_year_order():
    names, years = merge_covering_artists(
        SUNSHINE, {"artist": "Johnny Cash", "name": "Johnny Cash", "year": 1970}, "Johnny Cash", by_year)
    assert names == ["Johnny Cash", "Richard Greene", "Mac Wiseman", "Tom Adams"]
    assert years == [1970, 1979, 2008, None]


def test_ignores_a_confirmation_for_an_artist_the_work_no_longer_has():
    names, _ = merge_covering_artists(
        SUNSHINE, {"artist": "Johnny Cash", "name": "Johnny Cash", "year": 1970}, "Someone Else", by_year)
    assert "Johnny Cash" not in names


def test_unconfirmed_scraped_artist_never_appears():
    names, years = merge_covering_artists([], None, "Johnny Cash", by_year)
    assert (names, years) == ([], [])


def test_a_name_from_two_sources_appears_once_with_the_earlier_year():
    names, years = merge_covering_artists(
        [{"name": "Mac Wiseman", "year": 2008}, {"name": "Mac Wiseman", "year": 1999}],
        {"artist": "mac wiseman", "name": "mac wiseman", "year": 1960}, "Mac Wiseman", by_year)
    assert (names, years) == (["Mac Wiseman"], [1960])


def test_shows_the_credit_musicbrainz_gives_not_the_scraped_name():
    names, years = merge_covering_artists(
        [], {"artist": "Doyle Lawson", "name": "Doyle Lawson & Quicksilver", "year": 1983},
        "Doyle Lawson", by_year)
    assert (names, years) == (["Doyle Lawson & Quicksilver"], [1983])


def test_an_unconfirmed_entry_adds_nothing():
    names, _ = merge_covering_artists([], {"artist": "Misc Children", "name": None}, "Misc Children", by_year)
    assert names == []


def test_counts_works_never_checked_or_checked_under_another_artist():
    songs = [{"id": "a", "artist": "X"}, {"id": "b", "artist": "Y"}, {"id": "c", "artist": "Z"},
             {"id": "d", "artist": "Traditional"}, {"id": "e"}]
    verified = {"a": {"artist": "X", "name": None}, "b": {"artist": "Old Artist", "name": "Old Artist"}}
    assert unchecked_artist_count(songs, verified) == 2     # b changed, c never checked


def test_accepts_old_string_format():
    names, years = merge_covering_artists(["Bill Monroe"], None, "", by_year)
    assert (names, years) == (["Bill Monroe"], [None])
