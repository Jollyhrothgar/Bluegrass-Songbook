#!/usr/bin/env python3
"""Emit the frontend-consumable form of the bounty adjudication ledger.

`curation/bounty_decisions.yaml` is the tracked source of truth for which
wanted-list titles denote a work the songbook already has (see
sources/bounty-hunt/CLEANUP-PLAN.md § 4). The browser can't read YAML out of
curation/, so the index build lowers it to `docs/data/bounty_decisions.json`,
keyed by the exact wanted-list title the board renders.

Ledger keys are slugs of the annotation-stripped title, so mapping a key back
to board titles is deterministic — no fuzzy matching at emit time. Two board
titles that differ only by an arrangement label (the intra-dupes: "Sweet Sunny
South major" / "… modal") share a slug and therefore share a verdict, which is
exactly right.

The emitted `chords` count decides *how* the frontend drops an entry: a covered
work with chords disappears; a covered work that is lyrics-only moves to the
"Needs Chords" section instead of being advertised as missing.
"""

import json
import re
import unicodedata
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent.parent
LEDGER_FILE = REPO_ROOT / 'curation' / 'bounty_decisions.yaml'
WANTED_FILE = REPO_ROOT / 'docs' / 'data' / 'wanted_songs.json'
OUTPUT_FILE = REPO_ROOT / 'docs' / 'data' / 'bounty_decisions.json'

# Arrangement/performer annotations the Strum Machine catalog glues onto its
# display names ("Sweet Sunny South modal", "Cotton-Eyed Joe 16 bars"). Stripped
# before slugging so every variant of a song lands on one ledger key.
ANNOTATION_RE = re.compile(
    r"\s+(via\s+.*|w/.*|\d+\s*bars?|\d/\d\s*time|modal|major|minor|"
    r"1-4-5\s*only|with\s+\d+m|original chords|bluegrass version.*)$",
    re.IGNORECASE,
)

# Titles that name a tune form rather than a song. Used to correct the blanket
# `Vocal` typing on the 488 Strum Machine rows, which makes fiddle-tune
# bounties render under "More Songs" with no instrument chips.
# Phase 2's catalogue builder should import this rather than reimplement it.
INSTRUMENTAL_RE = re.compile(
    r"\b(waltz|reel|jig|hornpipe|breakdown|rag|polka|march|two.?step|"
    r"schottische|clog|strathspey)\b",
    re.IGNORECASE,
)


def ledger_slug(title: str) -> str:
    """Ledger key for a wanted-list title: annotation-stripped, slugified.

    Must stay in step with the `catalogue_id` scheme in
    curation/bounty_decisions.yaml — changing it detaches every verdict.
    """
    stripped = ANNOTATION_RE.sub('', title or '')
    stripped = unicodedata.normalize('NFKD', stripped)
    stripped = ''.join(c for c in stripped if not unicodedata.combining(c))
    slug = re.sub(r'[^a-z0-9]+', '-', stripped.lower()).strip('-')
    return re.sub(r'-+', '-', slug)[:60]


def infer_type(title: str, current: str) -> str:
    """Correct a blanket `Vocal` typing when the title names a tune form.

    Only ever promotes Vocal -> Instrumental; an explicit Gospel/Fiddle Tune/
    Old-Time/Instrumental typing from the gap analysis is left alone.
    """
    if current and current != 'Vocal':
        return current
    return 'Instrumental' if INSTRUMENTAL_RE.search(title or '') else (current or 'Vocal')


def _chord_counts(data_dir: Path) -> dict:
    """work id -> chord_count, from the freshly built index + archive."""
    counts = {}
    for name in ('index.jsonl', 'archive.jsonl'):
        path = data_dir / name
        if not path.exists():
            continue
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                counts[row['id']] = row.get('chord_count', 0) or 0
    return counts


def build_bounty_decisions(data_dir: Path = None, quiet: bool = False) -> dict:
    """Lower the YAML ledger to docs/data/bounty_decisions.json.

    Returns the emitted payload. Missing ledger or wanted list is not an error:
    the board simply renders unfiltered, exactly as it did before.
    """
    data_dir = data_dir or (REPO_ROOT / 'docs' / 'data')
    out_file = data_dir / 'bounty_decisions.json'

    if not LEDGER_FILE.exists() or not WANTED_FILE.exists():
        if not quiet:
            print("Bounty ledger or wanted list absent — skipping decisions build")
        return {}

    ledger = yaml.safe_load(LEDGER_FILE.read_text(encoding='utf-8')) or {}
    wanted = json.loads(WANTED_FILE.read_text(encoding='utf-8')).get('songs', [])
    counts = _chord_counts(data_dir)

    # Each ledger entry pins the exact board titles it retires. Deriving them
    # from the key by slug was tried and abandoned: the keys name the base song
    # ("shady-grove") while a slug carries the annotation ("shady-grove-minor"),
    # and a prefix fallback silently swallowed the junk entry "Talk" into
    # "talk-about-suffering". Explicit lists cannot drift.
    title_to_entry = {}
    for key, entry in (ledger.get('covered') or {}).items():
        for title in entry.get('titles') or []:
            title_to_entry[title] = (key, entry)

    junk_titles = {e['title'] for e in (ledger.get('not_a_song') or {}).values()
                   if e.get('title')}

    covered, not_a_song, types = {}, [], {}
    seen_keys = set()
    board_titles = {s.get('title') for s in wanted}

    for song in wanted:
        title = song.get('title')
        if not title:
            continue

        if title in junk_titles:
            not_a_song.append(title)
            continue

        hit = title_to_entry.get(title)
        if hit:
            key, entry = hit
            seen_keys.add(key)
            work = entry['work']
            covered[title] = {
                'work': work,
                'chords': counts.get(work, 0),
                'archived': bool(entry.get('archived')),
            }
            continue

        corrected = infer_type(title, song.get('type'))
        if corrected != song.get('type'):
            types[title] = corrected

    # A pinned title that is no longer on the board means the wanted list was
    # regenerated with different spellings — the verdict has detached and needs
    # a human, so say so loudly rather than silently dropping coverage.
    unmatched = sorted(t for t in title_to_entry if t not in board_titles)

    payload = {
        '_meta': {
            'source': 'curation/bounty_decisions.yaml',
            'description': 'Wanted-list titles that resolve to an existing work, '
                           'plus type corrections. Built by scripts/lib/bounty_decisions.py.',
        },
        'covered': dict(sorted(covered.items())),
        'not_a_song': sorted(not_a_song),
        'types': dict(sorted(types.items())),
    }

    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(
        json.dumps(payload, indent=1, ensure_ascii=False, sort_keys=False) + '\n',
        encoding='utf-8',
    )

    if not quiet:
        lyrics_only = sum(1 for v in covered.values() if not v['chords'])
        archived = sum(1 for v in covered.values() if v['archived'])
        print(f"Bounty decisions: {len(covered)} covered "
              f"({lyrics_only} lyrics-only, {archived} archived), "
              f"{len(not_a_song)} junk, {len(types)} type fixes")
        if unmatched:
            print(f"  WARNING: {len(unmatched)} pinned titles are no longer on "
                  f"the board — verdicts detached: {'; '.join(unmatched[:3])}")

    return payload


if __name__ == '__main__':
    build_bounty_decisions()
