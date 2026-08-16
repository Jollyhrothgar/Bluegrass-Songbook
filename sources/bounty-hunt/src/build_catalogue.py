#!/usr/bin/env python3
"""Build the canonical bluegrass catalogue — the repertoire the board measures against.

The bounty board is a subtraction: canonical repertoire minus what the songbook
holds. Until now the left-hand side existed only as one-off research output, so
the board could never be rebuilt (see sources/bounty-hunt/CLEANUP-PLAN.md § 1).
This reconstructs it from committed data and freezes it as
`docs/data/bluegrass_catalogue.json`.

**No MusicBrainz mirror required.** The raw export the original research ran on
is vendored at `curation/decision-data/bg_coverage.csv.gz` (75,356 rows, 681
artists) beside the SQL that produced it and the write-up that interprets it —
the same reason `site_index_scored.csv` lives there. Refreshing it still needs
the local mirror, which is why the catalogue output is tracked in git rather
than rebuilt in CI, but rebuilding the catalogue from it needs nothing.

Note the export, not `docs/data/bluegrass_recordings.json`, is the coverage
input: that cache holds only the 292 hand-curated artists, and scoring a
coverage>=8 rule against a narrower artist population silently halves Core
(303 vs the 637 FINDINGS.md reports). The cache is still used for its
authoritative artist-era mapping.

Scoring replicates `curation/decision-data/FINDINGS.md` § 2 exactly:

    coverage = distinct bluegrass-family artists who recorded the song
    spread   = how many of 3 eras those artists span
    score    = coverage * (1 + 0.5 * (spread - 1))
    core     = coverage >= 8 and spread >= 2 and touched by a seed-roster artist

Two corrections from that write-up are preserved here:
  * Songs fold by NORMALIZED TITLE, not MB work_id. MusicBrainz splits standards
    across work entries (two "Little Maggie", two "Nine Pound Hammer"), and
    work-id grouping fragments coverage. This is the same fragmentation that
    later made MB work ids useless as a join key.
  * The catalogue is a union, not just the MB tier — Strum Machine and
    BluegrassLyrics contribute repertoire MB coverage alone would miss.

Usage:
    uv run python sources/bounty-hunt/src/build_catalogue.py
    uv run python sources/bounty-hunt/src/build_catalogue.py --report
"""

import argparse
import csv
import gzip
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / 'scripts' / 'lib'))

from bounty_decisions import infer_type  # noqa: E402

COVERAGE_EXPORT = REPO_ROOT / 'curation' / 'decision-data' / 'bg_coverage.csv.gz'
RECORDINGS_FILE = REPO_ROOT / 'docs' / 'data' / 'bluegrass_recordings.json'
SM_MISSING_FILE = REPO_ROOT / 'docs' / 'data' / 'sm_missing_vocals.json'
BL_PARSED_DIR = REPO_ROOT / 'sources' / 'bluegrass-lyrics' / 'parsed'
SEED_SQL = REPO_ROOT / 'curation' / 'decision-data' / 'bg_query.sql'
OUTPUT_FILE = REPO_ROOT / 'docs' / 'data' / 'bluegrass_catalogue.json'

# `bluegrass_recordings.json` codes each artist's era as 4 / 2 / 1. FINDINGS.md
# numbers the eras 1..3 in chronological order, so map rather than reuse.
ERA_BY_CODE = {4: 1, 2: 2, 1: 3}   # 1 = Monroe/Stanley, 2 = newgrass, 3 = modern

# The curated cache knows the era for 292 artists; the export carries 681. For
# the rest, band by the artist's MusicBrainz begin year. Cutoffs were fitted
# against the curated codes rather than guessed — 1960/1990 reproduces them for
# 88% of the artists where both are known (1955/1986 manages 79%).
ERA_YEAR_CUTS = (1960, 1990)

CORE_COVERAGE = 8
CORE_SPREAD = 2
# The original deliverable was Core (637) plus the top-2000-by-score Expanded
# tier. Keeping that cut means the catalogue stays comparable to the research
# run the current board came from.
EXPANDED_TOP_N = 2000

