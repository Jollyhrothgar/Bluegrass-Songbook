#!/usr/bin/env python3
"""Static per-song pages + sitemap.xml, built from the search index (G2).

The app routes songs by hash (`/#work/{id}`), and Google treats everything
after `#` as the same URL, so the whole songbook was one page to it. This
writes one plain HTML page per searchable song:

    docs/songs/{id}/index.html   title, artist, key, chords over lyrics,
                                 tab instruments, a link into the app
    docs/sitemap.xml             the static pages + every song page

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
- No redirect into the app: crawler and reader see the same page.

Run standalone with `uv run python scripts/lib/build_song_pages.py`.
"""

import html
import json
import re
import shutil
from pathlib import Path

ORIGIN = 'https://bluegrassbook.com/'

# Hand-written pages worth indexing. Left out on purpose: blog.html (a
# redirect), create.html (noindex shim), editor.html / editor-demo.html /
# tab-test.html (dev pages).
STATIC_PAGES = ['', 'about.html', 'chord-explorer.html',
                'bluegrass-standards-board.html']

SONGS_DIR = 'songs'
DESCRIPTION_CHARS = 155

SECTION_START = re.compile(r'^\{(?:start_of_|so)(\w+)(?::\s*(.*?))?\}$')
SECTION_END = re.compile(r'^\{(?:end_of_|eo)(\w+)\}$')
DIRECTIVE = re.compile(r'^\{(\w+)(?::\s*(.*?))?\}$')
CHORD = re.compile(r'\[([^\]]*)\]')
SECTION_SHORT = {'v': 'verse', 'c': 'chorus', 'b': 'bridge', 't': 'tab'}
PREFORMATTED = {'tab', 'grid'}

PAGE_CSS = """
:root { --bg: #fdfbf7; --text: #2b2620; --muted: #6b6258; --accent: #8a4b1f; --line: #e6dfd4; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1d1a17; --text: #ece6dd; --muted: #a89e92; --accent: #e3a16b; --line: #3a342e; }
}
body { margin: 0; background: var(--bg); color: var(--text);
  font: 17px/1.5 Georgia, 'Times New Roman', serif; }
main, header, footer { max-width: 720px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 16px; }
header a { color: var(--muted); text-decoration: none; font-size: 0.95rem; }
h1 { font-size: 2rem; line-height: 1.2; margin: 24px 0 4px; }
.by, .facts { color: var(--muted); margin: 0 0 4px; }
.open { display: inline-block; margin: 16px 0 8px; padding: 8px 16px;
  border: 1px solid var(--accent); border-radius: 6px; color: var(--accent);
  text-decoration: none; font-family: system-ui, sans-serif; font-size: 0.95rem; }
h2 { font-size: 1.1rem; margin: 28px 0 4px; color: var(--muted); }
pre { font: 15px/1.45 'SF Mono', Menlo, Consolas, monospace; white-space: pre;
  overflow-x: auto; margin: 0; }
.ch { color: var(--accent); font-weight: bold; }
.note { font-style: italic; color: var(--muted); margin: 8px 0; }
footer { margin-top: 48px; padding-bottom: 32px; border-top: 1px solid var(--line);
  color: var(--muted); font-size: 0.85rem; }
footer a { color: var(--muted); }
"""


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

def _page_url(work_id: str) -> str:
    return f'{ORIGIN}{SONGS_DIR}/{work_id}/'


def _instrument_name(instrument: str) -> str:
    return (instrument or 'tab').replace('5-string-', '').replace('-', ' ').capitalize()


def _description(row: dict) -> str:
    bits = [f"{row.get('title', '')} chords and lyrics"]
    if row.get('artist'):
        bits[0] += f", as played by {row['artist']}"
    if row.get('key'):
        bits.append(f"Key of {row['key']}")
    if row.get('first_line'):
        bits.append(f"“{row['first_line']}”")
    text = '. '.join(bits) + '.'
    if len(text) > DESCRIPTION_CHARS:
        text = text[:DESCRIPTION_CHARS - 1].rsplit(' ', 1)[0] + '…'
    return text


