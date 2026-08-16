#!/usr/bin/env python3
"""Land one ``pending_songs`` row in ``works/``.

Run by ``.github/workflows/process-pending.yml`` in response to the
``pending-commit`` repository_dispatch that ``auto-commit-song`` (or the
hourly reconciler) fires. The edge function decides *what kind of change*
this is; this script does nothing but hand that decision to
:mod:`works_writer`, which is the repo's one writer.

Modes (chosen server-side, never by the client):

``create``
    No work exists at the target id. ``create_work(on_collision='suffix')``
    — the historical importer behaviour, so a genuine slug clash makes
    ``foo-1`` rather than clobbering ``foo``.
``update``
    The submitter already owns content in this work, or they are trusted.
    ``update_part`` replaces the default lead sheet in place.
``fork``
    An edit of somebody else's chart. ``fork_to_arrangement`` lands it as an
    ADDITIONAL version part with ``x_version_*`` metadata; the original keeps
    its file, its ``default`` flag and its provenance. This is the
    "hard to destroy" rule from the contract.

Idempotence
-----------
A dispatch can arrive twice — the hourly reconciler re-fires any row still
flagged uncommitted, and a workflow that pushed but failed to flip the flag
looks exactly like one that never ran. So every part written here carries a
``provenance.source_id`` of ``pending:<row id>:<content sha>``; if the target
work already has a part with that marker, the row has already been applied
and this is a no-op. Re-editing the same row changes the sha, so a genuine
second edit is never mistaken for a replay.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Optional

import works_writer

MODES = ('create', 'update', 'fork')

# Every part this script writes is stamped with this source, so a later
# audit can tell in-app contributions from scraped imports.
SOURCE = 'user-submission'


class ProcessPendingError(Exception):
    """The dispatch cannot be applied (bad mode, missing row, empty content)."""


# ============================================
# Supabase
# ============================================


def fetch_pending_row(row_id: str, *, supabase_url: str,
                      service_key: str) -> dict:
    """Read one pending_songs row via PostgREST.

    Deliberately urllib rather than the supabase client: this runs in CI
    where every extra dependency is another way for the write path to fail,
    and one GET does not need an SDK.
    """
    url = (f"{supabase_url.rstrip('/')}/rest/v1/pending_songs"
           f"?id=eq.{urllib.parse.quote(row_id, safe='')}&select=*")
    request = urllib.request.Request(url, headers={
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            rows = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise ProcessPendingError(
            f"pending_songs lookup for '{row_id}' failed: "
            f"HTTP {e.code} {e.read().decode('utf-8', 'replace')[:200]}") from e

    if not rows:
        raise ProcessPendingError(f"no pending_songs row with id '{row_id}'")
    return rows[0]


# ============================================
# Applying a row
# ============================================


def content_marker(row_id: str, content: str) -> str:
    """The provenance.source_id that makes a re-dispatch a no-op."""
    sha = hashlib.sha256(content.encode('utf-8')).hexdigest()[:12]
    return f'pending:{row_id}:{sha}'


def already_applied(repo_root, work_id: str, marker: str) -> bool:
    work = works_writer.load_work(repo_root, work_id)
    if not work:
        return False
    for part in work.get('parts') or []:
        if (part.get('provenance') or {}).get('source_id') == marker:
            return True
    return False


def _provenance(row: dict, marker: str, actor: Optional[str]) -> dict:
    return {
        'source': SOURCE,
        'source_id': marker,
        # The verified auth.uid() of the submitter. Ownership of a work is
        # read back out of exactly this field by the edge function's
        # classifier, so it is what makes "edit your own in place" work
        # after the pending row has been reaped.
        'submitted_by': row.get('created_by') or actor,
        'submitted_at': (row.get('created_at') or '')[:10] or date.today().isoformat(),
    }


def _version_label(actor: Optional[str]) -> str:
    """Arrangement label from the submitter's identity."""
    name = (actor or '').strip()
    if not name or name.lower() == 'anonymous':
        return 'Alternate arrangement'
    return f"{name}'s arrangement"


