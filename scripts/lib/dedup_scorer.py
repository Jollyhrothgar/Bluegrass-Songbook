#!/usr/bin/env python3
"""
Containment-based duplicate scorer for incoming submissions.

Answers one question: *does this incoming chart already exist in `works/`, and
if so what should we do about it?* The answer is a :class:`MatchVerdict`, not a
bare number — the score says "same song", the outcome says "enrich / duplicate /
arrangement".

Why this exists (see docs/plans/contribution-pipeline.md, "Dedup before creating
a slug"): `dedup_works.py` scored the `how-long-blues` / `how-long-blues-1` pair
at 0.043 against a 0.5 threshold — a clean miss, not a near miss — because it
compares only the first 300 characters and compares them *in order*, while the
two charts order chorus and verse differently. This module compares the full
lyric word *sets* and uses **containment** (|A ∩ B| / |smaller side|) instead of
Jaccard or `SequenceMatcher`: a lyrics-only scrape is nearly a *subset* of a
fuller submission, and Jaccard punishes that size gap. The same pair scores
0.91 here.

`dedup_works.py` is untouched and still does its job (whole-corpus merge plans).
This module is the per-submission check.

Signals, in order (and nothing else):

* **Lyrics** — the only strong signal, and the only thing that decides a match.
* **Title** — always present, collides constantly. It *narrows* candidates
  before lyrics are read; it never decides a match on its own except in the
  explicitly low-confidence instrumental path below.
* **Chords** — **not** a matching signal (half the canon is I-IV-V in G). Chord
  *presence* picks the outcome: existing lyrics-only + incoming with chords is
  an enrichment, not a duplicate.

Composer is deliberately not a signal: 12 of 19,228 works carry one.

Instrumentals are the known gap. With no lyrics on either side, title would be
carrying alone — exactly where title collisions are worst ("Blackberry
Blossom"). The scorer never silently falls back: it sets ``low_confidence``,
records a warning, requires a much higher title similarity before it will even
name a candidate, and never marks the verdict ``auto_actionable``.

Known limitation: because title narrows before lyrics decide, a submission
retitled beyond recognition ("Wildwood Flower" filed as "The Pale Amaranthus")
will not be compared at all. Fixing that needs a lyric-side index, which is not
worth building until this misses something real.

Usage (library)::

    from dedup_scorer import Chart, WorkCorpus, score_pair

    corpus = WorkCorpus(Path('works'))
    incoming = Chart.from_chordpro(submitted_text)
    verdict = corpus.best_match(incoming)
    if verdict.outcome == Outcome.ENRICH:
        ...

Usage (CLI)::

    uv run python scripts/lib/dedup_scorer.py how-long-blues how-long-blues-1
    uv run python scripts/lib/dedup_scorer.py a.pro b.pro --json
    uv run python scripts/lib/dedup_scorer.py --scan submission.pro
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

import yaml

# `scripts/lib` modules import each other flat (see process_submission.py), which
# works both when run as a script and under tests/conftest.py's sys.path setup.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dedup_works import extract_lyrics_from_chordpro  # noqa: E402


# --------------------------------------------------------------------------
# Thresholds
#
# Calibrated against the three pairs the plan names, using full-text containment
# over normalized lyric word sets:
#
#   how-long-blues / how-long-blues-1      0.91   must match (the #208 miss)
#   i-walk-alone   / i-walk-the-line       0.39   must not match
#   good-hearted-woman / good-hearted-man  0.22   must not match
#
# The gap between the true pair and the worst false positive is enormous
# (0.91 vs 0.39), so the exact cut point is not delicate. MATCH sits roughly
# midway; DUPLICATE is set where two charts share nearly every word.
# --------------------------------------------------------------------------

#: Containment at or above this means "same song". Below it, no match.
CONTAINMENT_MATCH = 0.65

#: Containment at or above this means the word sets are all but identical.
CONTAINMENT_DUPLICATE = 0.85

#: Word-set size ratio (smaller/larger) at or above which two charts count as
#: comparably rich. Below it, the smaller side is a partial chart — an
#: arrangement or a stub — not a straight duplicate.
SIMILAR_RICHNESS_RATIO = 0.80

#: Fewer than this many distinct lyric words means "no usable lyrics" — an
#: instrumental, a tab, or a title-only stub. Triggers the low-confidence path.
MIN_LYRIC_WORDS = 12

#: A side with usable but thin lyrics gets a warning (not a threshold change).
THIN_LYRIC_WORDS = 25

#: Title similarity required to keep a work as a candidate worth reading lyrics
#: for. Title narrows; lyrics decide. Generous on purpose — a missed candidate
#: is a missed duplicate, while a spurious candidate just gets scored and
#: dropped.
TITLE_NARROW_MIN = 0.60

#: Cheap blocking filter before the O(n) similarity pass: share at least this
#: fraction of the smaller title's word set.
TITLE_TOKEN_OVERLAP_MIN = 0.5

#: Title similarity required when neither side has usable lyrics. Much higher,
#: and even then the verdict stays low-confidence and never auto-actionable.
TITLE_ONLY_MIN = 0.95

#: Most candidates ever scored on lyrics for one incoming chart.
MAX_CANDIDATES = 50


class Outcome:
    """What the caller should offer to do. Values are stable strings."""

    #: Existing work is sparser (no chords), incoming is richer — add the part
    #: to the existing work instead of minting a slug. The #208 case.
    ENRICH = 'enrich'
    #: Same song, comparable richness — the incoming chart adds nothing new.
    DUPLICATE = 'duplicate'
    #: Same song, but a materially different chart — offer it as an arrangement.
    ARRANGEMENT_CANDIDATE = 'arrangement-candidate'
    #: Nothing in the corpus matched (or the evidence was too weak to say).
    NO_MATCH = 'no-match'


class Warning_:
    """Warning codes attached to a verdict. Values are stable strings."""

    #: Neither side has usable lyrics — this comparison ran on title alone.
    NO_LYRICS = 'no-lyrics-both-sides'
    #: One side has usable lyrics and the other does not (tab vs lead sheet).
    NO_LYRICS_ONE_SIDE = 'no-lyrics-one-side'
    #: Lyrics exist but are short enough that word overlap is noisy.
    THIN_LYRICS = 'thin-lyrics'
    #: A candidate was named on title similarity alone. Never auto-act on this.
    TITLE_ONLY = 'matched-on-title-only'


# --------------------------------------------------------------------------
# Normalization
#
# Conventions follow dedup_works.normalize_title / normalize_lyrics and
# build_works_index.fuzzy_group_songs: NFKD -> ASCII, lowercase, drop
# parentheticals and articles, strip punctuation. The one deliberate departure
# is that lyrics are NOT truncated (dedup_works cuts at 300 chars) and are
# compared as a set of words rather than as a string.
# --------------------------------------------------------------------------

_CHORD_RE = re.compile(r'\[[^\]]*\]')
_CHORD_TOKEN_RE = re.compile(r'^[A-G][#b]?[^\s\]]*$')


def _to_ascii(text: str) -> str:
    text = unicodedata.normalize('NFKD', text)
    return text.encode('ascii', 'ignore').decode('ascii')


def normalize_title(title: str) -> str:
    """Normalize a title for comparison (lowercase words, no articles)."""
    if not title:
        return ''
    text = _to_ascii(title).lower()
    # Trailing parenthetical: (Live), (Banjo Break), (C)
    text = re.sub(r'\s*\([^)]*\)\s*$', '', text)
    # bluegrass-lyrics import artifact
    text = re.sub(r'\s*lyrics\s+and\s+chords\s*$', '', text)
    text = re.sub(r'\b(the|a|an)\b', ' ', text)
    text = re.sub(r'\bst\b', 'saint', text)
    text = re.sub(r'\bmt\b', 'mount', text)
    text = re.sub(r'[^a-z0-9\s]', '', text)
    return ' '.join(text.split())


def title_similarity(a: str, b: str) -> float:
    """Similarity of two *raw* titles, 0-1, after normalization."""
    na, nb = normalize_title(a), normalize_title(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def lyric_words(text: str) -> frozenset[str]:
    """Normalized word set for plain lyrics (already chord/directive-free).

    Order-independent by construction, which is the whole point: the #208 pair
    orders chorus and verse differently.
    """
    if not text:
        return frozenset()
    normalized = re.sub(r'[^a-z0-9\s]', ' ', _to_ascii(text).lower())
    return frozenset(normalized.split())


def chordpro_lyric_words(content: str) -> frozenset[str]:
    """Normalized lyric word set straight from ChordPro source.

    Directives, chord brackets and ABC blocks are removed by
    :func:`dedup_works.extract_lyrics_from_chordpro`; ``#`` comment lines are
    dropped here because that helper keeps them and comment prose would
    otherwise count as lyrics.
    """
    body = '\n'.join(
        line for line in (content or '').split('\n') if not line.lstrip().startswith('#')
    )
    return lyric_words(extract_lyrics_from_chordpro(body))


def has_chords(content: str) -> bool:
    """True if the ChordPro source carries actual chord markers.

    Bracket contents are checked so that annotations like ``[Verse 1]`` or
    ``[x2]`` do not read as chords.
    """
    for line in (content or '').split('\n'):
        stripped = line.strip()
        if stripped.startswith('{'):
            continue
        for token in _CHORD_RE.findall(line):
            inner = token[1:-1].strip()
            if inner and _CHORD_TOKEN_RE.match(inner):
                return True
    return False


def chordpro_title(content: str) -> str:
    """Pull the title out of ChordPro metadata, if present."""
    for pattern in (r'\{meta:\s*title\s+([^}]+)\}', r'\{(?:title|t):\s*([^}]+)\}'):
        match = re.search(pattern, content or '', re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ''


def containment(a: frozenset[str], b: frozenset[str]) -> float:
    """|A ∩ B| / |smaller side| — the primary metric.

    Containment, not Jaccard: a lyrics-only work is nearly a subset of a fuller
    submission, and Jaccard punishes the size difference that makes it one.
    """
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    """|A ∩ B| / |A ∪ B| — reported for context, never used to decide."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Chart:
    """One side of a comparison: a title, a lyric word set, chord presence."""

    title: str
    words: frozenset[str] = frozenset()
    chords: bool = False
    work_id: str | None = None

    @property
    def has_usable_lyrics(self) -> bool:
        return len(self.words) >= MIN_LYRIC_WORDS

    @classmethod
    def from_chordpro(cls, content: str, title: str = '', work_id: str | None = None) -> 'Chart':
        return cls(
            title=title or chordpro_title(content),
            words=chordpro_lyric_words(content),
            chords=has_chords(content),
            work_id=work_id,
        )

    @classmethod
    def from_file(cls, path: Path, title: str = '', work_id: str | None = None) -> 'Chart':
        path = Path(path)
        return cls.from_chordpro(
            path.read_text(encoding='utf-8'), title=title, work_id=work_id
        )

    @classmethod
    def from_work_dir(cls, work_dir: Path) -> 'Chart':
        """Load a work from ``works/<id>/``.

        Title comes from ``work.yaml`` (authoritative); lyrics and chords come
        from every chordpro part, so a work with several lead sheets is
        compared on all of its text.
        """
        work_dir = Path(work_dir)
        meta = {}
        work_yaml = work_dir / 'work.yaml'
        if work_yaml.exists():
            meta = yaml.safe_load(work_yaml.read_text(encoding='utf-8')) or {}

        words: set[str] = set()
        chords = False
        for chart_path in _chordpro_paths(work_dir, meta):
            content = chart_path.read_text(encoding='utf-8')
            words |= chordpro_lyric_words(content)
            chords = chords or has_chords(content)

        return cls(
            title=str(meta.get('title') or ''),
            words=frozenset(words),
            chords=chords,
            work_id=str(meta.get('id') or work_dir.name),
        )


