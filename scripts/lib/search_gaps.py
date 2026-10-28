#!/usr/bin/env python3
"""search-gaps: what visitors searched for and could not find.

    ./scripts/utility search-gaps                 # the last 30 days
    ./scripts/utility search-gaps --since 2026-10-01

Reads the events docs/js/analytics.js already sends to `analytics_events`
(`search`, `search_result_click`, `song_not_found`), stitches each visitor's
events into journeys, and re-runs every failed search against the LOCAL
corpus (docs/data/index.jsonl + archive.jsonl) to say what kind of gap it is:

    missing     no song by that name anywhere     -> add-placeholder (wanted list)
    dungeon     an archived work's TITLE matches  -> curate unprune
                (a lyric mention alone is not the song: that stays "missing")
    filtered    the song is here, not with the    -> a missing tab / tag
                filters asked for (tag:mandolin)
    misspelled  a canon title is a near spelling  -> search UX, not content
    artist      an artist: search, no songs       -> artist gap
    filters     only filters, nothing matches     -> a mistyped tag, or an
                                                     empty combination
    resolved    the canon matches it NOW          -> added since; nothing to do

A journey is one visitor's searches and result clicks with no pause longer
than JOURNEY_GAP. Its outcome:

    found      opened a result
    recovered  a search found nothing, then they opened something
    gave_up    looked for something (free text, title:, lyrics:) or got zero
               results, and opened nothing
    browsed    only filters (tag:, artist:, ...) with results, opened nothing —
               reading a list, not failing to find a song

Searches are recorded after a 1 s typing pause, so "appalach" and
"appalachian" arrive before "appalachian road show"; a search the next one
extends is part of that burst and dropped, and so is one that cuts the search
before it mid-word (backspacing: "salt spring tag:jamfriendly" -> "salt spring
ta" -> "salt spring tag:instrumental"). Dungeon-mode searches (`scope:
dungeon`) are exploring the archive, not looking for a song, and are left out;
so are result clicks made in a list view (`from_list`), which log the same
event with whatever is left in the search box.

An archived work counts as "opened from search" only when the search before
the click had `scope: canon+dungeon` ("Include the dungeon", 2026-10-27) —
before that, a canon search could not show an archived row.

The report is PRINTED, never written or committed: the queries are visitors'
words, and this repo and its Pages site are public. It suggests commands and
runs none of them. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the
utility injects them via with-secrets) and a built index
(./scripts/bootstrap --quick) — the verdicts are only as fresh as docs/data/.

`search_index.search` is the matcher, so verdicts follow the site's rules
minus its stemmed-word fallback and virtual instrument tags: it can find
less than the site, never more. A site miss is still a miss; at worst a
`tag:banjo` search reads as "filtered" when a banjo take landed since.
"""

import argparse
import string
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from rapidfuzz import fuzz, process

import search_index as si

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / 'docs' / 'data'

EVENT_NAMES = ('search', 'search_result_click', 'song_not_found')
JOURNEY_GAP = timedelta(minutes=30)
# rapidfuzz ratio for "maybe meant". Only ever a hint for a person:
# title-match.js documents why no ratio is safe to act on.
NEAR_TITLE_SCORE = 88
MIN_FUZZY_LEN = 4
MAX_IDS_SHOWN = 3


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------

def normalize(query: str) -> str:
    return ' '.join((query or '').lower().split())


def intent_text(parsed: dict) -> str:
    """The words a search was looking for: free text, else its title: value."""
    return ' '.join(parsed['text_terms']) or (parsed['title_filter'] or '')


def looks_for_something(query: str) -> bool:
    """Free text, title: or lyrics: — a song in mind, not a list to browse."""
    parsed = si.parse_query(query)
    return bool(parsed['text_terms'] or parsed['title_filter'] or parsed['lyrics_filter'])


def _loosened(parsed: dict) -> dict:
    """The query without the filters that narrow a song down to a take."""
    return {**parsed, 'tag_filters': [], 'exclude_tags': [],
            'chord_filters': [], 'progression_filter': None}


def _has_terms(parsed: dict) -> bool:
    return any(parsed[k] for k in (
        'text_terms', 'artist_filter', 'title_filter', 'lyrics_filter',
        'composer_filter', 'tag_filters', 'chord_filters', 'progression_filter'))