def apply_row(repo_root, row: dict, mode: str, work_id: str,
              actor: Optional[str] = None,
              verbose: bool = True) -> works_writer.WriteResult:
    """Write one pending row to ``works/`` in the dispatched mode."""
    if mode not in MODES:
        raise ProcessPendingError(
            f"unknown mode {mode!r} (expected one of {', '.join(MODES)})")

    content = row.get('content')
    if not content or not content.strip():
        raise ProcessPendingError(
            f"row '{row.get('id')}' has no content — nothing to write")
    if not content.endswith('\n'):
        content += '\n'

    row_id = row.get('id')
    if not row_id:
        raise ProcessPendingError('row has no id')
    title = row.get('title')
    if not title:
        raise ProcessPendingError(f"row '{row_id}' has no title")

    marker = content_marker(row_id, content)
    if already_applied(repo_root, work_id, marker):
        if verbose:
            print(f"Already applied: works/{work_id} carries {marker}")
        return works_writer.WriteResult(
            mode=mode, work_id=work_id, skipped_reason='already-applied')

    provenance = _provenance(row, marker, actor)

    if mode == 'create':
        composer = (row.get('composer') or '').strip()
        return works_writer.create_work(
            repo_root, work_id, title,
            works_writer.PartSpec(
                file='lead-sheet.pro',
                type='lead-sheet',
                format='chordpro',
                default=True,
                content=content,
                provenance=provenance,
            ),
            artist=(row.get('artist') or '').strip() or None,
            composers=[composer] if composer else None,
            default_key=(row.get('key') or '').strip() or None,
            tags=[],
            extra={'status': row['status']} if row.get('status') else None,
            on_collision='suffix',
            verbose=verbose,
        )

    if mode == 'update':
        work_updates = {}
        if row.get('title'):
            work_updates['title'] = row['title']
        if row.get('artist'):
            work_updates['artist'] = row['artist']
        if row.get('key'):
            work_updates['default_key'] = row['key']
        if row.get('notes'):
            work_updates['notes'] = row['notes']

        return works_writer.update_part(
            repo_root, work_id,
            match={'type': 'lead-sheet'},
            content=content,
            provenance_updates=provenance,
            work_updates=work_updates,
            add_if_missing=works_writer.PartSpec(
                file='lead-sheet.pro',
                type='lead-sheet',
                format='chordpro',
                default=True,
                content=content,
                provenance=provenance,
            ),
            verbose=verbose,
        )

    return works_writer.fork_to_arrangement(
        repo_root, work_id, content, provenance,
        version_label=_version_label(actor),
        version_type='alternate',
        arrangement_by=actor or None,
        version_notes=(row.get('notes') or '').strip() or None,
        verbose=verbose,
    )


# ============================================
# CLI
# ============================================


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def main() -> int:
    row_id = os.environ.get('PENDING_ROW_ID', '').strip()
    mode = os.environ.get('PENDING_MODE', '').strip()
    work_id = os.environ.get('PENDING_WORK_ID', '').strip()
    actor = os.environ.get('PENDING_ACTOR', '').strip() or None

    if not row_id or not mode:
        print('Error: PENDING_ROW_ID and PENDING_MODE must be set',
              file=sys.stderr)
        return 1

    supabase_url = os.environ.get('SUPABASE_URL', '').strip()
    service_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    if not supabase_url or not service_key:
        print('Error: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set',
              file=sys.stderr)
        return 1

    repo_root = _repo_root()

    try:
        row = fetch_pending_row(row_id, supabase_url=supabase_url,
                                service_key=service_key)
        result = apply_row(repo_root, row, mode, work_id or row_id, actor)
    except (ProcessPendingError, works_writer.WorksWriterError) as e:
        print(f'Error: {e}', file=sys.stderr)
        return 1

    if not result.written:
        print(f"Nothing written ({result.skipped_reason}) for '{row_id}'")
    else:
        print(f"{result.mode}: works/{result.work_id}/{result.part_file}")

    # The workflow reads these to build its commit message and to decide
    # whether to flip github_committed.
    github_output = os.environ.get('GITHUB_OUTPUT')
    if github_output:
        with open(github_output, 'a') as fh:
            fh.write(f'work_id={result.work_id}\n')
            fh.write(f'mode={result.mode}\n')
            fh.write(f'part_file={result.part_file or ""}\n')
            fh.write(f'written={"true" if result.written else "false"}\n')
            fh.write(f'skipped_reason={result.skipped_reason or ""}\n')

    return 0


if __name__ == '__main__':
    sys.exit(main())
