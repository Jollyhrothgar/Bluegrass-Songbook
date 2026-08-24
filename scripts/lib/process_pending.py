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
``add``
    Tablature only: a NEW tab part on an existing work — a first banjo tab
    for a song that had none, another take on an instrument it already has,
    or a "correction" from somebody who does not own the tab they meant to
    fix. ``add_part`` appends; nothing published is read-modify-written.
    This is the tab column's ``fork``.
``metadata``
    Metadata only: the WORK's own title / artist / key / notes and nothing
    else. No part is created, replaced, renamed or reordered and no part
    file is written — ``works_writer.update_metadata`` is the entry point,
    and it can only write work-level fields. See "Metadata" below.
``placeholder``
    A song REQUEST: mint a work with metadata, ``status: placeholder`` and
    ``parts: []``. ``create_work(part=None, on_collision='fail')`` — it mints
    at the id it was asked for or refuses, and never touches an existing
    work. See "Placeholder" below.

Tablature (2026-08-18)
----------------------
Tabs used to leave here entirely: ``create-tab-pr`` committed the OTF to a
branch, opened a PR, and ``process-tab-pr.yml`` ran ``process_tab.py`` to
author the work.yaml around it. A human merge published it. That split the
contract — a chart went live in seconds, a tab waited — and
docs/plans/contribution-pipeline.md deferred fixing it at 4c because
``pending_songs`` had no notion of parts or instruments. It does now
(``part_type`` / ``instrument`` / ``part_file``), so a tablature row rides
this same path: ``content`` holds the serialized OTF, it is validated here
(:func:`validate_otf`, moved over from the retired ``process_tab``), and
``works_writer`` writes ``works/<id>/<instrument>[-N].otf.json``.

One row per SONG is the right shape for a chart and the wrong one for a
part, so a tab row's id is synthetic — ``tab:<slug>:<rand>`` — and the work
it targets comes from ``replaces_id``, or from the TITLE when it is minting
one (:func:`tab_work_slug`). Keying tab rows by the work id would have made
two people tabbing the same song collide on the ``pending_songs`` primary
key, and (because the update policy gates on ``created_by``) fail as a
permissions error about something else entirely.

Three things a tab does differently, all for reasons that don't generalize:

* **The dedup backstop is skipped.** It scores lyric containment. An OTF has
  no lyrics, so every tab would come back low-confidence at best and
  nonsense at worst — the scorer's own instrumental rule already says as
  much. See :func:`apply_tablature_row`.
* **The submitted document's ``x_source`` block is dropped.** It records
  "this OTF is the conversion of Hangout TEF *N*", and
  ``build_works_index._tab_provenance_mismatch`` FAILS THE BUILD when it
  disagrees with the part's ``provenance.source_id`` — which this pipeline
  must set to the idempotence marker. An edited tab is no longer that
  verbatim conversion anyway; the displaced identity is kept as
  ``provenance.x_derived_from`` rather than thrown away.
* **The submitter's comment lands on the PART**, as
  ``provenance.x_submission_notes`` / ``x_correction_notes`` — not in the
  work-level ``notes`` the chart path writes, which describes the song
  rather than one take of it.

Metadata (2026-08-18)
---------------------
A work minted by a TAB was stranded: it had a title the submitter typed and
nothing else — no artist, no key — and no way to fix that, because every row
shape this pipeline understood edited a PART, and the work-level fields only
ever rode along with a rewrite of the primary chart. A tab-only work has no
chart to rewrite.

So ``part_type = 'metadata'``: a row with NO content that names its target in
``replaces_id`` and carries whichever of title / artist / key / notes the
editor changed. It writes work.yaml through
:func:`works_writer.update_metadata` and touches nothing else.

Three things it does differently, each for its own reason:

* **The dedup backstop is skipped**, like a tab's but for a different reason:
  a tab has no lyrics to score, a metadata row has no *content at all*. There
  is also nothing to dedupe — the row names an existing work, so no slug is
  being minted, which is the only thing the backstop guards.
* **Absent fields are dropped, not written.** The client sends what changed;
  a null artist means "I didn't touch the artist", never "blank it".
* **The idempotence marker is derived from the FIELDS**, not from ``content``
  (which is null here) — see :func:`metadata_marker`.

Who is allowed to send one is decided before the dispatch, in
``supabase/functions/_shared/pending-dispatch.ts``: own any part of the work,
or be trusted. That is a looser question than the per-part-type ownership the
chart and tab columns ask, on purpose — no content is rewritten by naming the
artist — and the two must not be collapsed into each other.

Placeholder (2026-08-19)
------------------------
A song request. It mints a work with metadata, ``status: placeholder`` and
``parts: []`` — the shape ``utils.isPlaceholder`` and the bounty board read.

``create-song-request`` used to do this itself: it hand-interpolated a
``work.yaml`` string and PUT it to the GitHub Contents API, passing the
EXISTING file's sha whenever the path was taken. So a request whose
client-generated slug collided with a real work overwrote it — parts, artist,
composers and tags replaced by an empty stub — with no suppression check, no
redirect check and no collision handling. It also set ``github_committed`` on
the basis of TRUST, before the commit was attempted, while treating a failed
commit as non-fatal. That function predates phase 1c/2b and was simply never
converted; this branch is the conversion.