def _chordpro_paths(work_dir: Path, meta: dict) -> list[Path]:
    """ChordPro files belonging to a work, from work.yaml with a dir fallback."""
    paths = []
    for part in (meta.get('parts') or []):
        if part.get('format') != 'chordpro':
            continue
        name = part.get('file')
        if not name:
            continue
        candidate = work_dir / name
        if candidate.exists():
            paths.append(candidate)
    if not paths:
        paths = sorted(work_dir.glob('*.pro'))
    return paths


@dataclass(frozen=True)
class MatchVerdict:
    """The result of comparing an incoming chart against the corpus.

    ``score`` is containment over lyric word sets — 0.0 when lyrics could not
    decide, in which case ``low_confidence`` is set and ``title_similarity``
    carries whatever evidence exists. Callers must not auto-apply anything when
    ``low_confidence`` is true; ``auto_actionable`` is the only green light, and
    it is only ever given to enrichment, which cannot destroy anything.
    """

    score: float
    matched_work_id: str | None
    outcome: str
    title_similarity: float = 0.0
    low_confidence: bool = False
    auto_actionable: bool = False
    warnings: tuple[str, ...] = ()
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        data = asdict(self)
        data['warnings'] = list(self.warnings)
        return data


NO_MATCH_VERDICT = MatchVerdict(score=0.0, matched_work_id=None, outcome=Outcome.NO_MATCH)


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------