def _title_key(title: str) -> str:
    """Lowercase, apostrophes dropped (sittin' = sittin), punctuation to spaces."""
    t = (title or '').lower().replace("'", '').replace('’', '')
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in t).split())


# --------------------------------------------------------------------------
# Journeys
# --------------------------------------------------------------------------

def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


@dataclass
class Step:
    at: datetime
    kind: str                       # 'search' | 'click'
    query: str = ''
    result_count: int | None = None
    song_id: str | None = None
    scope: str = 'canon'            # events from before 2026-10-27 had none


@dataclass
class Journey:
    visitor: str
    steps: list                     # typing bursts already collapsed

    @property
    def searches(self) -> list:
        return [s for s in self.steps if s.kind == 'search']

    @property
    def clicks(self) -> list:
        return [s for s in self.steps if s.kind == 'click']

    @property
    def outcome(self) -> str:
        kinds = [s.kind for s in self.steps]
        if 'click' in kinds:
            before = self.steps[:kinds.index('click')]
            missed = any(s.kind == 'search' and s.result_count == 0 for s in before)
            return 'recovered' if missed else 'found'
        if any(s.result_count == 0 or looks_for_something(s.query) for s in self.searches):
            return 'gave_up'
        return 'browsed'


def _step(event: dict) -> Step | None:
    props = event.get('properties') or {}
    at = _parse_ts(event['created_at'])
    if event['event_name'] == 'search':
        if props.get('scope') == 'dungeon':
            return None
        return Step(at, 'search', query=props.get('query') or '',
                    result_count=props.get('result_count'),
                    scope=props.get('scope') or 'canon')
    if event['event_name'] == 'search_result_click':
        if props.get('from_list'):
            return None
        return Step(at, 'click', query=props.get('query') or '',
                    song_id=props.get('song_id'))
    return None


def _extends(longer: Step | None, shorter: Step) -> bool:
    return (longer is not None and longer.kind == 'search'
            and normalize(longer.query).startswith(normalize(shorter.query)))


def _cut_mid_word(longer: Step, shorter: Step) -> bool:
    """`shorter` ends part-way through one of `longer`'s words."""
    words = normalize(shorter.query).split()
    return bool(words) and words[-1] not in normalize(longer.query).split()


def collapse_typing(steps: list) -> list:
    """Drop the pauses inside a burst of typing; keep the attempts.

    Typing forward, every pause the next search extends is dropped.
    Backspacing, a pause that cuts the previous search mid-word is dropped
    too — but shortening by whole words ("blue moon of kentucky" -> "blue
    moon") is a deliberate second attempt and stays.
    """
    kept = []
    for i, step in enumerate(steps):
        if step.kind == 'search':
            prev = steps[i - 1] if i > 0 else None
            nxt = steps[i + 1] if i + 1 < len(steps) else None
            if _extends(nxt, step):
                continue
            if _extends(prev, step) and _cut_mid_word(prev, step):
                continue
        kept.append(step)
    return kept


def build_journeys(events: list, gap: timedelta = JOURNEY_GAP) -> list:
    by_visitor = {}
    for event in events:
        step = _step(event)
        if step is not None:
            by_visitor.setdefault(event['visitor_id'], []).append(step)

    journeys = []
    for visitor, steps in by_visitor.items():
        steps.sort(key=lambda s: s.at)
        current = []
        for step in steps:
            if current and step.at - current[-1].at > gap:
                journeys.append(Journey(visitor, collapse_typing(current)))
                current = []
            current.append(step)
        if current:
            journeys.append(Journey(visitor, collapse_typing(current)))
    # Clicks alone are list browsing (list rows log result clicks too)
    return [j for j in journeys if j.searches]


@dataclass
class Miss:
    visitor: str
    query: str
    kind: str                       # 'zero' | 'unopened'
    result_count: int
    then_opened: str | None = None


def find_misses(journeys: list) -> list:
    """Every zero-result search, plus the last search a visitor gave up on."""
    misses = []
    for j in journeys:
        for i, step in enumerate(j.steps):
            if step.kind == 'search' and step.result_count == 0:
                opened = next((s.song_id for s in j.steps[i + 1:] if s.kind == 'click'), None)
                misses.append(Miss(j.visitor, step.query, 'zero', 0, opened))
        if j.outcome == 'gave_up':
            last = next((s for s in reversed(j.searches)
                         if s.result_count and looks_for_something(s.query)), None)
            if last:
                misses.append(Miss(j.visitor, last.query, 'unopened', last.result_count))
    return misses


