#!/usr/bin/env python3
"""Import parsed web-chords lead sheets into works/.

Follows the established importer shape (``sources/banjo-hangout/src/
works_importer.py``): build a normalized-title index over works/ once, match
each candidate against it, and never re-create a work the curation registry
has suppressed.

Policy — deliberately non-destructive, because these charts come from a search
engine's best guess and existing works were curated:

* existing work whose lead sheet already has chords  -> skip, reported
* existing work that is lyrics-only, or has no lead
  sheet at all (tab-only / placeholder)              -> reported as a merge
                                                        candidate, untouched
* no existing work                                   -> create it

Nothing in works/ is ever modified; the only writes are new work directories.

Usage::

    uv run python sources/web-chords/src/works_importer.py --dry-run
    uv run python sources/web-chords/src/works_importer.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from typing import Optional

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKS_DIR = REPO_ROOT / 'works'
PARSED_DIR = REPO_ROOT / 'sources' / 'web-chords' / 'parsed'
REPORT_PATH = REPO_ROOT / 'sources' / 'web-chords' / 'import_report.json'
NEW_IDS_PATH = REPO_ROOT / 'sources' / 'web-chords' / 'new_work_ids.txt'

IMPORTED_AT = date.today().isoformat()
SOURCE = 'web-chords'

_SCRIPTS_LIB = REPO_ROOT / 'scripts' / 'lib'
if str(_SCRIPTS_LIB) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_LIB))
from curation import is_suppressed, load_deleted_songs, load_registry  # noqa: E402
from work_schema import (ExternalLinks, Part, Provenance, Work,  # noqa: E402
                         slugify, validate_work)


# ---------------------------------------------------------------------------
# Title matching
# ---------------------------------------------------------------------------

def normalize_title(title: str) -> str:
    """Matching key for a title.

    Accents folded, apostrophes closed up (``Don't`` and ``Dont`` are the same
    song), everything else non-alphanumeric collapsed to single spaces.
    """
    text = unicodedata.normalize('NFKD', title or '')
    text = text.encode('ascii', 'ignore').decode('ascii')
    # Catalogue-style sort titles ("Cuckoo, The") must match the natural form
    # works/ stores ("The Cuckoo").
    m = re.match(r'^(.+?),\s*(the|a|an)$', text.strip(), re.I)
    if m:
        text = f'{m.group(2)} {m.group(1)}'
    text = text.replace("'", '').replace('`', '')
    text = re.sub(r'[^A-Za-z0-9]+', ' ', text)
    return ' '.join(text.lower().split())


def bare_title(title: str) -> str:
    """Normalized title without its leading article.

    "The Irish Washerwoman" and "Irish Washerwoman" are one tune; matching
    only on the exact normalized form creates a second work for it.
    """
    return re.sub(r'^(?:the|a|an)\s+', '', normalize_title(title))


_TITLE_INDEX: Optional[tuple[dict, dict]] = None


def title_index(works_dir: Path = WORKS_DIR) -> tuple[dict, dict]:
    """``(exact, article-insensitive)`` title -> work dirs, built once.

    18k works with a yaml parse each, so this is cached; a per-title scan made
    batch imports quadratic in the banjo-hangout importer.
    """
    global _TITLE_INDEX
    if _TITLE_INDEX is None:
        exact: dict[str, list[Path]] = {}
        bare: dict[str, list[Path]] = {}
        for work_dir in sorted(works_dir.iterdir()):
            work_yaml = work_dir / 'work.yaml'
            if not work_dir.is_dir() or not work_yaml.exists():
                continue
            try:
                data = yaml.safe_load(work_yaml.read_text()) or {}
            except Exception:
                continue
            title = data.get('title', '')
            exact.setdefault(normalize_title(title), []).append(work_dir)
            bare.setdefault(bare_title(title), []).append(work_dir)
        _TITLE_INDEX = (exact, bare)
    return _TITLE_INDEX


def find_matching_works(title: str, works_dir: Path = WORKS_DIR) -> list[Path]:
    """Existing works for this title: exact slug, exact title, then bare title."""
    exact, bare = title_index(works_dir)
    matches: list[Path] = []

    def add(path: Path):
        if path not in matches and (path / 'work.yaml').exists():
            matches.append(path)

    slug_dir = works_dir / slugify(normalize_title(title))
    if slug_dir.is_dir():
        add(slug_dir)
    for candidate in exact.get(normalize_title(title), []):
        add(candidate)
    if not matches:
        for candidate in bare.get(bare_title(title), []):
            add(candidate)
    return matches


# ---------------------------------------------------------------------------
# Inspecting an existing work
# ---------------------------------------------------------------------------

CHORD_MARKER_RE = re.compile(r'\[[A-G][^\]]*\]')


def lead_sheet_state(work_dir: Path) -> str:
    """``'chords'``, ``'lyrics-only'`` or ``'no-lead-sheet'``."""
    try:
        data = yaml.safe_load((work_dir / 'work.yaml').read_text()) or {}
    except Exception:
        return 'no-lead-sheet'
    for part in data.get('parts') or []:
        if part.get('type') != 'lead-sheet':
            continue
        pro = work_dir / (part.get('file') or '')
        if not pro.exists():
            continue
        if CHORD_MARKER_RE.search(pro.read_text(errors='replace')):
            return 'chords'
        return 'lyrics-only'
    return 'no-lead-sheet'


# ---------------------------------------------------------------------------
# Building a new work
# ---------------------------------------------------------------------------

META_RE = re.compile(r'^\{meta:\s*(\w+)\s+(.*)\}\s*$')
KEY_RE = re.compile(r'^\{key:\s*(.+)\}\s*$')


def read_pro_metadata(text: str) -> dict:
    meta = {}
    for line in text.split('\n'):
        m = META_RE.match(line)
        if m:
            meta[m.group(1)] = m.group(2).strip()
            continue
        m = KEY_RE.match(line)
        if m:
            meta['key'] = m.group(1).strip()
    return meta


def claim_slug(title: str, works_dir: Path, registry, deleted,
               claimed: set[str]) -> str:
    """A free, non-suppressed work id for this title."""
    base = slugify(normalize_title(title)) or 'untitled'
    slug = base
    suffix = 1
    while (slug in claimed or (works_dir / slug).exists()
           or is_suppressed(slug, registry, deleted)):
        slug = f'{base}-{suffix}'
        suffix += 1
    return slug


def build_work(work_id: str, meta: dict) -> Work:
    return Work(
        id=work_id,
        title=meta.get('title', work_id),
        artist=meta.get('artist'),
        default_key=meta.get('key'),
        # Tags are left to the build pipeline (harmonic analysis / LLM
        # tagging). Asserting a genre here would be inventing metadata the
        # source page never carried.
        tags=[],
        parts=[Part(
            type='lead-sheet',
            format='chordpro',
            file='lead-sheet.pro',
            default=True,
            provenance=Provenance(
                source=SOURCE,
                source_file=meta.get('x_source_file'),
                source_url=meta.get('x_source_url'),
                imported_at=IMPORTED_AT,
            ),
        )],
    )


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

def import_all(parsed_dir: Path = PARSED_DIR, works_dir: Path = WORKS_DIR,
               dry_run: bool = False) -> dict:
    registry = load_registry(REPO_ROOT)
    deleted = load_deleted_songs(REPO_ROOT)

    created, skipped, merge_candidates, errors = [], [], [], []
    claimed: set[str] = set()

    for pro_path in sorted(parsed_dir.glob('*.pro')):
        text = pro_path.read_text()
        meta = read_pro_metadata(text)
        title = meta.get('title')
        if not title:
            errors.append({'file': pro_path.name, 'error': 'no title in .pro'})
            continue

        matches = find_matching_works(title, works_dir)
        if matches:
            work_dir = matches[0]
            state = lead_sheet_state(work_dir)
            entry = {
                'file': pro_path.name, 'title': title,
                'existing_work': work_dir.name, 'state': state,
                'source_url': meta.get('x_source_url'),
            }
            if state == 'chords':
                skipped.append(entry)
            else:
                merge_candidates.append(entry)
            continue

        work_id = claim_slug(title, works_dir, registry, deleted, claimed)
        if is_suppressed(work_id, registry, deleted):
            skipped.append({'file': pro_path.name, 'title': title,
                            'existing_work': None, 'state': 'suppressed'})
            continue
        claimed.add(work_id)

        work = build_work(work_id, meta)
        problems = validate_work(work)
        if problems:
            errors.append({'file': pro_path.name, 'error': '; '.join(problems)})
            continue

        if not dry_run:
            work_dir = works_dir / work_id
            work_dir.mkdir(parents=True)
            (work_dir / 'work.yaml').write_text(work.to_yaml())
            (work_dir / 'lead-sheet.pro').write_text(text)

        created.append({'id': work_id, 'file': pro_path.name, 'title': title,
                        'artist': work.artist, 'default_key': work.default_key,
                        'source_url': meta.get('x_source_url')})

    report = {
        'imported_at': IMPORTED_AT,
        'parsed_files': len(list(parsed_dir.glob('*.pro'))),
        'created': len(created),
        'skipped_existing_with_chords': len(skipped),
        'merge_candidates': len(merge_candidates),
        'errors': len(errors),
        'created_works': created,
        'skipped': skipped,
        'merge_candidate_works': merge_candidates,
        'error_details': errors,
    }
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Import web-chords .pro into works/')
    ap.add_argument('--parsed-dir', type=Path, default=PARSED_DIR)
    ap.add_argument('--works-dir', type=Path, default=WORKS_DIR)
    ap.add_argument('--report', type=Path, default=REPORT_PATH)
    ap.add_argument('--new-ids', type=Path, default=NEW_IDS_PATH)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)

    report = import_all(args.parsed_dir, args.works_dir, args.dry_run)

    print(f"parsed .pro files        {report['parsed_files']}")
    print(f"new works created        {report['created']}")
    print(f"skipped (has chords)     {report['skipped_existing_with_chords']}")
    print(f"merge candidates         {report['merge_candidates']}")
    print(f"errors                   {report['errors']}")
    for e in report['error_details'][:10]:
        print(f"    {e['file']}: {e['error']}")

    if not args.dry_run:
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False))
        args.new_ids.write_text(
            '\n'.join(w['id'] for w in report['created_works']) + '\n')
        print(f"\nreport   -> {args.report}")
        print(f"new ids  -> {args.new_ids}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