def score_pair(incoming: Chart, existing: Chart) -> MatchVerdict:
    """Score one incoming chart against one existing work.

    Lyrics decide the match; chord presence decides the outcome. When lyrics
    are unusable on either side the verdict is explicitly low-confidence and
    needs a near-exact title before a candidate is even named.
    """
    warnings: list[str] = []
    tsim = title_similarity(incoming.title, existing.title)
    details = {
        'incoming_words': len(incoming.words),
        'existing_words': len(existing.words),
        'incoming_has_chords': incoming.chords,
        'existing_has_chords': existing.chords,
    }

    # --- the instrumental / no-lyrics path -------------------------------
    if not incoming.has_usable_lyrics or not existing.has_usable_lyrics:
        both_missing = not incoming.has_usable_lyrics and not existing.has_usable_lyrics
        warnings.append(Warning_.NO_LYRICS if both_missing else Warning_.NO_LYRICS_ONE_SIDE)
        details['lyrics_decided'] = False
        if tsim >= TITLE_ONLY_MIN:
            warnings.append(Warning_.TITLE_ONLY)
            return MatchVerdict(
                score=0.0,
                matched_work_id=existing.work_id,
                outcome=Outcome.ARRANGEMENT_CANDIDATE,
                title_similarity=tsim,
                low_confidence=True,
                auto_actionable=False,
                warnings=tuple(warnings),
                details=details,
            )
        return MatchVerdict(
            score=0.0,
            matched_work_id=None,
            outcome=Outcome.NO_MATCH,
            title_similarity=tsim,
            low_confidence=True,
            auto_actionable=False,
            warnings=tuple(warnings),
            details=details,
        )

    # --- lyrics decide ----------------------------------------------------
    score = containment(incoming.words, existing.words)
    ratio = min(len(incoming.words), len(existing.words)) / max(
        len(incoming.words), len(existing.words)
    )
    details['lyrics_decided'] = True
    details['jaccard'] = round(jaccard(incoming.words, existing.words), 4)
    details['size_ratio'] = round(ratio, 4)

    if min(len(incoming.words), len(existing.words)) < THIN_LYRIC_WORDS:
        warnings.append(Warning_.THIN_LYRICS)

    if score < CONTAINMENT_MATCH:
        return MatchVerdict(
            score=round(score, 4),
            matched_work_id=None,
            outcome=Outcome.NO_MATCH,
            title_similarity=tsim,
            warnings=tuple(warnings),
            details=details,
        )

    # Same song. Chord presence — not chord content — picks the offer.
    if incoming.chords and not existing.chords:
        outcome = Outcome.ENRICH
    elif existing.chords and not incoming.chords:
        # The corpus already has the richer chart; the submission adds nothing.
        outcome = Outcome.DUPLICATE
    elif score >= CONTAINMENT_DUPLICATE and ratio >= SIMILAR_RICHNESS_RATIO:
        outcome = Outcome.DUPLICATE
    else:
        outcome = Outcome.ARRANGEMENT_CANDIDATE

    auto = (
        outcome == Outcome.ENRICH
        and score >= CONTAINMENT_DUPLICATE
        and Warning_.THIN_LYRICS not in warnings
    )

    return MatchVerdict(
        score=round(score, 4),
        matched_work_id=existing.work_id,
        outcome=outcome,
        title_similarity=tsim,
        auto_actionable=auto,
        warnings=tuple(warnings),
        details=details,
    )


