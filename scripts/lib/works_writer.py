#!/usr/bin/env python3
"""THE writer for ``works/``. Every path that adds or changes a work goes
through here.

Before this module there were five writers (``process_submission``,
``process_correction``, ``process_tab``, ``fetch_tune``, and the
``auto-commit-song`` edge function), each with its own collision handling,
its own YAML authoring, and its own idea of whether suppression matters.
They disagreed, and the disagreements were the bugs: silent overwrite of an
existing work, ``composers: [Smith, John]`` emitted as *two* composers,
imports resurrecting suppressed ids.

The contract this module enforces:

1. **Never silently overwrite.** Writing to an id that already exists picks
   an explicit mode — there is no "just write it" entry point.
2. **Suppressed and redirected ids are refused** — but the question is
   asked twice, differently, and the mode decides which one. ``create_work``
   asks ``Guards.blocked``: the exact id *and* its collision-suffix base, so
   an importer cannot resurrect a suppressed ``foo`` as ``foo-1``. Every
   other mode operates on a work that already exists, so it asks
   ``Guards.blocked_existing``: the exact id only. Collapsing the two
   refused a tab for the live ``dark-hollow-1`` because the unrelated
   ``dark-hollow`` had been soft-deleted. See ``curation.is_suppressed``.
3. **Provenance is required.** Every part carries where it came from; there
   is no way to add a part without saying so.
4. **YAML is serialized, never concatenated.** Scalars that would be
   ambiguous inside a flow sequence (``Smith, John``) are quoted, so the
   file survives a round trip no matter who reads it next.

Modes
-----

``create_work``
    A brand-new work. On collision: suffix (``foo`` → ``foo-1``, the
    historical importer behavior) or fail. Never overwrites.
``add_part``
    Enrich an existing work with a NEW part (a tab for a work that only had
    a lead sheet). Refuses if a part with that identity already exists.
``update_part``
    Replace a part's file and stamp provenance — for correction flows that
    legitimately own the content.
``update_metadata``
    Change the WORK's own fields — title, artist, key, notes — and no part
    at all. The one mode that writes work.yaml without writing a file
    beside it.
``fork_to_arrangement``
    A collision that is really a different arrangement: the incoming chart
    lands as an ADDITIONAL version part on the existing work with
    ``x_version_*`` metadata populated. The original is untouched. This is
    the "hard to destroy" rule — a second chart for a song is never a
    reason to replace the first one.

Where a forked part surfaces (issue #232, phase 2c):
``build_works_index.build_song_from_work`` publishes every lead-sheet part —
the primary as ``docs/data/songs/{id}.pro`` (unchanged), each fork as
``{id}--{slug}.pro`` — and lists them in the row's ``arrangements``, which
the Arrangement pill turns into a choice. The ``label`` / ``version_type`` /
``arrangement_by`` / ``version_notes`` written here are exactly what that
list shows, and the part FILENAME is what its stable slug is derived from.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

from curation import (Registry, is_suppressed, is_suppressed_exact,
                      load_deleted_songs, load_registry)
from work_schema import slugify, validate_work

WORK_YAML = 'work.yaml'

# Canonical work.yaml key order. The old writers each had their own (one
# appended `composers` AFTER `parts`); this is the order work_schema.Work
# serializes in, so hand-edited and machine-written works look alike.
_FIELD_ORDER = [
    'id', 'title', 'artist', 'composers', 'default_key', 'default_tempo',
    'time_signature', 'tags', 'exclude_tags', 'status', 'notes', 'external',
    'metadata_provenance', 'parts',
]

#: Work-level fields :func:`update_metadata` may write. Everything a
#: metadata edit is *for*, and nothing else — most importantly not ``parts``
#: and not ``id``, so "a metadata edit touches no part" is a property of the
#: function rather than a promise made by its callers.
METADATA_FIELDS = (
    'title', 'artist', 'composers', 'default_key', 'default_tempo',
    'time_signature', 'notes',
)

_PART_FIELD_ORDER = [
    'type', 'format', 'file', 'default', 'instrument', 'label',
    'version_type', 'arrangement_by', 'version_notes', 'provenance',
]

# Characters that end a plain scalar inside a flow collection. A value
# holding one of these is quoted so `composers: [Smith, John]` can never be
# read back as two composers.
_FLOW_AMBIGUOUS = set(',[]{}')


# ============================================
# Errors
# ============================================


class WorksWriterError(Exception):
    """Base class for every refusal this module makes."""


class SuppressedWorkError(WorksWriterError):
    """The id is suppressed / soft-deleted / redirected away."""


class WorkExistsError(WorksWriterError):
    """create_work(on_collision='fail') hit an existing work."""


class WorkNotFoundError(WorksWriterError):
    """A mode that enriches an existing work found nothing to enrich."""


class PartExistsError(WorksWriterError):
    """add_part() would have shadowed a part that is already there."""


class ProvenanceRequiredError(WorksWriterError, ValueError):
    """A part arrived without provenance, or without provenance.source."""


# ============================================
# YAML serialization
# ============================================


class _WorkDumper(yaml.SafeDumper):
    """SafeDumper that quotes flow-ambiguous scalars. Local to this module —
    it does not perturb yaml.dump() elsewhere in the codebase."""


def _represent_str(dumper, data):
    style = None
    if data and '\n' not in data and any(c in data for c in _FLOW_AMBIGUOUS):
        style = "'"
    return dumper.represent_scalar('tag:yaml.org,2002:str', data, style=style)


_WorkDumper.add_representer(str, _represent_str)


def dump_work_yaml(work: dict) -> str:
    """Serialize a work dict to work.yaml text (canonical key order)."""
    return yaml.dump(order_work(work), Dumper=_WorkDumper,
                     default_flow_style=False, allow_unicode=True,
                     sort_keys=False)


def _order(data: dict, keys: list) -> dict:
    ordered = {k: data[k] for k in keys if k in data}
    ordered.update({k: v for k, v in data.items() if k not in ordered})
    return ordered


def order_work(work: dict) -> dict:
    """Canonical key order for a work dict and each of its parts."""
    ordered = _order(work, _FIELD_ORDER)
    if isinstance(ordered.get('parts'), list):
        ordered['parts'] = [
            _order(p, _PART_FIELD_ORDER) if isinstance(p, dict) else p
            for p in ordered['parts']
        ]
    return ordered


def load_work(repo_root, work_id: str) -> Optional[dict]:
    """Read works/<id>/work.yaml, or None if it isn't there."""
    path = work_path(repo_root, work_id) / WORK_YAML
    if not path.exists():
        return None
    return yaml.safe_load(path.read_text()) or None


