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
    ``update_part`` replaces ONE chart in place — the one the actor owns
    (:func:`update_target`), or the work's primary chart when they own
    nothing and reached ``update`` through the trusted branch.
``fork``
    An edit of somebody else's chart. ``fork_to_arrangement`` lands it as an
    ADDITIONAL version part with ``x_version_*`` metadata; the original keeps
    its file, its ``default`` flag and its provenance. This is the
    "hard to destroy" rule from the contract.

Dedup backstop (phase 3b)
-------------------------
The editor offers an interactive offramp before a submission is sent
(``docs/js/dedup-check.js``). That surface is what makes the offramp *easy*;
this one is what makes it *complete* — it sits on the last line before a slug
is minted, so it also catches the paths with no human in front of them (the
hourly reconciler re-dispatching an old row, a future importer, a client that
skipped the modal). Only ``create`` is checked: ``update`` and ``fork`` already
name the work they target, so there is nothing left to guess.

===========================  ==================================================
verdict                      what happens here
===========================  ==================================================
``enrich`` + auto_actionable **redirect** — no new slug. The row retargets the
                             matched work and is re-classified by ownership:
                             the submitter owns a part there → ``update``,
                             otherwise → ``fork`` (a new arrangement part, the
                             original untouched). The #208 case.
``duplicate`` at/above       **hold** — nothing is written. The workflow opens
CONTAINMENT_DUPLICATE with   or comments on one review issue, and the row is
similar richness             marked ``dedup_hold`` so the hourly reconciler
                             stops re-dispatching it (otherwise the backstop
                             would refuse the same row every hour, forever).
anything else                **proceed** — the create happens as dispatched and
(arrangement-candidate,      the scores are logged as advice. Notably every
low-confidence, no-match)    instrumental lands here: with no lyrics the
                             scorer is explicitly low-confidence and never
                             auto-actionable, so it must not divert a write.
===========================  ==================================================

Trust is deliberately *not* consulted on a redirect. A trusted user's in-place
edit right is about content they chose to edit; here the machine chose the
target, so the safe classification is the one that cannot destroy anything.

Idempotence
-----------
A dispatch can arrive twice — the hourly reconciler re-fires any row still
flagged uncommitted, and a workflow that pushed but failed to flip the flag
looks exactly like one that never ran. So every part written here carries a
``provenance.source_id`` of ``pending:<row id>:<content sha>``; if the target
work already has a part with that marker, the row has already been applied
and this is a no-op. Re-editing the same row changes the sha, so a genuine
second edit is never mistaken for a replay.

A redirect complicates this: the row landed on a work the dispatch never
named, so looking for the marker under the dispatched id finds nothing. The
backstop therefore checks the marker against its match candidates too — see
``DedupBackstop._check``.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Optional

import dedup_scorer
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


def patch_pending_row(row_id: str, updates: dict, *, supabase_url: str,
                      service_key: str) -> None:
    """Write a few columns back onto one pending_songs row."""
    url = (f"{supabase_url.rstrip('/')}/rest/v1/pending_songs"
           f"?id=eq.{urllib.parse.quote(row_id, safe='')}")
    request = urllib.request.Request(
        url, method='PATCH', data=json.dumps(updates).encode('utf-8'),
        headers={
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        })
    try:
        with urllib.request.urlopen(request, timeout=30):
            pass
    except urllib.error.HTTPError as e:
        raise ProcessPendingError(
            f"pending_songs update for '{row_id}' failed: "
            f"HTTP {e.code} {e.read().decode('utf-8', 'replace')[:200]}") from e


# ============================================
# Dedup backstop
# ============================================

#: ``WriteResult.skipped_reason`` when the backstop refused a create. The
#: workflow keys its review-issue step off this exact string.
DEDUP_HOLD_REASON = 'dedup-duplicate'


@dataclass
class DedupDecision:
    """What the backstop concluded about one create-mode row."""

    #: 'proceed' | 'redirect' | 'hold'
    action: str
    #: The mode to actually write in (a redirect re-classifies).
    mode: str
    #: The work to actually write to (a redirect retargets).
    work_id: str
    #: One line, logged and echoed into the workflow summary.
    reason: str
    verdict: Optional[dedup_scorer.MatchVerdict] = None

    def outputs(self) -> dict:
        """Flat ``GITHUB_OUTPUT`` fields describing this decision."""
        v = self.verdict
        return {
            'dedup_action': self.action,
            'dedup_reason': self.reason,
            'dedup_outcome': v.outcome if v else '',
            'dedup_score': f'{v.score:.4f}' if v else '',
            'dedup_title_similarity': f'{v.title_similarity:.4f}' if v else '',
            'dedup_matched_work': (v.matched_work_id or '') if v else '',
        }