def render_page(row: dict, chordpro: str, canonical: str) -> str:
    work_id = str(row['id'])
    title = row.get('title') or work_id
    artist = row.get('artist') or ''
    composer = row.get('composer') or ''
    esc = html.escape
    app_link = f'/#work/{work_id}'

    head_title = f'{title} ({artist}) chords and lyrics' if artist else f'{title} chords and lyrics'
    if not chordpro and row.get('tablature_parts'):
        head_title = f'{title} ({artist}) tab' if artist else f'{title} tab'

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
    if composer:
        ld['composer'] = {'@type': 'Person', 'name': composer}
    ld_json = json.dumps(ld, ensure_ascii=False, indent=2).replace('</', '<\\/')

    body = []
    body.append(f'<h1>{esc(title)}</h1>')
    if artist:
        body.append(f'<p class="by">{esc(artist)}</p>')
    if composer and composer != artist:
        written = composer if composer.lower() == 'traditional' else f'Written by {composer}'
        body.append(f'<p class="by">{esc(written)}</p>')
    if facts:
        body.append(f'<p class="facts">{esc(" · ".join(facts))}</p>')
    if instruments:
        body.append('<p class="facts">' + esc(' · '.join(f'{n} tab' for n in instruments)) + '</p>')
    body.append(f'<a class="open" href="{esc(app_link)}">Open in Bluegrass Book: transpose, play along'
                + (', tabs' if instruments else '') + '</a>')
    if chordpro:
        body.append(render_chart(chordpro).rstrip('\n'))

    subject = f'Copyright concern: {title}'
    mail = ('mailto:hello@bluegrassbook.com?subject='
            + re.sub(r'\s', '%20', esc(subject, quote=True))
            + '&amp;body=' + esc(_page_url(work_id)))

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(head_title)} | Bluegrass Book</title>
<meta name="description" content="{esc(_description(row), quote=True)}">
<link rel="canonical" href="{esc(canonical)}">
<link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
<script type="application/ld+json">
{ld_json}
</script>
<style>{PAGE_CSS}</style>
</head>
<body>
<header><a href="/">&larr; Bluegrass Book</a></header>
<main>
{chr(10).join(body)}
</main>
<footer>
<p>From <a href="/">Bluegrass Book</a>, a free songbook for bluegrass jams. Rights holder? <a href="{mail}">Copyright concern</a></p>
</footer>
</body>
</html>
"""


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
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    lines += [f'  <url><loc>{html.escape(u)}</loc></url>' for u in urls]
    lines.append('</urlset>')
    return '\n'.join(lines) + '\n'


def build_song_pages(docs_dir: Path) -> dict:
    """Write docs/songs/{id}/index.html + docs/sitemap.xml from the index."""
    docs_dir = Path(docs_dir)
    data_dir = docs_dir / 'data'
    out_dir = docs_dir / SONGS_DIR
    rows = []
    with open(data_dir / 'index.jsonl', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))

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

    written = 0
    song_urls = []
    for work_id in sorted(pages):
        row, chart = pages[work_id]
        main = str(row.get('variant_of') or '')
        canonical = _page_url(main if main in pages else work_id)
        if canonical == _page_url(work_id):
            song_urls.append(canonical)
        if _write_if_changed(out_dir / work_id / 'index.html', render_page(row, chart, canonical)):
            written += 1

    # Prune pages whose song left the index. Only generated page directories
    # (a lone index.html) are removed; anything else in docs/songs is left.
    pruned = 0
    if out_dir.is_dir():
        for child in out_dir.iterdir():
            if (child.is_dir() and child.name not in pages
                    and [p.name for p in child.iterdir()] == ['index.html']):
                shutil.rmtree(child)
                pruned += 1

    urls = [ORIGIN + p for p in STATIC_PAGES] + song_urls
    _write_if_changed(docs_dir / 'sitemap.xml', _sitemap(urls))
    print(f"Song pages: {len(pages)} in {out_dir} ({written} written, {pruned} pruned); "
          f"sitemap.xml lists {len(urls)} URLs")
    return {'pages': len(pages), 'written': written, 'pruned': pruned, 'sitemap_urls': len(urls)}


if __name__ == '__main__':
    build_song_pages(Path(__file__).resolve().parent.parent.parent / 'docs')