def write_work_yaml(repo_root, work: dict) -> Path:
    """Validate then serialize a work dict to its work.yaml."""
    errors = validate_work(work)
    if errors:
        raise WorksWriterError(
            f"work '{work.get('id')}' fails schema validation: "
            + '; '.join(errors))
    work_dir = work_path(repo_root, work['id'])
    work_dir.mkdir(parents=True, exist_ok=True)
    path = work_dir / WORK_YAML
    path.write_text(dump_work_yaml(work))
    return path


def work_path(repo_root, work_id: str) -> Path:
    return Path(repo_root) / 'works' / work_id


# ============================================
# Guards: suppression + redirects
# ============================================


def load_redirects(repo_root) -> dict:
    """docs/data/redirects.json ({old_id: canonical_id}); {} if absent."""
    path = Path(repo_root) / 'docs' / 'data' / 'redirects.json'
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text()) or {}
    except (json.JSONDecodeError, OSError):
        return {}


@dataclass
class Guards:
    """The "must not resurrect" set, loaded once per write."""
    registry: Registry = field(default_factory=Registry)
    deleted_songs: dict = field(default_factory=dict)
    redirects: dict = field(default_factory=dict)

    @classmethod
    def load(cls, repo_root) -> 'Guards':
        return cls(
            registry=load_registry(repo_root),
            deleted_songs=load_deleted_songs(repo_root),
            redirects=load_redirects(repo_root),
        )

    def blocked(self, work_id: str) -> Optional[str]:
        """MINT: reason a NEW work must not be created here, or None.

        The full rule, including ``curation.is_suppressed``'s
        collision-suffix base check — an importer must not resurrect a
        suppressed ``foo`` as ``foo-1``.
        """
        if is_suppressed(work_id, self.registry, self.deleted_songs):
            return 'suppressed'
        if work_id in (self.redirects or {}):
            return 'redirected'
        return None

    def blocked_existing(self, work_id: str) -> Optional[str]:
        """WRITE: reason an EXISTING work must not be written to, or None.

        Exact id only. ``foo-1`` on disk is a published work, not a bid to
        resurrect ``foo``, so the base-suffix heuristic has no business
        here — asking it refused a guitar tab for the live, curated
        ``dark-hollow-1`` because the unrelated ``dark-hollow`` had been
        soft-deleted, and refused it identically every hour thereafter.

        A work whose OWN id is suppressed or redirected is still refused,
        and that is the deliberate half: the next build drops it from both
        indexes (``curation.filter_suppressed`` asks exactly this question),
        so a part added to it would be published nowhere. The rule reads
        "if the build still publishes it, you may add to it".
        """
        if is_suppressed_exact(work_id, self.registry, self.deleted_songs):
            return 'suppressed'
        if work_id in (self.redirects or {}):
            return 'redirected'
        return None


