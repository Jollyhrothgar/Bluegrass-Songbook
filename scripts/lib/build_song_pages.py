#!/usr/bin/env python3
"""Static per-song pages + sitemap.xml, built from the search index (G2).

The app routes songs by hash (`/#work/{id}`), and Google treats everything
after `#` as the same URL, so the whole songbook was one page to it. This
writes one plain HTML page per searchable song:

    docs/songs/{id}/index.html   the app itself (docs/index.html) with the
                                 song's title/description/canonical in the
                                 head and its chart pre-rendered in the song
                                 view: writer, key, chords over lyrics, tab
                                 instruments, "Recorded by"
    docs/songs/index.html        every song A–Z: the page that links to them
                                 all, linked from the homepage (G11)
    docs/tab-editor/index.html   the tab editor's front door (G15c): the app
                                 with its empty state's words already in the
                                 results panel
    docs/sitemap.xml             the static pages, the A–Z page, the tab
                                 editor + every song page

Inputs are what `build_works_index.write_outputs` just wrote
(`docs/data/index.jsonl` + `docs/data/songs/{id}.pro`), so the pages follow
curation with no extra step: a song promoted into search gets a page at the
next build, a pruned, deleted or suppressed one loses it. Both outputs are
generated (gitignored, tier 4).

Rules:
- A row gets a page when it has a chart or a tab. Placeholders and empty
  rows don't: a page with a title and nothing else is thin content.
- A variant (`variant_of`) gets a page whose canonical link names its main
  version, and is left out of the sitemap, so Google indexes one page per
  song rather than near-duplicates.
- No redirect: the page IS the app. index.html's `<base href="/">` keeps
  its relative URLs at the root, and main.js routes the song's path. Before JavaScript runs (and for a crawler that doesn't run
  it) the song view already shows the chart; the app then replaces it with
  the full song page — transpose, playback, tabs. A crawler and a reader see
  the same song.
- No scraped artist (F9). `artist` is whichever performer page a chart was
  scraped from, not whose version it is, so it is never shown (it stays in
  the data). The title, description and top of the page credit the
  writer; the footer's "Recorded by" lists `covering_artists` — artists
  MusicBrainz shows recording the song — by first recording year, each a
  YouTube search for that recording. A credit for the song, never a label
  on this chart.

Run standalone with `uv run python scripts/lib/build_song_pages.py`.
"""

import html
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import quote_plus

ORIGIN = 'https://bluegrassbook.com/'

# Hand-written pages worth indexing. Left out on purpose: blog.html (a
# redirect), create.html (noindex shim), editor.html / editor-demo.html /
# tab-test.html (dev pages).
STATIC_PAGES = ['', 'about.html', 'chord-explorer.html',
                'bluegrass-standards-board.html']

SONGS_DIR = 'songs'
ALL_SONGS = f'{SONGS_DIR}/'
ALL_SONGS_TITLE = 'All songs A–Z | Bluegrass Book'
ALL_SONGS_DESCRIPTION = ('Every song in Bluegrass Book, A to Z: chords, lyrics and tabs '
                         'for bluegrass, old-time and gospel standards.')
TAB_EDITOR_DIR = 'tab-editor'
TAB_EDITOR_SOURCE = 'scripts/lib/build_song_pages.py'   # what dates its sitemap entry, with docs/index.html
TAB_EDITOR_TITLE = 'Free TablEdit (.tef) tab editor online · Bluegrass Book'
TAB_EDITOR_DESCRIPTION = ('Open a TablEdit .tef file, edit it in your browser and save it back '
                          'as .tef. Free, with no account. Your files stay on your device.')