def _verdict_rank(verdict: MatchVerdict) -> tuple:
    """Sort key for picking the best of several verdicts."""
    return (
        0 if verdict.outcome == Outcome.NO_MATCH else 1,
        0 if verdict.low_confidence else 1,
        verdict.score,
        verdict.title_similarity,
    )


# --------------------------------------------------------------------------
# Corpus: title narrows, lyrics decide
# --------------------------------------------------------------------------


class WorkCorpus:
    """Lazy, cached view of ``works/`` for candidate narrowing.

    Nothing is read until the first query. The title index reads only the head
    of each ``work.yaml`` (~1.6s for 19k works, vs ~7.8s to parse them in full)
    and is then held for the process lifetime. **Lyrics are never bulk-loaded**:
    only the handful of works that survive title narrowing get their charts
    read, and those are memoized. Scoring one submission therefore costs one
    index build plus a few dozen small file reads.
    """

    _TITLE_LINE_RE = re.compile(r'^title:[ \t]*(\S.*?)[ \t]*$', re.M)
    _HEAD_BYTES = 800

    def __init__(self, works_dir: Path | str = 'works'):
        self.works_dir = Path(works_dir)
        self._titles: dict[str, str] | None = None
        self._normalized: dict[str, str] = {}
        self._token_index: dict[str, list[str]] = {}
        self._charts: dict[str, Chart] = {}

    # -- index -----------------------------------------------------------
    @property
    def titles(self) -> dict[str, str]:
        """``{work_id: title}`` for the whole corpus, built once on demand."""
        if self._titles is None:
            self._build_index()
        return self._titles  # type: ignore[return-value]

    def _build_index(self) -> None:
        titles: dict[str, str] = {}
        normalized: dict[str, str] = {}
        token_index: dict[str, list[str]] = defaultdict(list)

        if self.works_dir.is_dir():
            for work_dir in sorted(self.works_dir.iterdir()):
                if not work_dir.is_dir():
                    continue
                title = self._read_title(work_dir / 'work.yaml')
                if not title:
                    continue
                norm = normalize_title(title)
                if not norm:
                    continue
                work_id = work_dir.name
                titles[work_id] = title
                normalized[work_id] = norm
                for token in set(norm.split()):
                    token_index[token].append(work_id)

        self._titles = titles
        self._normalized = normalized
        self._token_index = dict(token_index)

    @classmethod
    def _read_title(cls, work_yaml: Path) -> str:
        """Read just the title, falling back to a full parse if the cheap read
        cannot produce a string (block scalars, odd layouts)."""
        try:
            head = work_yaml.read_text(encoding='utf-8')[: cls._HEAD_BYTES]
        except OSError:
            return ''
        match = cls._TITLE_LINE_RE.search(head)
        if match:
            try:
                value = yaml.safe_load(match.group(1))
            except yaml.YAMLError:
                value = None
            if isinstance(value, str) and value.strip():
                return value.strip()
        try:
            data = yaml.safe_load(work_yaml.read_text(encoding='utf-8')) or {}
        except (OSError, yaml.YAMLError):
            return ''
        title = data.get('title')
        return str(title).strip() if title else ''

    # -- narrowing -------------------------------------------------------
    def candidates(
        self, title: str, limit: int = MAX_CANDIDATES, exclude: set[str] | None = None
    ) -> list[tuple[str, float]]:
        """Work ids whose titles are close enough to be worth reading.

        Two stages: an inverted index over title words does the cheap blocking,
        then :func:`title_similarity` ranks what survives. Returns
        ``[(work_id, title_similarity)]``, best first.
        """
        norm = normalize_title(title)
        if not norm:
            return []
        self.titles  # force index build

        tokens = set(norm.split())
        counts: dict[str, int] = defaultdict(int)
        for token in tokens:
            for work_id in self._token_index.get(token, ()):
                counts[work_id] += 1

        exclude = exclude or set()
        scored = []
        for work_id, shared in counts.items():
            if work_id in exclude:
                continue
            other = self._normalized[work_id]
            other_tokens = other.split()
            overlap = shared / min(len(tokens), len(other_tokens))
            if overlap < TITLE_TOKEN_OVERLAP_MIN:
                continue
            sim = 1.0 if other == norm else SequenceMatcher(None, norm, other).ratio()
            if sim >= TITLE_NARROW_MIN:
                scored.append((work_id, sim))

        scored.sort(key=lambda item: (-item[1], item[0]))
        return scored[:limit]

    # -- charts ----------------------------------------------------------
    def chart(self, work_id: str) -> Chart | None:
        """Load (and memoize) one work's chart."""
        if work_id in self._charts:
            return self._charts[work_id]
        work_dir = self.works_dir / work_id
        if not work_dir.is_dir():
            return None
        chart = Chart.from_work_dir(work_dir)
        self._charts[work_id] = chart
        return chart

    # -- the query -------------------------------------------------------
    def best_match(
        self, incoming: Chart, limit: int = MAX_CANDIDATES, exclude: set[str] | None = None
    ) -> MatchVerdict:
        """Best verdict for ``incoming`` against the whole corpus."""
        verdicts = self.rank_matches(incoming, limit=limit, exclude=exclude)
        return verdicts[0] if verdicts else NO_MATCH_VERDICT

    def rank_matches(
        self, incoming: Chart, limit: int = MAX_CANDIDATES, exclude: set[str] | None = None
    ) -> list[MatchVerdict]:
        """Every non-``no-match`` verdict for ``incoming``, best first."""
        exclude = set(exclude or ())
        if incoming.work_id:
            exclude.add(incoming.work_id)

        verdicts = []
        for work_id, _ in self.candidates(incoming.title, limit=limit, exclude=exclude):
            existing = self.chart(work_id)
            if existing is None:
                continue
            verdict = score_pair(incoming, existing)
            if verdict.outcome != Outcome.NO_MATCH:
                verdicts.append(verdict)

        verdicts.sort(key=_verdict_rank, reverse=True)
        return verdicts


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _resolve_chart(ref: str, works_dir: Path) -> Chart:
    """Accept a work id, a work directory, or a ChordPro file."""
    path = Path(ref)
    if path.is_file():
        return Chart.from_file(path)
    if path.is_dir() and (path / 'work.yaml').exists():
        return Chart.from_work_dir(path)
    work_dir = works_dir / ref
    if work_dir.is_dir():
        return Chart.from_work_dir(work_dir)
    raise SystemExit(f"Not a work id, work dir, or chordpro file: {ref}")