def _guard_reason_text(work_id: str, reason: str) -> str:
    if reason == 'redirected':
        return (f"'{work_id}' was merged away (docs/data/redirects.json); "
                f"not writing to works/")
    return (f"'{work_id}' is suppressed (curation/registry.yaml or "
            f"deleted_songs.json); not writing to works/")


# ============================================
# Parts
# ============================================


@dataclass
class PartSpec:
    """A part to write, plus (optionally) the bytes that go with it.

    ``content=None`` means the file is already on disk — the tab flow
    commits the OTF before work.yaml is authored.
    """
    file: str
    provenance: dict
    type: str = 'lead-sheet'
    format: str = 'chordpro'
    content: Optional[str] = None
    default: bool = False
    instrument: Optional[str] = None
    label: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        part = {
            'type': self.type,
            'format': self.format,
            'file': self.file,
        }
        if self.default:
            part['default'] = True
        if self.instrument:
            part['instrument'] = self.instrument
        if self.label:
            part['label'] = self.label
        part.update(self.extra)
        part['provenance'] = clean_provenance(self.provenance)
        return _order(part, _PART_FIELD_ORDER)


def clean_provenance(provenance: Any) -> dict:
    """Validate provenance and drop empty values.

    Provenance is required — a part with no answer to "where did this come
    from?" is exactly the part nobody can review later.
    """
    if not provenance:
        raise ProvenanceRequiredError(
            'provenance is required: pass at least {"source": "..."}')
    if not isinstance(provenance, dict):
        provenance = dict(provenance)
    if not provenance.get('source'):
        raise ProvenanceRequiredError(
            "provenance.source is required (e.g. 'manual', 'user-submission')")
    return {k: v for k, v in provenance.items() if v is not None and v != ''}


def part_identity(part: dict) -> tuple:
    """What makes two parts "the same part" for collision purposes."""
    prov = part.get('provenance') or {}
    return (part.get('type'), part.get('instrument'),
            str(prov.get('source_id')) if prov.get('source_id') else None,
            part.get('file'))


def find_parts(work: dict, match: dict) -> list:
    """Parts whose fields all equal the criteria in ``match``."""
    out = []
    for part in work.get('parts') or []:
        if all(part.get(k) == v for k, v in match.items()):
            out.append(part)
    return out