# Titles that are catalog artifacts rather than songs. These recur across every
# source (a Strum Machine set list will contain "Band Intros"), so filter once
# here instead of letting each consumer re-discover them.
NON_SONG_RE = re.compile(
    r'^(intro|intros|introduction|introductions|outro|outros|'
    r'band intro(duction)?s?|talk|talking|tuning|announcement|applause|'
    r'encore|medley|jam|instrumental|untitled|unknown|track \d+|untitled \d+|'
    r'banter|chatter|spoken|dialogue|false start|reprise|interlude|segue)$',
    re.IGNORECASE,
)

# Instrumentals want tabs for the jam instruments; the board renders these as
# chips. Matches what the previous wanted list carried.
JAM_INSTRUMENTS = ['fiddle', 'banjo', 'mandolin', 'guitar']


# Strum Machine ships arrangement notes inside its display names, so the same
# song arrives as several titles ("Sally Ann key of D, 1-4-5", "Sally Ann Earl
# Scruggs version"). Only the STRUCTURED forms are stripped here — the ones
# whose shape identifies them as notation rather than title. Bare performer
# suffixes are not handled here — the same position also carries real title
# words (`Salty Dog Blues`), so stripping by position would destroy titles.
# `fold_performer_variants` handles those structurally instead.
ANNOTATION_RE = re.compile(
    r'[,(\s]+('
    r'via\s+\S.*'                                  # via Doc Watson
    r'|w/o?\S*(\s+\S.*)?'                          # w/minor, w/ 5 chord in the middle
    r'|with(out)?\s+(a\s+)?[\w\d]+(\s+\w+){0,3}\s+chords?'   # with 7 chord
    r'|with(out)?\s+minors?'                       # with minor
    r'|with(out)?\s+\d+\w*'                         # with 6m
    r'|\d+\s*bars?'                                # 16 bars
    r'|\d/\d\s*(time|version)?'                    # 4/4 time
    r'|key\s+of\s+[A-G][#b]?\b.*'                  # key of D, 1-4-5
    r'|[A-G][#b]?m?\s+to\s+[A-G][#b]?m?\b.*'        # C to Em version
    r'|(extended\s+)?\d+\s*chords?\s+in\s+\w+\s+part'
    r'|original\s+chords?'
    r'|(a\.?k\.?a\.?)\s+.*'
    r'|1-4-5(\s*only)?'
    r'|(modal|major|minor)(\s+key)?(\s+tune)?'     # modal / major key tune
    r'|(crooked|square)\s+[\d-]*\s*part\b.*'
    r'|arrangement\b.*'
    r')[)\s]*$',
    re.IGNORECASE,
)

# Floor on what a strip may leave. The regex requires a separator before the
# annotation, so it can no longer match from position 0 and eat a whole title
# (`Canadian Waltz original chords` once did). This is the backstop for that
# class, not a ratio: a ratio blocks legitimate strips on short titles with
# long annotations — "Sally Ann key of D, 1-4-5" keeps only 36% of its length.
MIN_KEPT_CHARS = 3

# ...and must not remove more words than it leaves. A pattern of the form
# "<arbitrary words> version" was tried and reverted: it truncated
# "Sally Ann Earl Scruggs version" to "Sally" and "Irish Rovers version" to
# "Irish". A character floor did not catch that — "Sally" clears any of them —
# because the damage is measured in words, not characters. Forms whose own
# shape identifies them (key of D, 16 bars, 4/4 time) are safe; "arbitrary
# words plus a keyword" is not, and belongs in the review queue.
MAX_WORDS_REMOVED_RATIO = 3.0


