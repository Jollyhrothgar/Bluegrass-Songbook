"""Is a tab annotation's text a chord name? (G21d; OTF 1.3 annotations[].kind)

parse_tab_chord(text) -> {chord, optional, shape, ext} or None
  chord     the sounding chord, root capitalised: "em" -> "Em", "D/F#"
  optional  True when written in parentheses: "(em)"
  shape     capo spelling, the chord fingered: "A (G)" -> chord A, shape G
  ext       optional extension: "A(7)" -> chord A, ext "7"
Anything else is None and stays text.

The chord grammar is is_valid_chord (chord_chart.py); this adds only what
tabs write. A lowercase root is accepted only as a minor ("em", "bm7"); a
lone "a", "e" or "g" is a word. A "o" (dim) quality alone is refused, so "Go"
and "Do" stay text, and so do "A1".."B2" (part labels in the corpus). JS twin: docs/js/tab-chord.js; both are pinned by
tests/fixtures/tab-chord/tab-chords.json.
"""
import re

from chord_chart import is_valid_chord

_LOWER_MINOR = re.compile(r'[a-g][#b]?m(?!aj)', re.ASCII)
_BARE_O = re.compile(r'[A-G][#b]?(?:o(?:/|$)|[1-4]$)', re.ASCII)
_WRAPPED = re.compile(r'\(([^()]*)\)')
_TAIL = re.compile(r'(.*?)\s*\(([^()]*)\)', re.ASCII | re.DOTALL)
_EXT = re.compile(r'(?:m|[a-z#]*\d)', re.ASCII)


def _chord_name(s):
    name = s[0].upper() + s[1:] if _LOWER_MINOR.match(s) else s
    if not is_valid_chord(name) or _BARE_O.match(name):
        return None
    return name


def parse_tab_chord(text):
    if not isinstance(text, str):
        return None
    s = text.strip()
    optional = False
    m = _WRAPPED.fullmatch(s)
    if m:
        optional, s = True, m.group(1).strip()

    inner = None
    m = _TAIL.fullmatch(s)
    if m:
        s, inner = m.group(1), m.group(2).strip()

    chord = _chord_name(s) if s else None
    if not chord:
        return None
    shape = ext = None
    if inner is not None:
        shape = _chord_name(inner) if inner else None
        if not shape and _EXT.match(inner) and is_valid_chord(chord + inner):
            ext = inner
        if not shape and not ext:
            return None
    return {'chord': chord, 'optional': optional, 'shape': shape, 'ext': ext}