def _pick_part(candidates: list):
    """Among matches prefer the default one — that's the part a correction
    is about when a work carries several arrangements."""
    if not candidates:
        return None
    for part in candidates:
        if part.get('default'):
            return part
    return candidates[0]


# ============================================
# Result
# ============================================


@dataclass
class WriteResult:
    mode: str
    work_id: str
    work_dir: Optional[Path] = None
    part_file: Optional[str] = None
    written: bool = False
    skipped_reason: Optional[str] = None

    def __bool__(self) -> bool:
        return self.written


def _skip(mode: str, work_id: str, reason: str, on_suppressed: str,
          verbose: bool) -> WriteResult:
    message = _guard_reason_text(work_id, reason)
    if on_suppressed == 'raise':
        raise SuppressedWorkError(message)
    if verbose:
        print(f"Skipping write: {message}")
    return WriteResult(mode=mode, work_id=work_id, skipped_reason=reason)


def _write_part_file(work_dir: Path, part: PartSpec):
    if part.content is None:
        return
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / part.file).write_text(part.content)


# ============================================
# Mode: create-new
# ============================================


def create_work(repo_root, work_id: str, title: str, part: PartSpec, *,
                artist: Optional[str] = None,
                composers: Optional[list] = None,
                default_key: Optional[str] = None,
                tags: Optional[list] = None,
                extra: Optional[dict] = None,
                on_collision: str = 'suffix',
                on_suppressed: str = 'skip',
                allow_existing_dir: bool = False,
                guards: Optional[Guards] = None,
                verbose: bool = True) -> WriteResult:
    """Create a brand-new work. Never overwrites an existing one.

    ``on_collision``:
      - ``'suffix'`` (default, the historical importer behavior): ``foo`` →
        ``foo-1`` → ``foo-2``, skipping candidates that are themselves
        suppressed or redirected.
      - ``'fail'``: raise :class:`WorkExistsError`.

    ``allow_existing_dir``: treat only an existing ``work.yaml`` as a
    collision, not an existing directory. The tab flow needs this — the
    edge function commits the OTF into ``works/<id>/`` before any work.yaml
    exists, so the directory is there and adopting it is the whole point.
    An existing work.yaml is still never overwritten.

    ``on_suppressed``: ``'skip'`` returns an unwritten result (callers that
    used to get ``None`` read ``result.work_dir``); ``'raise'`` raises.
    """
    if on_collision not in ('suffix', 'fail'):
        raise ValueError(f"unknown on_collision: {on_collision!r}")
    guards = guards or Guards.load(repo_root)

    reason = guards.blocked(work_id)
    if reason:
        return _skip('create-new', work_id, reason, on_suppressed, verbose)

    # Fail fast on bad provenance before touching the filesystem.
    part_dict = part.to_dict()

    def occupied(path: Path) -> bool:
        return (path / WORK_YAML).exists() if allow_existing_dir \
            else path.exists()

    work_dir = work_path(repo_root, work_id)
    original_id = work_id
    counter = 1
    while occupied(work_dir) or guards.blocked(work_id):
        if on_collision == 'fail':
            raise WorkExistsError(
                f"work '{work_id}' already exists; refusing to overwrite "
                f"(use add_part / update_part / fork_to_arrangement)")
        work_id = f"{original_id}-{counter}"
        work_dir = work_path(repo_root, work_id)
        counter += 1

    work = {'id': work_id, 'title': title}
    if artist:
        work['artist'] = artist
    if composers:
        work['composers'] = list(composers)
    if default_key:
        work['default_key'] = default_key
    work['tags'] = list(tags) if tags else []
    if extra:
        work.update(extra)
    work['parts'] = [part_dict]

    work_dir.mkdir(parents=True, exist_ok=True)
    _write_part_file(work_dir, part)
    write_work_yaml(repo_root, work)

    return WriteResult(mode='create-new', work_id=work_id, work_dir=work_dir,
                       part_file=part.file, written=True)


# ============================================
# Mode: add-part
# ============================================