# The words below are the app's empty state too (docs/js/tab-editor-home.js):
# the heading and the privacy line must read the same in both.
TAB_EDITOR_H1 = 'Free tab editor for TablEdit (.tef) files'
TAB_EDITOR_PRIVACY = 'Your tabs stay on this device. Nothing is uploaded unless you submit it to the book.'
# The homepage's own title and description, which a song page swaps for its own.
HOME_HEAD = re.compile(r'<title>[^<]*</title>\s*<meta name="description" content="[^"]*">')
DESCRIPTION_CHARS = 155
# Footer credit: the first few recorders, the rest behind "and N more". A
# famous song has dozens; a page-long roll call is the slop look F9 removes.
FOOTER_ARTISTS = 5
YOUTUBE_SEARCH = 'https://www.youtube.com/results?search_query='

SECTION_START = re.compile(r'^\{(?:start_of_|so)(\w+)(?::\s*(.*?))?\}$')
SECTION_END = re.compile(r'^\{(?:end_of_|eo)(\w+)\}$')
DIRECTIVE = re.compile(r'^\{(\w+)(?::\s*(.*?))?\}$')
CHORD = re.compile(r'\[([^\]]*)\]')
SECTION_SHORT = {'v': 'verse', 'c': 'chorus', 'b': 'bridge', 't': 'tab'}
PREFORMATTED = {'tab', 'grid'}


# ---------------------------------------------------------------- chart

def _chord_lyric_lines(line: str) -> list:
    """`[G]Blue moon [C]shine` -> [chord line, lyric line] (chords aligned)."""
    lyric = ''
    chords = ''
    pos = 0
    for m in CHORD.finditer(line):
        lyric += line[pos:m.start()]
        pos = m.end()
        at = len(lyric)
        if chords:
            at = max(at, len(chords) + 1)   # never let two chords touch
        chords = chords.ljust(at) + m.group(1)
    lyric += line[pos:]
    if not chords:
        return [html.escape(lyric)]
    out = [f'<span class="ch">{html.escape(chords.rstrip())}</span>']
    if lyric.strip():
        out.append(html.escape(lyric.rstrip()))
    return out


def render_chart(chordpro: str) -> str:
    """ChordPro -> HTML sections of chords-over-lyrics `<pre>` blocks.

    Metadata and unknown directives are dropped; ABC notation is skipped (it
    is drawn in the app); `{chorus}` and `{comment}` become a short note.
    """
    parts = []
    pending = []          # lines of the current <pre>
    heading = None
    in_abc = False
    preformatted = False

    def flush():
        nonlocal pending, heading
        while pending and not pending[-1].strip():
            pending.pop()
        if pending:
            if heading:
                parts.append(f'<h2>{html.escape(heading)}</h2>')
            parts.append('<pre>' + '\n'.join(pending) + '</pre>')
        elif heading:
            parts.append(f'<h2>{html.escape(heading)}</h2>')
        pending, heading = [], None

    for raw in chordpro.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        start = SECTION_START.match(stripped)
        end = SECTION_END.match(stripped)
        if in_abc:
            if end and end.group(1) == 'abc':
                in_abc = False
            continue
        if start:
            kind = SECTION_SHORT.get(start.group(1), start.group(1))
            if kind == 'abc':
                flush()
                in_abc = True
                continue
            flush()
            heading = start.group(2) or kind.replace('_', ' ').title()
            preformatted = kind in PREFORMATTED
            continue
        if end:
            flush()
            preformatted = False
            continue
        directive = DIRECTIVE.match(stripped)
        if directive:
            name, value = directive.group(1), directive.group(2)
            if name == 'chorus':
                flush()
                parts.append('<p class="note">(Chorus)</p>')
            elif name in ('comment', 'c', 'comment_italic', 'ci') and value:
                flush()
                parts.append(f'<p class="note">{html.escape(value)}</p>')
            continue
        if preformatted:
            pending.append(html.escape(line))
        elif not stripped:
            if pending:
                pending.append('')
        else:
            pending.extend(_chord_lyric_lines(line))
    flush()
    return '\n'.join(parts) + ('\n' if parts else '')


# ---------------------------------------------------------------- page

def _path(row: dict) -> str:
    """`songs/{song}/` or `songs/{song}/{version}/` (build_works_index.apply_songs)."""
    return row.get('path') or f"{SONGS_DIR}/{row['id']}/"


