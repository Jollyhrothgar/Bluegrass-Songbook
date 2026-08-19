#!/usr/bin/env python3
"""Assert the LIVE Supabase schema still has the properties the code needs.

Why this exists
---------------
On 2026-08-19 every metadata save started failing with 23502. The cause was
``20260209000000_pending_nullable_content.sql`` — one line, ``ALTER TABLE
pending_songs ALTER COLUMN content DROP NOT NULL`` — which ``supabase
migration list`` reported as applied on the remote, same id, no drift, for six
months. The live schema still said ``"content" "text" NOT NULL``. The ledger
recorded a migration whose DDL had never run (a ``migration repair`` stamp, a
dashboard table edit, a restore from an older snapshot — the catalog cannot say
which after the fact). It hid because nothing depended on it, until
``20260818010000`` added ``CHECK (part_type <> 'metadata' or content is null)``
and produced a pair of constraints no row can satisfy.

**A matching ``migration list`` proves the LEDGER agrees, not that the schema
does.** Nothing else in this repo checks the second thing, and no test can:
vitest and Deno mock Supabase, and pytest never touches a database. So this
module reads what the database says about itself and asserts a small set of
load-bearing properties against it.

What is in the set, and what is not
-----------------------------------
An invariant earns a slot only if all three hold:

1. **A named consumer depends on it.** Some file in this repo breaks, or
   silently does the wrong thing, when the property is false. Each invariant
   names that consumer in ``why``.
2. **It can drift silently.** It is a *shape* property — nullability, whether a
   CHECK exists, a function's security attribute, an object's absence, RLS
   on/off, a grant. Shape is what a stamped-but-unrun migration corrupts. Row
   data is not in scope.
3. **Losing it is not already caught by an equivalent guard on the same path.**

Rule 3 is what keeps this list short. Deliberately EXCLUDED:

* ``pending_songs_instrument_shape`` / ``_part_file_shape`` /
  ``_tab_needs_instrument`` — ``process_pending.tab_instrument`` re-validates
  all three in Python and raises before anything reaches ``works/``.
* the length caps (``_title_len``, ``_artist_len``, ``_notes_len``,
  ``_content_size``, ``_tags_size``, …) — defence in depth against oversized
  input on a path already bounded by the edge function. Losing one degrades a
  guard; it does not break a feature, and listing twenty of them would make a
  report nobody reads.
* ``pending_songs_status_valid`` — borderline (``process_pending`` copies
  ``status`` straight into ``work.yaml``), but ``work_schema`` documents the
  enum and the blast radius is one string in one work. Promote it here if that
  ever stops being true.
* column *types* — PostgREST coerces, and a type change is loud rather than
  silent.

Usage
-----
    ./scripts/utility db-check              # dumps the live schema, asserts
    uv run python3 scripts/lib/schema_assert.py --dump-file some.sql

Exit status is 0 when every invariant holds, 1 when any fails, 2 when the dump
could not be obtained.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

# ---------------------------------------------------------------------------
# Dump parsing
#
# `supabase db dump --schema public` emits pg_dump output with every
# identifier double-quoted. We only need a shallow model of it: enough to ask
# "is this column nullable", "does this constraint exist", "is this function
# security definer", "does this table have RLS and which policies".
# ---------------------------------------------------------------------------

_CREATE_TABLE = re.compile(
    r'^CREATE TABLE (?:IF NOT EXISTS )?"?public"?\."?([A-Za-z0-9_]+)"?\s*\($')
_CONSTRAINT_LINE = re.compile(r'^\s*CONSTRAINT "([^"]+)"\s+(.*)$')
_COLUMN_LINE = re.compile(r'^\s*"([^"]+)"\s+(.*)$')
_ALTER_TABLE = re.compile(r'^ALTER TABLE (?:ONLY )?"?public"?\."?([A-Za-z0-9_]+)"?')
_ADD_CONSTRAINT = re.compile(r'^\s*ADD CONSTRAINT "([^"]+)"\s+(.*?);?\s*$')
_ENABLE_RLS = re.compile(
    r'^ALTER TABLE (?:ONLY )?"?public"?\."?([A-Za-z0-9_]+)"?\s+ENABLE ROW LEVEL SECURITY;')
_CREATE_VIEW = re.compile(
    r'^CREATE (?:OR REPLACE )?(?:MATERIALIZED )?VIEW "?public"?\."?([A-Za-z0-9_]+)"?')
_CREATE_FUNCTION = re.compile(
    r'CREATE (?:OR REPLACE )?FUNCTION "?public"?\."?([A-Za-z0-9_]+)"?(.*?)\n\s*AS \$',
    re.S)
_GRANT_FUNCTION = re.compile(
    r'^GRANT\s+(.+?)\s+ON FUNCTION "?public"?\."?([A-Za-z0-9_]+)"?.*?\bTO "?([A-Za-z0-9_]+)"?;')
_CREATE_POLICY = re.compile(
    r'^CREATE POLICY "([^"]+)" ON "?public"?\."?([A-Za-z0-9_]+)"?(.*)$', re.S)


@dataclass
class Column:
    name: str
    definition: str

    @property
    def nullable(self) -> bool:
        return not re.search(r'\bNOT NULL\b', self.definition)


@dataclass
class Policy:
    name: str
    table: str
    command: str            # ALL / SELECT / INSERT / UPDATE / DELETE
    roles: list[str]
    using: Optional[str]
    check: Optional[str]

    @property
    def effective_check(self) -> Optional[str]:
        """What a write has to satisfy — WITH CHECK, or USING when absent."""
        return self.check if self.check is not None else self.using


@dataclass
class Table:
    name: str
    columns: dict[str, Column] = field(default_factory=dict)
    constraints: dict[str, str] = field(default_factory=dict)
    rls_enabled: bool = False
    policies: list[Policy] = field(default_factory=list)


@dataclass
class Function:
    name: str
    header: str

    @property
    def security_definer(self) -> bool:
        return 'SECURITY DEFINER' in self.header

    @property
    def search_path_pinned(self) -> bool:
        return 'search_path' in self.header


@dataclass
class Schema:
    tables: dict[str, Table] = field(default_factory=dict)
    functions: dict[str, Function] = field(default_factory=dict)
    views: set[str] = field(default_factory=set)
    function_grants: dict[str, set[str]] = field(default_factory=dict)

    def table(self, name: str) -> Optional[Table]:
        return self.tables.get(name)

    def has_relation(self, name: str) -> bool:
        return name in self.tables or name in self.views


def _balanced(text: str, open_idx: int) -> tuple[str, int]:
    """Return (inside, index-after-close) for the parens starting at open_idx."""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i], i + 1
    raise ValueError('unbalanced parentheses in dump fragment')


def _parse_policy(name: str, table: str, tail: str) -> Policy:
    """Parse the part of a CREATE POLICY statement after the table name.

    ``tail`` looks like ``  FOR INSERT TO "authenticated" WITH CHECK (...);``.
    USING / WITH CHECK bodies nest parentheses freely, so they are extracted by
    balanced-paren scan rather than a regex.
    """
    using = check = None
    for marker, setter in (('WITH CHECK (', 'check'), ('USING (', 'using')):
        idx = tail.find(marker)
        if idx == -1:
            continue
        inside, _ = _balanced(tail, idx + len(marker) - 1)
        if setter == 'check':
            check = inside.strip()
        else:
            using = inside.strip()

    head = tail.split(' USING (')[0].split(' WITH CHECK (')[0]
    cmd_match = re.search(r'\bFOR (ALL|SELECT|INSERT|UPDATE|DELETE)\b', head)
    command = cmd_match.group(1) if cmd_match else 'ALL'
    roles_match = re.search(r'\bTO ((?:"[^"]+"|[A-Za-z0-9_]+)(?:\s*,\s*(?:"[^"]+"|[A-Za-z0-9_]+))*)',
                            head)
    roles = ([r.strip().strip('"') for r in roles_match.group(1).split(',')]
             if roles_match else ['public'])
    return Policy(name=name, table=table, command=command, roles=roles,
                  using=using, check=check)


def parse_dump(text: str) -> Schema:
    """Parse `supabase db dump --schema public` output into a Schema."""
    schema = Schema()
    lines = text.split('\n')

    # --- tables, their inline columns and CHECK constraints -----------------
    i = 0
    while i < len(lines):
        m = _CREATE_TABLE.match(lines[i].strip())
        if not m:
            i += 1
            continue
        table = schema.tables.setdefault(m.group(1), Table(name=m.group(1)))
        i += 1
        pending: Optional[tuple[str, str, list[str]]] = None  # kind, name, lines

        def flush() -> None:
            if pending is None:
                return
            kind, name, buf = pending
            body = '\n'.join(buf).rstrip().rstrip(',')
            if kind == 'column':
                table.columns[name] = Column(name=name, definition=body)
            else:
                table.constraints[name] = body

        while i < len(lines) and lines[i].strip() != ');':
            line = lines[i]
            cm = _CONSTRAINT_LINE.match(line)
            colm = _COLUMN_LINE.match(line)
            if cm:
                flush()
                pending = ('constraint', cm.group(1), [cm.group(2)])
            elif colm:
                flush()
                pending = ('column', colm.group(1), [colm.group(2)])
            elif pending is not None:
                # Continuation of a multi-line CHECK (the CASE in
                # pending_songs_content_size is dumped across five lines).
                pending[2].append(line)
            i += 1
        flush()
        i += 1

    # --- views --------------------------------------------------------------
    for line in lines:
        vm = _CREATE_VIEW.match(line)
        if vm:
            schema.views.add(vm.group(1))

    # --- ALTER TABLE: RLS and out-of-line constraints ------------------------
    current_alter: Optional[str] = None
    for line in lines:
        rls = _ENABLE_RLS.match(line)
        if rls:
            schema.tables.setdefault(rls.group(1), Table(name=rls.group(1))).rls_enabled = True
            current_alter = None
            continue
        am = _ALTER_TABLE.match(line)
        if am:
            current_alter = am.group(1)
            continue
        if current_alter:
            acm = _ADD_CONSTRAINT.match(line)
            if acm:
                tbl = schema.tables.setdefault(current_alter, Table(name=current_alter))
                tbl.constraints[acm.group(1)] = acm.group(2)
            if line.rstrip().endswith(';'):
                current_alter = None

    # --- functions ----------------------------------------------------------
    for fm in _CREATE_FUNCTION.finditer(text):
        schema.functions[fm.group(1)] = Function(name=fm.group(1), header=fm.group(2))

    # --- function grants ----------------------------------------------------
    for line in lines:
        gm = _GRANT_FUNCTION.match(line)
        if gm:
            schema.function_grants.setdefault(gm.group(2), set()).add(gm.group(3))

    # --- policies (may span lines; terminate on the trailing semicolon) ------
    i = 0
    while i < len(lines):
        if lines[i].startswith('CREATE POLICY'):
            buf = [lines[i]]
            while not buf[-1].rstrip().endswith(';') and i + 1 < len(lines):
                i += 1
                buf.append(lines[i])
            stmt = '\n'.join(buf)
            pm = _CREATE_POLICY.match(stmt)
            if pm:
                tbl = schema.tables.setdefault(pm.group(2), Table(name=pm.group(2)))
                tbl.policies.append(_parse_policy(pm.group(1), pm.group(2), pm.group(3)))
        i += 1

    return schema


# ---------------------------------------------------------------------------
# Invariants
# ---------------------------------------------------------------------------

@dataclass
class Invariant:
    key: str
    what: str
    why: str
    check: Callable[[Schema], Optional[str]]
    """check() returns None when the invariant holds, else a failure detail."""


def _column_nullable(table: str, column: str) -> Callable[[Schema], Optional[str]]:
    def check(schema: Schema) -> Optional[str]:
        t = schema.table(table)
        if t is None:
            return f'table {table} does not exist'
        col = t.columns.get(column)
        if col is None:
            return f'{table}.{column} does not exist'
        if not col.nullable:
            return f'{table}.{column} is NOT NULL'
        return None
    return check


def _constraint_exists(table: str, name: str,
                       must_contain: tuple[str, ...] = ()) -> Callable[[Schema], Optional[str]]:
    def check(schema: Schema) -> Optional[str]:
        t = schema.table(table)
        if t is None:
            return f'table {table} does not exist'
        body = t.constraints.get(name)
        if body is None:
            return (f'constraint {name} is missing (table has: '
                    f'{", ".join(sorted(t.constraints)) or "none"})')
        missing = [s for s in must_contain if s not in body]
        if missing:
            return f'constraint {name} does not mention {", ".join(missing)}: {body}'
        return None
    return check


def _rls_locked(table: str) -> Callable[[Schema], Optional[str]]:
    """RLS on and ZERO policies — the table is reachable only through a
    SECURITY DEFINER function."""
    def check(schema: Schema) -> Optional[str]:
        t = schema.table(table)
        if t is None:
            return f'table {table} does not exist'
        if not t.rls_enabled:
            return f'RLS is NOT enabled on {table}'
        if t.policies:
            names = ', '.join(sorted(p.name for p in t.policies))
            return f'{table} has {len(t.policies)} policy/policies: {names}'
        return None
    return check


def _rls_enabled(table: str) -> Callable[[Schema], Optional[str]]:
    def check(schema: Schema) -> Optional[str]:
        t = schema.table(table)
        if t is None:
            return f'table {table} does not exist'
        if not t.rls_enabled:
            return f'RLS is NOT enabled on {table}'
        return None
    return check


def _no_client_insert(table: str) -> Callable[[Schema], Optional[str]]:
    def check(schema: Schema) -> Optional[str]:
        t = schema.table(table)
        if t is None:
            return f'table {table} does not exist'
        if not t.rls_enabled:
            return f'RLS is NOT enabled on {table}'
        offenders = []
        for p in t.policies:
            if p.command not in ('INSERT', 'ALL'):
                continue
            body = (p.effective_check or '').strip().strip('()').strip().lower()
            if body != 'false':
                offenders.append(f'{p.name} ({p.command}: {p.effective_check})')
        if offenders:
            return f'{table} accepts client writes via ' + '; '.join(offenders)
        return None
    return check


def _function_definer(name: str) -> Callable[[Schema], Optional[str]]:
    def check(schema: Schema) -> Optional[str]:
        fn = schema.functions.get(name)
        if fn is None:
            return (f'function {name}() does not exist '
                    f'({len(schema.functions)} functions in public)')
        if not fn.security_definer:
            return f'{name}() exists but is NOT security definer'
        return None
    return check


def _function_granted(name: str, roles: tuple[str, ...]) -> Callable[[Schema], Optional[str]]:
    def check(schema: Schema) -> Optional[str]:
        if name not in schema.functions:
            return f'function {name}() does not exist'
        granted = schema.function_grants.get(name, set())
        missing = [r for r in roles if r not in granted]
        if missing:
            return (f'{name}() is not granted to {", ".join(missing)} '
                    f'(granted to: {", ".join(sorted(granted)) or "nobody"})')
        return None
    return check


def _relation_absent(name: str) -> Callable[[Schema], Optional[str]]:
    def check(schema: Schema) -> Optional[str]:
        if schema.has_relation(name):
            return f'{name} still exists in the live schema'
        return None
    return check


INVARIANTS: list[Invariant] = [
    # --- the contribution pipeline -----------------------------------------
    Invariant(
        key='pending_songs.content-nullable',
        what='pending_songs.content is NULLABLE',
        why=("a part_type='metadata' row carries no content by construction. "
             "NOT NULL here plus pending_songs_metadata_has_no_content is a "
             "pair no row can satisfy — every metadata save 23502s. This is "
             "the 2026-08-19 outage."),
        check=_column_nullable('pending_songs', 'content'),
    ),
    Invariant(
        key='pending_songs.metadata-has-no-content',
        what='CHECK pending_songs_metadata_has_no_content exists',
        why=("the other half of the pair above. Without it a metadata row can "
             "carry ChordPro, and process_pending.apply_metadata_row — which "
             "writes work.yaml and nothing else — would silently drop it."),
        check=_constraint_exists('pending_songs',
                                 'pending_songs_metadata_has_no_content'),
    ),
    Invariant(
        key='pending_songs.metadata-needs-target',
        what='CHECK pending_songs_metadata_needs_target exists',
        why=("a metadata edit has no work to mint; replaces_id IS the target. "
             "Without the CHECK the row inserts fine, shows up in the search "
             "overlay, is refused by classifyChange with a 400 forever, and "
             "the hourly reconciler opens an alert issue about it."),
        check=_constraint_exists('pending_songs',
                                 'pending_songs_metadata_needs_target'),
    ),
    Invariant(
        key='pending_songs.part-type-admits-metadata',
        what="CHECK pending_songs_part_type admits lead-sheet, tablature AND metadata",
        why=("the enum every dispatcher switches on: classifyChange in "
             "_shared/pending-dispatch.ts and apply_row in process_pending.py. "
             "Drop a value and that whole column of the pipeline is refused at "
             "INSERT."),
        check=_constraint_exists(
            'pending_songs', 'pending_songs_part_type',
            must_contain=("'lead-sheet'", "'tablature'", "'metadata'")),
    ),
    Invariant(
        key='pending_songs.tab-id-namespace',
        what='CHECK pending_songs_tab_id_namespace exists',
        why=("pending_songs.id is the PRIMARY KEY and for a chart it IS the "
             "work slug. Tab rows must live in tab:<slug>:<rand> or the second "
             "person to tab a song collides on the PK — and, because the update "
             "policy gates on created_by, gets a *permissions* error that says "
             "nothing about what went wrong. Nothing in Python or TypeScript "
             "re-checks this; it is a uniqueness property only the table can "
             "hold."),
        check=_constraint_exists('pending_songs', 'pending_songs_tab_id_namespace'),
    ),
    Invariant(
        key='pending_songs.metadata-id-namespace',
        what='CHECK pending_songs_metadata_id_namespace exists',
        why='same PK collision, meta:<slug>:<rand>, for metadata rows.',
        check=_constraint_exists('pending_songs',
                                 'pending_songs_metadata_id_namespace'),
    ),
    Invariant(
        key='pending_songs.rls',
        what='RLS is enabled on pending_songs',
        why=("the table is GRANT ALL to anon — RLS is the only thing between "
             "the public anon key and rewriting anybody's pending submission. "
             "The insert/update policies are meaningless without it."),
        check=_rls_enabled('pending_songs'),
    ),

    # --- the leaderboard's anonymization ------------------------------------
    Invariant(
        key='get_leaderboard.definer',
        what='get_leaderboard() exists and is SECURITY DEFINER',
        why=("it is the ONLY reader of leaderboard_identities and "
             "leaderboard_salt, both of which have RLS on with zero policies. "
             "Lose SECURITY DEFINER and it reads nothing: the High Scores "
             "board goes silently empty for every visitor. Consumer: "
             "docs/js/high-scores.js."),
        check=_function_definer('get_leaderboard'),
    ),
    Invariant(
        key='get_leaderboard.grants',
        what='get_leaderboard() is granted to anon and authenticated',
        why=('the board is public. A revoked anon grant turns it into a 403 '
             'for logged-out visitors only — the half of the audience least '
             'likely to report it.'),
        check=_function_granted('get_leaderboard', ('anon', 'authenticated')),
    ),
    Invariant(
        key='leaderboard_salt.locked',
        what='leaderboard_salt has RLS enabled and ZERO policies',
        why=("contributor uuids are already public in works/*/work.yaml "
             "(provenance.submitted_by). The salt is the only thing standing "
             "between the leaderboard's md5 aliases and a join key straight "
             "back to real contributors. One readable policy here "
             "de-anonymizes the entire board retroactively."),
        check=_rls_locked('leaderboard_salt'),
    ),
    Invariant(
        key='leaderboard_identities.locked',
        what='leaderboard_identities has RLS enabled and ZERO policies',
        why=("it maps user_id -> real name and carries the `hidden` opt-out. "
             "Any policy exposes both the mapping and who asked to be hidden."),
        check=_rls_locked('leaderboard_identities'),
    ),

    # --- the ledger the leaderboard and the rate limit both count -----------
    Invariant(
        key='submission_log.no-client-insert',
        what='submission_log has RLS on and no policy lets a client INSERT',
        why=("get_leaderboard() aggregates it and pending-dispatch.ts counts it "
             "for the durable per-user rate limit. A client that can insert "
             "rows can both forge its way onto the High Scores board and reset "
             "its own rate limit. Only the service role writes here."),
        check=_no_client_insert('submission_log'),
    ),

    # --- retired objects stay retired ---------------------------------------
    Invariant(
        key='doc_staging.absent',
        what='doc_staging does NOT exist',
        why=("phase 2d removed the document-upload intake because nothing "
             "downstream read it while the UI told submitters their file was "
             "'submitted for review'. If the table came back — a restore from "
             "a pre-August snapshot would do it — the drop migration is "
             "already stamped, so nothing would ever remove it again."),
        check=_relation_absent('doc_staging'),
    ),
]


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------

@dataclass
class Result:
    invariant: Invariant
    detail: Optional[str]

    @property
    def ok(self) -> bool:
        return self.detail is None


def run_invariants(schema: Schema,
                   invariants: Optional[list[Invariant]] = None) -> list[Result]:
    return [Result(inv, inv.check(schema))
            for inv in (invariants if invariants is not None else INVARIANTS)]


def format_results(results: list[Result], verbose: bool = False) -> str:
    out: list[str] = []
    width = max((len(r.invariant.key) for r in results), default=0)
    for r in results:
        status = 'PASS' if r.ok else 'FAIL'
        out.append(f'{status}  {r.invariant.key.ljust(width)}  {r.invariant.what}')
        if not r.ok:
            out.append(f'        -> {r.detail}')
            out.append(f'        why: {r.invariant.why}')
        elif verbose:
            out.append(f'        why: {r.invariant.why}')
    failed = [r for r in results if not r.ok]
    out.append('')
    out.append(f'{len(results) - len(failed)} passed, {len(failed)} failed')
    if failed:
        out.append('')
        out.append('The LEDGER can still say every migration is applied. It is not the')
        out.append('ledger that is wrong here — dump the schema and look:')
        out.append('    supabase db dump --schema public')
        out.append('Fix with a NEW migration (never edit an applied one), and end it with')
        out.append('a DO $$ ... RAISE EXCEPTION postcondition block — see the')
        out.append('"Self-verifying migrations" section of supabase/CLAUDE.md.')
    return '\n'.join(out)


def dump_live_schema(repo_root: Path) -> str:
    """Run `supabase db dump --schema public`. Read-only; no DB password."""
    if not (repo_root / 'supabase' / '.temp' / 'project-ref').exists():
        raise RuntimeError(
            'Not linked. Run ./scripts/bootstrap (seeds supabase/.temp/project-ref).')
    proc = subprocess.run(
        ['supabase', 'db', 'dump', '--schema', 'public'],
        cwd=repo_root, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f'supabase db dump failed ({proc.returncode}):\n{proc.stderr.strip()}')
    if not proc.stdout.strip():
        raise RuntimeError('supabase db dump produced no output')
    return proc.stdout


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description='Assert load-bearing invariants against the live Supabase schema.')
    parser.add_argument(
        '--dump-file', type=Path,
        help='read a recorded `supabase db dump --schema public` instead of '
             'querying the live database')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='print the rationale for passing invariants too')
    parser.add_argument('--list', action='store_true',
                        help='list the invariants and exit without touching the database')
    args = parser.parse_args(argv)

    if args.list:
        for inv in INVARIANTS:
            print(f'{inv.key}\n    {inv.what}\n    why: {inv.why}\n')
        return 0

    repo_root = Path(__file__).resolve().parents[2]
    if args.dump_file:
        text = args.dump_file.read_text()
        source = str(args.dump_file)
    else:
        try:
            text = dump_live_schema(repo_root)
        except RuntimeError as exc:
            print(f'error: {exc}', file=sys.stderr)
            return 2
        source = 'live database (supabase db dump --schema public)'

    schema = parse_dump(text)
    results = run_invariants(schema)
    print(f'Schema invariants — {len(results)} checked against {source}\n')
    print(format_results(results, verbose=args.verbose))
    return 1 if any(not r.ok for r in results) else 0


if __name__ == '__main__':
    sys.exit(main())