def add_part(repo_root, work_id: str, part: PartSpec, *,
             on_suppressed: str = 'skip',
             guards: Optional[Guards] = None,
             verbose: bool = True) -> WriteResult:
    """Enrich an existing work with a NEW part.

    Refuses (:class:`PartExistsError`) when a part with the same identity —
    same file, or same (type, instrument, source_id) — is already there;
    that case is an update or a fork, not an add.
    """
    guards = guards or Guards.load(repo_root)
    reason = guards.blocked_existing(work_id)
    if reason:
        return _skip('add-part', work_id, reason, on_suppressed, verbose)

    work = load_work(repo_root, work_id)
    if work is None:
        raise WorkNotFoundError(
            f"work '{work_id}' has no {WORK_YAML}; use create_work()")

    part_dict = part.to_dict()
    identity = part_identity(part_dict)
    for existing in work.get('parts') or []:
        if part_identity(existing) == identity or \
                existing.get('file') == part_dict.get('file'):
            raise PartExistsError(
                f"work '{work_id}' already has part {existing.get('file')!r}; "
                f"use update_part() or fork_to_arrangement()")

    if part_dict.get('default') and any(
            p.get('default') for p in work.get('parts') or []):
        # Never demote what's already there.
        part_dict.pop('default')
        if verbose:
            print(f"add_part: '{work_id}' already has a default part; "
                  f"adding {part.file} as non-default")

    work.setdefault('parts', []).append(part_dict)
    work_dir = work_path(repo_root, work_id)
    _write_part_file(work_dir, part)
    write_work_yaml(repo_root, work)

    return WriteResult(mode='add-part', work_id=work_id, work_dir=work_dir,
                       part_file=part.file, written=True)


# ============================================
# Mode: update-part
# ============================================


def update_part(repo_root, work_id: str, *,
                match: dict,
                content: Optional[str] = None,
                file: Optional[str] = None,
                provenance_updates: Optional[dict] = None,
                work_updates: Optional[dict] = None,
                add_if_missing: Optional[PartSpec] = None,
                on_suppressed: str = 'skip',
                guards: Optional[Guards] = None,
                verbose: bool = True) -> WriteResult:
    """Replace a part's content and stamp provenance on it.

    Only for flows that legitimately own the content (an approved
    correction). ``match`` selects the part by field equality
    (``{'type': 'lead-sheet'}``); when several match, the default one wins.

    ``add_if_missing`` supplies the part to append when nothing matches —
    the tab flow's "correction to an instrument this work didn't have yet".

    A work directory that exists without a ``work.yaml`` still gets its
    content file written (the historical correction behavior); the result
    reports ``part_file`` with no yaml touched.
    """
    guards = guards or Guards.load(repo_root)
    reason = guards.blocked_existing(work_id)
    if reason:
        return _skip('update-part', work_id, reason, on_suppressed, verbose)

    work_dir = work_path(repo_root, work_id)
    work = load_work(repo_root, work_id)
    if work is None:
        if not work_dir.exists():
            raise WorkNotFoundError(
                f"no work directory for '{work_id}'; use create_work()")
        # Directory but no work.yaml: write the content, author nothing.
        if content is not None and file:
            (work_dir / file).write_text(content)
        return WriteResult(mode='update-part', work_id=work_id,
                           work_dir=work_dir, part_file=file, written=True)

    part = _pick_part(find_parts(work, match))
    if part is None:
        if add_if_missing is None:
            raise WorkNotFoundError(
                f"work '{work_id}' has no part matching {match}; "
                f"pass add_if_missing= to create it")
        part = add_if_missing.to_dict()
        work.setdefault('parts', []).append(part)
        if content is None:
            content = add_if_missing.content
        file = file or add_if_missing.file

    if file:
        part['file'] = file
    target = file or part.get('file')
    if content is not None and target:
        work_dir.mkdir(parents=True, exist_ok=True)
        (work_dir / target).write_text(content)

    if provenance_updates:
        prov = part.setdefault('provenance', {})
        prov.update({k: v for k, v in provenance_updates.items()
                     if v is not None})
        part['provenance'] = _order(prov, ['source'])

    if work_updates:
        work.update({k: v for k, v in work_updates.items() if v is not None})

    write_work_yaml(repo_root, work)
    return WriteResult(mode='update-part', work_id=work_id, work_dir=work_dir,
                       part_file=target, written=True)