def owns_content(repo_root, work_id: str, user_id: Optional[str]) -> bool:
    """Has ``user_id`` already contributed a part to this work?

    Mirrors ``supabase/functions/_shared/pending-dispatch.ts``'s
    ``submittersOf`` — the same question, asked of the same field, on the
    other side of the dispatch.
    """
    if not user_id:
        return False
    work = works_writer.load_work(repo_root, work_id)
    if not work:
        return False
    return any(
        (part.get('provenance') or {}).get('submitted_by') == user_id
        for part in (work.get('parts') or [])
    )


# ============================================
# Which chart an update may rewrite
# ============================================


def lead_sheets(work: Optional[dict]) -> list:
    """A work's chart parts, in file order."""
    return [part for part in ((work or {}).get('parts') or [])
            if part.get('type') == 'lead-sheet']


def primary_chart(work: Optional[dict]) -> Optional[dict]:
    """The work's main chart: the default lead sheet, else the first one.

    Deliberately the same choice ``works_writer.update_part`` makes for a
    bare ``{'type': 'lead-sheet'}`` match, so "no explicit target" and "the
    primary" stay the same part.
    """
    charts = lead_sheets(work)
    for part in charts:
        if part.get('default'):
            return part
    return charts[0] if charts else None


def update_target(work: Optional[dict], row_id: str,
                  user_id: Optional[str]) -> Optional[str]:
    """The file an ``update`` may rewrite, or ``None`` for "the primary chart".

    THE targeting rule, in one place, because ``mode`` cannot answer this on
    its own. Ownership classification — ``owns_content`` here and
    ``classifyChange`` in ``supabase/functions/_shared/pending-dispatch.ts``
    — says ``update`` as soon as the caller appears in ANY part's
    ``provenance.submitted_by``. So a user who owns only a FORK arrives in
    update mode, and rewriting "the first lead sheet" would destroy the
    PRIMARY — somebody else's chart — in place, which is precisely what the
    "hard to destroy" rule exists to prevent. An update therefore lands on
    the part the actor actually owns.

    Among the actor's own charts, in order:

    1. the part this very pending row landed on last time. Its provenance
       carries ``pending:<row id>:<sha>`` and only the sha changes when the
       row is re-edited, so where there is such a part it is an exact answer
       and nothing else needs guessing.
    2. the primary chart, if the actor owns it — an owner correcting the
       main chart is the ordinary case and must not be diverted onto a fork
       they happen to also own.
    3. otherwise their most recently submitted chart (``submitted_at``,
       ties broken by file order with the later part winning) — of several
       arrangements of their own, the freshest is the one they were most
       plausibly looking at.

    Owning no chart here returns ``None``: the caller was classified
    ``update`` through the TRUSTED branch instead, and a trusted in-place
    edit is about the work's primary chart.

    Caveat worth knowing: ``submitted_by`` is written only on lead-sheet
    parts today (the tab flow records ``author``), so "owns a part" and
    "owns a chart" coincide. If a non-chart part ever carries
    ``submitted_by``, its owner would be classified ``update`` and land in
    the trusted branch here — owning a tab would buy an in-place edit of
    somebody else's chart. Closing that needs trust in the dispatch payload.
    """
    if not user_id:
        return None
    mine = [part for part in lead_sheets(work)
            if (part.get('provenance') or {}).get('submitted_by') == user_id]
    if not mine:
        return None

    # 1. where this row landed before
    prefix = f'pending:{row_id}:'
    for part in mine:
        source_id = str((part.get('provenance') or {}).get('source_id') or '')
        if source_id.startswith(prefix):
            return part.get('file')

    # 2. the primary, if it is theirs
    primary = primary_chart(work)
    if primary is not None and any(
            part.get('file') == primary.get('file') for part in mine):
        return primary.get('file')

    # 3. their most recent chart
    _, part = max(
        enumerate(mine),
        key=lambda item: (
            (item[1].get('provenance') or {}).get('submitted_at') or '',
            item[0]))
    return part.get('file')