def _page_url(row: dict) -> str:
    return ORIGIN + _path(row)


def _version_name(row: dict) -> str:
    """`2` -> "Version 2"; `banjo-tab` -> "Banjo tab"."""
    version = str(row.get('version') or '')
    return f'Version {version}' if version.isdigit() else version.replace('-', ' ').capitalize()


def _version_order(row: dict) -> tuple:
    version = str(row.get('version') or '')
    return (not version.isdigit(), int(version) if version.isdigit() else 0, version)


def _instrument_name(instrument: str) -> str:
    return (instrument or 'tab').replace('5-string-', '').replace('-', ' ').capitalize()


def _is_traditional(name: str) -> bool:
    return (name or '').strip().lower() == 'traditional'


def _writer(row: dict) -> str:
    """Who wrote it: `composer`, or "Traditional" when that is all the
    artist field says (a scrape that names no performer). '' when unknown —
    no guessing."""
    composer = (row.get('composer') or '').strip()
    if composer:
        return composer
    return 'Traditional' if _is_traditional(row.get('artist')) else ''


def _written_by(writer: str) -> str:
    if not writer:
        return ''
    return 'Traditional' if _is_traditional(writer) else f'Written by {writer}'


def recorded_by(row: dict) -> list:
    """[(name, year or None)] — the artists a page may name: `covering_artists`
    with their parallel `covering_years`, in the index's order (first
    recording year first), once each, "Traditional" left out. Never the
    scraped `artist` unless the build confirmed it into covering_artists
    (Mike, 2026-10-26). Mirrors recordedBy() in docs/js/utils.js."""
    names = row.get('covering_artists') or []
    years = row.get('covering_years') or []
    out, seen = [], set()
    for i, name in enumerate(names):
        name = (name or '').strip()
        if not name or _is_traditional(name) or name.lower() in seen:
            continue
        seen.add(name.lower())
        year = years[i] if i < len(years) and years[i] else None
        out.append((name, year))
    return out


def associated_artists(row: dict) -> list:
    return [name for name, _ in recorded_by(row)]


def _recording_link(title: str, name: str, year) -> str:
    """`Bill Monroe (1947)` linking to a YouTube search for that recording."""
    query = ' '.join(str(x) for x in (title, name, year) if x)
    label = f'{name} ({year})' if year else name
    href = YOUTUBE_SEARCH + quote_plus(query)
    return (f'<a href="{html.escape(href, quote=True)}" rel="nofollow noopener" '
            f'target="_blank">{html.escape(label)}</a>')


def _description(row: dict) -> str:
    bits = [f"{row.get('title', '')} chords and lyrics"]
    writer = _writer(row)
    if writer:
        bits.append('Traditional song' if _is_traditional(writer) else f'Written by {writer}')
    if row.get('key'):
        bits.append(f"Key of {row['key']}")
    if row.get('first_line'):
        bits.append(f"“{row['first_line']}”")
    text = '. '.join(bits) + '.'
    if len(text) > DESCRIPTION_CHARS:
        text = text[:DESCRIPTION_CHARS - 1].rsplit(' ', 1)[0] + '…'
    return text


def _fill(template: str, old: str, new: str) -> str:
    """Replace one landmark in the app template; it must occur exactly once."""
    count = template.count(old)
    if count != 1:
        raise ValueError(f'docs/index.html: expected {old!r} once, found it {count} times '
                         '(song pages are built from it; update build_song_pages.py)')
    return template.replace(old, new)


def _landmark(template: str, pattern: re.Pattern) -> str:
    """The text `pattern` matches in the app template, for _fill to replace."""
    match = pattern.search(template)
    if not match:
        raise ValueError(f'docs/index.html: no match for {pattern.pattern!r} '
                         '(song pages are built from it; update build_song_pages.py)')
    return match.group(0)


# ---------------------------------------------------------------- A–Z

