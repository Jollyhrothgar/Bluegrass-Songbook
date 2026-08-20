#!/usr/bin/env python3
"""Compare the local migration files against the remote ledger — BOTH ways.

``supabase migration list`` prints a three-column table:

    Local          | Remote         | Time (UTC)
   ----------------|----------------|---------------------
    20260818010000 | 20260818010000 | 2026-08-18 01:00:00
    20260819000000 |                | 2026-08-19 00:00:00
                   | 20260209000000 | 2026-02-09 00:00:00

Three row shapes, three meanings:

* **both columns** — in sync.
* **local only** — a migration file that has not been applied. This is what
  ``./scripts/utility db-push`` used to be the whole of: it awk'd for rows with
  a version in Local and nothing in Remote.
* **remote only** — a version the database has run (or been *stamped* with)
  that has no file in ``supabase/migrations/``. Nothing printed this. The
  command reported "(none — local and remote agree)" and exited 0 while a real
  ``supabase db push`` refused with a drift error, because push looks at both
  columns and the check looked at one.

That third shape is exactly what a hand-applied fix or a ``supabase migration
repair`` leaves behind — the same class of event that stamped
``20260209000000`` as applied without ever running its DDL. Reporting only the
direction that is easy to see is how a ledger discrepancy stays invisible for
six months.

Exit status:

* ``0`` — local and remote agree; nothing to push.
* ``1`` — remote-only versions exist. Real drift; ``supabase db push`` will
  refuse. Stop and reconcile.
* ``2`` — local-only versions are pending (and no remote-only drift). Normal;
  the caller should proceed to the dry run.
* ``3`` — ``supabase migration list`` could not be run.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_VERSION = re.compile(r'^\d{6,}$')

EXIT_IN_SYNC = 0
EXIT_REMOTE_DRIFT = 1
EXIT_PENDING = 2
EXIT_UNAVAILABLE = 3


@dataclass
class Drift:
    """The three row shapes of `supabase migration list`, kept apart."""
    in_sync: list[str] = field(default_factory=list)
    local_only: list[str] = field(default_factory=list)
    remote_only: list[str] = field(default_factory=list)

    @property
    def has_drift(self) -> bool:
        return bool(self.remote_only)

    @property
    def agree(self) -> bool:
        return not self.local_only and not self.remote_only


def parse_migration_list(text: str) -> Drift:
    """Parse `supabase migration list` output into a Drift.

    Tolerates the CLI's chatter (login notices, update nags) around the table:
    only lines with two ``|`` separators and a version-shaped token in the
    Local or Remote cell are considered, so the header row (``Local |
    Remote``) and the ``---|---|---`` rule fall out on their own.
    """
    drift = Drift()
    for line in text.split('\n'):
        if line.count('|') < 2:
            continue
        cells = [c.strip() for c in line.split('|')]
        local, remote = cells[0], cells[1]
        local_ok = bool(_VERSION.match(local))
        remote_ok = bool(_VERSION.match(remote))
        if local_ok and remote_ok:
            drift.in_sync.append(local)
        elif local_ok:
            drift.local_only.append(local)
        elif remote_ok:
            drift.remote_only.append(remote)
    return drift


def format_drift(drift: Drift) -> str:
    out: list[str] = []
    if drift.agree:
        out.append('Pending migrations:')
        out.append(f'  (none — local and remote agree on all '
                   f'{len(drift.in_sync)} versions)')
        return '\n'.join(out)

    out.append('Pending migrations (local file, not applied on remote):')
    if drift.local_only:
        out.extend(f'  {v}' for v in drift.local_only)
    else:
        out.append('  (none)')

    if drift.remote_only:
        out.append('')
        out.append('!! DRIFT — applied on remote, NO file in supabase/migrations/:')
        out.extend(f'  {v}' for v in drift.remote_only)
        out.append('')
        out.append('  Something ran (or was stamped) against the database that this')
        out.append('  branch cannot see. `supabase db push` will refuse until it is')
        out.append('  reconciled. Before you reach for `supabase migration repair`:')
        out.append('  a repair stamps the ledger WITHOUT running any DDL, which is')
        out.append('  the same move that left pending_songs.content NOT NULL for six')
        out.append('  months under an "applied" ledger entry. Find the file (another')
        out.append('  branch? a dashboard edit?) before you make the rows match.')
        out.append('')
        out.append('  Then check the SCHEMA, not just the ledger:')
        out.append('      ./scripts/utility db-check')
    return '\n'.join(out)


def fetch_migration_list(repo_root: Path) -> str:
    if not (repo_root / 'supabase' / '.temp' / 'project-ref').exists():
        raise RuntimeError(
            'Not linked. Run ./scripts/bootstrap (seeds supabase/.temp/project-ref).')
    proc = subprocess.run(['supabase', 'migration', 'list'],
                          cwd=repo_root, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f'supabase migration list failed ({proc.returncode}):\n{proc.stderr.strip()}')
    return proc.stdout


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description='Report migration drift between local files and the remote ledger.')
    parser.add_argument('--input', type=Path,
                        help='read recorded `supabase migration list` output '
                             'instead of running the CLI')
    args = parser.parse_args(argv)

    if args.input:
        text = args.input.read_text()
    else:
        try:
            text = fetch_migration_list(Path(__file__).resolve().parents[2])
        except RuntimeError as exc:
            print(f'error: {exc}', file=sys.stderr)
            return EXIT_UNAVAILABLE

    drift = parse_migration_list(text)
    print(format_drift(drift))
    if drift.has_drift:
        return EXIT_REMOTE_DRIFT
    if drift.local_only:
        return EXIT_PENDING
    return EXIT_IN_SYNC


if __name__ == '__main__':
    sys.exit(main())