A request is a lead-sheet row with no lead sheet, so — unlike a tab or a
metadata edit — it is NOT a new ``part_type``. It is recognised by shape:
``status = 'placeholder'`` and no content (:func:`is_placeholder_row`). Both
halves are needed; see that function.

Three things it does differently:

* **The dedup backstop is skipped**, for the union of the other two
  contentless columns' reasons: no ChordPro to score, and "is this song
  already here?" has just been answered exactly by looking rather than
  guessed at from lyrics.
* **An existing work at the id is a refusal, not a suffix.**
  ``on_collision='suffix'`` would be SAFE (``foo-1``, leaving ``foo`` alone)
  but wrong: an empty placeholder beside a real song is a bounty-board entry
  asking for a song the site already has. The edge function answers 409
  before a row is written; reaching :func:`apply_placeholder_row` with the
  work present means it appeared in between, and the row is parked.
* **The marker is the metadata one.** No content to hash and no part to hang
  a part-level marker on, so the sha is over the fields being written and it
  is stamped at the work level as ``metadata_provenance`` — which doubles as
  the only record of who asked for the song.

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

Refusals that must not be retried
---------------------------------
The hourly reconciler re-fires every uncommitted row, which is the right
answer for a transient failure and the wrong one for a *decision*. Two
refusals are decisions: the dedup hold above, and a write whose target work
is suppressed / soft-deleted / merged away (``works_writer.Guards``). Both
are parked by writing the verdict to ``pending_songs.dedup_hold``, which the
reconciler skips and the Bluegrass Dungeon renders with *Release hold* /
*Reject* — see :func:`hold_reason` for why that column and not a new one.

The suppressed case is not hypothetical: a guitar tab for ``dark-hollow-1``
— a live, curated work — was refused because the *unrelated*, soft-deleted
``dark-hollow`` matched the mint-time collision-suffix rule, and then refused
again every hour for as long as it took somebody to read the logs. The rule
itself is fixed in ``curation.is_suppressed`` / ``is_suppressed_exact``; the
hold is what keeps the next such refusal from being an hourly one.

Idempotence
-----------
A dispatch can arrive twice — the hourly reconciler re-fires any row still
flagged uncommitted, and a workflow that pushed but failed to flip the flag
looks exactly like one that never ran. So every part written here carries a
``provenance.source_id`` of ``pending:<row id>:<content sha>``; if the target
work already has a part with that marker, the row has already been applied
and this is a no-op. Re-editing the same row changes the sha, so a genuine
second edit is never mistaken for a replay.

A metadata row has no content to hash, so its marker hashes the FIELDS it is
applying instead (:func:`metadata_marker`) and is stamped at the work level as
``metadata_provenance.source_id``. Same property, same shape: replay the same
edit and the marker matches (no-op); change one letter of the artist and it
does not (applies).

A redirect complicates this: the row landed on a work the dispatch never
named, so looking for the marker under the dispatched id finds nothing. The
backstop therefore checks the marker against its match candidates too — see
``DedupBackstop._check``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
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
from work_schema import slugify

#: Modes a LEAD-SHEET row may be dispatched in.
MODES = ('create', 'update', 'fork')

#: Modes a TABLATURE row may be dispatched in. ``add`` takes the place of
#: ``fork``; a chart's alternate take is an arrangement of the same chart,
#: a tab's is simply another part. Keeping the two tuples separate means a
#: mode from the wrong column ('fork' for a tab, 'add' for a chart) is a
#: loud refusal rather than a surprising write.
TAB_MODES = ('create', 'update', 'add')

#: Modes a METADATA row may be dispatched in — one, because there is only
#: one thing it can do. Kept as a tuple for symmetry with the two above, and
#: so a mode from another column ('create' for a metadata row, which would
#: mean minting a work out of a title with no content) is a loud refusal.
METADATA_MODES = ('metadata',)

#: Modes a PLACEHOLDER row may be dispatched in. One again, and deliberately
#: NOT ``create``: the two are the same gesture but not the same permission,
#: and a placeholder dispatched as ``create`` would fall into the chart column
#: and be refused there for having no content. Keeping the names apart makes
#: a row from the wrong column a loud refusal in both directions.
PLACEHOLDER_MODES = ('placeholder',)

#: What marks a work as having no content yet, in ``pending_songs.status`` and
#: in ``work.yaml``. Read by the frontend (``utils.isPlaceholder``) and the
#: bounty board; ``work_schema.Work`` defines the other value as ``complete``.
PLACEHOLDER_STATUS = 'placeholder'

#: ``pending_songs`` column -> ``work.yaml`` field, for a placeholder row.
#: The same four a metadata row may write, minus ``notes``' sibling fields the
#: request form does not collect. ``tags`` is deliberately absent: a requester
#: types a title and an artist, not a genre taxonomy, and the tagging pipeline
#: fills those in once there is something to tag.
PLACEHOLDER_COLUMNS = (
    ('title', 'title'),
    ('artist', 'artist'),
    ('key', 'default_key'),
    ('notes', 'notes'),
)

#: ``pending_songs`` column -> ``work.yaml`` field, for a metadata row. Only
#: these four: the row shape carries nothing else a work-level field wants,
#: and ``works_writer.update_metadata`` refuses anything outside its own
#: whitelist anyway.
METADATA_COLUMNS = (
    ('title', 'title'),
    ('artist', 'artist'),
    ('key', 'default_key'),
    ('notes', 'notes'),
)