# ============================================
# Mode: update-metadata
# ============================================


def update_metadata(repo_root, work_id: str, *,
                    updates: dict,
                    provenance: dict,
                    on_suppressed: str = 'skip',
                    guards: Optional[Guards] = None,
                    verbose: bool = True) -> WriteResult:
    """Change a work's own fields. Touches no part, writes no part file.

    The entry point the metadata column of ``pending_songs`` lands through.
    Deliberately NOT ``update_part(..., work_updates=...)``: that one has to
    find a part to rewrite before it will write anything, and the works this
    exists for — a song minted by a tab, with a title and no artist — have
    no part their editor owns or wants to touch. Passing it a loose match
    just to reach the work-level fields would rewrite whichever part the
    match happened to pick, which is the exact destruction the part-targeting
    rules elsewhere exist to prevent.

    ``updates`` may only name :data:`METADATA_FIELDS`; anything else is a
    ``ValueError`` rather than a silent write, so no caller can reach
    ``parts`` (or ``id``) through here. Values that are ``None`` or empty are
    DROPPED, not written: a client that sends only the artist must not blank
    the key, and there is no "clear this field" gesture in this pipeline.

    ``provenance`` is stamped at the work level as ``metadata_provenance``
    (same shape a part's provenance has: source / source_id / submitted_by /
    submitted_at). It is what makes a replayed dispatch a no-op — see
    ``process_pending.metadata_applied`` — and the only record of who last
    changed a work's details.
    """
    guards = guards or Guards.load(repo_root)
    reason = guards.blocked_existing(work_id)
    if reason:
        return _skip('update-metadata', work_id, reason, on_suppressed, verbose)

    unknown = sorted(set(updates or {}) - set(METADATA_FIELDS))
    if unknown:
        raise ValueError(
            f"update_metadata cannot write {', '.join(unknown)} — "
            f"only {', '.join(METADATA_FIELDS)}")

    work = load_work(repo_root, work_id)
    if work is None:
        raise WorkNotFoundError(
            f"work '{work_id}' has no {WORK_YAML}; there is no metadata to "
            f"edit")

    applied = {k: v for k, v in (updates or {}).items()
               if v is not None and v != '' and v != []}
    if not applied:
        raise ValueError('update_metadata was given no fields to apply')

    work.update(applied)
    work['metadata_provenance'] = clean_provenance(provenance)

    write_work_yaml(repo_root, work)
    return WriteResult(mode='update-metadata', work_id=work_id,
                       work_dir=work_path(repo_root, work_id),
                       part_file=None, written=True)


# ============================================
# Mode: fork-to-arrangement
# ============================================


_VERSION_META_RE = re.compile(
    r'^\{meta:\s*(x_version_label|x_version_type|x_version_notes|'
    r'x_arrangement_by)\b')


def apply_version_metadata(content: str, *, label: str,
                           version_type: Optional[str] = None,
                           arrangement_by: Optional[str] = None,
                           notes: Optional[str] = None) -> str:
    """Stamp ``x_version_*`` directives onto a ChordPro chart.

    Existing version directives are replaced, so forking a fork doesn't
    stack labels.
    """
    lines = [l for l in content.split('\n') if not _VERSION_META_RE.match(l)]

    meta = [f'{{meta: x_version_label {label}}}']
    if version_type:
        meta.append(f'{{meta: x_version_type {version_type}}}')
    if arrangement_by:
        meta.append(f'{{meta: x_arrangement_by {arrangement_by}}}')
    if notes:
        meta.append(f'{{meta: x_version_notes {notes}}}')

    insert_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('{meta:') or line.startswith('{title:') \
                or line.startswith('{artist:'):
            insert_idx = i + 1
    for j, line in enumerate(meta):
        lines.insert(insert_idx + j, line)
    return '\n'.join(lines)


