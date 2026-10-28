"""Every icon a page links exists, and is the size it claims.

Google Search shows a site's favicon only if one it can use is a multiple of
48px square; when none qualified it fell back to the 192px banjo
apple-touch-icon. Icons come from scripts/lib/make_icons.py.
"""

import re
import sys
from pathlib import Path

import pytest
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
DOCS = REPO / 'docs'
sys.path.insert(0, str(REPO / 'scripts' / 'lib'))

from build_song_pages import render_page  # noqa: E402

ICON_LINK = re.compile(r'<link rel="(?:icon|apple-touch-icon)"[^>]*>')
HREF = re.compile(r'href="([^"]+)"')
SIZES = re.compile(r'sizes="(\d+)x(\d+)"')
PAGES = ['index.html', 'about.html', 'chord-explorer.html',
         'bluegrass-standards-board.html', 'editor.html']


def icon_links(html: str) -> list:
    return ICON_LINK.findall(html)


def resolve(href: str) -> Path:
    return DOCS / href.lstrip('/')


def song_page() -> str:
    row = {'id': 'tall-pines', 'title': 'Tall Pines', 'has_content': True}
    return render_page(row, '{title: Tall Pines}\n[D]Tall pines', 'https://bluegrassbook.com/songs/tall-pines/',
                       (DOCS / 'index.html').read_text(encoding='utf-8'))


@pytest.mark.parametrize('name', PAGES + ['songs/<id>/'])
def test_linked_icons_exist_at_their_stated_size(name):
    html = song_page() if name.startswith('songs/') else (DOCS / name).read_text(encoding='utf-8')
    links = icon_links(html)
    assert any('apple-touch-icon' in l for l in links), name
    assert any('sizes="48x48"' in l for l in links), name
    for link in links:
        href = HREF.search(link).group(1)
        # The browser would rasterize an SVG itself and skip the tuned PNGs.
        assert not href.endswith('.svg'), f'{name}: {link}'
        path = resolve(href)
        assert path.is_file(), f'{name}: {link}'
        size = SIZES.search(link)
        if size:
            assert Image.open(path).size == (int(size[1]), int(size[2])), f'{name}: {link}'


def test_root_favicon_ico_exists():
    ico = Image.open(DOCS / 'favicon.ico')
    assert (48, 48) in ico.info['sizes']


def test_manifest_icons_are_the_monogram_not_the_banjo():
    manifest = (DOCS / 'manifest.webmanifest').read_text(encoding='utf-8')
    assert 'banjo' not in manifest
    assert not (DOCS / 'images' / 'banjo.png').exists()