#: Instrument names and work ids both land inside works/ as path segments,
#: so both are held to the slug shape the edge function, work_schema.slugify
#: and the pending_songs CHECKs all agree on.
SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')

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

#: ``WriteResult.skipped_reason`` when a placeholder was asked to mint a work
#: at an id that already holds one. Its own reason string rather than a
#: ``WorkExistsError``, because it is a DECISION (park the row, tell a human)
#: and not a crash: raising would fail the workflow, be retried hourly, and
#: fail identically every hour.
WORK_EXISTS_SKIP_REASON = 'work-exists'

#: ``WriteResult.skipped_reason`` values that no retry can turn into a write.
#: ``works_writer.Guards`` produces both: the target work is suppressed /
#: soft-deleted, or it was merged away. Neither changes by waiting — only a
#: human editing ``curation/registry.yaml``, ``deleted_songs`` or the row's
#: ``replaces_id`` can move them — so a row refused for one of these is
#: parked (see :func:`hold_reason`) instead of being re-dispatched hourly
#: until the end of time.
PERMANENT_SKIP_REASONS = ('suppressed', 'redirected')


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


def owns_content(repo_root, work_id: str, user_id: Optional[str],
                 part_type: str = 'lead-sheet') -> bool:
    """Has ``user_id`` already contributed a part OF THIS KIND to this work?

    Mirrors ``supabase/functions/_shared/pending-dispatch.ts``'s
    ``submittersOf`` — the same question, asked of the same field, on the
    other side of the dispatch, and scoped the same way.

    The scoping is the point. Both sides used to ask "does this uuid appear
    in any part's ``submitted_by``?", which was safe only while
    ``submitted_by`` appeared on lead-sheet parts alone (the PR-based tab
    flow recorded ``author``). Tabs now come through this pipeline and carry
    ``submitted_by`` too, so an unscoped answer would let submitting a banjo
    tab to a work confer in-place edit rights over that work's CHART — a
    stranger's lyrics, and the work's title/artist/key with them. Ownership
    of a tab is ownership of a tab.
    """
    if not user_id:
        return False
    work = works_writer.load_work(repo_root, work_id)
    if not work:
        return False
    return any(
        (part.get('provenance') or {}).get('submitted_by') == user_id
        for part in (work.get('parts') or [])
        if part.get('type') == part_type
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

    That fallback is why ownership must be answered per part type, and now
    is. ``submitted_by`` used to appear on lead-sheet parts only, so "owns a
    part" and "owns a chart" coincided by accident; tabs joined this
    pipeline and started carrying it too, at which point an unscoped
    classifier would have sent a tab contributor down the trusted branch
    here — a non-owner rewriting the primary chart in place, plus the
    work-level title/artist/key that ride along with a primary edit. Both
    classifiers (:func:`owns_content` and ``submittersOf``) now count only
    parts of the kind being edited, so reaching this function's ``None``
    really does mean "trusted".
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
            # Chart ownership, explicitly: the backstop only ever sees
            # lead-sheet rows (tabs skip it — an OTF has no lyrics to
            # contain), and owning a TAB on the matched work must not
            # redirect this chart into an in-place update of somebody
            # else's chart.
            new_mode = 'update' if owns_content(
                self.repo_root, matched, owner, 'lead-sheet') else 'fork'
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


# ============================================
# Metadata
# ============================================


def metadata_updates(row: dict) -> dict:
    """The work-level fields this row is actually asking to change.

    Only what the row CARRIES. A null or blank column is "I didn't touch
    this", never "blank it" — the editor sends the fields it changed, and
    there is no gesture in this pipeline for clearing one. Writing a missing
    artist as an empty artist would let a client that forgot a field erase
    work somebody else did, which is the same destruction the part-targeting
    rules prevent one level down.
    """
    updates = {}
    for column, field in METADATA_COLUMNS:
        value = row.get(column)
        if value is None:
            continue
        value = str(value).strip()
        if value:
            updates[field] = value
    return updates


def metadata_marker(row_id: str, updates: dict) -> str:
    """The idempotence marker for a metadata row.

    The part markers hash ``content``; a metadata row has none (a CHECK on
    ``pending_songs`` refuses one), so hashing it would give every metadata
    row in the table the SAME marker — the first edit of a work would then
    make every later edit of it look like a replay and silently do nothing.

    So the sha is taken over the fields being applied, serialized
    canonically: sorted keys, so column order can never change the answer,
    and the exact dict :func:`metadata_updates` produced, so a field the row
    is not applying cannot influence it. The result goes through
    :func:`content_marker` to keep the one ``pending:<row id>:<sha>`` shape
    everything in this pipeline greps for.

    The property that matters, in both directions:

    * replay the same row unchanged -> same fields -> same sha -> the work
      already carries this marker -> no-op.
    * genuinely re-edit the row (fix a typo in the artist) -> different sha
      -> applies.

    Note this is last-writer-wins across DIFFERENT rows, exactly as the part
    path is: a metadata row that never reached git keeps its uncommitted flag
    and will be re-dispatched with its CURRENT values, so a stale edit cannot
    resurrect old text — but two people editing one work land in the order
    their dispatches complete.
    """
    canonical = json.dumps(updates, sort_keys=True, ensure_ascii=False,
                           separators=(',', ':'))
    return content_marker(row_id, canonical)


def metadata_applied(repo_root, work_id: str, marker: str) -> bool:
    """Has this exact metadata edit already landed on this work?

    The part-level :func:`already_applied` cannot answer it: a metadata edit
    writes no part, so there is no ``provenance.source_id`` for it to find.
    The marker lives at the work level instead.
    """
    work = works_writer.load_work(repo_root, work_id)
    if not work:
        return False
    return (work.get('metadata_provenance') or {}).get('source_id') == marker


def apply_metadata_row(repo_root, row: dict, mode: str, work_id: str,
                       actor: Optional[str] = None,
                       verbose: bool = True) -> works_writer.WriteResult:
    """Write one metadata row to ``works/``: work-level fields, nothing else.

    No part is created, replaced, renamed or reordered, and no part file is
    written — :func:`works_writer.update_metadata` is structurally incapable
    of any of that (it accepts a whitelist of work-level keys, and ``parts``
    is not on it).

    The dedup backstop is NOT consulted, and the omission is deliberate. It
    exists to stop a ``create`` minting a slug for a song that is already in
    the corpus; a metadata row mints nothing — it names an existing work in
    ``replaces_id``, which the edge function has already resolved and checked
    — so there is no slug for it to guard. It also scores lyric containment
    over a submission's ChordPro, and this row has no content at all.
    """
    if mode not in METADATA_MODES:
        raise ProcessPendingError(
            f"unknown metadata mode {mode!r} "
            f"(expected one of {', '.join(METADATA_MODES)})")

    row_id = row.get('id')
    if not row_id:
        raise ProcessPendingError('row has no id')

    # A metadata row's id is `meta:<slug>:<rand>` so two people fixing one
    # song's details cannot collide on the pending_songs primary key. Like a
    # tab's, it is NOT a work slug and must never become a directory name —
    # and unlike a tab's there is no title-minting fallback, because a
    # metadata edit has nothing to create a work out of.
    work_id = (work_id or '').strip()
    if not SLUG_RE.match(work_id):
        raise ProcessPendingError(
            f"metadata row '{row_id}' has no usable target work id "
            f"({work_id!r} is not a slug); it must be dispatched with the "
            f"work named in replaces_id")

    updates = metadata_updates(row)
    if not updates:
        raise ProcessPendingError(
            f"metadata row '{row_id}' carries no fields to apply")

    marker = metadata_marker(row_id, updates)
    if metadata_applied(repo_root, work_id, marker):
        if verbose:
            print(f"Already applied: works/{work_id} carries {marker}")
        return works_writer.WriteResult(
            mode='update-metadata', work_id=work_id,
            skipped_reason='already-applied')

    return works_writer.update_metadata(
        repo_root, work_id,
        updates=updates,
        provenance=_provenance(row, marker, actor),
        verbose=verbose,
    )


# ============================================
# Placeholder (a song request)
# ============================================


def is_placeholder_row(row: dict) -> bool:
    """Is this row a song REQUEST — a work that is wanted, with no chart yet?

    The Python half of ``commit-song.ts:isPlaceholderRow``, and the two must
    keep agreeing: that one decides which column the edge function classifies
    the row into, this one decides which writer it reaches. Both ask the same
    two questions of the same two columns.

    ``content`` is the second question and it is load-bearing, not
    belt-and-braces. ``status`` is a STICKY column — a chart save upserts on
    the same id (a chart row's id is its work slug, and so is a request's) —
    so a row that WAS a request and has since grown a real chart can still be
    carrying ``status: placeholder``. Content settles it: once there is a
    chart this is a chart row, whatever the status column still says.
    Believing the status column alone would drop that submitter's ChordPro
    and mint an empty work in its place.
    """
    if (row.get('part_type') or 'lead-sheet') != 'lead-sheet':
        return False
    if row.get('status') != PLACEHOLDER_STATUS:
        return False
    return not (row.get('content') or '').strip()


def placeholder_updates(row: dict) -> dict:
    """The work-level fields this request actually carries.

    Only what is there, exactly as :func:`metadata_updates` does it: a null
    column is "the requester didn't say", never "write a blank". The
    difference is that this dict SEEDS a new work rather than editing one, so
    an absent field simply never appears in the file.
    """
    updates = {}
    for column, field in PLACEHOLDER_COLUMNS:
        value = row.get(column)
        if value is None:
            continue
        value = str(value).strip()
        if value:
            updates[field] = value
    return updates


def apply_placeholder_row(repo_root, row: dict, mode: str, work_id: str,
                          actor: Optional[str] = None,
                          verbose: bool = True) -> works_writer.WriteResult:
    """Mint one placeholder work: metadata, ``status: placeholder``, no parts.

    This is the path that replaced a hand-interpolated YAML string PUT
    straight to the GitHub Contents API by ``create-song-request``. That PUT
    carried the existing file's SHA when the path was taken, so a request
    whose slug collided with a real work REPLACED it with an empty stub — its
    parts, artist, composers and tags gone. Everything that stops that now is
    inherited rather than re-implemented:

    * ``create_work`` refuses a suppressed or redirected id (``Guards``),
    * it never overwrites an existing work in any mode, and
    * ``work_id`` is re-checked against :data:`SLUG_RE` before it can become
      a directory name, the same way a tab's slug is re-derived rather than
      trusted.

    On top of those, ONE rule of this column's own: a placeholder is never
    written where a work already exists. ``create_work(on_collision='suffix')``
    would have been safe — it mints ``foo-1`` and leaves ``foo`` alone — but
    it is not RIGHT: an empty placeholder beside a real song is a bounty-board
    entry asking for a song the site already has. The edge function refuses
    that case with a 409 before a row is even written; reaching it here means
    the work appeared in between (or somebody re-fired a dispatch by hand), so
    the row is parked for a human instead (:func:`hold_reason`).

    The dedup backstop is skipped, for the union of the two reasons the other
    contentless columns skip it: there is no ChordPro for a lyric-containment
    scorer to score, and "is this song already here?" has just been answered
    exactly, by looking, rather than guessed at from lyrics.
    """
    if mode not in PLACEHOLDER_MODES:
        raise ProcessPendingError(
            f"unknown placeholder mode {mode!r} "
            f"(expected one of {', '.join(PLACEHOLDER_MODES)})")

    row_id = row.get('id')
    if not row_id:
        raise ProcessPendingError('row has no id')

    # A request's id IS the work slug it is asking for, and it is
    # CLIENT-SUPPLIED — which is why it is checked on both sides of the
    # dispatch. This is the side that mints a directory.
    work_id = (work_id or '').strip()
    if not SLUG_RE.match(work_id):
        raise ProcessPendingError(
            f"placeholder row '{row_id}' has no usable work id "
            f"({work_id!r} is not a slug)")

    updates = placeholder_updates(row)
    if not updates.get('title'):
        raise ProcessPendingError(f"row '{row_id}' has no title")

    # Same construction as a metadata row's marker, and for the same reason: a
    # placeholder has no content to hash either, so the sha is taken over the
    # fields being written. It is stamped at the work level, so
    # `metadata_applied` is the question to ask — a placeholder has no part to
    # carry a part-level marker, which is the whole point of it.
    marker = metadata_marker(row_id, updates)
    if metadata_applied(repo_root, work_id, marker):
        if verbose:
            print(f"Already applied: works/{work_id} carries {marker}")
        return works_writer.WriteResult(
            mode='create-new', work_id=work_id, skipped_reason='already-applied')

    if works_writer.load_work(repo_root, work_id) is not None:
        if verbose:
            print(f"Refusing to place a request on works/{work_id}: "
                  f"a work is already there")
        return works_writer.WriteResult(
            mode='create-new', work_id=work_id,
            skipped_reason=WORK_EXISTS_SKIP_REASON)

    extra = {'status': PLACEHOLDER_STATUS}
    if updates.get('notes'):
        extra['notes'] = updates['notes']
    # The work-level provenance a metadata edit stamps, used here as the
    # request's receipt: who asked, when, and the marker that makes a
    # re-dispatch a no-op. A placeholder has no part to hang provenance on, so
    # this is the only record that the work was minted by a request at all.
    extra['metadata_provenance'] = _provenance(row, marker, actor)

    return works_writer.create_work(
        repo_root, work_id, updates['title'], None,
        artist=updates.get('artist'),
        default_key=updates.get('default_key'),
        tags=[],
        extra=extra,
        # Unreachable after the existence check above, and deliberately not
        # 'suffix': the two together mean this column can only ever mint at
        # the id it was asked for, or refuse.
        on_collision='fail',
        allow_existing_dir=True,
        on_suppressed='skip',
        verbose=verbose,
    )


# ============================================
# Tablature
# ============================================


def validate_otf(otf) -> list:
    """Sanity checks — returns a list of problems (empty = OK).

    Moved here from the retired ``scripts/lib/process_tab.py`` unchanged.
    It is the ONLY structural validation an incoming OTF gets: the edge
    function asks no more than "does this parse and have tracks?", because
    everything below needs to walk the notation, and the editor that
    produced the document is not a party this pipeline trusts.
    """
    problems = []
    if not isinstance(otf, dict):
        return ['not an object']
    tracks = otf.get('tracks')
    if not isinstance(tracks, list) or not tracks:
        problems.append('no tracks')
        return problems
    notation = otf.get('notation') or {}
    for t in tracks:
        tid = t.get('id')
        if not tid:
            problems.append('track without id')
            continue
        if not isinstance(t.get('tuning'), list) or len(t['tuning']) < 3:
            problems.append(f'track {tid}: bad tuning')
        measures = notation.get(tid)
        if not isinstance(measures, list):
            problems.append(f'track {tid}: no notation')
            continue
        nstrings = len(t.get('tuning') or [])
        for m in measures:
            if not isinstance(m.get('measure'), int):
                problems.append(f'track {tid}: measure without number')
                break
            for e in m.get('events', []):
                if not isinstance(e.get('tick'), int) or e['tick'] < 0:
                    problems.append(f'track {tid} m{m.get("measure")}: bad tick')
                    break
                for n in e.get('notes', []):
                    s, f = n.get('s'), n.get('f')
                    if not (isinstance(s, int) and 1 <= s <= nstrings):
                        problems.append(f'track {tid} m{m.get("measure")}: bad string {s}')
                        break
                    if not (isinstance(f, int) and 0 <= f <= 24):
                        problems.append(f'track {tid} m{m.get("measure")}: bad fret {f}')
                        break
    return problems


def otf_document(row: dict) -> tuple:
    """Parse, validate and re-serialize a tablature row's ``content``.

    Returns ``(document, text)``. The text is what lands in ``works/``:
    ``indent=2``, matching every OTF already in the corpus, so a correction
    produces a readable diff against the take it replaces rather than a
    one-line churn.

    Re-serializing also makes the idempotence marker whitespace-insensitive.
    The marker is a sha of this canonical text, so a client that re-saves a
    tab it did not actually change is a replay (no-op) rather than a second
    part — which matters more here than for charts, because an OTF is
    machine-serialized and its formatting is nobody's intent.

    ``x_source`` is dropped on the way through. It records "this OTF is the
    conversion of Hangout TEF *N*", and ``build_works_index`` FAILS THE
    BUILD when that id disagrees with the part's ``provenance.source_id``,
    which this pipeline sets to the marker. A tab that has been through the
    editor is no longer that verbatim conversion, so the claim has to go;
    the identity it carried is preserved in provenance instead
    (:func:`_tab_provenance`, ``x_derived_from``).
    """
    content = row.get('content')
    if not content or not content.strip():
        raise ProcessPendingError(
            f"row '{row.get('id')}' has no content — nothing to write")
    try:
        document = json.loads(content)
    except json.JSONDecodeError as e:
        raise ProcessPendingError(
            f"row '{row.get('id')}' content is not valid JSON: {e}") from e

    problems = validate_otf(document)
    if problems:
        raise ProcessPendingError(
            f"row '{row.get('id')}' failed OTF validation: "
            + '; '.join(problems[:5]))

    document.pop('x_source', None)
    return document, json.dumps(document, indent=2, ensure_ascii=False) + '\n'


def tab_work_slug(work_id: str, title: str) -> str:
    """The slug a tab-minted work is created under.

    A tablature row's id is synthetic — ``tab:<slug>:<rand>``, so that two
    people can tab the same song without colliding on ``pending_songs``'
    primary key — which means the id is NOT a work slug and must never
    become one. ``classifyChange`` already sends ``slugify(title)`` for a
    create, but this is the side that mints a directory, so it re-derives
    rather than trusting: anything that is not a plain slug (a row id that
    leaked through, a stale edge function, a hand-fired dispatch) is
    replaced by the title's slug.

    Only the BASE name is decided here. ``create_work(on_collision='suffix')``
    resolves the real one against the checkout — ``salt-creek``,
    ``salt-creek-1``, … — skipping ids that are taken, suppressed or
    redirected. That is the free-slug hunt the retired ``create-tab-pr``
    did by probing the Contents API, moved somewhere it can actually see
    the whole corpus instead of one branch.
    """
    if work_id and SLUG_RE.match(work_id):
        return work_id
    slug = slugify(title or '')
    if not slug:
        raise ProcessPendingError(
            f"cannot mint a work for a tab: {work_id!r} is not a slug and "
            f"the title {title!r} does not produce one")
    return slug


def tab_instrument(row: dict) -> str:
    """The instrument a tablature row is for, shape-checked.

    A CHECK constraint on ``pending_songs`` already requires this, and the
    edge function refuses a row without it. Checked a third time because
    this value becomes a filename inside ``works/`` — the one place where
    being wrong is a path, not a message.
    """
    instrument = (row.get('instrument') or '').strip()
    if not instrument:
        raise ProcessPendingError(
            f"tablature row '{row.get('id')}' has no instrument")
    if not SLUG_RE.match(instrument):
        raise ProcessPendingError(
            f"tablature row '{row.get('id')}' has a bad instrument "
            f"{instrument!r} (expected lowercase slug)")
    return instrument


def _tab_provenance(row: dict, marker: str, actor: Optional[str],
                    previous: Optional[dict] = None) -> dict:
    """Provenance for a tab part this pipeline writes.

    ``author`` is the display name the frontend credits on a tablature part
    (``tablature_parts[].author``), so a NEW tab records the submitter
    there. A correction does not — see :func:`apply_tablature_row`: the
    person who fixes a wrong fret did not arrange the tab, and overwriting
    ``author`` would quietly take the credit.

    ``previous`` is the provenance being replaced, when there is one. Its
    ``source``/``source_id`` are about to be overwritten with
    ``user-submission`` + the marker, so where they said something real
    (a Hangout tab id) they are folded into ``x_derived_from`` rather than
    lost — this part's lineage is the only record that the take started
    life somewhere else.

    ``row['notes']`` is the submitter's comment. It lands on the PART, as
    ``x_submission_notes`` (or ``x_correction_notes`` for an update), and
    deliberately NOT in the work-level ``notes`` field the chart path uses:
    work-level notes describe the song, and "fixed the fret in bar 12" is
    about one take of it. The retired PR flow put this text in the PR body
    and wrote it nowhere — with no reviewer to read a PR body, provenance
    is where it has to live.
    """
    provenance = _provenance(row, marker, actor)
    if actor:
        provenance['author'] = actor
    notes = (row.get('notes') or '').strip()
    if notes:
        provenance['x_submission_notes'] = notes
    if previous:
        source = (previous.get('source') or '').strip()
        source_id = str(previous.get('source_id') or '').strip()
        if source and source != SOURCE and source_id:
            provenance['x_derived_from'] = f'{source}:{source_id}'
        elif source and source != SOURCE:
            provenance['x_derived_from'] = source
        elif previous.get('x_derived_from'):
            provenance['x_derived_from'] = previous['x_derived_from']
    return provenance


def apply_tablature_row(repo_root, row: dict, mode: str, work_id: str,
                        actor: Optional[str] = None,
                        verbose: bool = True) -> works_writer.WriteResult:
    """Write one tablature row to ``works/`` in the dispatched mode.

    ``create``
        The tab mints the work — the shape a submission for a song not in
        the corpus takes. The part is the work's default, and the work's
        slug comes from the title (:func:`tab_work_slug`), never from the
        synthetic row id.
    ``add``
        A NEW part on an existing work: a first tab for that instrument, a
        second take on one it already has, or a "correction" from somebody
        who does not own the tab they meant to fix. Nothing published is
        read-modify-written, which is the "hard to destroy" rule in the tab
        column.
    ``update``
        The caller owns the named part, or is trusted. The one mode that
        rewrites a published file.

    The dedup backstop is NOT consulted, and the omission is deliberate
    rather than an oversight: it scores lyric containment
    (``dedup_scorer.Chart.from_chordpro``), an OTF has no lyrics, and the
    scorer's own rule for lyric-less input is that it is low-confidence and
    never auto-actionable. Running it here would spend ~1.6s building a
    title index in order to produce advice it already knows is worthless,
    with a non-zero chance of diverting a write on a title collision.
    Whether two tabs are the same arrangement is a real question — it is
    just not a question this scorer can answer.
    """
    if mode not in TAB_MODES:
        raise ProcessPendingError(
            f"unknown tablature mode {mode!r} "
            f"(expected one of {', '.join(TAB_MODES)})")

    row_id = row.get('id')
    if not row_id:
        raise ProcessPendingError('row has no id')
    title = row.get('title')
    if not title:
        raise ProcessPendingError(f"row '{row_id}' has no title")

    instrument = tab_instrument(row)
    _, otf_text = otf_document(row)
    marker = content_marker(row_id, otf_text)

    # A tab row's id is `tab:<slug>:<rand>`, never a work slug, so a create
    # has to be told (or work out) what to name the work it mints.
    if mode == 'create':
        work_id = tab_work_slug(work_id, title)

    if already_applied(repo_root, work_id, marker):
        if verbose:
            print(f"Already applied: works/{work_id} carries {marker}")
        return works_writer.WriteResult(
            mode=mode, work_id=work_id, skipped_reason='already-applied')

    work = works_writer.load_work(repo_root, work_id)
    work_dir = works_writer.work_path(repo_root, work_id)
    bare_name = f'{instrument}.otf.json'

    if mode == 'update':
        target = (row.get('part_file') or '').strip()
        match = {'type': 'tablature', 'file': target}
        existing = works_writer.find_parts(work, match) if work else []
        if not existing:
            # The edge function downgrades this to `add` when it can see the
            # work.yaml; arriving here means main moved underneath the
            # dispatch (the part was renamed or removed). Landing the tab
            # beside what IS there beats guessing at a substitute target —
            # `update_part` with a loose match would pick the default take
            # and overwrite a stranger's arrangement.
            if verbose:
                print(f"update: works/{work_id} has no tablature part "
                      f"{target!r} any more — adding it instead")
            mode = 'add'
        else:
            previous = dict(existing[0].get('provenance') or {})
            provenance = _tab_provenance(row, marker, actor, previous)
            # A correction is not an arrangement credit: `author` stays
            # whoever arranged the take. Who fixed it is recorded the way
            # the retired PR flow recorded it, so the vocabulary in
            # works/ does not fork.
            provenance.pop('author', None)
            provenance['x_corrected_by'] = row.get('created_by') or actor
            provenance['x_corrected_attribution'] = actor
            provenance['x_corrected'] = date.today().isoformat()
            # Same text, named for what it is on this path — the client
            # collects it as "what did you change?".
            notes = provenance.pop('x_submission_notes', None)
            if notes:
                provenance['x_correction_notes'] = notes
            return works_writer.update_part(
                repo_root, work_id,
                match=match,
                content=otf_text,
                provenance_updates=provenance,
                verbose=verbose,
            )

    provenance = _tab_provenance(row, marker, actor)

    if mode == 'add':
        if work is None:
            raise ProcessPendingError(
                f"cannot add a tab to '{work_id}': no work.yaml to add to")
        # ONE naming scheme for "another part on this work", shared with a
        # forked chart. Counting what is on disk is sound here in a way it
        # never was for the PR flow: that ran on two branches that could not
        # see each other's file and both picked `-2`; this runs serially in
        # one concurrency group on a checkout of main.
        file = works_writer.unique_filename(work_dir, work, bare_name)
        return works_writer.add_part(
            repo_root, work_id,
            works_writer.PartSpec(
                file=file,
                type='tablature',
                format='otf',
                instrument=instrument,
                content=otf_text,
                default=False,   # a sibling never displaces the pinned take
                provenance=provenance,
            ),
            verbose=verbose,
        )

    return works_writer.create_work(
        repo_root, work_id, title,
        works_writer.PartSpec(
            file=bare_name,
            type='tablature',
            format='otf',
            instrument=instrument,
            default=True,
            content=otf_text,
            provenance=provenance,
        ),
        artist=(row.get('artist') or '').strip() or None,
        # Parity with the retired process_tab: a work whose only part is a
        # tab has no lyrics to show, so it publishes as an instrumental.
        # Later tagging can disagree; this is the seed, not the verdict.
        tags=['Instrumental'],
        on_collision='suffix',
        verbose=verbose,
    )


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

    A tablature row (``part_type = 'tablature'``) goes to
    :func:`apply_tablature_row` instead, and a metadata row
    (``part_type = 'metadata'``) to :func:`apply_metadata_row` — both before
    anything here reads ``content`` as ChordPro, and both before the dedup
    backstop, which is skipped for each of them on purpose (an OTF has no
    lyrics for a lyric-containment scorer to contain; a metadata row has no
    content and mints no slug).
    """
    part_type = row.get('part_type') or 'lead-sheet'
    if part_type == 'tablature':
        return apply_tablature_row(repo_root, row, mode, work_id, actor,
                                   verbose=verbose)
    if part_type == 'metadata':
        return apply_metadata_row(repo_root, row, mode, work_id, actor,
                                  verbose=verbose)
    # A song REQUEST is a lead-sheet row that has no lead sheet yet, so it is
    # recognised by SHAPE (status + no content) rather than by part_type —
    # see is_placeholder_row for why both halves are needed. Checked after
    # part_type so a tab or a metadata row can never be read as one.
    if is_placeholder_row(row):
        return apply_placeholder_row(repo_root, row, mode, work_id, actor,
                                     verbose=verbose)

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


def hold_reason(result: works_writer.WriteResult,
                backstop: Optional[DedupBackstop] = None) -> Optional[str]:
    """Why this row must stop being re-dispatched, or None if it may retry.

    The reconciler re-fires every uncommitted row every hour, which is right
    for a transient failure (a GitHub 502, a push race) and catastrophic for
    a refusal that is a *decision*: the same refusal, the same red workflow
    run and the same alert issue, hourly, forever. A refused row therefore
    gets its verdict written back to ``pending_songs.dedup_hold``, which the
    reconciler already treats as "held — a human owns this now" and skips.

    Three kinds of refusal qualify, and all three are decisions:

    - the **dedup backstop** held a create (its original meaning),
    - the write target is **suppressed or redirected**
      (:data:`PERMANENT_SKIP_REASONS`) — the case that stranded the guitar
      tab for ``dark-hollow-1``, and
    - a **song request whose slug already holds a work**
      (:data:`WORK_EXISTS_SKIP_REASON`). The song exists, so the request is
      already granted; nothing may be written and nothing will change by
      waiting.

    Why ``dedup_hold`` rather than a new column: it is already the flag the
    reconciler skips on, the RLS policies grant admins over, and the
    Bluegrass Dungeon renders with *Release hold* / *Reject* — so one
    migration-free write buys the stop AND the human surface. A second
    column would need all four of those rebuilt to mean the same thing. The
    reason string is what the admin reads, so it has to say which kind this
    is; the column name is a historical accident, and
    ``commit-song.ts:holdReason`` names the general question on the other
    side of the dispatch.

    A hold is not a verdict on the submission — it is a stop. Clearing it
    (un-suppress the work first, or point ``replaces_id`` at a live one) is
    what re-arms the next reconciler pass.
    """
    if result.skipped_reason == DEDUP_HOLD_REASON:
        return (backstop.decision.reason if backstop and backstop.decision
                else 'held by the dedup backstop')
    if result.skipped_reason == WORK_EXISTS_SKIP_REASON:
        return (
            f"a work already exists at '{result.work_id}', so this song "
            f"request cannot mint one there — and a placeholder must never be "
            f"written over a work (that is the bug this path was rewritten to "
            f"fix). The song is already in the songbook, so the request is "
            f"already granted: delete the row. If it is genuinely a DIFFERENT "
            f"song that happens to slug the same, re-file it under a slug "
            f"that distinguishes them.")
    if result.skipped_reason in PERMANENT_SKIP_REASONS:
        return (
            f"target work '{result.work_id}' is {result.skipped_reason} "
            f"(curation/registry.yaml, docs/data/deleted_songs.json or "
            f"docs/data/redirects.json), so nothing may be written to it. "
            f"Retrying cannot change that. Clear this hold only after the "
            f"work is restored, or retarget the row's replaces_id at a live "
            f"work.")
    return None


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

    # A row refused by a DECISION must stop being re-dispatched. Without
    # this the hourly reconciler re-fires it every hour and it is refused
    # every hour — a review issue that never stops growing and a workflow
    # that is always red. The flag is set here rather than by the workflow
    # so the hold is atomic with the decision that made it.
    held = hold_reason(result, backstop)
    if held:
        try:
            patch_pending_row(row_id, {'dedup_hold': held[:5000]},
                              supabase_url=supabase_url,
                              service_key=service_key)
            print(f"Marked '{row_id}' dedup_hold — the reconciler will skip "
                  f"it: {held}")
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
            'part_type': row.get('part_type') or 'lead-sheet',
            'instrument': row.get('instrument') or '',
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