def unique_filename(work_dir: Path, work: dict, name: str) -> str:
    """``name``, or the first ``stem-N.ext`` nobody has claimed.

    Public because the tab pipeline needs the same answer for a sibling
    arrangement (``banjo.otf.json`` → ``banjo-2.otf.json``) that a forked
    chart needs, and two naming schemes for "another part on this work"
    would be one too many. Counting what is on disk is only sound for a
    writer that sees the whole work — which is why the old create-tab-pr
    could not use it (two submissions, two branches, both blind to each
    other, both picking ``-2``) and why process_pending can: it runs in one
    concurrency group on a checkout of main.
    """
    taken = {p.get('file') for p in work.get('parts') or []}
    stem, dot, ext = name.partition('.')
    candidate, counter = name, 2
    while candidate in taken or (work_dir / candidate).exists():
        candidate = f"{stem}-{counter}{dot}{ext}"
        counter += 1
    return candidate


def fork_to_arrangement(repo_root, work_id: str, content: str,
                        provenance: dict, *,
                        version_label: str,
                        version_type: str = 'alternate',
                        arrangement_by: Optional[str] = None,
                        version_notes: Optional[str] = None,
                        part_type: str = 'lead-sheet',
                        part_format: str = 'chordpro',
                        instrument: Optional[str] = None,
                        file: Optional[str] = None,
                        on_suppressed: str = 'skip',
                        guards: Optional[Guards] = None,
                        verbose: bool = True) -> WriteResult:
    """Land an incoming chart as a NEW version part on an existing work.

    Nothing that was already there is read-modify-written: the original
    part keeps its file, its ``default`` flag, and its provenance. This is
    what a collision routes to when the incoming content is a different
    arrangement rather than a correction.
    """
    guards = guards or Guards.load(repo_root)
    reason = guards.blocked_existing(work_id)
    if reason:
        return _skip('fork-to-arrangement', work_id, reason, on_suppressed,
                     verbose)

    work = load_work(repo_root, work_id)
    if work is None:
        raise WorkNotFoundError(
            f"cannot fork '{work_id}': no {WORK_YAML} to fork from")
    if not version_label:
        raise ValueError('fork_to_arrangement requires a version_label')

    work_dir = work_path(repo_root, work_id)
    label_slug = slugify(version_label) or 'arrangement'

    if file is None:
        if part_type == 'tablature':
            base = instrument or 'tab'
            file = f"{base}-{label_slug}.otf.json"
        elif part_format == 'abc':
            file = f"melody-{label_slug}.abc"
        else:
            file = f"lead-sheet-{label_slug}.pro"
    file = unique_filename(work_dir, work, file)

    if part_format == 'chordpro':
        content = apply_version_metadata(
            content, label=version_label, version_type=version_type,
            arrangement_by=arrangement_by, notes=version_notes)
        if not content.endswith('\n'):
            content += '\n'

    part = PartSpec(
        file=file,
        provenance=provenance,
        type=part_type,
        format=part_format,
        content=content,
        default=False,  # forks never displace the original
        instrument=instrument,
        label=version_label,
    )
    part_dict = part.to_dict()
    part_dict['version_type'] = version_type
    if arrangement_by:
        part_dict['arrangement_by'] = arrangement_by
    if version_notes:
        part_dict['version_notes'] = version_notes
    part_dict = _order(part_dict, _PART_FIELD_ORDER)

    work.setdefault('parts', []).append(part_dict)
    _write_part_file(work_dir, part)
    write_work_yaml(repo_root, work)

    return WriteResult(mode='fork-to-arrangement', work_id=work_id,
                       work_dir=work_dir, part_file=file, written=True)
