"""Static per-song pages + sitemap (G2).

Songs live at `/#work/{id}`, and Google treats everything after `#` as one
URL, so no song could be indexed. `build_song_pages` writes a page per
searchable song at `docs/songs/{id}/index.html` -- the app's own index.html
with the song's head tags and its chart pre-rendered in the song view -- and
regenerates `docs/sitemap.xml` from the same rows, on every index build. Curation is
therefore automatic: a song promoted into search gets a page at the next
deploy, a pruned or deleted one loses it.
"""

import json
import re
import shutil
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

from build_song_pages import (  # noqa: E402
    ORIGIN,
    STATIC_PAGES,
    build_song_pages,
    render_chart,
    render_page,
)

APP_TEMPLATE = REPO_ROOT / "docs" / "index.html"


def make_docs(tmp_path, rows, charts):
    data = tmp_path / "data"
    (data / "songs").mkdir(parents=True)
    shutil.copy(APP_TEMPLATE, tmp_path / "index.html")   # the real app is the template
    with open(data / "index.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    for name, text in charts.items():
        (data / "songs" / name).write_text(text)
    return tmp_path


BLUE_MOON = """{meta: title Blue Moon Of Kentucky}
{meta: artist Bill Monroe}

{start_of_verse: Verse 1}
[G]Blue moon of Kentucky keep on [C]shining
{end_of_verse}

{start_of_chorus}
I said [D]blue moon <of> & [G]more
{end_of_chorus}

{chorus}
{start_of_abc}
X:1
K:G
{end_of_abc}
"""

ROWS = [
    {"id": "blue-moon-of-kentucky", "title": "Blue Moon of Kentucky",
     "artist": "Bill Monroe", "composer": "Bill Monroe", "key": "G",
     "nashville": ["I", "IV", "V"], "first_line": "Blue moon of Kentucky keep on shining",
     "has_content": True},
    {"id": "salt-creek", "title": "Salt Creek", "artist": "Bill Monroe", "key": "A",
     "tablature_parts": [{"instrument": "banjo", "file": "data/tabs/salt-creek-banjo-1.otf.json"}]},
    {"id": "blue-moon-alt", "title": "Blue Moon of Kentucky", "artist": "Elvis Presley",
     "key": "A", "has_content": True, "variant_of": "blue-moon-of-kentucky"},
    {"id": "wanted-song", "title": "Wanted", "status": "placeholder"},
    {"id": "empty-row", "title": "Nothing Here"},
    {"id": 2393, "title": "Numeric Id", "has_content": True},
]
CHARTS = {
    "blue-moon-of-kentucky.pro": BLUE_MOON,
    "blue-moon-alt.pro": "[A]Blue moon\n",
    "2393.pro": "[C]Hello\n",
}


def sitemap_locs(docs):
    xml = (docs / "sitemap.xml").read_text()
    return [m for m in re.findall(r"<loc>([^<]+)</loc>", xml)]


def test_one_page_per_song_with_content(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    pages = sorted(p.parent.name for p in (docs / "songs").glob("*/index.html"))
    assert pages == ["2393", "blue-moon-alt", "blue-moon-of-kentucky", "salt-creek"]


def test_page_is_indexable_and_links_into_the_app(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    html = (docs / "songs" / "blue-moon-of-kentucky" / "index.html").read_text()
    assert "<title>Blue Moon of Kentucky chords and lyrics | Bluegrass Book</title>" in html
    assert f'<link rel="canonical" href="{ORIGIN}songs/blue-moon-of-kentucky/">' in html
    assert '<meta name="description" content="' in html
    assert 'href="/#work/blue-moon-of-kentucky"' in html
    assert "noindex" not in html
    # No redirect: a crawler and a reader see the same page.
    assert "location.replace" not in html and 'http-equiv="refresh"' not in html
    assert "Key of G" in html and "I IV V" in html
    assert '"@type": "MusicComposition"' in html


def prerendered(docs, work_id):
    """The song's own pre-rendered chart, without the app template around it."""
    html = (docs / "songs" / work_id / "index.html").read_text()
    return html.split('<article class="prerender">', 1)[1].split("</article>", 1)[0]


def test_chart_is_chords_over_lyrics_and_escaped(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    html = prerendered(docs, "blue-moon-of-kentucky")
    assert "<h2>Verse 1</h2>" in html
    assert "<h2>Chorus</h2>" in html
    assert "Blue moon of Kentucky keep on shining" in html
    assert "I said blue moon &lt;of&gt; &amp; more" in html
    assert "X:1" not in html           # ABC notation stays in the app
    assert "{meta" not in html and "{chorus}" not in html


def test_render_chart_aligns_chords_above_their_syllable():
    out = render_chart("[G]Blue moon of Kentucky keep on [C]shining\n")
    chord_line, lyric_line = re.findall(r'<span class="ch">(.*?)</span>\n([^\n<]*)', out)[0]
    assert lyric_line == "Blue moon of Kentucky keep on shining"
    assert chord_line.index("G") == 0
    assert chord_line.index("C") == lyric_line.index("shining")


def test_render_chart_never_collides_adjacent_chords():
    out = render_chart("[G][C]Hi\n")
    chord_line = re.findall(r'<span class="ch">(.*?)</span>', out)[0]
    assert chord_line.split() == ["G", "C"]


def test_traditional_is_not_written_by(tmp_path):
    rows = [{"id": "trad", "title": "Trad", "artist": "Someone", "composer": "Traditional",
             "has_content": True}]
    docs = make_docs(tmp_path, rows, {"trad.pro": "[G]Hi\n"})
    build_song_pages(docs)
    html = (docs / "songs" / "trad" / "index.html").read_text()
    assert '<p class="by">Traditional</p>' in html
    assert "Written by Traditional" not in html


def page_parts(html):
    """(head, main, footer) of a rendered page: the head, the pre-rendered
    chart, and the credits that close it ("Recorded by" + copyright line)."""
    head = html.split("</head>")[0]
    article = html.split('<article class="prerender">')[1].split("</article>")[0]
    cut = min(i for i in (article.find('<div class="artists">'),
                          article.find('<p class="rights">')) if i >= 0)
    return head, article[:cut], article[cut:]


# F9: `artist` is whichever performer page a chart was scraped from, not whose
# version it is, so a page never shows it. The writer is the credit up top;
# the footer's "Recorded by" names covering_artists (MusicBrainz) with years.
SUNSHINE = {"id": "you-are-my-sunshine", "title": "You Are My Sunshine",
            "artist": "Johnny Cash", "composer": "Jimmie Davis, Charles Mitchell",
            "covering_artists": ["Richard Greene", "Mac Wiseman", "mac wiseman"],
            "covering_years": [1979, 2008, 2008],
            "key": "G", "first_line": "The other night dear as I lay sleeping",
            "has_content": True}


def render_one(tmp_path, row):
    docs = make_docs(tmp_path, [row], {f"{row['id']}.pro": "[G]Hi\n"})
    build_song_pages(docs)
    return (docs / "songs" / row["id"] / "index.html").read_text()


def test_scraped_artist_is_never_shown(tmp_path):
    html = render_one(tmp_path, SUNSHINE)
    head, main, _ = page_parts(html)
    assert "<title>You Are My Sunshine chords and lyrics | Bluegrass Book</title>" in head
    assert "played by" not in head
    assert "Johnny Cash" not in html          # not in head, body or footer
    assert '<p class="by">Written by Jimmie Davis, Charles Mitchell</p>' in main


def test_description_credits_the_writer(tmp_path):
    head, _, _ = page_parts(render_one(tmp_path, SUNSHINE))
    desc = re.search(r'<meta name="description" content="([^"]*)"', head).group(1)
    assert desc.startswith("You Are My Sunshine chords and lyrics. "
                           "Written by Jimmie Davis, Charles Mitchell. Key of G.")


def test_footer_credits_recorders_with_years_once_each(tmp_path):
    _, _, footer = page_parts(render_one(tmp_path, SUNSHINE))
    assert footer.count("Mac Wiseman") == 1
    text = re.sub(r"<[^>]+>", "", footer)
    assert "Recorded by: Richard Greene (1979), Mac Wiseman (2008)" in text


def test_each_recorder_links_to_a_youtube_search_for_that_recording(tmp_path):
    _, _, footer = page_parts(render_one(tmp_path, SUNSHINE))
    assert ('<a href="https://www.youtube.com/results?search_query='
            'You+Are+My+Sunshine+Richard+Greene+1979" rel="nofollow noopener" '
            'target="_blank">Richard Greene (1979)</a>') in footer


def test_recorder_without_a_year_has_no_parentheses(tmp_path):
    row = {**SUNSHINE, "covering_artists": ["Tom Adams"], "covering_years": [None]}
    _, _, footer = page_parts(render_one(tmp_path, row))
    assert ">Tom Adams</a>" in footer
    assert "search_query=You+Are+My+Sunshine+Tom+Adams\"" in footer


def test_scraped_artist_alone_gets_no_footer(tmp_path):
    row = {"id": "solo", "title": "Solo", "artist": "Richard Thompson", "has_content": True}
    html = render_one(tmp_path, row)
    assert 'class="artists"' not in html
    assert "Richard Thompson" not in html


def test_footer_list_expands_for_famous_songs(tmp_path):
    row = {**SUNSHINE, "artist": "Scraped Singer",
           "covering_artists": [f"Band {i}" for i in range(1, 13)],
           "covering_years": list(range(1950, 1962))}
    _, _, footer = page_parts(render_one(tmp_path, row))
    visible = footer.split("<details>")[0]
    assert ">Band 5 (1954)</a>" in visible and "Band 6" not in visible
    assert "<details><summary> and 7 more</summary>, " in footer
    assert ">Band 12 (1961)</a></details>" in footer
    assert "Scraped Singer" not in footer


def test_traditional_is_a_writer_never_an_artist(tmp_path):
    row = {"id": "trad", "title": "Trad", "artist": "Traditional",
           "covering_artists": ["Ralph Stanley"], "has_content": True}
    head, main, footer = page_parts(render_one(tmp_path, row))
    assert '<p class="by">Traditional</p>' in main
    assert "Trad chords and lyrics. Traditional song." in head
    assert ">Ralph Stanley</a></div>" in footer
    # No Person called "Traditional" in the structured data.
    assert '"composer"' not in head


def test_no_writer_and_no_artists_says_nothing(tmp_path):
    row = {"id": "bare", "title": "Bare", "has_content": True}
    _, main, footer = page_parts(render_one(tmp_path, row))
    assert 'class="by"' not in main
    assert 'class="artists"' not in footer


def test_tab_only_work_gets_a_page_naming_its_instruments(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    html = (docs / "songs" / "salt-creek" / "index.html").read_text()
    assert "Banjo tab" in html
    assert 'href="/#work/salt-creek"' in html


def test_variant_points_canonical_at_its_main_version(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    html = (docs / "songs" / "blue-moon-alt" / "index.html").read_text()
    assert f'<link rel="canonical" href="{ORIGIN}songs/blue-moon-of-kentucky/">' in html


def test_sitemap_lists_static_pages_and_main_versions_only(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    locs = sitemap_locs(docs)
    assert locs[: len(STATIC_PAGES)] == [ORIGIN + p for p in STATIC_PAGES]
    assert f"{ORIGIN}songs/blue-moon-of-kentucky/" in locs
    assert f"{ORIGIN}songs/salt-creek/" in locs
    assert f"{ORIGIN}songs/2393/" in locs
    assert f"{ORIGIN}songs/blue-moon-alt/" not in locs
    assert not any("wanted-song" in u or "empty-row" in u for u in locs)
    assert len(locs) == len(set(locs))
    assert all("#" not in u for u in locs)


def test_rebuild_prunes_songs_that_left_the_index(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    # salt-creek is pruned from search; a stray non-generated file is left alone
    (docs / "songs" / "README.txt").write_text("keep me")
    rows = [r for r in ROWS if r["id"] != "salt-creek"]
    (docs / "data" / "index.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    build_song_pages(docs)
    assert not (docs / "songs" / "salt-creek").exists()
    assert (docs / "songs" / "README.txt").exists()
    assert f"{ORIGIN}songs/salt-creek/" not in sitemap_locs(docs)


def test_rebuild_is_byte_stable_and_quiet(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    page = docs / "songs" / "blue-moon-of-kentucky" / "index.html"
    before = (page.read_bytes(), page.stat().st_mtime_ns, (docs / "sitemap.xml").read_bytes())
    build_song_pages(docs)
    after = (page.read_bytes(), page.stat().st_mtime_ns, (docs / "sitemap.xml").read_bytes())
    assert before == after


def test_static_pages_exist_in_the_real_site():
    for page in STATIC_PAGES:
        assert (REPO_ROOT / "docs" / (page or "index.html")).is_file(), page


def test_page_is_the_app_with_the_song_already_showing(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    html = (docs / "songs" / "blue-moon-of-kentucky" / "index.html").read_text()
    # Relative URLs (js/, css/, data/, images/) resolve from the root, and the
    # base comes before anything in the head that uses one.
    assert html.index('<base href="/">') < html.index('href="css/style.css"')
    assert html.index('<base href="/">') < html.index('href="images/favicon-16.png"')
    assert '<script type="module" src="js/main.js"></script>' in html
    # First paint is the song, not the homepage.
    assert '<div id="landing-page" class="landing-page hidden">' in html
    assert '<div id="song-view" class="song-view">' in html
    content = html.split('<div id="song-content" class="song-content">', 1)[1]
    assert content.startswith('<article class="prerender">')
    assert "Blue moon of Kentucky keep on shining" in content.split("</article>")[0]
    # One title, and it is the song's.
    assert html.count("<title>") == 1
    assert "Copyright concern" in html


def test_template_drift_fails_loudly():
    row = {"id": "x", "title": "X", "has_content": True}
    with pytest.raises(ValueError, match="song-view"):
        render_page(row, "[G]Hi\n", ORIGIN + "songs/x/",
                    APP_TEMPLATE.read_text().replace('id="song-view"', 'id="renamed"'))


# Songs and versions (work.yaml `song:`; build_works_index.apply_songs sets
# each row's path). One indexed page per song; versions live under it.
SONG_ROWS = [
    {"id": "house-of-gold", "title": "House Of Gold", "path": "songs/house-of-gold/",
     "canonical": True, "has_content": True},
    {"id": "a-house-of-gold", "title": "A House of Gold", "path": "songs/house-of-gold/2/",
     "variant_of": "house-of-gold", "version": "2", "has_content": True},
    {"id": "hog-banjo", "title": "House of Gold", "path": "songs/house-of-gold/banjo-tab/",
     "variant_of": "house-of-gold", "version": "banjo-tab",
     "tablature_parts": [{"instrument": "banjo", "file": "data/tabs/x.otf.json"}]},
]
SONG_CHARTS = {"house-of-gold.pro": "[C]People steal\n", "a-house-of-gold.pro": "[G]People steal\n"}


def test_versions_live_under_their_song_and_point_at_it(tmp_path):
    docs = make_docs(tmp_path, SONG_ROWS, SONG_CHARTS)
    build_song_pages(docs)
    song = (docs / "songs" / "house-of-gold" / "index.html").read_text()
    version = (docs / "songs" / "house-of-gold" / "2" / "index.html").read_text()
    tab = (docs / "songs" / "house-of-gold" / "banjo-tab" / "index.html").read_text()
    assert ('Versions: <a href="/songs/house-of-gold/2/">Version 2</a> · '
            '<a href="/songs/house-of-gold/banjo-tab/">Banjo tab</a>') in song
    for page in (version, tab):
        assert f'<link rel="canonical" href="{ORIGIN}songs/house-of-gold/">' in page
    assert 'Version 2 of <a href="/songs/house-of-gold/">House Of Gold</a>' in version
    assert sitemap_locs(docs)[len(STATIC_PAGES):] == [f"{ORIGIN}songs/house-of-gold/"]


def test_404_is_the_app_rooted_at_slash(tmp_path):
    docs = make_docs(tmp_path, SONG_ROWS, SONG_CHARTS)
    build_song_pages(docs)
    page = (docs / "404.html").read_text()
    assert '<base href="/">' in page and 'src="js/main.js"' in page
    assert "prerender" not in page


def test_rebuild_prunes_version_pages_and_their_folders(tmp_path):
    docs = make_docs(tmp_path, SONG_ROWS, SONG_CHARTS)
    build_song_pages(docs)
    rows = [r for r in SONG_ROWS if r["id"] != "a-house-of-gold"]
    (docs / "data" / "index.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    build_song_pages(docs)
    assert not (docs / "songs" / "house-of-gold" / "2").exists()
    assert (docs / "songs" / "house-of-gold" / "banjo-tab" / "index.html").exists()


def test_sitemap_dates_a_song_by_its_newest_version(tmp_path):
    docs = make_docs(tmp_path, SONG_ROWS, SONG_CHARTS)
    build_song_pages(docs, work_dates={"house-of-gold": "2026-07-31", "a-house-of-gold": "2026-10-26"},
                     page_dates={"docs/index.html": "2026-10-20"})
    xml = (docs / "sitemap.xml").read_text()
    assert f"<loc>{ORIGIN}songs/house-of-gold/</loc><lastmod>2026-10-26</lastmod>" in xml
    assert f"<loc>{ORIGIN}</loc><lastmod>2026-10-20</lastmod>" in xml
    assert f"<loc>{ORIGIN}about.html</loc></url>" in xml        # no date known: no <lastmod>


def git_repo(path):
    import subprocess
    def git(*args, env=None):
        subprocess.run(["git", "-C", str(path), *args], check=True, capture_output=True, env=env)
    path.mkdir()
    git("init", "-q")
    for when, work in (("2026-01-02T00:00:00", "a"), ("2026-03-04T00:00:00", "b"), ("2026-05-06T00:00:00", "a")):
        (path / "works" / work).mkdir(parents=True, exist_ok=True)
        (path / "works" / work / "work.yaml").write_text(f"title: {when}\n")
        git("add", "-A")
        env = {"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when, "PATH": __import__("os").environ["PATH"],
               "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
               "GIT_COMMITTER_EMAIL": "t@t", "HOME": str(path)}
        git("commit", "-q", "-m", work, env=env)
    return git


def test_git_dates_are_each_works_last_commit(tmp_path):
    from build_song_pages import git_dates
    git_repo(tmp_path / "repo")
    assert git_dates(tmp_path / "repo", ["works"]) == {"a": "2026-05-06", "b": "2026-03-04"}


def test_git_dates_refuse_a_shallow_clone(tmp_path):
    import subprocess
    from build_song_pages import git_dates
    git_repo(tmp_path / "repo")
    subprocess.run(["git", "clone", "-q", "--depth", "1", f"file://{tmp_path / 'repo'}", str(tmp_path / "shallow")],
                   check=True, capture_output=True)
    assert git_dates(tmp_path / "shallow", ["works"]) == {}
    assert git_dates(tmp_path / "not-a-repo", ["works"]) == {}