def _print_verdict(verdict: MatchVerdict, label: str = '') -> None:
    header = f"{label}: " if label else ''
    print(f"{header}{verdict.outcome}  (containment {verdict.score:.3f}, "
          f"title {verdict.title_similarity:.3f})")
    if verdict.matched_work_id:
        print(f"  matched work:   {verdict.matched_work_id}")
    print(f"  low confidence: {verdict.low_confidence}")
    print(f"  auto-actionable:{verdict.auto_actionable}")
    if verdict.warnings:
        print(f"  warnings:       {', '.join(verdict.warnings)}")
    for key, value in sorted(verdict.details.items()):
        print(f"  {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='Containment-based dedup scorer (lyrics decide, title narrows).'
    )
    parser.add_argument('refs', nargs='*',
                        help='Two work ids / work dirs / .pro files to compare')
    parser.add_argument('--scan', metavar='REF',
                        help='Score one chart against the whole corpus')
    parser.add_argument('--works-dir', default='works', help='Path to works/ (default: works)')
    parser.add_argument('--limit', type=int, default=MAX_CANDIDATES,
                        help=f'Max candidates to score (default: {MAX_CANDIDATES})')
    parser.add_argument('--all', action='store_true',
                        help='With --scan, print every match instead of the best')
    parser.add_argument('--json', action='store_true', help='Emit JSON')
    args = parser.parse_args(argv)

    works_dir = Path(args.works_dir)

    if args.scan:
        incoming = _resolve_chart(args.scan, works_dir)
        corpus = WorkCorpus(works_dir)
        if args.all:
            verdicts = corpus.rank_matches(incoming, limit=args.limit)
            if args.json:
                print(json.dumps([v.to_dict() for v in verdicts], indent=2))
            elif not verdicts:
                print('no-match')
            else:
                for verdict in verdicts:
                    _print_verdict(verdict)
                    print()
            return 0
        verdict = corpus.best_match(incoming, limit=args.limit)
        if args.json:
            print(json.dumps(verdict.to_dict(), indent=2))
        else:
            _print_verdict(verdict, label=incoming.title or args.scan)
        return 0

    if len(args.refs) != 2:
        parser.error('give two refs to compare, or use --scan REF')

    incoming = _resolve_chart(args.refs[0], works_dir)
    existing = _resolve_chart(args.refs[1], works_dir)
    verdict = score_pair(incoming, existing)
    if args.json:
        print(json.dumps(verdict.to_dict(), indent=2))
    else:
        _print_verdict(verdict, label=f"{args.refs[0]} vs {args.refs[1]}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