# Theme before first paint: the saved choice, else the OS preference. Keep in
# step with the same script in docs/index.html.
THEME_SCRIPT = """<script>
        (function () {
            var t = null;
            try { t = localStorage.getItem('theme'); } catch (e) {}
            if (t !== 'dark' && t !== 'light') {
                t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            document.documentElement.setAttribute('data-theme', t);
        })();
    </script>"""


def _title_key(title: str) -> str:
    """Sort and file a title by its first letter or digit: `’Tis` under T."""
    return re.sub(r'^\W+', '', title.casefold())


def render_all_songs(rows: list) -> str:
    """`songs/index.html`: every song (not its versions), A to Z, with its
    writer. The one page that links to all of them, so a song page has a
    referring page and isn't known to Google through the sitemap alone; the
    homepage links here. A plain page, not the app: main.js routes only a
    song's own path."""
    esc = html.escape

    def title(row):
        return row.get('title') or str(row['id'])

    letters = {}
    for row in sorted(rows, key=lambda r: (_title_key(title(r)), str(r['id']))):
        first = _title_key(title(row))[:1].upper()
        letters.setdefault(first if first.isascii() and first.isalpha() else '#', []).append(row)
    order = sorted(letters, key=lambda k: (k != '#', k))

    def anchor(letter):
        return 'num' if letter == '#' else letter

    sections = []
    for letter in order:
        items = []
        for row in letters[letter]:
            writer = _writer(row)
            by = f' <span class="by">{esc(writer)}</span>' if writer else ''
            items.append(f'<li><a href="/{esc(_path(row))}">{esc(title(row))}</a>{by}</li>')
        sections.append(f'<h2 id="{anchor(letter)}">{esc(letter)}</h2>\n<ul>\n'
                        + '\n'.join(items) + '\n</ul>')
    bar = ' '.join(f'<a href="#{anchor(letter)}">{esc(letter)}</a>' for letter in order)
    count = f'{len(rows):,} song' + ('' if len(rows) == 1 else 's')

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{esc(ALL_SONGS_TITLE)}</title>
    <meta name="description" content="{esc(ALL_SONGS_DESCRIPTION, quote=True)}">
    <link rel="canonical" href="{ORIGIN}{ALL_SONGS}">
    <link rel="icon" type="image/png" sizes="48x48" href="/images/favicon-48.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/images/favicon-192.png">
    <link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
    <link rel="stylesheet" href="/css/style.css">
    {THEME_SCRIPT}
