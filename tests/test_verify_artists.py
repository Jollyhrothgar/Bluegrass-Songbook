"""verify_artists: a work's scraped `artist` earns a "Recorded by" credit only
when MusicBrainz has a recording of the same title credited to that artist —
under any spelling, as a member of a duo, or through a band (F9). The credit
shown is the name MusicBrainz credits. The database half is exercised by
running the script; this pins the matching rules."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts" / "lib"))

from tagging.verify_artists import confirm, name_parts, name_variants, title_key  # noqa: E402

CASH, DYLAN_CASH, LAWSON, QUICKSILVER = 1, 2, 3, 4
RECORDINGS = {
    CASH: [(10, "You Are My Sunshine (live)", "Johnny Cash"),
           (11, "You Are My Sunshine", "Johnny Cash"),
           (12, "Folsom Prison Blues", "Johnny Cash")],
    DYLAN_CASH: [(20, "You Are My Sunshine", "Bob Dylan & Johnny Cash")],
    QUICKSILVER: [(30, "Beautiful Altar of Prayer", "Doyle Lawson & Quicksilver")],
}


def test_confirms_and_credits_the_earliest_dated_recording():
    works = [("sunshine", "You Are My Sunshine", "Johnny Cash")]
    out = confirm(works, {"Johnny Cash": {CASH, DYLAN_CASH}}, RECORDINGS, {10: 1975, 11: 1980, 20: 1969})
    assert out["sunshine"] == {"artist": "Johnny Cash", "name": "Bob Dylan & Johnny Cash", "year": 1969}


def test_band_credit_is_shown_under_the_bands_name():
    works = [("altar", "Beautiful Altar Of Prayer", "Doyle Lawson")]
    out = confirm(works, {"Doyle Lawson": {LAWSON, QUICKSILVER}}, RECORDINGS, {30: 1983})
    assert out["altar"] == {"artist": "Doyle Lawson", "name": "Doyle Lawson & Quicksilver", "year": 1983}


def test_unconfirmed_works_are_recorded_as_checked():
    works = [("shark", "Baby Shark", "Misc Children"), ("ring", "Ring of Fire", "Johnny Cash")]
    out = confirm(works, {"Johnny Cash": {CASH}}, RECORDINGS, {})
    assert out["shark"] == {"artist": "Misc Children", "name": None}
    assert out["ring"] == {"artist": "Johnny Cash", "name": None}   # artist known, title never recorded


def test_year_is_none_when_no_release_is_dated():
    works = [("sunshine", "You Are My Sunshine", "Johnny Cash")]
    out = confirm(works, {"Johnny Cash": {CASH}}, RECORDINGS, {})
    assert out["sunshine"]["year"] is None


def test_name_variants_cover_and_ampersand_and_the():
    assert name_variants("Stanley Brothers") >= {"stanley brothers", "the stanley brothers"}
    assert name_variants("Flatt and Scruggs") >= {"flatt and scruggs", "flatt & scruggs"}


def test_name_parts_split_duos_and_lists_only():
    assert name_parts("Earl Scruggs and Lester Flatt") == {"earl scruggs", "lester flatt"}
    assert name_parts("Ned Luberecki / Becky Buller") == {"ned luberecki", "becky buller"}
    assert name_parts("Bobby Osborne, Pete Goble") == {"bobby osborne", "pete goble"}
    assert name_parts("Ricky Skaggs") == set()


def test_title_key_restores_a_dropped_g_but_stays_exact_otherwise():
    assert title_key("Blowin' In The Wind") == title_key("Blowing In The Wind")
    assert title_key("Ramblin’ Man") == title_key("Rambling Man")
    assert title_key("Little Cabin Home") != title_key("Little Cabing Home")
    assert title_key("As Long As I Love You") != title_key("As Long As I Live")