# --------------------------------------------------------------------------
# Classification against the local corpus
# --------------------------------------------------------------------------

@dataclass
class Verdict:
    category: str
    ids: list = field(default_factory=list)


class Corpus:
    def __init__(self, canon: list, archive: list):
        self.canon, self.archive = canon, archive
        self.canon_ids = {row['id'] for row in canon}
        self.archived_ids = {row['id'] for row in archive}
        self._titles = {}           # title key -> (id, archived?); canon wins a tie
        for rows, archived in ((canon, False), (archive, True)):
            for row in rows:
                key = _title_key(row.get('title'))
                if key:
                    self._titles.setdefault(key, (row['id'], archived))
        self._title_keys = list(self._titles)
        self._verdicts = {}

    @classmethod
    def load(cls, data_dir: Path) -> 'Corpus':
        index = data_dir / 'index.jsonl'
        if not index.exists():
            sys.exit(f"Error: {index} not found. Run ./scripts/bootstrap --quick first.")
        archive = data_dir / 'archive.jsonl'
        if not archive.exists():
            print(f"Warning: no {archive}; nothing will be called 'in the dungeon'.",
                  file=sys.stderr)
        return cls(si.load_index(index), si.load_index(archive) if archive.exists() else [])

    def near_titles(self, text: str) -> list:
        """[(id, archived?)] whose title is a near spelling of `text`."""
        key = _title_key(text)
        if len(key) < MIN_FUZZY_LEN:
            return []
        matches = process.extract(key, self._title_keys, scorer=fuzz.ratio,
                                  score_cutoff=NEAR_TITLE_SCORE, limit=MAX_IDS_SHOWN)
        return [self._titles[choice] for choice, _score, _i in matches]

    def classify(self, query: str) -> Verdict:
        key = normalize(query)
        if key not in self._verdicts:
            self._verdicts[key] = self._classify(query)
        return self._verdicts[key]

    def _classify(self, query: str) -> Verdict:
        def ids(rows):
            return [r['id'] for r in rows]

        parsed = si.parse_query(query)
        hits = si.search_parsed(self.canon, parsed)
        if hits:
            return Verdict('resolved', ids(hits))

        loose = _loosened(parsed)
        loosened = loose != parsed and _has_terms(loose)
        if loosened:
            hits = si.search_parsed(self.canon, loose)
            if hits:
                return Verdict('filtered', ids(hits))

        text = intent_text(parsed)
        by_artist = bool(parsed['artist_filter'] or parsed['composer_filter'])
        if not text and not by_artist:
            return Verdict('filters')

        archived = []
        for candidate in (parsed, loose) if loosened else (parsed,):
            archived = si.search_parsed(self.archive, candidate)
            if archived:
                break
        if text:
            key = _title_key(text)
            titled = [r for r in archived if key and key in _title_key(r.get('title'))]
            if titled:
                return Verdict('dungeon', ids(titled))
            near = self.near_titles(text)
            in_canon = [work_id for work_id, is_archived in near if not is_archived]
            if in_canon:
                return Verdict('misspelled', in_canon)
            if near:
                return Verdict('dungeon', [work_id for work_id, _ in near])
        # What is left matched lyrics or credits, not a title: context for a
        # person (an artist's songs are in the dungeon; a song names her), not
        # a song to promote.
        return Verdict('artist' if by_artist and not text else 'missing', ids(archived))


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------

def fetch_events(client, since: str, page_size: int = 1000) -> list:
    """Every search-gap event since `since`, oldest first, paged."""
    rows, start = [], 0
    while True:
        page = (client.table('analytics_events')
                .select('visitor_id,event_name,properties,created_at')
                .in_('event_name', list(EVENT_NAMES))
                .gte('created_at', since)
                .order('created_at')
                .order('id')
                .range(start, start + page_size - 1)
                .execute()).data or []
        rows.extend(page)
        if len(page) < page_size:
            return rows
        start += page_size


# --------------------------------------------------------------------------
# The report
# --------------------------------------------------------------------------