def strip_annotation(title: str) -> str:
    """Remove trailing structured arrangement notes, if any.

    Applied repeatedly because Strum Machine stacks them
    ("Sally Ann key of D, 1-4-5"), and refuses any strip that would eat most
    of the title.
    """
    original = (title or '').strip()
    out = original
    for _ in range(4):                      # bounded; stacking runs 2-3 deep
        candidate = ANNOTATION_RE.sub('', out).strip().rstrip(',(-')
        if candidate == out:
            break
        kept, before = len(candidate.split()), len(out.split())
        if len(candidate) < MIN_KEPT_CHARS:
            break
        if (before - kept) > MAX_WORDS_REMOVED_RATIO * kept:
            break
        out = candidate
    return out or original


def _basic_norm(text: str) -> str:
    """Minimal fold used to build the artist vocabulary.

    Separate from `normalize` because `normalize` calls `strip_annotation`,
    which needs this vocabulary — going through `normalize` would recurse.
    """
    t = unicodedata.normalize('NFKD', text or '')
    t = ''.join(c for c in t if not unicodedata.combining(c)).lower()
    t = re.sub(r"['‘’ʼ´`]", '', t).replace('&', ' and ')
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', t)).strip()


_ARTIST_NAMES = None


def artist_vocabulary() -> set:
    """Bluegrass artist names, for spotting performer suffixes in titles.

    A title ending in a known artist ("Crazy Arms Ray Price", "Jerusalem Ridge
    Kenny Baker") is a catalog annotation, not a title — but no regex
    enumerates performer names, so the roster itself is the vocabulary. Names
    longer than four words are skipped: they are more likely to swallow a real
    title than to appear as a suffix.
    """
    global _ARTIST_NAMES
    if _ARTIST_NAMES is None:
        names = set()
        if COVERAGE_EXPORT.exists():
            with gzip.open(COVERAGE_EXPORT, 'rt', encoding='utf-8') as f:
                for rec in csv.DictReader(f):
                    n = _basic_norm(rec['artist_name'])
                    if n and len(n.split()) <= 4:
                        names.add(n)
        if RECORDINGS_FILE.exists():
            for a in json.loads(RECORDINGS_FILE.read_text(encoding='utf-8'))['artists']:
                n = _basic_norm(a)
                if n and len(n.split()) <= 4:
                    names.add(n)
        # The songbook's own artist and composer fields. The MusicBrainz roster
        # is bluegrass-only, so it has no Ray Price and no Irish Rovers — but
        # the classic-country corpus does, and a performer suffix cites whoever
        # cut the record, not whoever is bluegrass-tagged.
        for name in ('index.jsonl', 'archive.jsonl'):
            path = REPO_ROOT / 'docs' / 'data' / name
            if not path.exists():
                continue
            with open(path, encoding='utf-8') as f:
                for line in f:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    for value in [row.get('artist')] + (row.get('composers') or []):
                        n = _basic_norm(value)
                        if n and 2 <= len(n.split()) <= 4:
                            names.add(n)
        names.discard('')
        _ARTIST_NAMES = names
    return _ARTIST_NAMES


# A bare trailing "version" is safe to drop on its own — it is one common word
# and effectively no song title ends in it. Dropping it first lets the artist
# tier compose: "Cumberland Gap Earl Scruggs version" -> "... Earl Scruggs" ->
# "Cumberland Gap".
TRAILING_VERSION_RE = re.compile(r'[,\s]+versions?\s*$', re.IGNORECASE)


def strip_artist_suffix(title: str) -> str:
    """Drop a trailing performer name, leaving at least two words of title."""
    title = TRAILING_VERSION_RE.sub('', title or '').strip()
    toks = _basic_norm(title).split()
    names = artist_vocabulary()
    for i in range(len(toks) - 1, 1, -1):
        if ' '.join(toks[i:]) in names:
            # Cut the raw title at the same word boundary so casing survives.
            raw = title.split()
            return ' '.join(raw[:i]).rstrip(' ,-') or title
    return title


