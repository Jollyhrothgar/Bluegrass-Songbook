#!/usr/bin/env python3
"""Propose which works are versions of the same song (the `song:` seed).

Every work is its own song by default, its URL slug being its (permanent)
work id. A work that is a VERSION of another carries two fields in its
work.yaml:

    song: a-hundred-years-from-now    # the song's root work id
    version: 2                        # its slug under /songs/{song}/

This script proposes those fields from the last build's output
(docs/data/index.jsonl + archive.jsonl — run ./scripts/bootstrap --quick
first). It is deliberately conservative: works are grouped only on strong
evidence, and anything uncertain stays its own song, because a wrong merge
hides a song and a missed one costs nothing.

Strong evidence, any of:
- a curation pin: the row's `variant_of` (curation/registry.yaml);
- a merge: docs/data/redirects.json maps one live work to another.
  merge_works.py (2026-02-17) deleted ~200 duplicates and recorded a redirect
  for each; July backfill imports re-created 79 of them, which then took on
  tabs and edits the app could never show (openWork follows the redirect).
  Each such pair becomes one song with both works as versions, and `--write`
  drops the redirect: nothing is deleted, nothing is hidden;
- the build put the works in one version group (`group_id`) AND the lyrics
  say it's the same song: lyric containment against the song's main chart at
  dedup_scorer's own match threshold, or no lyrics on either side (a tune).
  `group_id` alone is NOT evidence: its fuzzy pass merges on title only, so
  "Satisfied" (old time religion) and "Satisfied" (you may ask me if I'm
  happy) share one. Writers must not disagree either (no shared surname);
- a tab-only work whose normalized title equals exactly one song's title
  (`angeline-baker` tab -> `angeline-the-baker`): the tab is a version of it.

A song root whose work id would mislead in a URL gets `slug:` (its title,
slugified): a bare number (`2402`), or a `-N` suffix with no other song
behind it (`blue-moon-of-kentucky-1`, whose plain id was deleted). As a first
path segment a suffix must only ever mean "another song shares this title".

Every value is written once and then belongs to works/; nothing recomputes
it, so later edits to titles or lyrics never move a URL.

    uv run python scripts/lib/seed_songs.py            # print the proposal
    uv run python scripts/lib/seed_songs.py --write    # write it to works/
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from dedup_scorer import (CONTAINMENT_MATCH, MIN_LYRIC_WORDS,
                          chordpro_lyric_words, containment)
from work_schema import slugify

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / 'docs' / 'data'
SUFFIX = re.compile(r'-\d+$')


REDIRECTS = DATA / 'redirects.json'


def load_rows() -> list:
    rows = []
    for name in ('index.jsonl', 'archive.jsonl'):
        with open(DATA / name, encoding='utf-8') as f:
            rows += [json.loads(line) for line in f if line.strip()]
    return rows


def load_redirects() -> dict:
    try:
        return json.loads(REDIRECTS.read_text(encoding='utf-8'))
    except OSError:
        return {}


def norm_title(title: str) -> str:
    t = (title or '').lower()
    t = re.sub(r'\s*\([^)]*\)\s*$', '', t)
    t = re.sub(r"[’']", '', t)
    t = re.sub(r'\b(the|a|an)\b', ' ', t)
    return re.sub(r'[^a-z0-9]', '', t)


def writer_surnames(row: dict) -> frozenset:
    """Writers by surname, so "Stuart Hine" and "Stuart K. Hine" agree."""
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)', '', (row.get('composer') or '').lower())
    names = re.split(r'\s*(?:,|&|\band\b)\s*', text)
    return frozenset(n.split()[-1].strip('.') for n in names
                     if n.strip() and n.strip() != 'traditional')


def lyrics(row: dict) -> frozenset:
    if not row.get('has_content'):
        return frozenset()
    try:
        text = (DATA / 'songs' / f"{row['id']}.pro").read_text(encoding='utf-8')
    except OSError:
        return frozenset()
    return chordpro_lyric_words(text)


def same_song(a: dict, b: dict) -> bool:
    """The lyrics agree, or neither side has any (an instrumental)."""
    la, lb = lyrics(a), lyrics(b)
    thin_a, thin_b = len(la) < MIN_LYRIC_WORDS, len(lb) < MIN_LYRIC_WORDS
    if thin_a and thin_b:
        return True
    if thin_a or thin_b:
        return False
    return containment(la, lb) >= CONTAINMENT_MATCH


def is_tab_only(row: dict) -> bool:
    return bool(row.get('tablature_parts')) and not row.get('has_content')


def root_key(row: dict) -> tuple:
    """Which work in a group is the song: pinned, then a chart over a bare
    tab, then searchable, then the plainest id (no -N suffix, shortest), then
    the fullest chart."""
    return (not row.get('canonical'),
            is_tab_only(row),
            row.get('indexed') is False,
            bool(SUFFIX.search(str(row['id']))),
            len(str(row['id'])),
            -(row.get('chord_count') or 0),
            str(row['id']))


def propose(rows: list, redirects: dict = None) -> tuple:
    """-> (songs: {root_id: [version rows]}, skipped: [(reason, ids)]).

    Each piece of evidence links two works; each connected set of works is
    one song, headed by its `root_key` minimum.
    """
    by_id = {str(r['id']): r for r in rows if r.get('status') != 'placeholder'}
    parent = {i: i for i in by_id}
    skipped = []

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def link(a, b):
        if a in parent and b in parent:
            parent[find(a)] = find(b)

    # 1. The build's version groups, where the lyrics confirm it.
    groups = defaultdict(list)
    for r in by_id.values():
        if r.get('group_id'):
            groups[r['group_id']].append(r)
    for members in groups.values():
        if len(members) < 2:
            continue
        # Writers conflict only when two versions share no surname at all.
        named = [w for w in (writer_surnames(m) for m in members) if w]
        if any(not (a & b) for i, a in enumerate(named) for b in named[i + 1:]):
            skipped.append(('writers disagree', [str(m['id']) for m in members]))
            continue
        root = min(members, key=root_key)
        for m in members:
            if m is root:
                continue
            if is_tab_only(m) or same_song(root, m):
                link(str(m['id']), str(root['id']))
            else:
                skipped.append(('lyrics differ', [str(root['id']), str(m['id'])]))

    # 2. Curation pins and 3. merges are human/tool decisions: no lyric test.
    for r in by_id.values():
        if r.get('variant_of'):
            link(str(r['id']), str(r['variant_of']))
    for source, target in (redirects or {}).items():
        link(str(source), str(target))

    # 4. A tab-only work with nothing else linking it joins the one song that
    #    has exactly its title.
    titles = defaultdict(set)
    for rid, r in by_id.items():
        if not is_tab_only(r):
            titles[norm_title(r.get('title'))].add(find(rid))
    size = Counter(find(rid) for rid in by_id)
    for rid, r in by_id.items():
        if not is_tab_only(r) or size[find(rid)] > 1:
            continue
        candidates = titles.get(norm_title(r.get('title')), set())
        if len(candidates) == 1:
            link(rid, next(iter(candidates)))
        elif len(candidates) > 1:
            skipped.append(('tab title matches several songs', [rid] + sorted(candidates)))

    components = defaultdict(list)
    for rid in by_id:
        components[find(rid)].append(by_id[rid])
    songs = {}
    for members in components.values():
        if len(members) > 1:
            root = min(members, key=root_key)
            songs[str(root['id'])] = [m for m in members if m is not root]
    return songs, skipped


def version_slugs(song_id: str, versions: list) -> dict:
    """Tab-only versions are named for what they are; the rest are ordinals."""
    slugs = {}
    n = 2
    for r in sorted(versions, key=lambda r: str(r['id'])):
        if is_tab_only(r):
            instruments = sorted({(p.get('instrument') or 'tab').replace('5-string-', '')
                                  for p in r['tablature_parts']})
            base = '-'.join(instruments) + '-tab'
            slug, k = base, 2
            while slug in slugs.values():
                slug, k = f'{base}-{k}', k + 1
            slugs[str(r['id'])] = slug
        else:
            slugs[str(r['id'])] = str(n)
            n += 1
    return slugs


def song_slugs(rows: list, songs: dict) -> dict:
    """{root work id: slug} for the roots whose own id would mislead."""
    versions = {str(v['id']) for vs in songs.values() for v in vs}
    roots = [r for r in rows if str(r['id']) not in versions and r.get('status') != 'placeholder']
    taken = {str(r['id']) for r in roots}
    slugs = {}
    for r in roots:
        rid = str(r['id'])
        base = SUFFIX.sub('', rid)
        misleading = rid.isdigit() or (SUFFIX.search(rid) and base not in taken)
        if not misleading:
            continue
        slug = slugify(r.get('title') or '')
        if slug and slug != rid and slug not in taken and slug not in slugs.values():
            slugs[rid] = slug
    return slugs


def live_redirects(rows: list, redirects: dict) -> dict:
    """The redirects whose source work still exists: re-created duplicates."""
    ids = {str(r['id']) for r in rows}
    return {k: v for k, v in redirects.items() if k in ids}


def write(rows: list, songs: dict, redirects: dict) -> int:
    from works_writer import update_metadata
    provenance = {'source': 'song-seed', 'source_id': 'scripts/lib/seed_songs.py'}
    # The pairs are versions of one song now, so the redirects go first:
    # works_writer refuses to write to a redirected id.
    live = live_redirects(rows, redirects)
    if live:
        kept = {k: v for k, v in redirects.items() if k not in live}
        REDIRECTS.write_text(json.dumps(kept, indent=2, ensure_ascii=False), encoding='utf-8')
    written = 0
    for song, versions in songs.items():
        for vid, slug in version_slugs(song, versions).items():
            update_metadata(REPO, vid, updates={'song': song, 'version': slug},
                            provenance=provenance, verbose=False)
            written += 1
    for rid, slug in song_slugs(rows, songs).items():
        update_metadata(REPO, rid, updates={'slug': slug}, provenance=provenance, verbose=False)
        written += 1
    return written


def main(argv: list) -> int:
    rows = load_rows()
    by_id = {str(r['id']): r for r in rows}
    redirects = load_redirects()
    songs, skipped = propose(rows, live_redirects(rows, redirects))

    def label(r):
        first = (r.get('first_line') or '').strip()[:45]
        idx = '' if r.get('indexed') is not False else ' [archived]'
        kind = ' [tab]' if is_tab_only(r) else ''
        return f'{r["id"]}{idx}{kind}  “{first}”'

    canon_songs = [s for s in songs if by_id[s].get('indexed') is not False]
    versions = sum(len(v) for v in songs.values())
    print(f'{len(rows)} works -> {len(rows) - versions} songs; '
          f'{len(songs)} songs have versions ({len(canon_songs)} searchable), '
          f'{versions} works become versions; {len(skipped)} groups left alone\n')
    for song in sorted(songs, key=lambda s: (by_id[s].get('indexed') is False, s)):
        print(f'/songs/{song}/   {label(by_id[song])}')
        for vid, slug in version_slugs(song, songs[song]).items():
            print(f'    /{slug}/   {label(by_id[vid])}')
    print('\nLeft as separate songs:')
    for reason, ids in skipped:
        print(f'  {reason}: {", ".join(ids)}')
    print('\nMerged pairs where the redirect pointed away from the plainer id:')
    root_of = {str(v['id']): s for s, vs in songs.items() for v in vs}
    for source, target in live_redirects(rows, redirects).items():
        if root_of.get(source, source) == source:
            print(f'  /songs/{source}/  (redirect said {source} -> {target})')
    print('\nSong slugs replacing a misleading work id:')
    for rid, slug in song_slugs(rows, songs).items():
        print(f'  /songs/{slug}/   (work {rid})')
    if '--write' in argv:
        print(f'\nwrote {write(rows, songs, redirects)} work.yaml files; '
              f'dropped {len(live_redirects(rows, redirects))} redirects')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
