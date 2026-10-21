"""Static per-song pages + sitemap (G2).

Songs live at `/#work/{id}`, and Google treats everything after `#` as one
URL, so no song could be indexed. `build_song_pages` writes a plain HTML page
per searchable song at `docs/songs/{id}/index.html` and regenerates
`docs/sitemap.xml` from the same rows, on every index build. Curation is
therefore automatic: a song promoted into search gets a page at the next
deploy, a pruned or deleted one loses it.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

from build_song_pages import (  # noqa: E402
    ORIGIN,
    STATIC_PAGES,
    build_song_pages,
    render_chart,
)


def make_docs(tmp_path, rows, charts):
    data = tmp_path / "data"
    (data / "songs").mkdir(parents=True)
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
    assert "<title>Blue Moon of Kentucky (Bill Monroe) chords and lyrics | Bluegrass Book</title>" in html
    assert f'<link rel="canonical" href="{ORIGIN}songs/blue-moon-of-kentucky/">' in html
    assert '<meta name="description" content="' in html
    assert 'href="/#work/blue-moon-of-kentucky"' in html
    assert "noindex" not in html
    # No redirect: a crawler and a reader see the same page.
    assert "location.replace" not in html and 'http-equiv="refresh"' not in html
    assert "Key of G" in html and "I IV V" in html
    assert '"@type": "MusicComposition"' in html


def test_chart_is_chords_over_lyrics_and_escaped(tmp_path):
    docs = make_docs(tmp_path, ROWS, CHARTS)
    build_song_pages(docs)
    html = (docs / "songs" / "blue-moon-of-kentucky" / "index.html").read_text()
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
