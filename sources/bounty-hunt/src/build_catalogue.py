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
    r'encore|medley|jam|instrumental|untitled|unknown|track \d+|untitled \d+)$',
    re.IGNORECASE,
)

# Instrumentals want tabs for the jam instruments; the board renders these as
# chips. Matches what the previous wanted list carried.
JAM_INSTRUMENTS = ['fiddle', 'banjo', 'mandolin', 'guitar']


def normalize(title: str) -> str:
    """Fold a title to its comparison key.

    Deliberately the same shape as `normalizeTitle` in docs/js/title-match.js,
    but they are NOT required to agree byte for byte — this one decides what
    goes on the board, that one is a render-time safety net. See
    CLEANUP-PLAN.md § 5 Phase 1.
    """
    t = unicodedata.normalize('NFKD', title or '')
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
        print(f"  core: {sum(1 for r in kept if r['core'])}")
        print(f"  by source: {Counter(s for r in kept for s in r['sources'])}")
        print(f"  by type:   {Counter(r['type'] for r in kept)}")
        print(f"  with title variants: {sum(1 for r in kept if r['title_variants'])}")

    return payload


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--report', action='store_true', help='Print a summary')
    build_catalogue(report=ap.parse_args().report)
