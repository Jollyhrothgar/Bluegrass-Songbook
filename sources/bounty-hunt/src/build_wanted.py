#!/usr/bin/env python3
"""Build the bounty board's wanted list: canonical repertoire minus what we hold.

    bluegrass_catalogue.json  −  (index.jsonl ∪ archive.jsonl)  ±  ledger
                              =  wanted_songs.json

This is the cheap half of the split described in
sources/bounty-hunt/CLEANUP-PLAN.md § 1. It needs no MusicBrainz access and it
goes stale on every import, which is why it runs on every build while the
catalogue it subtracts from is produced locally and committed.

Matching runs the same tiers as the frontend, and stops where the frontend
stops: exact normalized title, then a de-spaced key for compound-word variants
("Muleskinner Blues" / "Mule Skinner Blues"). Anything looser — the 0.80–0.93
fuzzy band — interleaves true and false pairs at identical scores, so it is not
attempted here. Those calls live in curation/bounty_decisions.yaml.

The ledger adjusts the subtraction in both directions:
  * `covered` / `not_a_song` remove rows the corpus check would miss.
  * `keep` adds back real repertoire the catalogue cannot vouch for — mostly
    progressive and newgrass instrumentals with too few MusicBrainz-tagged
    bluegrass recordings to clear the score cut.

Usage:
    uv run python sources/bounty-hunt/src/build_wanted.py [--report] [--dry-run]
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(Path(__file__).parent))

from build_catalogue import despace, normalize  # noqa: E402

CATALOGUE_FILE = REPO_ROOT / 'docs' / 'data' / 'bluegrass_catalogue.json'
LEDGER_FILE = REPO_ROOT / 'curation' / 'bounty_decisions.yaml'
DATA_DIR = REPO_ROOT / 'docs' / 'data'
OUTPUT_FILE = DATA_DIR / 'wanted_songs.json'

# Fields carried onto a wanted row, in render order. `catalogue_id` is what
# adjudication verdicts key off, so it travels with the row.
ROW_FIELDS = ('catalogue_id', 'title', 'type', 'sources', 'coverage', 'core',
              'artists', 'instruments', 'key', 'difficulty', 'notes',
              'title_variants')


def is_empty_stub(row: dict) -> bool:
    """A placeholder work carrying nothing playable.

    `status: placeholder` only means "no lead sheet", not "no content" — and
    the distinction matters. `big-sciota` is a placeholder with 7 tablature
    parts and `billy-in-the-lowground` has 8; skipping every placeholder put
    both on the board as missing songs we plainly have. Only a stub with no
    chords, no tabs and no notation is still a bounty.
    """
    if row.get('status') != 'placeholder':
        return False
    return not (row.get('chord_count') or row.get('tablature_parts')
                or row.get('has_abc') or row.get('has_content'))


def corpus_keys(data_dir: Path):
    """Every title the songbook holds, in both matching forms.

    Empty placeholder stubs are excluded: they are themselves bounties, so
    letting one retire a wanted entry would hide the ask.
    """
    exact, despaced = set(), set()
    for name in ('index.jsonl', 'archive.jsonl'):
        path = data_dir / name
        if not path.exists():
            continue
        with open(path, encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                if is_empty_stub(row):
                    continue
                title = row.get('title', '')
                if normalize(title):
                    exact.add(normalize(title))
                    despaced.add(despace(title))
    return exact, despaced


def build_wanted(report: bool = False, dry_run: bool = False) -> dict:
    catalogue = json.loads(CATALOGUE_FILE.read_text(encoding='utf-8'))['songs']
    ledger = yaml.safe_load(LEDGER_FILE.read_text(encoding='utf-8')) or {}
    exact, despaced = corpus_keys(DATA_DIR)

    # Verdicts key on catalogue_id. Title-keyed verdicts were tried and they
    # detached wholesale: the first ledger pinned board titles carrying Strum
    # Machine arrangement suffixes, and the catalogue folds those away.
    covered_ids = {i for v in (ledger.get('covered') or {}).values()
                   for i in (v.get('catalogue_ids') or [])}
    junk_ids = {e['catalogue_id'] for e in (ledger.get('not_a_song') or {}).values()
                if e.get('catalogue_id')}
    junk_titles = {e['title'] for e in (ledger.get('not_a_song') or {}).values()
                   if e.get('title')}

    stats = Counter()
    songs = []

    for row in catalogue:
        title = row['title']
        if row['catalogue_id'] in junk_ids or title in junk_titles:
            stats['junk'] += 1
            continue
        if row['catalogue_id'] in covered_ids:
            stats['ledger_covered'] += 1
            continue
        if normalize(title) in exact or despace(title) in despaced:
            stats['in_corpus'] += 1
            continue
        songs.append({k: row[k] for k in ROW_FIELDS if row.get(k) not in (None, [], '')})
        stats['wanted'] += 1

    # Ledger keeps: repertoire the catalogue can't vouch for. Row data lives in
    # the ledger because there is no catalogue row to take it from.
    on_board = {s['title'] for s in songs}
    for title, row in sorted((ledger.get('keep') or {}).items()):
        if title in on_board:
            continue
        if normalize(title) in exact or despace(title) in despaced:
            stats['keep_now_held'] += 1
            continue
        entry = {'catalogue_id': normalize(title).replace(' ', '-'), 'sources': ['ledger-keep']}
        entry.update({k: v for k, v in row.items() if k in ROW_FIELDS})
        songs.append(entry)
        stats['ledger_keep'] += 1

    songs.sort(key=lambda s: (s['title'].lower(), s['catalogue_id']))

    payload = {
        '_meta': {
            'source': 'bluegrass_catalogue.json minus the corpus, adjusted by '
                      'curation/bounty_decisions.yaml',
            'description': 'Canonical repertoire the songbook lacks — the bounty wanted list',
            'built_by': 'sources/bounty-hunt/src/build_wanted.py',
        },
        'songs': songs,
    }

    if not dry_run:
        OUTPUT_FILE.write_text(
            json.dumps(payload, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')

    if report:
        print(f"Wanted list: {len(songs)} songs")
        print(f"  from catalogue {len(catalogue)}: "
              f"{stats['in_corpus']} already held, "
              f"{stats['ledger_covered']} ledger-covered, {stats['junk']} junk")
        print(f"  ledger keeps added: {stats['ledger_keep']}"
              + (f" ({stats['keep_now_held']} now held, skipped)" if stats['keep_now_held'] else ''))
        print(f"  by type: {dict(Counter(s['type'] for s in songs))}")
        print(f"  core: {sum(1 for s in songs if s.get('core'))}")

    return payload


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--dry-run', action='store_true', help='Do not write the file')
    a = ap.parse_args()
    build_wanted(report=a.report, dry_run=a.dry_run)
