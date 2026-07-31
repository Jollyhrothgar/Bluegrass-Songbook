#!/usr/bin/env python3
"""Web-chords parser: raw chord pages -> ChordPro.

The raw corpus in ``sources/web-chords/raw/`` was fetched by
``scripts/lib/fetch_chords.py`` from whatever chord site a DuckDuckGo search
turned up for each title on the Strum Machine missing list
(``docs/data/sm_missing_vocals.json``). Every file carries a metadata header::

    # title: Act Naturally
    # source_url: https://tabs.ultimate-guitar.com/tab/the-beatles/act-naturally-chords-816028
    # fetched_at: 2026-02-01 21:42:15

    <raw page text>

Four sites are represented (302 Ultimate Guitar, 14 e-chords, 8 cowboylyrics,
1 azchords) but only two *formats* matter, and both are chords-over-lyrics
monospace text:

1. **Ultimate Guitar** — ``[Verse 1]`` / ``[Chorus]`` bracket section markers,
   chord line directly above each lyric line, blank-ish separator lines.
2. **e-chords / cowboylyrics / azchords** — same chord-over-lyric pairing with
   ``Intro:``-style colon labels, ``( D G D A D )`` interlude grids, ``#1.``
   verse markers, and site debris (``hide ad ⨯``, "PLEASE NOTE" banners,
   uploader credits, tablature blocks, footers).

A third, rarer shape is inline parenthesised chords (``I'm (A)dreaming now of
(D)Halley``) which needs no column arithmetic at all.

Design notes
------------
*Column mapping, not proportional scaling.* ``sources/classic-country`` maps a
chord's column onto the lyric line by scaling ``col / len(chord_line) *
len(lyric_line)`` — that drifts badly whenever the chord line is padded past
the end of the lyric (which is the normal case, since the last chord sits to
the right of the last word). Here a chord at column ``c`` means column ``c`` of
the lyric line, snapped to the nearest word boundary, and chords are inserted
right-to-left so earlier insertions can't shift later offsets.

*Strict quality gate.* These files reconstruct canonical bluegrass repertoire,
so a wrong chart is worse than no chart. Files are rejected — reported, never
emitted — when they are navigation debris, lyrics-only, tablature-only,
chord-grid-only (no lyrics), when the fetched page's own title disagrees with
the title we asked for (the search engine handed back a different song), or
when fewer than 60% of the tokens on chord-shaped lines actually parse as
chords.

Usage::

    # Parse everything, write parsed/*.pro plus a reject report
    uv run python sources/web-chords/src/parser.py

    # One file, printed to stdout with the verdict on stderr
    uv run python sources/web-chords/src/parser.py --file act-naturally.txt
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = REPO_ROOT / 'sources' / 'web-chords' / 'raw'
PARSED_DIR = REPO_ROOT / 'sources' / 'web-chords' / 'parsed'
REPORT_PATH = REPO_ROOT / 'sources' / 'web-chords' / 'parse_report.json'

MIN_CHORD_VALIDITY = 0.60
MIN_GATE_TOKENS = 8
MIN_LYRIC_LINES = 4
MIN_TITLE_TOKEN_MATCH = 0.65
PREAMBLE_SCAN_LINES = 12


# ---------------------------------------------------------------------------
# Chord tokens
# ---------------------------------------------------------------------------

# A chord token: root, optional accidental, optional quality/extension stack,
# optional slash bass. Deliberately anchored — used to decide whether a whole
# line is chords, so it must not match ordinary words ("Age", "Bad", "Amen").
CHORD_TOKEN_RE = re.compile(
    r"""^
    [A-G][#b♯♭]?                        # root + accidental
    (?:maj|min|m|M|dim|aug|sus|add|°|\+)?    # quality
    \d{0,2}
    (?:(?:maj|min|m|sus|add|aug|dim|no|b|\#|/)\d{1,2})*
    (?:\((?:\#|b|no)?\d{1,2}\))?                  # (9), (b5)
    (?:/[A-G][#b♯♭]?)?                  # slash bass
    $""",
    re.VERBOSE,
)

# Same body, unanchored, for scanning a chord line and recording columns.
CHORD_SCAN_RE = re.compile(
    r"""(?<![A-Za-z0-9#/])
    [A-G][#b♯♭]?
    (?:maj|min|m|M|dim|aug|sus|add|°|\+)?
    \d{0,2}
    (?:(?:maj|min|m|sus|add|aug|dim|no|b|\#)\d{1,2})*
    (?:/[A-G][#b♯♭]?)?
    (?![A-Za-z])""",
    re.VERBOSE,
)

# Inline chord already written into the lyric line: "(A)dreaming", "[G]weep"
INLINE_CHORD_RE = re.compile(r'[\(\[]([A-G][#b]?[A-Za-z0-9+#/\(\)]{0,7})[\)\]]')

# Decoration that can hang off a chord token on a chord line.
_TOKEN_TRIM = '|()[]{}<>.,;*'


def strip_accents(text: str) -> str:
    text = unicodedata.normalize('NFKD', text)
    return text.encode('ascii', 'ignore').decode('ascii')


def is_chord_token(token: str) -> bool:
    """True if ``token`` is a chord symbol (after trimming grid decoration)."""
    tok = token.strip(_TOKEN_TRIM)
    if not tok:
        return False
    # Repeat counts and rest markers are grid furniture, not chords.
    if re.fullmatch(r'[xX]\d+|\d+[xX]|N\.?C\.?|%', tok):
        return False
    return bool(CHORD_TOKEN_RE.match(tok))


# ---------------------------------------------------------------------------
# Line classification
# ---------------------------------------------------------------------------

TAB_LINE_RE = re.compile(
    r"""^\s*
    (?:[EADGBeadgb]\|?|\|)?\s*
    [-|]
    [-\d|hpsbrtx/\\~<>()\s•*]{7,}
    $""",
    re.VERBOSE,
)

CHORD_DIAGRAM_RE = re.compile(
    r'^\s*[A-G][#b]?[A-Za-z0-9#/+()]{0,8}\s*[:=]\s*[x0-9\-]{4,8}\s*$', re.I)

# Punctuation that never appears on a chord line but is common in lyrics.
# The apostrophe matters: "Christmas Time's A-Comin'" is otherwise all
# capitalised short tokens starting with a note letter.
_LYRIC_PUNCT_RE = re.compile(r'[,!?"\'‘’“”]')


def is_blank(line: str) -> bool:
    return not line.strip()


_RULE_RE = re.compile(r'^\s*[-=*_~#+.]{4,}\s*$')


def is_tab_line(line: str) -> bool:
    if not line.strip() or _RULE_RE.match(line):
        return False
    body = line.strip()
    if body.count('-') < 5:
        return False
    # A run of dashes this long is a fretboard string, wherever it sits on the
    # line ("B|----(Guitar)-------0--1--3--|", "e|-------|  Strum D Chord").
    if re.search(r'-{8,}', body):
        return True
    return bool(TAB_LINE_RE.match(line))


# Grid furniture that shares a chord line without being a chord: bar lines,
# repeat counts, emphasis asterisks.
_FURNITURE_RE = re.compile(
    # `l` is a mistyped bar line — common enough in hand-typed grids
    # ("Dm  F  l  C   l C  G") that it's worth treating as furniture.
    r'^(?:\|+|l+|/+|:+|\*+|-+|\.+|%|[xX]\d+|\d+[xX]|\(\)|N\.?C\.?)$')


def tokens_of(line: str) -> list[str]:
    """Chord-bearing tokens of a line, with grid furniture removed.

    ``|Am  |C  |Am D7 |G | x2`` is 100% chords; counting the pipes and the
    repeat marker as failures would sink it to 45% and trip the quality gate.
    """
    return [t for t in line.split() if not _FURNITURE_RE.match(t)]


def is_chord_line(line: str) -> bool:
    """True if the line is (essentially) nothing but chord symbols.

    Strict: >=70% of tokens must parse as chords, the line must not carry
    lyric punctuation, and it must not be tablature.
    """
    if not line.strip() or is_tab_line(line):
        return False
    if _LYRIC_PUNCT_RE.search(line):
        return False
    toks = tokens_of(line)
    if not toks or len(toks) > 24:
        return False
    good = sum(1 for t in toks if is_chord_token(t))
    return good / len(toks) >= 0.7


# A chord line spreads its symbols out to sit over the right syllables, so it
# carries wide internal gaps; prose is single-spaced.
_WIDE_GAP_RE = re.compile(r'\S\s{3,}\S')


def is_candidate_chord_line(line: str) -> bool:
    """Loose, *shape only* test used by the quality gate.

    Catches lines that occupy the chord-line slot without being chords —
    fretboard letters, Nashville numbers, tuning notes, nonsense — so the gate
    has a non-trivial denominator. Gating on ``is_chord_line`` tokens alone
    would be circular: that test already demands 70% valid chords.

    Shape only, so it must not sweep in prose. All-caps lyrics (cowboylyrics
    shouts everything) have no lowercase words to disqualify them, hence the
    gap/short-line requirement.
    """
    if not line.strip() or is_tab_line(line):
        return False
    if CHORD_DIAGRAM_RE.match(line):
        return False
    if detect_section_marker(line):
        return False
    if INLINE_CHORD_RE.search(line):
        return False
    if _LYRIC_PUNCT_RE.search(line):
        return False
    toks = tokens_of(line)
    if not toks or len(toks) > 24:
        return False
    # A real lowercase word means it's lyrics, not a chord slot.
    for t in toks:
        if re.fullmatch(r"[a-z][a-z'\-]{2,}", t.strip(_TOKEN_TRIM)):
            return False
    if not (len(toks) <= 3 or _WIDE_GAP_RE.search(line)):
        return False
    return any(re.match(r'^[A-G]', t.strip(_TOKEN_TRIM)) for t in toks)


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------

SECTION_WORDS = (
    'intro', 'introduction', 'verse', 'chorus', 'refrain', 'bridge', 'outro',
    'ending', 'instrumental', 'interlude', 'pre-chorus', 'prechorus', 'solo',
    'break', 'tag', 'coda', 'hook', 'part', 'riff', 'turnaround', 'vamp',
    'chords', 'guitar solo', 'banjo solo', 'fiddle solo', 'mandolin solo',
    'banjo break', 'guitar intro', 'trumpet solo', 'harmonica solo',
)

# Words that can precede/follow a section word without changing its meaning.
_SECTION_FILLER = (
    'first', 'second', 'third', 'fourth', 'fifth', 'last', 'final', 'only',
    'again', 'repeat', 'x2', 'x3', 'x4', 'guitar', 'banjo', 'fiddle',
    'mandolin', 'harmonica', 'trumpet', 'dobro', 'a', 'b', 'c', 'd',
)


def _canonical_section_word(label: str) -> Optional[str]:
    """Map a raw label to one of SECTION_WORDS, tolerating typos."""
    cleaned = re.sub(r'[^a-z\- ]', ' ', strip_accents(label).lower())
    words = [w for w in cleaned.split() if w]
    if not words:
        return None
    # Try longest phrase first ("guitar solo" before "solo").
    for phrase in (' '.join(words), words[-1], words[0]):
        if phrase in SECTION_WORDS:
            return phrase
        near = difflib.get_close_matches(phrase, SECTION_WORDS, n=1, cutoff=0.82)
        if near:
            return near[0]
    # Allow "Verse 1 (repeat)" style trailing filler.
    core = [w for w in words if w not in _SECTION_FILLER]
    if len(core) == 1 and core[0] in SECTION_WORDS:
        return core[0]
    return None


def _tidy_label(label: str) -> str:
    label = re.sub(r'\s+', ' ', label.strip(' :*()[]-')).strip()
    if not label:
        return label
    if label.isupper() or label.islower():
        label = ' '.join(
            w if re.fullmatch(r'[A-G][#b]?\d*', w) else w.capitalize()
            for w in label.split()
        )
    return label


@dataclass
class SectionMarker:
    label: str          # display label, e.g. "Verse 2"
    kind: str           # 'verse' | 'chorus' | 'bridge'
    trailing: str = ''  # content that shared the marker line ("Intro:D G D")


def detect_section_marker(line: str) -> Optional[SectionMarker]:
    """Recognise a section header line, in any of the corpus's dialects."""
    stripped = line.strip()
    if not stripped:
        return None

    label = None
    trailing = ''
    free_label = False   # bracket markers may carry any name

    # [Verse 1] / [Chorus] / [Middle] / [(intro) ]D A D
    m = re.match(r'^\[([^\]]{1,40})\]\s*(.*)$', stripped)
    if m and re.search(r'[A-Za-z]{3}', m.group(1)) and not is_chord_token(m.group(1)):
        # Ultimate Guitar wraps every structural marker in brackets, so the
        # label vocabulary is open-ended ([Middle], [Hook], [Part B]).
        label, trailing = m.group(1), m.group(2)
        free_label = True

    # (Chorus)
    if label is None:
        m = re.match(r'^\(([^)]{1,30})\)\s*$', stripped)
        if m and _canonical_section_word(m.group(1)):
            label = m.group(1)

    # * * * CHORUS * * *   /   **Chorus**
    if label is None:
        m = re.match(r'^[*\s]*\*+[\s*]*([A-Za-z][A-Za-z0-9 \'#\-]{0,30}?)[\s*]*\*+[*\s]*$',
                     stripped)
        if m and _canonical_section_word(m.group(1)):
            label = m.group(1)

    # #1.  /  #2   (azchords verse numbering)
    if label is None:
        m = re.match(r'^#\s*(\d{1,2})\.?\s*$', stripped)
        if m:
            label = f'Verse {m.group(1)}'

    # Chorus:  /  Verse 2:  /  Intro:D G D A D
    if label is None:
        m = re.match(r"^([A-Za-z][A-Za-z0-9 '#\-]{0,28}?)\s*:\s*(.*)$", stripped)
        if m and _canonical_section_word(m.group(1)):
            label, trailing = m.group(1), m.group(2)

    # Bare marker with no punctuation at all: "A Part", "x2 Part B", "Chorus".
    # Every word must be a section word or filler, or "Part of me" would read
    # as a section header.
    if label is None and len(stripped.split()) <= 3 and not stripped.endswith('.'):
        words = [w.lower().strip('.,') for w in stripped.split()]
        if words and _canonical_section_word(stripped) and all(
                w in _SECTION_FILLER or w in SECTION_WORDS
                or re.fullmatch(r'[a-g0-9]|x\d+|\d+', w) for w in words):
            label = stripped

    if label is None:
        return None

    word = _canonical_section_word(label)
    if word is None:
        if not free_label:
            return None
        word = 'verse'

    if word == 'chorus':
        kind = 'chorus'
    elif word == 'bridge':
        kind = 'bridge'
    else:
        kind = 'verse'

    return SectionMarker(label=_tidy_label(label), kind=kind,
                         trailing=trailing.strip())


# ---------------------------------------------------------------------------
# Header / URL / title-artist derivation
# ---------------------------------------------------------------------------

HEADER_RE = re.compile(r'^#\s*(title|source_url|fetched_at|artist)\s*:\s*(.*)$')


def parse_header(text: str) -> tuple[dict, str]:
    """Split the ``# key: value`` header from the page body."""
    meta: dict[str, str] = {}
    lines = text.split('\n')
    i = 0
    for i, line in enumerate(lines):
        m = HEADER_RE.match(line)
        if m:
            meta[m.group(1)] = m.group(2).strip()
            continue
        break
    return meta, '\n'.join(lines[i:])


_UG_TAIL_RE = re.compile(
    r'-(?:chords|tabs|tab|official|ukulele-chords|bass-tabs|guitar-pro|power-tab)'
    r'(?:-ver-?\d+)?-\d+$')

_ARTIST_NOISE = {'misc', 'traditional', 'unsigned', 'bands', 'soundtrack',
                 'christmas', 'originals', 'computer', 'games', 'your',
                 'favorite', 'coffeehouse', 'songs', 'hymns', 'television',
                 'cartoons', 'holiday', 'sesame', 'street'}

_GENERIC_ARTISTS = {
    'misc-traditional', 'traditional', 'misc-unsigned-bands', 'misc-soundtrack',
    'misc-christmas', 'misc-originals', 'misc-computer-games',
    'misc-your-favorite-coffeehouse', 'misc-television', 'misc-cartoons',
    'misc-holiday', 'misc-hymns', 'bluegrass', 'unknown',
}


def parse_source_url(url: str) -> tuple[str, str, str]:
    """``(host, artist_slug, title_slug)``; slugs are ``''`` when unavailable."""
    if not url:
        return '', '', ''
    p = urlparse(url)
    host = p.netloc
    segs = [s for s in p.path.split('/') if s]

    if 'ultimate-guitar' in host:
        if len(segs) >= 3 and segs[0] == 'tab':
            title = _UG_TAIL_RE.sub('', segs[-1])
            title = re.sub(r'-\d+$', '', title)
            return host, segs[1], title
        return host, '', ''          # /tab/<numeric-id> carries no slugs

    if 'e-chords' in host and len(segs) >= 3:
        return host, segs[1], segs[2]

    if 'cowboylyrics' in host and len(segs) >= 3:
        return host, segs[1], re.sub(r'-\d+\.html?$', '', segs[-1])

    if 'azchords' in host and len(segs) >= 2:
        artist = re.sub(r'-tabs-\d+$', '', segs[-2])
        title = re.sub(r'-tabs-\d+\.html?$', '', segs[-1])
        return host, artist, title

    return host, '', (segs[-1] if segs else '')


def _artist_from_slug(slug: str) -> Optional[str]:
    """Human-readable artist name from a URL slug, or None if it's generic.

    Only Ultimate Guitar and e-chords slugs are in reliable first-last order.
    cowboylyrics uses ``lastname-firstname`` inconsistently and azchords
    mangles names, so those callers pass nothing here.
    """
    if not slug or slug.lower() in _GENERIC_ARTISTS:
        return None
    words = [w for w in slug.split('-') if w]
    if not words or set(words) <= _ARTIST_NOISE:
        return None
    small = {'and', 'of', 'the', 'a', 'his', 'her', 'de'}
    out = []
    for i, w in enumerate(words):
        if w in small and i > 0:
            out.append(w)
        elif len(w) <= 2 and w.isalpha() and i > 0:
            out.append(w.upper())     # "tom-t-hall" -> "Tom T Hall"
        else:
            out.append(w.capitalize())
    return ' '.join(out)


# Decorations the Strum Machine catalogue tacks onto a title that aren't part
# of the song's name ("Ida Red with 4 chords", "Adieu False Heart via Dirk
# Powell", "Ground Hog modal version"). Deliberately conservative — a title is
# also verified in its unstripped form, so an over-eager strip can't cause a
# false rejection, only a slightly wordy display title.
_TITLE_MODIFIERS = re.compile(
    r'\s+(?:'
    r'chords?|tabs?|lyrics|versions?|arrangements?|arranged|simplified|'
    r'modal|major|minor|'
    r'just\s+the\s+.*|via\s+.*|w/.*|with\s+\d.*|with\s+[^,]*chords?.*|'
    r'key\s+of\s+.*|capo\s+.*|living\s+room.*|'
    r'\d+\s+bars?|\d+\s*/?\s*\d+\s+time|'
    r'(?:two|three|four|five|six|seven|\d+)\s+parts?|'
    r'(?:dobro|fiddle|banjo|mandolin|guitar)\s+tune|'
    r'round\s+peak|texas\s+style|drawn\s+out'
    r')\b.*$', re.I)

_STOPWORDS = {'the', 'a', 'an', 'of', 'and', 'to', 'my', 'in', 'is', 'on',
              's', 'o'}

# Trailing slug words that name the page type, not the song.
_SLUG_NOISE = {'song', 'chords', 'chord', 'tab', 'tabs', 'lyrics', 'official',
               'ver', 'acoustic'}


def _significant_tokens(text: str) -> list[str]:
    """Comparable tokens: accents folded, apostrophes closed up, stops dropped.

    Apostrophes must close up rather than split, or ``Don't`` tokenizes as
    ``don`` + ``t`` and never matches the ``dont`` a URL slug carries — that
    alone accounted for a dozen bogus title mismatches.
    """
    text = strip_accents(text.replace('’', "'").replace('`', "'")).lower()
    text = text.replace("'", '')
    text = re.sub(r'[^a-z0-9 ]', ' ', text)
    return [w for w in text.split() if w and w not in _STOPWORDS]


def _slug_tokens(slug: str) -> list[str]:
    toks = _significant_tokens(slug.replace('-', ' '))
    while len(toks) > 1 and toks[-1] in _SLUG_NOISE:
        toks.pop()
    return toks


def _token_matches(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) >= 4 and len(b) >= 4:
        return difflib.SequenceMatcher(None, a, b).ratio() >= 0.85
    return False


def _contiguous_in(needle: list[str], haystack: list[str]) -> bool:
    """Is ``needle`` a contiguous run of ``haystack`` (fuzzy per token)?"""
    if not needle or len(needle) > len(haystack):
        return False
    for start in range(len(haystack) - len(needle) + 1):
        if all(_token_matches(n, h) for n, h
               in zip(needle, haystack[start:start + len(needle)])):
            return True
    return False


@dataclass
class TitleVerdict:
    title: str
    artist: Optional[str]
    verified: bool          # did the fetched page's own slug corroborate?
    checkable: bool         # did the URL carry a title slug at all?
    matched: float = 0.0
    detail: str = ''


def derive_title_artist(header_title: str, url: str) -> TitleVerdict:
    """Clean the requested title, name the artist, and cross-check the page.

    The header title comes from the Strum Machine catalogue, which routinely
    bakes the artist or an arrangement note into the name ("Amber Tresses Tied
    in Blue Flatt & Scruggs", "Ida Red with 4 chords"). The URL slug is the
    page the fetcher actually landed on. Agreement between the two is the only
    evidence we have that the search engine returned the right song.
    """
    host, artist_slug, title_slug = parse_source_url(url)

    raw = re.sub(r'\s+', ' ', (header_title or '').strip())
    # "Title (alt title)" -> keep the primary
    stripped = re.sub(r'\s*\([^)]*\)\s*$', '', raw).strip() or raw
    stripped = _TITLE_MODIFIERS.sub('', stripped).strip(' -,')
    title = stripped or raw

    url_artist = None
    if host and ('ultimate-guitar' in host or 'e-chords' in host):
        url_artist = _artist_from_slug(artist_slug)

    # If the catalogue title ends with the artist name, that's a suffix, not
    # part of the title: "Dooley The Dillards" -> "Dooley" / The Dillards.
    if url_artist:
        atoks = _significant_tokens(url_artist)
        ttoks_raw = title.split()
        # Ascending k finds the *longest* artist suffix ("Age Bluegrass Album
        # Band" -> "Age", not "Age Bluegrass Album").
        for k in range(1, len(ttoks_raw)):
            tail = _significant_tokens(' '.join(ttoks_raw[k:]))
            if tail and all(any(_token_matches(t, a) for a in atoks) for t in tail):
                title = ' '.join(ttoks_raw[:k]).strip(' -,')
                break

    # Otherwise, if some prefix of the catalogue title *is* the page's own
    # title, the rest is an attribution the catalogue tacked on:
    # "Amber Tresses Tied in Blue Flatt & Scruggs" -> "Amber Tresses Tied in
    # Blue" (the page is the-carter-family/amber-tresses-tied-in-blue).
    slug_tokens = _slug_tokens(title_slug)
    if slug_tokens:
        ttoks_raw = title.split()
        for k in range(len(ttoks_raw) - 1, 1, -1):
            head = _significant_tokens(' '.join(ttoks_raw[:k]))
            if len(head) == len(slug_tokens) and all(
                    _token_matches(h, s) for h, s in zip(head, slug_tokens)):
                title = ' '.join(ttoks_raw[:k]).strip(' -,')
                break

    if not title:
        title = raw

    # Cross-check against the page's own title slug.
    if not slug_tokens:
        return TitleVerdict(title=title, artist=url_artist, verified=True,
                            checkable=False, detail='no url title slug')

    best = 0.0
    ok = False
    # Check the cleaned title and the catalogue's raw title; either
    # corroborating is enough, so an over-eager modifier strip can't reject a
    # good file.
    for candidate in dict.fromkeys([title, stripped, raw]):
        want = _significant_tokens(candidate)
        if not want:
            continue
        hits = sum(1 for t in want
                   if any(_token_matches(t, u) for u in slug_tokens))
        ratio = hits / len(want)
        concat = difflib.SequenceMatcher(
            None, ''.join(want), ''.join(slug_tokens)).ratio()
        best = max(best, ratio, concat)

        # The head of the requested title appearing on the page is what
        # separates "I Don't Love Nobody" from the page's "Love Don't Love
        # Nobody", where token overlap alone looks fine.
        head_seen = any(_token_matches(want[0], u) for u in slug_tokens)

        passed = (
            # Same words, differently spaced: "Good Night Irene"/"goodnight
            # irene", "Ground Hog"/"groundhog", "Alleycat"/"alley cat".
            concat >= 0.90
            or (ratio >= MIN_TITLE_TOKEN_MATCH and head_seen)
            or (ratio >= MIN_TITLE_TOKEN_MATCH and concat >= 0.85)
            # The page's whole title sits inside the catalogue's, which is what
            # a catalogue prefix looks like ("Going Across the Sea" for the
            # page's "Across the Sea"). Requiring most of the catalogue title
            # to be accounted for keeps "Blue Moon of Kentucky waltz version"
            # from matching the page's (different) "Kentucky Waltz".
            or (_contiguous_in(slug_tokens, want)
                and len(slug_tokens) >= 2
                and len(slug_tokens) / len(want) >= 0.6)
        )

        if passed and len(want) < 2:
            # A one-word title matching one word of a longer page title is weak
            # evidence ("Cheyenne" vs "I Can Still Make Cheyenne"), so require
            # the page title to be about the same thing too.
            extra = [u for u in slug_tokens
                     if not any(_token_matches(u, t) for t in want)]
            passed = not extra or concat >= 0.90
        ok = ok or passed

    return TitleVerdict(
        title=title, artist=url_artist, verified=ok, checkable=True,
        matched=round(best, 2),
        detail=f"asked {_significant_tokens(title)!r} got {slug_tokens!r}",
    )


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------

_DEBRIS_SUBSTRINGS = (
    'hide ad', 'ultimate-guitar.com', 'youtube.com', 'youtu.be',
    'spotify.com', 'wikipedia.org', 'e-chords.com', 'cowboylyrics.com',
    'azchords.com', 'liveloveguitar', 'subscribe to my', 'buy this song',
    'view all', 'sign up', 'log in', 'cookie', 'advertisement',
    'this file is the author', 'you may only use this file',
    'my opinions do not reflect',
)

_DEBRIS_LINE_RES = (
    re.compile(r'^\s*[-=*_~#+.]{4,}\s*$'),                       # separators
    re.compile(r'^\s*\[?/?tab\]?\s*$', re.I),                    # [tab] markers
    re.compile(r'^\s*(?:tabbed|transcribed|submitted|corrected|arranged|'
               r'notated|typed)\s+(?:by|for)\b.*$', re.I),
    re.compile(r'^\s*from\s*:.*$', re.I),
    re.compile(r'^\s*\S+@\S+\.\S+\s*$'),                         # bare email
    re.compile(r'^\s*(?:https?://|www\.)\S*\s*$', re.I),
    re.compile(r'^\s*[pshb]\s*[:=]\s*(?:pull|hammer|slide|bend)\b.*$', re.I),
    re.compile(r'^\s*\*{2,}.*$'),                                # **performance note
    re.compile(r'^\s*\(?no\s+capo\)?\s*$', re.I),
    re.compile(r'^\s*standard\s+tuning\s*$', re.I),
)

_KEY_RE = re.compile(r'^\s*key\s*(?:of|:|\s)\s*'
                     r'([A-G][#b]?(?:m|min|maj|mix|dor|aeo)?[a-z]*)\s*'
                     r'(?:\(.*\))?\s*$', re.I)
_CAPO_RE = re.compile(r'^\s*\*?\s*capo\s*[:\-]?\s*(.{1,24}?)\s*$', re.I)
_TUNING_RE = re.compile(r'^\s*tuning\s*[:\-]\s*(.{1,40}?)\s*$', re.I)

_PREAMBLE_RES = (
    re.compile(r'^\s*(?:album|title|artist|song|words|music|lyrics|'
               r'words\s+and\s+music|music\s+and\s+words|recorded\s+by|'
               r'as\s+(?:recorded|performed|sung)\s+by|from\s+the\s+album|'
               r'written\s+by|composed\s+by|performed\s+by|tempo|time|'
               r'released|label|track|traditional|arr)\b\s*[:.\-]?.*$', re.I),
    re.compile(r'^\s*\(?\d{4}\)?\s*$'),                          # year
    re.compile(r'^\s*by\s+\S{1,30}\s*$', re.I),                  # "By Ohrblind"
    re.compile(r'^\s*\(.{0,60}\)\s*$'),                          # "(No Capo)"
)

# A bare name line in the preamble ("Stuart Duncan & Dolly Parton", "SONNY
# BURGESS") — title-cased or shouted, short, unpunctuated.
_PREAMBLE_NAME_RE = re.compile(
    r"^\s*(?:[A-Z][\w'.\-]*|&|and|of|the|with|feat\.?)"
    r"(?:\s+(?:[A-Z][\w'.\-]*|&|and|of|the|with|feat\.?)){0,5}\s*$")


@dataclass
class Cleaned:
    lines: list[str]
    key: Optional[str] = None
    capo: Optional[str] = None
    tuning: Optional[str] = None
    tab_lines: int = 0
    debris_lines: int = 0
    raw_content_lines: int = 0


def _drop_footer(lines: list[str]) -> list[str]:
    """Drop a trailing signature block introduced by a long horizontal rule.

    Only when what follows the rule is short and chord-free — a rule in the
    middle of a chart separates sections and must not truncate the song.
    """
    for i in range(len(lines) - 1, -1, -1):
        if not re.match(r'^\s*[-=_]{20,}\s*$', lines[i]):
            continue
        tail = [ln for ln in lines[i + 1:] if ln.strip()]
        if len(tail) <= 6 and not any(is_chord_line(ln) for ln in tail):
            return lines[:i]
        break
    return lines


def clean_body(body: str, title: str = '', artist: str = '') -> Cleaned:
    """Strip site debris, tablature and preamble; harvest key/capo/tuning."""
    lines = [ln.replace('\t', '    ').rstrip() for ln in body.split('\n')]
    lines = _drop_footer(lines)

    out = Cleaned(lines=[])
    out.raw_content_lines = sum(1 for ln in lines if ln.strip())

    kept: list[str] = []
    for ln in lines:
        low = ln.lower()
        if not ln.strip():
            kept.append('')
            continue
        if any(s in low for s in _DEBRIS_SUBSTRINGS):
            out.debris_lines += 1
            continue
        if is_tab_line(ln):
            out.tab_lines += 1
            continue
        if CHORD_DIAGRAM_RE.match(ln):
            out.debris_lines += 1
            continue
        m = _KEY_RE.match(ln)
        if m:
            out.key = out.key or m.group(1)
            continue
        m = _CAPO_RE.match(ln)
        if m:
            out.capo = out.capo or m.group(1).rstrip('.')
            continue
        m = _TUNING_RE.match(ln)
        if m:
            out.tuning = out.tuning or m.group(1)
            continue
        if any(r.match(ln) for r in _DEBRIS_LINE_RES):
            out.debris_lines += 1
            continue
        if ln.startswith('#') and not re.match(r'^#\s*\d{1,2}\.?\s*$', ln.strip()):
            out.debris_lines += 1
            continue
        # A stray one-character line ("X" at the end of a UG dump).
        if len(ln.strip()) == 1 and not is_chord_token(ln.strip()):
            out.debris_lines += 1
            continue
        kept.append(ln)

    kept = _strip_preamble(kept, title, artist)

    # Cap runs of blanks at two and trim edges. The one-vs-two distinction is
    # load-bearing: Ultimate Guitar separates sections with two or more blank
    # lines and never uses a single blank inside one.
    collapsed: list[str] = []
    for ln in kept:
        if not ln.strip():
            if len(collapsed) >= 2 and not collapsed[-1].strip() \
                    and not collapsed[-2].strip():
                continue
            collapsed.append('')
        else:
            collapsed.append(ln)
    while collapsed and not collapsed[0].strip():
        collapsed.pop(0)
    while collapsed and not collapsed[-1].strip():
        collapsed.pop()

    out.lines = collapsed
    return out


def _strip_preamble(lines: list[str], title: str, artist: str) -> list[str]:
    """Drop leading title/artist/album/uploader lines.

    Only metadata-shaped lines are dropped, and only within the first
    ``PREAMBLE_SCAN_LINES`` lines, so a song whose first verse has no chord
    line above it can't lose its opening.
    """
    want = {' '.join(_significant_tokens(t)) for t in (title, artist) if t}
    want.discard('')
    drop_to = 0
    names_dropped = 0
    for i, ln in enumerate(lines[:PREAMBLE_SCAN_LINES]):
        if not ln.strip():
            drop_to = i + 1
            continue
        if detect_section_marker(ln) or is_chord_line(ln):
            break
        if INLINE_CHORD_RE.search(ln):
            break
        norm = ' '.join(_significant_tokens(ln))
        if norm and norm in want:
            drop_to = i + 1
            continue
        if any(r.match(ln) for r in _PREAMBLE_RES):
            drop_to = i + 1
            continue
        if len(ln) <= 50 and _PREAMBLE_NAME_RE.match(ln) and names_dropped < 3:
            names_dropped += 1
            drop_to = i + 1
            continue
        break
    return lines[drop_to:]


# ---------------------------------------------------------------------------
# Chord placement (the column-drift-free part)
# ---------------------------------------------------------------------------

def snap_to_word(lyric: str, col: int) -> int:
    """Insertion offset in ``lyric`` for a chord sitting at column ``col``.

    Monospace chord sheets mean column ``col`` of the chord line is column
    ``col`` of the lyric line — no proportional scaling, which is what drifts
    when the chord line is padded past the end of the lyrics. The column is
    then snapped to a word boundary:

    * past the end of the lyric  -> end of line
    * over whitespace            -> start of the next word
    * inside a word              -> whichever is nearer, that word's start or
                                    the next word's start
    """
    n = len(lyric)
    if col >= n:
        return n
    if lyric[col].isspace():
        j = col
        while j < n and lyric[j].isspace():
            j += 1
        return j

    start = col
    while start > 0 and not lyric[start - 1].isspace():
        start -= 1

    j = col
    while j < n and not lyric[j].isspace():
        j += 1
    while j < n and lyric[j].isspace():
        j += 1
    nxt = j if j < n else None

    if nxt is None:
        return start
    return start if (col - start) <= (nxt - col) else nxt


def scan_chords(chord_line: str) -> list[tuple[int, str]]:
    """``[(column, chord)]`` for every chord token on a chord line."""
    found = []
    for m in CHORD_SCAN_RE.finditer(chord_line):
        tok = m.group(0)
        if is_chord_token(tok):
            found.append((m.start(), tok))
    return found


def place_chords(chord_line: str, lyric_line: str) -> list[tuple[int, str]]:
    """Map a chord line onto its lyric line as ``[(offset, chord)]``."""
    lyric = lyric_line.rstrip()
    return [(snap_to_word(lyric, col), chord)
            for col, chord in scan_chords(chord_line)]


def render_with_chords(lyric_line: str, placements: list[tuple[int, str]]) -> str:
    """Insert ``[chord]`` markers, right-to-left so offsets never shift."""
    lyric = lyric_line.rstrip()
    if not placements:
        return lyric.strip()
    result = lyric
    # Insert right-to-left so an earlier insertion can't shift a later
    # offset (the classic column-drift bug). Ties break on source order,
    # reversed, so two chords on one word come out left-to-right.
    ordered = sorted(range(len(placements)),
                     key=lambda i: (-placements[i][0], -i))
    for i in ordered:
        pos, chord = placements[i]
        pos = min(pos, len(result))
        result = result[:pos] + f'[{chord}]' + result[pos:]
    return result.strip()


def render_chord_only(chord_line: str) -> str:
    """A chord-only line (intro/turnaround grid) as bracketed chords."""
    chords = [c for _, c in scan_chords(chord_line)]
    return ' '.join(f'[{c}]' for c in chords)


# ---------------------------------------------------------------------------
# Parsing a whole file
# ---------------------------------------------------------------------------

# Commentary the tabber wrote *about* the chart. Only ever applied to lines
# that carry no chords, so a lyric can't lose its chord placement to it — but
# it is still deliberately jargon-only vocabulary, not "sounds technical".
_CHART_PROSE_RE = re.compile(
    r'\b(?:chords?|chordal|measures?|capo|frets?|tabs?|tabbed|tablature|'
    r'tuning|transcrib\w*|notation|backing|public\s+domain|corrections?|'
    r'kudos|bpm|beats?|downbeat|upbeat|strum\w*|arpeggi\w*|'
    r'chord\s+structure|reference\s+chart|these\s+are\s+the|'
    r'i\s+did\s+upload|stars\s+it\s+deserves|hesitate|'
    r'keep\s+in\s+mind|posting|videos?)\b', re.I)

# Transposition cheat-sheet rows ("G  = A") and bare count-offs.
_TABLE_ROW_RE = re.compile(
    r'^\s*[A-G][#b]?\w{0,4}\s*[=–-]+\s*[A-G][#b]?\w{0,4}\s*$')
_TIMING_RE = re.compile(
    r'^\s*(?:[\d\s+|.:/]+|\d+\s*beats?(?:\s+\d+\s*beats?)*|set\s*\d+|'
    r'\(?x\s*\d+\)?|\d+:\d\d)\s*$', re.I)


def is_chart_prose(line: str) -> bool:
    """True for a chord-free line that is commentary or furniture, not lyrics."""
    body = line.strip()
    if not body:
        return True
    if _TABLE_ROW_RE.match(body) or _TIMING_RE.match(body):
        return True
    return bool(_CHART_PROSE_RE.search(body))


@dataclass
class Section:
    kind: str                  # 'verse' | 'chorus' | 'bridge'
    label: Optional[str]
    lines: list[str] = field(default_factory=list)
    auto: bool = False         # label invented by us, not taken from the page

    @property
    def lyric_lines(self) -> int:
        return sum(1 for ln in self.lines
                   if re.sub(r'\[[^\]]*\]', '', ln).strip())


@dataclass
class ParseResult:
    source_file: str
    source_url: str
    title: str
    artist: Optional[str]
    key: Optional[str] = None
    capo: Optional[str] = None
    sections: list[Section] = field(default_factory=list)
    ok: bool = False
    reject_reason: Optional[str] = None
    detail: str = ''
    stats: dict = field(default_factory=dict)

    @property
    def chord_count(self) -> int:
        return sum(len(re.findall(r'\[[^\]]+\]', ln))
                   for s in self.sections for ln in s.lines)

    @property
    def lyric_line_count(self) -> int:
        return sum(s.lyric_lines for s in self.sections)


MARKER = '\x00MARKER'


def _expand_markers(lines: list[str]) -> tuple[list[str], dict[int, SectionMarker]]:
    """Replace marker lines with a sentinel, re-emitting any shared content.

    ``Intro:D G D A D`` is one line carrying both a label and a chord grid.
    """
    expanded: list[str] = []
    markers: dict[int, SectionMarker] = {}
    for ln in lines:
        marker = detect_section_marker(ln)
        if marker:
            markers[len(expanded)] = marker
            expanded.append(MARKER)
            if marker.trailing:
                expanded.append(marker.trailing)
        else:
            expanded.append(ln)
    return expanded, markers


def _is_marker_driven(expanded: list[str], markers: dict) -> bool:
    """Does this file label every stanza, or only mention a section in passing?

    Ultimate Guitar pages put a ``[Verse 2]`` above every stanza, so a single
    blank line inside a section means nothing there. e-chords pages label at
    most the intro and rely on blank lines to separate verses. Getting this
    backwards either merges a whole song into one "Intro" or shatters every
    marked section in half, so decide it per file from marker density.
    """
    if len(markers) < 2:
        return False
    stanzas = 0
    prev_blank = True
    for idx, ln in enumerate(expanded):
        if ln == MARKER:
            prev_blank = True      # content right after a marker isn't a stanza
            continue
        if not ln.strip():
            prev_blank = True
            continue
        if prev_blank and (idx == 0 or expanded[idx - 1] != MARKER):
            stanzas += 1
        prev_blank = False
    return len(markers) >= 0.6 * max(stanzas, 1)


def _build_sections(lines: list[str]) -> tuple[list[Section], dict]:
    """Pair chord lines with lyric lines and group them into sections."""
    sections: list[Section] = []
    current: Optional[Section] = None
    verse_no = 0
    stats = {'chord_only_lines': 0, 'paired_lines': 0, 'plain_lyric_lines': 0,
             'inline_chord_lines': 0}

    def start(kind: str, label: Optional[str], auto: bool = False):
        nonlocal current
        current = Section(kind=kind, label=label, auto=auto)
        sections.append(current)

    def ensure_verse():
        nonlocal verse_no
        if current is None:
            verse_no += 1
            start('verse', f'Verse {verse_no}', auto=True)

    expanded, markers = _expand_markers(lines)
    marker_driven = _is_marker_driven(expanded, markers)

    i = 0
    n = len(expanded)
    while i < n:
        ln = expanded[i]

        if ln == MARKER:
            marker = markers[i]
            label = marker.label
            if marker.kind == 'verse':
                # Keep the source's own numbering when it has one; only bare
                # "[Verse]" markers get counted.
                m_no = re.fullmatch(r'verse\s*(\d+)', label.lower())
                if m_no:
                    verse_no = int(m_no.group(1))
                    label = f'Verse {verse_no}'
                elif label.lower() == 'verse':
                    verse_no += 1
                    label = f'Verse {verse_no}'
            elif marker.kind == 'chorus' and label.lower() == 'chorus':
                label = None
            elif marker.kind == 'bridge' and label.lower() == 'bridge':
                label = None
            start(marker.kind, label)
            i += 1
            # Absorb the blank line(s) a marker is usually followed by.
            while i < n and not expanded[i].strip():
                i += 1
            continue

        if not ln.strip():
            run = 0
            while i + run < n and not expanded[i + run].strip():
                run += 1
            # A stanza break ends the section: always in an unmarked file, and
            # on a double blank in a marker-driven one.
            if not marker_driven or run >= 2:
                current = None
            i += run
            continue

        if is_chord_line(ln):
            nxt = expanded[i + 1] if i + 1 < n else ''
            if (nxt and nxt.strip() and nxt != MARKER
                    and not is_chord_line(nxt)
                    and not detect_section_marker(nxt)):
                ensure_verse()
                current.lines.append(render_with_chords(nxt, place_chords(ln, nxt)))
                stats['paired_lines'] += 1
                i += 2
                continue
            ensure_verse()
            rendered = render_chord_only(ln)
            if rendered:
                current.lines.append(rendered)
                stats['chord_only_lines'] += 1
            i += 1
            continue

        # Plain lyric line (possibly with inline (A)/[A] chords already).
        if INLINE_CHORD_RE.search(ln):
            ensure_verse()
            current.lines.append(_normalize_inline(ln))
            stats['inline_chord_lines'] += 1
        elif is_chart_prose(ln):
            stats['prose_lines_dropped'] = stats.get('prose_lines_dropped', 0) + 1
        else:
            ensure_verse()
            current.lines.append(ln.strip())
            stats['plain_lyric_lines'] += 1
        i += 1

    sections = [s for s in sections if s.lines]
    _relabel_auto_sections(sections)
    return sections, stats


def _relabel_auto_sections(sections: list[Section]) -> None:
    """Name the stanzas we invented labels for.

    A lyric-free auto stanza is an instrumental break or turnaround (the
    ``( D G D A D )`` grids e-chords puts between verses), not a verse — and
    the surviving verses get consecutive numbers that don't collide with any
    the page supplied itself.
    """
    taken = set()
    for sec in sections:
        if not sec.auto and sec.label:
            m = re.fullmatch(r'verse\s*(\d+)', sec.label.lower())
            if m:
                taken.add(int(m.group(1)))

    counter = 0
    for sec in sections:
        if not sec.auto:
            continue
        if sec.lyric_lines == 0:
            sec.label = 'Instrumental'
            continue
        counter += 1
        while counter in taken:
            counter += 1
        taken.add(counter)
        sec.label = f'Verse {counter}'


def _normalize_inline(line: str) -> str:
    """Rewrite already-inline ``(A)``/``[A]`` chords as ChordPro ``[A]``."""
    def repl(m):
        tok = m.group(1)
        return f'[{tok}]' if is_chord_token(tok) else m.group(0)
    out = INLINE_CHORD_RE.sub(repl, line)
    # Grid lines like "|(A) |(A) |(D)" become "[A] [A] [D]"
    out = re.sub(r'\|\s*', ' ', out) if out.count('|') >= 3 else out
    return re.sub(r'\s+', ' ', out).strip()


def chord_validity(lines: list[str]) -> tuple[float, int, int]:
    """Fraction of tokens on chord-shaped lines that really are chords."""
    total = good = 0
    for ln in lines:
        if not is_candidate_chord_line(ln):
            continue
        for tok in tokens_of(ln):
            total += 1
            if is_chord_token(tok):
                good += 1
    if not total:
        return 0.0, 0, 0
    return good / total, good, total


NAV_MARKERS = ('search', 'menu', 'home', 'privacy policy', 'terms of use',
               'all rights reserved', 'sign in', 'register', 'newsletter')


def parse_file(path: Path) -> ParseResult:
    """Parse one raw file, returning the ChordPro sections or a rejection."""
    text = path.read_text(errors='replace')
    return parse_text(text, path.name)


def parse_text(text: str, source_file: str) -> ParseResult:
    meta, body = parse_header(text)
    url = meta.get('source_url', '')
    verdict = derive_title_artist(meta.get('title', ''), url)

    res = ParseResult(source_file=source_file, source_url=url,
                      title=verdict.title, artist=verdict.artist)

    cleaned = clean_body(body, verdict.title, verdict.artist or '')
    res.key = cleaned.key
    res.capo = cleaned.capo

    validity, good_tokens, total_tokens = chord_validity(cleaned.lines)
    res.sections, line_stats = _build_sections(cleaned.lines)
    res.stats = {
        'raw_content_lines': cleaned.raw_content_lines,
        'kept_lines': sum(1 for ln in cleaned.lines if ln.strip()),
        'tab_lines': cleaned.tab_lines,
        'debris_lines': cleaned.debris_lines,
        'chord_token_validity': round(validity, 3),
        'chord_tokens': total_tokens,
        'valid_chord_tokens': good_tokens,
        'chords_placed': res.chord_count,
        'lyric_lines': res.lyric_line_count,
        'title_match': verdict.matched,
        'title_checkable': verdict.checkable,
        **line_stats,
    }

    def reject(reason: str, detail: str = '') -> ParseResult:
        res.ok = False
        res.reject_reason = reason
        res.detail = detail
        return res

    # --- quality gate -----------------------------------------------------
    if not verdict.verified:
        return reject('title-mismatch',
                      f'fetched page is a different song ({verdict.detail})')

    low = text.lower()
    if sum(1 for m in NAV_MARKERS if m in low) >= 3:
        return reject('navigation-debris', 'page text reads as site chrome')

    if res.stats['kept_lines'] < MIN_LYRIC_LINES:
        if cleaned.tab_lines >= 4:
            return reject('tab-only',
                          f'{cleaned.tab_lines} tablature lines and nothing else')
        return reject('navigation-debris',
                      f"only {res.stats['kept_lines']} content lines survived cleaning")

    # A handful of tokens can't tell us anything about a file's reliability;
    # such files fall through to the emptier reject reasons below.
    if total_tokens >= MIN_GATE_TOKENS and validity < MIN_CHORD_VALIDITY:
        return reject('low-chord-validity',
                      f'{good_tokens}/{total_tokens} chord-slot tokens parse '
                      f'as chords ({validity:.0%})')

    if res.chord_count == 0:
        if cleaned.tab_lines >= 4:
            return reject('tab-only', f'{cleaned.tab_lines} tablature lines, no chords')
        return reject('no-chords', 'lyrics only')

    if res.lyric_line_count < MIN_LYRIC_LINES:
        if cleaned.tab_lines >= 4:
            return reject('tab-only',
                          f'{cleaned.tab_lines} tablature lines, '
                          f'{res.lyric_line_count} lyric lines')
        return reject('no-lyrics-instrumental',
                      f'chord grid only ({res.lyric_line_count} lyric lines)')

    res.ok = True
    return res


# ---------------------------------------------------------------------------
# ChordPro output
# ---------------------------------------------------------------------------

def to_chordpro(res: ParseResult) -> str:
    out: list[str] = [f'{{meta: title {res.title}}}']
    if res.artist:
        out.append(f'{{meta: artist {res.artist}}}')
    if res.key:
        out.append(f'{{key: {res.key}}}')
    out.append('{meta: x_source web-chords}')
    out.append(f'{{meta: x_source_file {res.source_file}}}')
    if res.source_url:
        out.append(f'{{meta: x_source_url {res.source_url}}}')
    if res.capo:
        out.append(f'{{meta: x_capo {res.capo}}}')
    out.append('')

    for sec in res.sections:
        if sec.kind == 'chorus':
            out.append('{start_of_chorus}' if not sec.label
                       else f'{{start_of_chorus: {sec.label}}}')
            end = '{end_of_chorus}'
        elif sec.kind == 'bridge':
            out.append('{start_of_bridge}' if not sec.label
                       else f'{{start_of_bridge: {sec.label}}}')
            end = '{end_of_bridge}'
        else:
            out.append(f'{{start_of_verse: {sec.label}}}' if sec.label
                       else '{start_of_verse}')
            end = '{end_of_verse}'
        out.extend(sec.lines)
        out.append(end)
        out.append('')

    return '\n'.join(out).rstrip() + '\n'


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def batch(raw_dir: Path = RAW_DIR, out_dir: Path = PARSED_DIR,
          report_path: Path = REPORT_PATH, dry_run: bool = False) -> dict:
    files = sorted(raw_dir.glob('*.txt'))
    emitted, rejected = [], []
    seen_content: dict[str, str] = {}

    for path in files:
        res = parse_file(path)
        if not res.ok:
            rejected.append({
                'file': res.source_file, 'reason': res.reject_reason,
                'detail': res.detail, 'title': res.title,
                'source_url': res.source_url, 'stats': res.stats,
            })
            continue

        pro = to_chordpro(res)
        # Two catalogue entries can resolve to one page (the fetcher searched
        # both "Amber Tresses Carter Family" and "Amber Tresses Tied in Blue
        # Flatt & Scruggs" and got the same e-chords page). Keep the first.
        body_key = re.sub(r'^\{meta: x_source_file.*$', '', pro,
                          flags=re.M)
        if body_key in seen_content:
            rejected.append({
                'file': res.source_file, 'reason': 'duplicate',
                'detail': f'identical chart already emitted as '
                          f'{seen_content[body_key]}',
                'title': res.title, 'source_url': res.source_url,
                'stats': res.stats,
            })
            continue
        seen_content[body_key] = res.source_file

        if not dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / (path.stem + '.pro')).write_text(pro)
        emitted.append({
            'file': res.source_file, 'pro': path.stem + '.pro',
            'title': res.title, 'artist': res.artist,
            'source_url': res.source_url, 'stats': res.stats,
        })

    by_reason: dict[str, int] = {}
    for r in rejected:
        by_reason[r['reason']] = by_reason.get(r['reason'], 0) + 1

    report = {
        'total': len(files),
        'emitted': len(emitted),
        'rejected': len(rejected),
        'rejected_by_reason': dict(sorted(by_reason.items(),
                                          key=lambda kv: -kv[1])),
        'emitted_files': emitted,
        'rejects': rejected,
    }
    if not dry_run:
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Parse web-chords raw files to ChordPro')
    ap.add_argument('--file', help='parse a single raw file (name or path)')
    ap.add_argument('--raw-dir', type=Path, default=RAW_DIR)
    ap.add_argument('--out-dir', type=Path, default=PARSED_DIR)
    ap.add_argument('--report', type=Path, default=REPORT_PATH)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)

    if args.file:
        path = Path(args.file)
        if not path.exists():
            path = args.raw_dir / args.file
        res = parse_file(path)
        print(json.dumps({'ok': res.ok, 'reason': res.reject_reason,
                          'detail': res.detail, 'stats': res.stats},
                         indent=2, ensure_ascii=False), file=sys.stderr)
        if res.ok:
            print(to_chordpro(res), end='')
        return 0 if res.ok else 1

    report = batch(args.raw_dir, args.out_dir, args.report, args.dry_run)
    print(f"total    {report['total']}")
    print(f"emitted  {report['emitted']}")
    print(f"rejected {report['rejected']}")
    for reason, count in report['rejected_by_reason'].items():
        print(f"    {reason:26} {count}")
    if not args.dry_run:
        print(f"\nreport -> {args.report}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