def normalize(title: str) -> str:
    """Fold a title to its comparison key.

    Deliberately the same shape as `normalizeTitle` in docs/js/title-match.js,
    but they are NOT required to agree byte for byte — this one decides what
    goes on the board, that one is a render-time safety net. See
    CLEANUP-PLAN.md § 5 Phase 1.
    """
    t = unicodedata.normalize('NFKD', strip_artist_suffix(strip_annotation(title)))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    # Strip every apostrophe form to nothing, not to a space. Sources disagree
    # about which character they use, and treating them differently split the
    # same song two ways: "Reuben's Train" -> reubens train but the corpus's
    # "Reuben’s Train" -> reuben s train. Dropping them also merges the
    # possessive variants ("baby's" / "babys").
    t = re.sub(r"['‘’ʼ´`]", '', t)
    t = t.replace('&', ' and ')
    t = re.sub(r'\([^)]*\)', ' ', t)
    t = re.sub(r'[^a-z0-9]+', ' ', t).strip()
    t = re.sub(r'^(the|a|an)\s+', '', t)
    t = re.sub(r',?\s+(the|a|an)$', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def despace(title: str) -> str:
    """Normalized key with spaces removed — merges compound-word variants.

    "Muleskinner Blues" and "Mule Skinner Blues" are one song; so are
    "Hometown" and "Home Town". Removing spaces can only merge titles that
    already share every letter in order, so it is safe to apply automatically
    where a fuzzy ratio would not be.
    """
    return normalize(title).replace(' ', '')


def catalogue_id(title: str) -> str:
    """Stable slug for a catalogue row — the key adjudication verdicts hang off."""
    return re.sub(r'-+', '-', normalize(title).replace(' ', '-'))[:60] or 'untitled'


def load_seed_roster() -> set:
    """The founding-through-modern roster the Core rule requires a touch from."""
    sql = SEED_SQL.read_text(encoding='utf-8')
    block = re.search(r'ILIKE ANY \(ARRAY\[(.*?)\]\)', sql, re.S)
    if not block:
        return set()
    return {n.lower() for n in re.findall(r"'([^']+)'", block.group(1))}


def _display_title(variants: dict) -> str:
    """Pick the title to show: most frequently seen, then longest, then A-Z.

    Ties must break deterministically or the output stops being byte-stable.
    """
    return sorted(variants.items(), key=lambda kv: (-kv[1], -len(kv[0]), kv[0]))[0][0]


def load_type_signals() -> dict:
    """normalized title -> type, from sources that actually know.

    `infer_type`'s title regex only reaches titles that name their tune form,
    which misses most of the fiddle canon — `Bill Cheatham` and `Cumberland
    Gap` carry nothing to match on. Two corpora do know:

    * TuneArch is a fiddle-tune archive, so every title in it is a fiddle tune.
    * Our own works: an ABC part or an `Instrumental` tag is authoritative.

    Corpus tags win over TuneArch when both speak, since they describe the
    specific arrangement rather than the archive it came from.
    """
    signals = {}

    tunearch = REPO_ROOT / 'sources' / 'tunearch' / 'parsed'
    if tunearch.exists():
        title_re = re.compile(r'^\{(?:meta:\s*)?title[:\s]\s*(.+?)\}', re.MULTILINE)
        for path in sorted(tunearch.glob('*.pro')):
            m = title_re.search(path.read_text(encoding='utf-8', errors='replace'))
            if m:
                key = normalize(m.group(1))
                if key:
                    signals[key] = 'Fiddle Tune'

    for name in ('index.jsonl', 'archive.jsonl'):
        path = REPO_ROOT / 'docs' / 'data' / name
        if not path.exists():
            continue
        with open(path, encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                key = normalize(row.get('title', ''))
                if not key:
                    continue
                tags = row.get('tags') or []
                if row.get('has_abc'):
                    signals[key] = 'Fiddle Tune'
                elif 'Instrumental' in tags:
                    signals[key] = 'Instrumental'
                elif 'Gospel' in tags and key not in signals:
                    signals[key] = 'Gospel'
    return signals


MIN_ATTESTED_COVERAGE = 2
MIN_TAIL_WORD_USES = 8
# A two-word base is too generic to fold into unless the remainder is a
# recognized performer. "So Long" swallowed "So Long Jake" and "So Long Jerry";
# "Ode to" took "Ode to Earl" and "Ode to Bascom"; "Ghost of" took "Ghost of
# Glasgow". Those are different songs, and the tail-word guard cannot see it —
# "jake" and "jerry" end no other title.
MIN_GENERIC_BASE_WORDS = 3


def fold_performer_variants(rows: dict) -> int:
    """Merge rows that are an attested song plus a trailing performer credit.

    The board asks for SONGS. Which arrangement of a song someone contributes
    is the version system's business — `group_id`, `curation/registry.yaml`
    `groups:`, and the Arrangement pill already model that — so a catalogue
    holding "Sally Ann" and "Sally Ann Alison Fisher" as separate rows is the
    board doing the version system's job, badly.

    No performer vocabulary can be complete, so this works structurally
    instead: if a row's leading words are themselves an attested row, the
    remainder is a credit rather than title. The guard is that the remainder
    must not END in a word that commonly ends titles — otherwise
    "Salty Dog Blues" folds into "Salty Dog" and "Foggy Mountain Breakdown"
    into "Foggy Mountain". Those tail words are measured from the catalogue
    itself rather than listed by hand.

    Returns the number of rows folded away. `title_variants` keeps every
    folded spelling, so nothing is lost.
    """
    tail_counts = {}
    for key in rows:
        last = key.split()[-1]
        tail_counts[last] = tail_counts.get(last, 0) + 1
    tail_words = {w for w, c in tail_counts.items() if c >= MIN_TAIL_WORD_USES}

    folded = 0
    for key in sorted(rows, key=lambda k: -len(k)):
        row = rows.get(key)
        if row is None:
            continue
        toks = key.split()
        for i in range(len(toks) - 1, 1, -1):
            base_key = ' '.join(toks[:i])
            base = rows.get(base_key)
            if base is None or base is row:
                continue
            if len(base['artists']) < MIN_ATTESTED_COVERAGE:
                continue
            remainder = toks[i:]
            if remainder[-1] in tail_words:
                break            # a title continuation, not a credit
            is_credit = ' '.join(remainder) in artist_vocabulary()
            if not is_credit and len(toks[:i]) < MIN_GENERIC_BASE_WORDS:
                break            # base too generic to absorb an unknown suffix
            base['variants'].update(row['variants'])
            base['artists'].update(row['artists'])
            base['eras'].update(row['eras'])
            base['sources'].update(row['sources'])
            del rows[key]
            folded += 1
            break
    return folded


def artist_era(name: str, begin_year, era_codes: dict) -> int:
    """Which of the three eras an artist belongs to.

    Curated code first (authoritative for the 292 artists that have one), then
    the fitted begin-year bands. Artists with neither are treated as modern,
    which is the conservative choice: it can only ever *add* spread to a song
    that founding artists already recorded, never invent a founding credit.
    """
    code = era_codes.get(name)
    if code in ERA_BY_CODE:
        return ERA_BY_CODE[code]
    if begin_year:
        early, late = ERA_YEAR_CUTS
        return 1 if begin_year < early else (2 if begin_year < late else 3)
    return 3


def build_catalogue(report: bool = False) -> dict:
    era_codes = json.loads(RECORDINGS_FILE.read_text(encoding='utf-8'))['artists']
    seed = load_seed_roster()
    type_signals = load_type_signals()

    # key -> {variants: {title: count}, artists: set, eras: set, sources: set}
    rows = {}

    def touch(title, source):
        key = normalize(title)
        if not key or NON_SONG_RE.match(key):
            return None
        row = rows.setdefault(key, {'variants': {}, 'artists': set(),
                                    'eras': set(), 'sources': set()})
        row['variants'][title] = row['variants'].get(title, 0) + 1
        row['sources'].add(source)
        return row

    # 1. MusicBrainz cover coverage — the backbone of the canon. One row per
    #    (artist, recording); folding by normalized title is what reunites the
    #    standards MusicBrainz splits across work entries.
    with gzip.open(COVERAGE_EXPORT, 'rt', encoding='utf-8') as f:
        for rec in csv.DictReader(f):
            row = touch(rec['title'], 'mb-coverage')
            if row is None:
                continue
            name = rec['artist_name']
            row['artists'].add(name)
            year = int(rec['begin_year']) if rec.get('begin_year') else None
            row['eras'].add(artist_era(name, year, era_codes))

    # 2. Strum Machine repertoire the songbook lacks.
    if SM_MISSING_FILE.exists():
        for title in json.loads(SM_MISSING_FILE.read_text(encoding='utf-8')):
            touch(title, 'strum-machine')

    # 3. BluegrassLyrics corpus.
    if BL_PARSED_DIR.exists():
        for path in sorted(BL_PARSED_DIR.glob('*.json')):
            try:
                song = json.loads(path.read_text(encoding='utf-8'))
            except (json.JSONDecodeError, OSError):
                continue
            if song.get('title'):
                touch(song['title'], 'bluegrass-lyrics')

    folded = fold_performer_variants(rows)

    # Score every row, then cut.
    scored = []
    for key, row in rows.items():
        artists = sorted(row['artists'])
        coverage = len(artists)
        spread = len(row['eras'])
        score = coverage * (1 + 0.5 * (spread - 1)) if coverage else 0.0
        core = (coverage >= CORE_COVERAGE and spread >= CORE_SPREAD
                and any(a.lower() in seed for a in artists))
        title = _display_title(row['variants'])
        scored.append({
            'key': key,
            'catalogue_id': catalogue_id(title),
            'title': title,
            'title_variants': sorted(t for t in row['variants'] if t != title),
            'sources': sorted(row['sources']),
            'coverage': coverage,
            'spread': spread,
            'score': round(score, 2),
            'core': core,
            'artists': artists[:12],
            'type': type_signals.get(key) or infer_type(title, 'Vocal'),
        })

    # Expanded tier: top N by score. Sort ties by key so the cut is stable.
    by_score = sorted(scored, key=lambda r: (-r['score'], r['key']))
    expanded = {r['key'] for r in by_score[:EXPANDED_TOP_N]}

    kept = [r for r in scored
            if r['core'] or r['key'] in expanded
            # Anything a curated source vouched for stays regardless of MB
            # coverage — SM and BL are independent evidence of jam repertoire,
            # and MB coverage of 0 usually means the recording artists simply
            # aren't bluegrass-tagged, not that nobody plays the song.
            or 'strum-machine' in r['sources']
            or 'bluegrass-lyrics' in r['sources']]

    for r in kept:
        if r['type'] in ('Instrumental', 'Fiddle Tune'):
            r['instruments'] = list(JAM_INSTRUMENTS)
        else:
            r['instruments'] = []
        del r['key']

    kept.sort(key=lambda r: r['catalogue_id'])

    payload = {
        '_meta': {
            'description': 'Canonical bluegrass repertoire — the left-hand side of the '
                           'bounty subtraction. Built by sources/bounty-hunt/src/build_catalogue.py.',
            'method': 'FINDINGS.md §2: coverage x (1 + 0.5 x (spread - 1)); '
                      f'core = coverage>={CORE_COVERAGE}, spread>={CORE_SPREAD}, seed-roster touch',
            'sources': ['mb-coverage', 'strum-machine', 'bluegrass-lyrics'],
        },
        'songs': kept,
    }

    OUTPUT_FILE.write_text(
        json.dumps(payload, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')

    if report:
        from collections import Counter
        print(f"Catalogue: {len(kept)} songs from {len(scored)} scored candidates")
        print(f"  performer variants folded into their song: {folded}")
        print(f"  core: {sum(1 for r in kept if r['core'])}")
        print(f"  by source: {Counter(s for r in kept for s in r['sources'])}")
        print(f"  by type:   {Counter(r['type'] for r in kept)}")
        print(f"  with title variants: {sum(1 for r in kept if r['title_variants'])}")

    return payload


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--report', action='store_true', help='Print a summary')
    build_catalogue(report=ap.parse_args().report)
