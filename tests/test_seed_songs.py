"""The `song:` seed (scripts/lib/seed_songs.py).

What it must never do is claim more than the data shows: group two works as
one song without lyric evidence, name a version after the scraped artist, or
give a song a URL whose `-N` suffix suggests a sibling song that isn't there.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

import seed_songs  # noqa: E402
from seed_songs import propose, root_key, song_slugs, version_slugs, writer_surnames  # noqa: E402

VERSE = "my latest sun is sinking fast my race is nearly run my strongest trials now are past"
OTHER = "how many times have you heard someone say if i had his money i could do things my way"


@pytest.fixture
def lyrics(monkeypatch):
    """Lyrics by work id, instead of reading docs/data/songs/*.pro."""
    table = {}
    monkeypatch.setattr(seed_songs, "lyrics",
                        lambda row: frozenset(table.get(str(row["id"]), "").split()))
    return table


def chart(id_, title, group="g1", **kw):
    return {"id": id_, "title": title, "group_id": group, "has_content": True, **kw}


def tab(id_, title, instrument="banjo", group=None, **kw):
    return {"id": id_, "title": title, "group_id": group,
            "tablature_parts": [{"instrument": instrument}], **kw}


def test_same_lyrics_make_versions(lyrics):
    lyrics.update({"angel-band": VERSE, "angel-band-1": VERSE})
    songs, skipped = propose([chart("angel-band", "Angel Band"),
                              chart("angel-band-1", "Angel Band")])
    assert {k: [v["id"] for v in vs] for k, vs in songs.items()} == {"angel-band": ["angel-band-1"]}
    assert skipped == []


def test_shared_title_alone_is_not_evidence(lyrics):
    # The build's fuzzy pass groups on title only; the lyrics say two songs.
    lyrics.update({"satisfied": VERSE, "satisfied-1": OTHER})
    songs, skipped = propose([chart("satisfied", "Satisfied"), chart("satisfied-1", "Satisfied")])
    assert songs == {}
    assert skipped == [("lyrics differ", ["satisfied", "satisfied-1"])]


def test_writers_that_share_no_surname_stay_apart(lyrics):
    lyrics.update({"a": VERSE, "b": VERSE})
    songs, skipped = propose([chart("a", "X", composer="Jimmie Davis and Eva Sargent"),
                              chart("b", "X", composer="Tom Darby, Jimmie Tarlton")])
    assert songs == {} and skipped[0][0] == "writers disagree"


def test_writer_spelling_variants_agree():
    assert writer_surnames({"composer": "Stuart K. Hine"}) == writer_surnames({"composer": "Stuart Hine"})
    assert writer_surnames({"composer": "Jimmy Newman, J.D. Miller"}) & \
        writer_surnames({"composer": "Jimmy D. Miller and Jimmy Newman"})
    assert writer_surnames({"composer": "Traditional"}) == frozenset()


def test_a_tab_joins_its_chart_and_never_heads_the_song(lyrics):
    rows = [chart("angeline-the-baker", "Angeline the Baker", group="g"),
            tab("angeline-baker", "Angeline Baker", group="g")]
    songs, _ = propose(rows)
    assert list(songs) == ["angeline-the-baker"]
    assert version_slugs("angeline-the-baker", songs["angeline-the-baker"]) == {"angeline-baker": "banjo-tab"}


def test_curation_pin_wins_over_missing_evidence(lyrics):
    lyrics.update({"x": VERSE, "x-1": OTHER})
    songs, _ = propose([chart("x", "X", group="g1", canonical=True),
                        chart("x-1", "X", group="g2", variant_of="x")])
    assert [v["id"] for v in songs["x"]] == ["x-1"]


def test_root_prefers_plain_searchable_id():
    rows = [chart("a-satisfied-mind", "A Satisfied Mind"), chart("satisfied-mind-1", "Satisfied Mind")]
    assert min(rows, key=root_key)["id"] == "a-satisfied-mind"
    archived = [chart("cry", "Cry", indexed=False), chart("cry-1", "Cry")]
    assert min(archived, key=root_key)["id"] == "cry-1"


def test_versions_are_ordinals_never_artists():
    versions = [chart("angel-band-2", "Angel Band", artist="Emmylou Harris"),
                chart("angel-band-1", "Angel Band", artist="Johnny Cash"),
                tab("angel-band-banjo", "Angel Band"), tab("angel-band-banjo-2", "Angel Band")]
    assert version_slugs("angel-band", versions) == {
        "angel-band-1": "2", "angel-band-2": "3",
        "angel-band-banjo": "banjo-tab", "angel-band-banjo-2": "banjo-tab-2"}


def test_slug_replaces_only_misleading_ids():
    rows = [chart("2402", "I’ll Be Alright Tomorrow"),           # bare number
            chart("blue-moon-of-kentucky-1", "Blue Moon of Kentucky"),  # no sibling song
            chart("cry", "Cry"), chart("cry-1", "Cry"),          # real sibling: honest suffix
            chart("blue-yodel-4", "Blue Yodel #4")]              # number is the title's own
    assert song_slugs(rows, {}) == {"2402": "ill-be-alright-tomorrow",
                                    "blue-moon-of-kentucky-1": "blue-moon-of-kentucky"}


def test_a_merge_redirect_makes_one_song_and_keeps_both(lyrics):
    # angeline-the-baker was merged into angeline-baker, then re-imported with
    # nine tabs nobody could reach. Both stay; the plainer chart heads the song.
    rows = [chart("angeline-the-baker", "Angeline the Baker", group="g1"),
            tab("angeline-baker", "Angeline Baker", group="g2")]
    songs, _ = propose(rows, {"angeline-the-baker": "angeline-baker"})
    assert {k: [v["id"] for v in vs] for k, vs in songs.items()} == \
        {"angeline-the-baker": ["angeline-baker"]}


def test_redirect_violations(tmp_path):
    from works_writer import redirect_violations
    (tmp_path / "docs" / "data").mkdir(parents=True)
    for work in ("target", "back-again"):
        (tmp_path / "works" / work).mkdir(parents=True)
    redirects = {"gone": "target", "back-again": "target",
                 "chained": "gone", "dangling": "nowhere"}
    (tmp_path / "docs" / "data" / "redirects.json").write_text(json.dumps(redirects))
    problems = redirect_violations(tmp_path)
    assert any(p.startswith("back-again: merged away") for p in problems)
    assert any(p.startswith("chained:") and "itself redirected" in p for p in problems)
    assert any(p.startswith("dangling:") and "no works/ dir" in p for p in problems)
    assert not any(p.startswith("gone:") for p in problems)


def test_the_real_corpus_has_no_resurrected_redirects():
    from works_writer import redirect_violations
    assert redirect_violations(REPO_ROOT) == []