SECTIONS = [
    ('missing', 'NOT IN THE SONGBOOK — add it'),
    ('dungeon', 'IN THE DUNGEON — promote it'),
    ('filtered', 'HERE, BUT NOT WITH THOSE FILTERS — a missing take or tag'),
    ('misspelled', 'SPELLED DIFFERENTLY — maybe meant a song we have'),
    ('artist', 'ARTISTS WITH NO SONGS HERE'),
    ('filters', 'NOTHING MATCHES THESE FILTERS — a mistyped tag, or an empty combination'),
    ('resolved', 'FOUND NOTHING THEN, IN THE SONGBOOK NOW'),
]
OUTCOMES = [('found', 'found'), ('recovered', 'recovered'),
            ('gave_up', 'gave up'), ('browsed', 'browsed')]


@dataclass
class Gap:
    key: str
    visitors: set = field(default_factory=set)
    queries: set = field(default_factory=set)
    ids: list = field(default_factory=list)
    opened: set = field(default_factory=set)
    opened_by: set = field(default_factory=set)
    result_count: int = 0


def _ids_text(ids: list) -> str:
    shown = ', '.join(ids[:MAX_IDS_SHOWN])
    more = len(ids) - MAX_IDS_SHOWN
    return shown + (f' +{more} more' if more > 0 else '')


def _ranked(gaps) -> list:
    return sorted(gaps, key=lambda g: (-len(g.visitors), g.key))


def _gap_line(gap: Gap, *, arrow: str = '') -> str:
    line = f'{len(gap.visitors):>3}  {gap.key}'
    also = sorted(gap.queries - {gap.key})
    if also:
        line += f'  (also: {"; ".join(also)})'
    if arrow and gap.ids:
        line += f'  {arrow} {_ids_text(gap.ids)}'
    if gap.opened:
        line += f'  · then opened {", ".join(sorted(gap.opened))}'
    return line


def _host(referrer: str | None) -> str | None:
    if not referrer:
        return None
    host = urlparse(referrer).hostname or ''
    return host.removeprefix('www.') or None