class DedupBackstop:
    """The last check before a slug is minted.

    One :class:`dedup_scorer.WorkCorpus` is built lazily and reused, so the
    ~1.6s title index is paid at most once per process no matter how many
    rows are checked.
    """

    def __init__(self, repo_root, corpus: Optional[dedup_scorer.WorkCorpus] = None,
                 enabled: bool = True):
        self.repo_root = Path(repo_root)
        self.enabled = enabled
        self._corpus = corpus
        #: The most recent decision, for the caller's reporting.
        self.decision: Optional[DedupDecision] = None

    @property
    def corpus(self) -> dedup_scorer.WorkCorpus:
        if self._corpus is None:
            self._corpus = dedup_scorer.WorkCorpus(self.repo_root / 'works')
        return self._corpus

    def check(self, row: dict, mode: str, work_id: str, content: str,
              marker: str, verbose: bool = True) -> DedupDecision:
        decision = self._check(row, mode, work_id, content, marker)
        self.decision = decision
        if verbose:
            print(f"Dedup backstop [{decision.action}]: {decision.reason}")
        return decision

    def _check(self, row: dict, mode: str, work_id: str,
               content: str, marker: str) -> DedupDecision:
        if mode != 'create' or not self.enabled:
            why = ('target already chosen' if mode != 'create'
                   else 'backstop disabled')
            return DedupDecision('proceed', mode, work_id, why)

        incoming = dedup_scorer.Chart.from_chordpro(
            content, title=row.get('title') or '')
        verdicts = self.corpus.rank_matches(incoming)

        if not verdicts:
            return DedupDecision(
                'proceed', mode, work_id,
                f'nothing in works/ matched "{incoming.title}" — creating it')

        # Replay guard. A redirect moves the write to a work the dispatch never
        # named, so apply_row's marker check — which looks at the DISPATCHED id
        # — cannot see it. A re-dispatch of an already-redirected row would
        # then score differently (the target now carries the incoming content,
        # so `enrich` has become `duplicate`) and mint the very slug the first
        # run avoided. Look for this row's marker on the matched works instead.
        for candidate in verdicts:
            matched_id = candidate.matched_work_id
            if matched_id and already_applied(self.repo_root, matched_id, marker):
                return DedupDecision(
                    'redirect', mode, matched_id,
                    f"'{work_id}' was already applied to works/{matched_id} by "
                    f"an earlier run — this dispatch is a replay",
                    verdict=candidate)

        verdict = verdicts[0]
        scores = (f"containment {verdict.score:.3f}, title "
                  f"{verdict.title_similarity:.3f}")
        matched = verdict.matched_work_id or ''

        # --- enrich: don't mint a slug, add to what's already there --------
        if (verdict.outcome == dedup_scorer.Outcome.ENRICH
                and verdict.auto_actionable):
            owner = row.get('created_by')
            new_mode = 'update' if owns_content(self.repo_root, matched, owner) else 'fork'
            why = ('submitter already owns a part there'
                   if new_mode == 'update'
                   else "someone else's work — landing as a new arrangement part")
            return DedupDecision(
                'redirect', new_mode, matched,
                f"'{work_id}' is an enrichment of works/{matched} ({scores}); "
                f"redirecting the write as {new_mode} — {why}",
                verdict=verdict)

        # --- duplicate: write nothing, ask a human -------------------------
        ratio = verdict.details.get('size_ratio', 0.0)
        if (verdict.outcome == dedup_scorer.Outcome.DUPLICATE
                and not verdict.low_confidence
                and verdict.score >= dedup_scorer.CONTAINMENT_DUPLICATE
                and ratio >= dedup_scorer.SIMILAR_RICHNESS_RATIO):
            return DedupDecision(
                'hold', mode, work_id,
                f"'{work_id}' looks like a duplicate of works/{matched} "
                f"({scores}, size ratio {ratio:.2f}) — nothing written, "
                f"held for review",
                verdict=verdict)

        # --- everything else is advice, not a veto -------------------------
        note = 'low-confidence' if verdict.low_confidence else verdict.outcome
        return DedupDecision(
            'proceed', mode, work_id,
            f"'{work_id}' scored {note} against works/{matched} ({scores}) — "
            f"advisory only, creating it as dispatched",
            verdict=verdict)


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
              verbose: bool = True,
              backstop: Optional[DedupBackstop] = None) -> works_writer.WriteResult:
    """Write one pending row to ``works/`` in the dispatched mode.

    ``backstop`` is consulted before a ``create`` and may retarget the write
    or refuse it outright; pass one in to reuse its corpus (or to disable the
    check). See "Dedup backstop" in the module docstring.
    """
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

    # The backstop runs BEFORE the replay check so a re-dispatch of a
    # redirected row looks for its marker on the work it was redirected to,
    # not on the slug it would have minted.
    if backstop is None:
        backstop = DedupBackstop(repo_root)
    decision = backstop.check(row, mode, work_id, content, marker,
                              verbose=verbose)
    if decision.action == 'hold':
        return works_writer.WriteResult(
            mode=mode, work_id=work_id, skipped_reason=DEDUP_HOLD_REASON)
    mode, work_id = decision.mode, decision.work_id

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
        # Target the chart the actor OWNS, never just the first one. See
        # update_target: an owner of a FORK is classified `update` too, and
        # a bare {'type': 'lead-sheet'} match would rewrite the primary.
        work = works_writer.load_work(repo_root, work_id)
        target = update_target(work, row_id, row.get('created_by'))
        match = {'type': 'lead-sheet'}
        if target:
            match['file'] = target

        primary = primary_chart(work)
        edits_primary = target is None or (
            primary is not None and primary.get('file') == target)

        # Work-level fields describe the SONG, not one arrangement of it, so
        # only an edit of the primary chart carries them. A fork owner
        # re-keying or retitling their own arrangement must not re-key or
        # retitle the work out from under everybody else — the same in-place
        # destruction the part targeting above prevents, one level up. (A
        # fork lands with no work_updates at all, so this keeps "submit my
        # arrangement" and "edit my arrangement" consistent.)
        work_updates = {}
        if edits_primary:
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
            match=match,
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