</head>
<body>
<main class="all-songs">
<nav><a class="all-songs-home" href="/">← Bluegrass Book</a></nav>
<h1>All songs</h1>
<p class="all-songs-intro">{count}, A to Z. Or <a href="/#search">search them</a>.</p>
<p class="all-songs-letters">{bar}</p>
{chr(10).join(sections)}
</main>
</body>
</html>
"""


def render_page(row: dict, chordpro: str, canonical: str, template: str,
                related: str = '') -> str:
    """The app's index.html, made into this song's page.

    Head: the song's title, description, canonical link and JSON-LD (the
    template's own `<base href="/">` keeps its relative URLs at the root). Body: the landing page starts
    hidden and the song view starts shown, holding the pre-rendered chart,
    so the first paint is the song, not the homepage.
    """
    work_id = str(row['id'])
    title = row.get('title') or work_id
    writer = _writer(row)
    recorders = recorded_by(row)
    esc = html.escape
    app_link = f'/#work/{work_id}'

    head_title = f'{title} chords and lyrics'
    if not chordpro and row.get('tablature_parts'):
        head_title = f'{title} tab'

    facts = []
    if row.get('key'):
        facts.append(f"Key of {row['key']}")
    if row.get('nashville'):
        facts.append('Chords: ' + ' '.join(row['nashville']))
    tabs = [p for p in row.get('tablature_parts') or [] if p]
    instruments = []
    for part in tabs:
        name = _instrument_name(part.get('instrument'))
        if name not in instruments:
            instruments.append(name)

    ld = {'@context': 'https://schema.org', '@type': 'MusicComposition',
          'name': title, 'url': canonical}
    if writer and not _is_traditional(writer):
        ld['composer'] = {'@type': 'Person', 'name': writer}
    ld_json = json.dumps(ld, ensure_ascii=False, indent=2).replace('</', '<\\/')

    body = []
    body.append(f'<h1>{esc(title)}</h1>')
    if writer:
        body.append(f'<p class="by">{esc(_written_by(writer))}</p>')
    if facts:
        body.append(f'<p class="facts">{esc(" · ".join(facts))}</p>')
    if instruments:
        body.append('<p class="facts">' + esc(' · '.join(f'{n} tab' for n in instruments)) + '</p>')
    if related:
        body.append(related)
    # Only seen before the app boots, or with JavaScript off.
    body.append(f'<a class="open" href="{esc(app_link)}">Open in Bluegrass Book: transpose, play along'
                + (', tabs' if instruments else '') + '</a>')
    if chordpro:
        body.append(render_chart(chordpro).rstrip('\n'))

    subject = f'Copyright concern: {title}'
    mail = ('mailto:hello@bluegrassbook.com?subject='
            + re.sub(r'\s', '%20', esc(subject, quote=True))
            + '&amp;body=' + esc(_page_url(row)))
    rights = f'<p class="rights">Rights holder? <a href="{mail}">Copyright concern</a></p>'

    if recorders:
        links = [_recording_link(title, name, year) for name, year in recorders]
        shown = ', '.join(links[:FOOTER_ARTISTS])
        rest = links[FOOTER_ARTISTS:]
        if rest:
            # Opened, the rest continues the same line (::details-content).
            shown += (f'<details><summary> and {len(rest)} more</summary>, '
                      + ', '.join(rest) + '</details>')
        body.append(f'<div class="artists">Recorded by: {shown}</div>')

    body.append(rights)

    head = (f'<title>{esc(head_title)} | Bluegrass Book</title>\n'
            f'    <meta name="description" content="{esc(_description(row), quote=True)}">\n'
            f'    <link rel="canonical" href="{esc(canonical)}">\n'
            f'    <script type="application/ld+json">\n{ld_json}\n    </script>')
    article = '<article class="prerender">\n' + '\n'.join(body) + '\n</article>'

    page = _fill(template, _landmark(template, HOME_HEAD), head)
    page = _fill(page, '<div id="landing-page" class="landing-page">',
                 '<div id="landing-page" class="landing-page hidden">')
    page = _fill(page, '<div id="song-view" class="song-view hidden">', '<div id="song-view" class="song-view">')
    page = _fill(page, '<div id="song-content" class="song-content"></div>',
                 f'<div id="song-content" class="song-content">{article}</div>')
    return page


# ---------------------------------------------------------------- tab editor

def render_tab_editor_page(template: str) -> str:
    """`tab-editor/index.html`: the app, with the tab editor front door's
    head and its words already in the results panel. The app replaces the
    article when it renders the empty state (docs/js/tab-editor-home.js), so a
    crawler and a reader see the same words. The landing page starts hidden
    and the (otherwise empty) results panel starts shown."""
    esc = html.escape
    canonical = f'{ORIGIN}{TAB_EDITOR_DIR}/'
    head = (f'<title>{esc(TAB_EDITOR_TITLE)}</title>\n'
            f'    <meta name="description" content="{esc(TAB_EDITOR_DESCRIPTION, quote=True)}">\n'
            f'    <link rel="canonical" href="{esc(canonical)}">')
    article = '\n'.join([
        '<article class="prerender">',
        f'<h1>{esc(TAB_EDITOR_H1)}</h1>',
        '<p>Open a TablEdit file, or a tab saved from this site, and edit it right here in '
        'your browser. It is free, it needs no account, and it works on a phone as well as a '
        'laptop.</p>',
        f'<p>{esc(TAB_EDITOR_PRIVACY)}</p>',
        '<ul>',
        '<li>Open a <code>.tef</code> or <code>.otf.json</code> file</li>',
        '<li>Start a new tab for banjo, guitar, mandolin, bass or dobro</li>',
        '<li>Edit with the keyboard or by touch, and play it back</li>',
        '<li>Keep your tabs in My tabs, saved in this browser</li>',
        '<li>Download your work, or submit it to the book when you are ready</li>',
        '</ul>',
        '</article>',
    ])
    page = _fill(template, _landmark(template, HOME_HEAD), head)
    page = _fill(page, '<div id="landing-page" class="landing-page">',
                 '<div id="landing-page" class="landing-page hidden">')
    return _fill(page, '<div id="results" class="results"></div>',
                 f'<div id="results" class="results">{article}</div>')


# ---------------------------------------------------------------- build

def _write_if_changed(path: Path, text: str) -> bool:
    try:
        if path.read_text(encoding='utf-8') == text:
            return False
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    return True


def _sitemap(urls: list) -> str:
    """urls: [(url, lastmod 'YYYY-MM-DD' or None)]."""
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, lastmod in urls:
        mod = f'<lastmod>{lastmod}</lastmod>' if lastmod else ''
        lines.append(f'  <url><loc>{html.escape(url)}</loc>{mod}</url>')
    lines.append('</urlset>')
    return '\n'.join(lines) + '\n'


def git_dates(repo: Path, paths: list) -> dict:
    """{path's first segment below its root: date of the last commit touching it}.

    For `paths=['works']` that is {work id: 'YYYY-MM-DD'}; for a list of
    files it is {file name: date}. The sitemap's <lastmod> comes from here,
    because Google only uses lastmod when it is consistently accurate: a page
    is dated by the last commit that changed its content, never by the build.
    Returns {} without full history (CI's default shallow clone dates every
    file to the one commit it has) or outside a git checkout — the sitemap
    then simply has no <lastmod>.
    """
    def git(*args):
        return subprocess.run(['git', '-C', str(repo), *args], capture_output=True,
                              text=True, check=True).stdout
    try:
        if git('rev-parse', '--is-shallow-repository').strip() != 'false':
            return {}
        log = git('log', '--format=%x00%cs', '--name-only', '--no-renames', '--', *paths)
    except (OSError, subprocess.CalledProcessError):
        return {}
    dates, current = {}, None
    for line in log.splitlines():
        if line.startswith('\x00'):
            current = line[1:]
        elif line:
            for root in paths:
                if line == root or line.startswith(root.rstrip('/') + '/'):
                    key = line[len(root):].lstrip('/').split('/')[0] or root
                    dates.setdefault(key, current)      # newest first: keep the first
    return dates


def _read_jsonl(path: Path) -> list:
    if not path.exists():
        return []
    with open(path, encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


def build_song_pages(docs_dir: Path, work_dates: dict = None, page_dates: dict = None) -> dict:
    """Write a page per song and version, the A–Z page (`songs/index.html`),
    docs/404.html, docs/tab-editor/index.html and docs/sitemap.xml.

    A song's page (`songs/{song}/`) is indexed, listed in the sitemap and on
    the A–Z page, and names its versions. A version's page (`songs/{song}/{version}/`) points
    its canonical link at the song, so Google indexes one page per song.
    404.html is the app as is (index.html carries `<base href="/">`): GitHub
    Pages serves it for any path without a page (an archived song), and
    main.js routes that path.

    Each sitemap URL carries <lastmod>: a song's is the newest commit to its
    own work or any of its versions (its page lists them); a static page's is
    its file's. `work_dates` / `page_dates` default to git (see git_dates).
    """
    docs_dir = Path(docs_dir)
    data_dir = docs_dir / 'data'
    template = (docs_dir / 'index.html').read_text(encoding='utf-8')
    if work_dates is None:
        work_dates = git_dates(docs_dir.parent, ['works'])
    if page_dates is None:
        page_dates = git_dates(docs_dir.parent, [f'docs/{p or "index.html"}' for p in STATIC_PAGES]
                               + [TAB_EDITOR_SOURCE])
    out_dir = docs_dir / SONGS_DIR
    rows = _read_jsonl(data_dir / 'index.jsonl')
    everything = rows + _read_jsonl(data_dir / 'archive.jsonl')
    by_id = {str(r['id']): r for r in everything}
    versions_of = {}
    for r in everything:
        if r.get('variant_of'):
            versions_of.setdefault(str(r['variant_of']), []).append(r)

    def chart_for(row):
        if not row.get('has_content'):
            return ''
        try:
            return (data_dir / 'songs' / f"{row['id']}.pro").read_text(encoding='utf-8')
        except OSError:
            return ''

    pages = {}
    for row in rows:
        if row.get('status') == 'placeholder':
            continue
        chart = chart_for(row)
        if chart or row.get('tablature_parts'):
            pages[str(row['id'])] = (row, chart)

    def link(row, text):
        return f'<a href="/{html.escape(_path(row))}">{html.escape(text)}</a>'

    written = 0
    song_urls = []
    songs = []          # the sitemap's songs, for the A–Z page
    expected = set()
    for work_id in sorted(pages):
        row, chart = pages[work_id]
        root = str(row.get('variant_of') or '')
        if root:
            song = by_id.get(root)
            canonical = _page_url(pages[root][0]) if root in pages else _page_url(row)
            related = (f'<p class="facts">{html.escape(_version_name(row))} of '
                       f'{link(song, song.get("title") or root)}</p>') if song else ''
        else:
            canonical = _page_url(row)
            versions = sorted(versions_of.get(work_id, []), key=_version_order)
            dated = [work_dates.get(str(r['id'])) for r in [row] + versions]
            song_urls.append((canonical, max((d for d in dated if d), default=None)))
            songs.append(row)
            related = ('<p class="facts">Versions: '
                       + ' · '.join(link(v, _version_name(v)) for v in versions)
                       + '</p>') if versions else ''
        target = docs_dir / _path(row) / 'index.html'
        expected.add(target)
        if _write_if_changed(target, render_page(row, chart, canonical, template, related)):
            written += 1

    all_songs = docs_dir / ALL_SONGS / 'index.html'
    expected.add(all_songs)
    _write_if_changed(all_songs, render_all_songs(songs))

    # Prune pages that left the index (renames, curation, deletions). Every
    # index.html under docs/songs is generated; anything else is left alone.
    pruned = 0
    if out_dir.is_dir():
        for page in sorted(out_dir.rglob('index.html')):
            if page not in expected:
                page.unlink()
                pruned += 1
        for folder in sorted((d for d in out_dir.rglob('*') if d.is_dir()),
                             key=lambda d: len(d.parts), reverse=True):
            if not any(folder.iterdir()):
                folder.rmdir()

    _fill(template, '<base href="/">', '<base href="/">')   # fails loudly if it's gone
    _write_if_changed(docs_dir / '404.html', template)
    _write_if_changed(docs_dir / TAB_EDITOR_DIR / 'index.html', render_tab_editor_page(template))

    # The A–Z page has no <lastmod>: no single commit dates its list. The tab
    # editor's page is generated, so no commit touches it: it is as new as the
    # newer of the template it is made from and this generator.
    editor_dates = [page_dates.get(k) for k in ('docs/index.html', TAB_EDITOR_SOURCE)]
    urls = ([(ORIGIN + p, page_dates.get(f'docs/{p or "index.html"}')) for p in STATIC_PAGES]
            + [(ORIGIN + ALL_SONGS, None),
               (f'{ORIGIN}{TAB_EDITOR_DIR}/', max((d for d in editor_dates if d), default=None))]
            + song_urls)
    _write_if_changed(docs_dir / 'sitemap.xml', _sitemap(urls))
    print(f"Song pages: {len(pages)} in {out_dir} ({written} written, {pruned} pruned); "
          f"sitemap.xml lists {len(urls)} URLs")
    return {'pages': len(pages), 'written': written, 'pruned': pruned, 'sitemap_urls': len(urls)}


if __name__ == '__main__':
    build_song_pages(Path(__file__).resolve().parent.parent.parent / 'docs')