def render_report(events: list, corpus: Corpus, *, since: str, until: str,
                  index_note: str | None = None) -> str:
    journeys = build_journeys(events)
    misses = find_misses(journeys)
    out = [f'Search gaps, {since} → {until}']

    counts = {key: sum(j.outcome == key for j in journeys) for key, _ in OUTCOMES}
    visitors = len({j.visitor for j in journeys})
    out.append(f'  {len(journeys)} search journeys from {visitors} visitors: '
               + ' · '.join(f'{label} {counts[key]}' for key, label in OUTCOMES))
    if index_note:
        out.append(f'  {index_note}')

    # Zero-result searches, grouped by verdict and by what was looked for.
    # The dungeon is grouped by WORK instead: the question there is which
    # archived song to promote, however it was spelled.
    by_section = {key: {} for key, _ in SECTIONS}
    for miss in (m for m in misses if m.kind == 'zero'):
        verdict = corpus.classify(miss.query)
        norm = normalize(miss.query)
        if verdict.category == 'dungeon':
            for work_id in verdict.ids[:MAX_IDS_SHOWN]:
                gap = by_section['dungeon'].setdefault(work_id, Gap(work_id, ids=[work_id]))
                gap.visitors.add(miss.visitor)
                gap.queries.add(norm)
            continue
        # A take or an artist is the whole query; anything else is its words
        key = (norm if verdict.category in ('filtered', 'artist', 'filters')
               else intent_text(si.parse_query(miss.query)) or norm)
        gap = by_section[verdict.category].setdefault(key, Gap(key))
        gap.visitors.add(miss.visitor)
        gap.queries.add(norm)
        gap.ids = gap.ids or verdict.ids
        if miss.then_opened:
            gap.opened.add(miss.then_opened)

    # Archived works opened from an "Include the dungeon" search
    for j in journeys:
        last_search = None
        for step in j.steps:
            if step.kind == 'search':
                last_search = step
            elif (step.song_id in corpus.archived_ids and last_search is not None
                  and last_search.scope == 'canon+dungeon'):
                gap = by_section['dungeon'].setdefault(step.song_id, Gap(step.song_id, ids=[step.song_id]))
                gap.visitors.add(j.visitor)
                gap.opened_by.add(j.visitor)
                gap.queries.add(normalize(last_search.query))

    arrows = {'filtered': '→', 'misspelled': '→ maybe', 'resolved': '→'}
    notes = {'missing': 'the dungeon mentions it in', 'artist': 'the dungeon has'}
    for category, title in SECTIONS:
        gaps = _ranked(by_section[category].values())
        if not gaps:
            continue
        out += ['', title]
        for gap in gaps:
            if category == 'dungeon':
                searched = '; '.join(sorted(q for q in gap.queries if q))
                opened = f'; opened by {len(gap.opened_by)}' if gap.opened_by else ''
                out.append(f'{len(gap.visitors):>3}  {gap.key}  (searched: {searched}{opened})')
                out.append(f'       ./scripts/utility curate unprune {gap.key} '
                           f'--reason "searched for: {searched}"')
                continue
            line = _gap_line(gap, arrow=arrows.get(category, ''))
            if category in notes and gap.ids:
                line += f'  ({notes[category]} {_ids_text(gap.ids)})'
            out.append(line)
            if category == 'missing' and si.parse_query(gap.key)['text_terms']:
                out.append(f'       ./scripts/utility add-placeholder "{string.capwords(gap.key)}"')

    # Results came back, nothing was opened: weaker, but worth reading
    unopened = {}
    for miss in (m for m in misses if m.kind == 'unopened'):
        norm = normalize(miss.query)
        gap = unopened.setdefault(norm, Gap(norm))
        gap.visitors.add(miss.visitor)
        gap.result_count = miss.result_count
    if unopened:
        out += ['', 'HAD RESULTS, OPENED NONE — not what they wanted?']
        for gap in _ranked(unopened.values()):
            plural = '' if gap.result_count == 1 else 's'
            out.append(f'{_gap_line(gap)}  ({gap.result_count} result{plural})')

    # Song pages that did not exist (old links, Google, typed URLs)
    not_found = {}
    for event in events:
        if event['event_name'] != 'song_not_found':
            continue
        props = event.get('properties') or {}
        song_id = props.get('song_id') or '?'
        entry = not_found.setdefault(song_id, {'visitors': set(), 'sources': set(), 'hosts': set()})
        entry['visitors'].add(event['visitor_id'])
        entry['sources'].add(props.get('source') or '?')
        host = _host(props.get('referrer'))
        if host:
            entry['hosts'].add(host)
    if not_found:
        out += ['', 'SONG PAGES NOT FOUND — old links, search engines, typed URLs']
        for song_id, entry in sorted(not_found.items(), key=lambda kv: (-len(kv[1]['visitors']), kv[0])):
            notes = [', '.join(sorted(entry['sources']))]
            if entry['hosts']:
                notes.append('from ' + ', '.join(sorted(entry['hosts'])))
            if song_id in corpus.canon_ids:
                notes.append('in the songbook now')
            elif song_id in corpus.archived_ids:
                notes.append('in the dungeon now')
            else:
                near = [work_id for work_id, _ in corpus.near_titles(song_id.replace('-', ' '))]
                if near:
                    notes.append(f'maybe {_ids_text(near)}')
            out.append(f'{len(entry["visitors"]):>3}  {song_id}  ({"; ".join(notes)})')

    if len(out) <= 3:
        out += ['', 'Nothing missed.']
    return '\n'.join(out) + '\n'


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(
        description='What visitors searched for and could not find.',
        epilog='The report is printed only: the queries are visitors\' words.')
    parser.add_argument('--since', help='YYYY-MM-DD (default: 30 days ago)')
    parser.add_argument('--data-dir', type=Path, default=DATA_DIR,
                        help='Built index to classify against (default: docs/data)')
    args = parser.parse_args(argv)

    today = date.today()
    since = args.since or (today - timedelta(days=30)).isoformat()
    corpus = Corpus.load(args.data_dir)
    built = datetime.fromtimestamp((args.data_dir / 'index.jsonl').stat().st_mtime)
    note = (f'Verdicts from {args.data_dir} (built {built:%Y-%m-%d %H:%M}); '
            f'refresh with ./scripts/bootstrap --quick.')

    from supabase_client import connect, fetch_failed
    client = connect('search analytics')
    try:
        events = fetch_events(client, since)
    except Exception as exc:                       # noqa: BLE001
        fetch_failed('search analytics', exc)

    print(render_report(events, corpus, since=since, until=today.isoformat(), index_note=note),
          end='')


if __name__ == '__main__':
    main()