def _one_line(value) -> str:
    """Collapse a value to a single line for GITHUB_OUTPUT."""
    return ' '.join(str(value or '').split())


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
    backstop = DedupBackstop(repo_root)

    try:
        row = fetch_pending_row(row_id, supabase_url=supabase_url,
                                service_key=service_key)
        result = apply_row(repo_root, row, mode, work_id or row_id, actor,
                           backstop=backstop)
    except (ProcessPendingError, works_writer.WorksWriterError) as e:
        print(f'Error: {e}', file=sys.stderr)
        return 1

    # A held row must stop being re-dispatched. Without this the hourly
    # reconciler would re-fire it every hour and the backstop would refuse it
    # every hour — a review issue that never stops growing and a workflow that
    # is always red. The flag is set here rather than by the workflow so the
    # hold is atomic with the decision that made it.
    if result.skipped_reason == DEDUP_HOLD_REASON:
        reason = (backstop.decision.reason if backstop.decision
                  else 'held by the dedup backstop')
        try:
            patch_pending_row(row_id, {'dedup_hold': reason[:5000]},
                              supabase_url=supabase_url,
                              service_key=service_key)
            print(f"Marked '{row_id}' dedup_hold — the reconciler will skip it.")
        except ProcessPendingError as e:
            # Worth saying loudly, but not worth failing over: the review
            # issue still gets opened and a human still sees the row.
            print(f'Warning: could not set dedup_hold: {e}', file=sys.stderr)

    if not result.written:
        print(f"Nothing written ({result.skipped_reason}) for '{row_id}'")
    else:
        print(f"{result.mode}: works/{result.work_id}/{result.part_file}")

    # The workflow reads these to build its commit message and to decide
    # whether to flip github_committed.
    github_output = os.environ.get('GITHUB_OUTPUT')
    if github_output:
        fields = {
            'work_id': result.work_id,
            'mode': result.mode,
            'part_file': result.part_file or '',
            'written': 'true' if result.written else 'false',
            'skipped_reason': result.skipped_reason or '',
            'row_title': row.get('title') or '',
        }
        if backstop.decision:
            fields.update(backstop.decision.outputs())
        with open(github_output, 'a') as fh:
            for key, value in fields.items():
                # `key=value\n` is the whole format, so a newline anywhere in
                # a value would let submitted text forge another output. Row
                # titles and work ids are user-controlled; flatten them.
                fh.write(f'{key}={_one_line(value)}\n')

    return 0


if __name__ == '__main__':
    sys.exit(main())
