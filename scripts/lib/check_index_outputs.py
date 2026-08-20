#!/usr/bin/env python3
"""Sanity-check the split index outputs after a rebuild.

Run by CI (verify job) right after `build_works_index.py` so a builder
regression fails the PR instead of surfacing in the deploy job after
merge. Checks shape, not exact bytes: committed jsonl is allowed to
drift from a fresh rebuild (content workflows commit --skip-fuzzy
output; see docs/data notes in scripts/lib/CLAUDE.md).

Usage: uv run python scripts/lib/check_index_outputs.py
"""

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / 'docs' / 'data'

# Wide bounds: catch "empty/duplicated output" disasters, not curation drift.
CANON_MIN, CANON_MAX = 1_000, 5_000
ARCHIVE_MIN = 10_000


def load_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def main():
    errors = []

    canon = load_jsonl(DATA / 'index.jsonl')
    archive = load_jsonl(DATA / 'archive.jsonl')
    song_files = {p.stem for p in (DATA / 'songs').glob('*.pro')}

    if not CANON_MIN < len(canon) < CANON_MAX:
        errors.append(f'canon row count suspicious: {len(canon)}')
    if len(archive) < ARCHIVE_MIN:
        errors.append(f'archive row count suspicious: {len(archive)}')

    for row in canon:
        if row.get('indexed') is False:
            errors.append(f'archived row leaked into canon index: {row["id"]}')
            break
    for row in archive:
        if row.get('indexed') is not False:
            errors.append(f'archive row not marked indexed:false: {row["id"]}')
            break

    fat = [r['id'] for r in canon + archive if 'content' in r or 'abc_content' in r]
    if fat:
        errors.append(f'fat fields leaked into {len(fat)} rows (e.g. {fat[0]})')

    flagged = [r for r in canon + archive if r.get('has_content')]
    missing = [r['id'] for r in flagged if str(r['id']) not in song_files]
    if missing:
        errors.append(
            f'{len(missing)} rows flag has_content but have no songs/*.pro '
            f'(e.g. {missing[0]})'
        )

    # A work with a second lead sheet also publishes one .pro per ARRANGEMENT,
    # named `{id}--{slug}`, and those are not row ids -- the row lists them in
    # `arrangements[]` instead. They are claimed here rather than skipped by
    # pattern, so a genuinely orphaned `foo--bar.pro` (a renamed or deleted
    # arrangement the prune missed) is still caught.
    #
    # This check predates the first fork actually existing in the corpus, so
    # it read every arrangement file as an orphan the moment one appeared.
    ids = {str(r['id']) for r in canon + archive}
    claimed = set(ids)
    for row in canon + archive:
        for arrangement in row.get('arrangements') or []:
            stem = Path(str(arrangement.get('file') or '')).stem
            if stem:
                claimed.add(stem)

    orphans = song_files - claimed
    if orphans:
        errors.append(
            f'{len(orphans)} songs/*.pro files have no index row '
            f'(e.g. {sorted(orphans)[0]})'
        )

    tab_parts = [p for r in canon for p in r.get('tablature_parts') or []]
    untracked = [p for p in tab_parts if not isinstance(p.get('tracks'), int)]
    if tab_parts and untracked:
        errors.append(
            f'{len(untracked)}/{len(tab_parts)} canon tablature parts missing '
            f'integer tracks count'
        )

    if errors:
        for e in errors:
            print(f'FAIL: {e}', file=sys.stderr)
        sys.exit(1)

    print(
        f'index outputs OK: {len(canon)} canon rows, {len(archive)} archive rows, '
        f'{len(song_files)} song files, {len(tab_parts)} tab parts with tracks'
    )


if __name__ == '__main__':
    main()
