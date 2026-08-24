#!/usr/bin/env python3
"""Editorial curation registry.

Works are ephemeral (regenerated from sources/), so editorial decisions —
which version of a song is canonical, and which work ids must never come
back — live in ``curation/registry.yaml`` at the repo root, not in
works/*/work.yaml.

Registry format:

    groups:
      <canonical-work-id>:
        variants:
          <variant-work-id>:
            label: "Display label"     # optional
    suppressed:
      <work-id>:
        reason: "why"
        suppressed_at: "YYYY-MM-DD"
    tab_pins:
      <work-id>:
        <instrument>: "<source_id>"   # default arrangement for that instrument

Used by:
- build_works_index.py: ``filter_suppressed()`` (registry.suppressed ∪
  deleted_songs.json) and ``apply_curation()`` (stable ``grp:`` group ids,
  ``canonical`` / ``variant_of`` / ``variant_label`` fields).
- works_writer.py (the single write path for works/), via its ``Guards``
  class, which asks TWO different questions: ``is_suppressed()`` before
  minting a new id (``create_work``), ``is_suppressed_exact()`` before
  writing to a work that already exists (add / update / fork / metadata).
  See :func:`is_suppressed` for why they must not be collapsed.
- Other direct importers (migrate_to_works, banjo-hangout / web-chords
  works_importer): the mint guard, ``is_suppressed()``.
"""

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

# Collision-suffix pattern: importers append -1/-2/... on slug collisions.
_COLLISION_SUFFIX_RE = re.compile(r'-\d+$')


@dataclass
class Registry:
    """In-memory view of curation/registry.yaml."""
    groups: dict = field(default_factory=dict)
    suppressed: dict = field(default_factory=dict)
    keep: dict = field(default_factory=dict)
    tag_exclusions: dict = field(default_factory=dict)
    tab_pins: dict = field(default_factory=dict)
    path: Optional[Path] = None


def registry_path(repo_root) -> Path:
    return Path(repo_root) / 'curation' / 'registry.yaml'


def load_registry(repo_root) -> Registry:
    """Load the registry; returns an empty Registry if the file is absent."""
    path = registry_path(repo_root)
    if not path.exists():
        return Registry(path=path)
    data = yaml.safe_load(path.read_text()) or {}
    return Registry(
        groups=data.get('groups') or {},
        suppressed=data.get('suppressed') or {},
        keep=data.get('keep') or {},
        tag_exclusions=data.get('tag_exclusions') or {},
        tab_pins=data.get('tab_pins') or {},
        path=path,
    )


def save_registry(registry: Registry):
    """Write the registry back to its path.

    Data-preserving round trip: all existing entries survive a
    read-modify-write, and the file's leading comment header (the doc
    block) is kept. Inline comments elsewhere are not preserved (PyYAML
    limitation).
    """
    if registry.path is None:
        raise ValueError("Registry has no path to save to")

    # Preserve the leading comment header, if any
    header_lines = []
    if registry.path.exists():
        for line in registry.path.read_text().splitlines():
            if line.startswith('#') or not line.strip():
                header_lines.append(line)
            else:
                break
    header = ('\n'.join(header_lines) + '\n') if header_lines else ''

    data = {
        'groups': registry.groups or {},
        'suppressed': registry.suppressed or {},
        'keep': registry.keep or {},
        'tag_exclusions': registry.tag_exclusions or {},
        'tab_pins': registry.tab_pins or {},
    }
    registry.path.parent.mkdir(parents=True, exist_ok=True)
    registry.path.write_text(header + yaml.dump(
        data, default_flow_style=False, allow_unicode=True, sort_keys=False))


def load_deleted_songs(repo_root) -> dict:
    """Load docs/data/deleted_songs.json ({work_id: {deleted_at, reason}})."""
    path = Path(repo_root) / 'docs' / 'data' / 'deleted_songs.json'
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text()) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def load_promoted_songs(repo_root) -> dict:
    """Load docs/data/promoted_songs.json ({work_id: {promoted_at, reason}}).

    Trusted-user promotions synced from the Supabase promoted_songs table;
    unioned with the registry keep: map by apply_index_prune.
    """
    path = Path(repo_root) / 'docs' / 'data' / 'promoted_songs.json'
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text()) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def suppressed_ids(registry: Registry, deleted_songs: dict = None) -> set:
    """registry.suppressed ∪ deleted_songs — the ids that are dead."""
    ids = set(registry.suppressed or {})
    if deleted_songs:
        ids |= set(deleted_songs)
    return ids


def is_suppressed(work_id: str, registry: Registry, deleted_songs: dict = None) -> bool:
    """MINT-TIME: may a work be CREATED under this id? (False = yes.)

    Checks the exact id against registry.suppressed ∪ deleted_songs, and
    also the collision-suffix base (``foo-1`` is refused when ``foo`` is
    suppressed) so importers can't resurrect a suppressed song under a
    collision-suffixed slug.

    **This is the mint-time question only.** Do NOT use it to decide whether
    an existing work may be written to — see :func:`is_suppressed_exact` and
    the note below.

    The two questions (2026-08-19)
    ------------------------------
    The base-suffix rule reads ``foo-1`` as "somebody is trying to mint a
    slug next to the suppressed ``foo``", which is exactly right for an id
    that does not exist yet. It is wrong for one that does: ``works/foo-1``
    on disk is a published work in its own right, and ``-1`` is not proof
    that it was ever a collision artifact — ``dark-hollow-1`` is a curated
    golden-standard chart that has nothing to do with the soft-deleted
    ``dark-hollow``. Applying the mint rule to an add-part refused a guitar
    tab for a live song, forever (the row could not become un-suppressed by
    waiting, so the hourly reconciler re-fired it every hour).

    So:

    ============================  =======================================
    the caller is about to...     ask
    ============================  =======================================
    mint a NEW id                 :func:`is_suppressed` (exact ∪ base)
    write to a work that EXISTS   :func:`is_suppressed_exact` (exact only)
    ============================  =======================================

    The mode is the proof of which one applies: ``works_writer.create_work``
    is the only entry point that can bring a work into being, and every
    other mode raises ``WorkNotFoundError`` without one to enrich.
    """
    suppressed = suppressed_ids(registry, deleted_songs)
    if work_id in suppressed:
        return True
    base = _COLLISION_SUFFIX_RE.sub('', work_id)
    return base != work_id and base in suppressed


def is_suppressed_exact(work_id: str, registry: Registry,
                        deleted_songs: dict = None) -> bool:
    """WRITE-TIME: is THIS work itself dead? Exact id only, no base match.

    The predicate for "may I add to / correct / re-title a work that already
    exists on disk". Suppression of the exact id still refuses, and that is
    deliberate rather than incidental: a suppressed or soft-deleted work is
    on its way out — :func:`filter_suppressed` drops it from both published
    indexes at the next build — so a part added to it would be written into
    a grave, invisible to everyone including its submitter.

    Same set as :func:`filter_suppressed`, on purpose. The invariant that
    falls out of it: **if the build still publishes the work, you may add to
    it; if the build drops it, you may not.**
    """
    return work_id in suppressed_ids(registry, deleted_songs)


def filter_suppressed(songs: list, deleted_songs: dict, registry: Registry) -> list:
    """Drop songs whose exact id is in registry.suppressed ∪ deleted_songs.

    Exact-id match only (mirrors the historical deleted_songs filter);
    collision-suffix base matching applies to the MINT guard
    (:func:`is_suppressed`), not here. This is the same question
    :func:`is_suppressed_exact` asks — the build and the write-time guard
    agree on which works are dead by construction.
    """
    suppressed = suppressed_ids(registry, deleted_songs)
    if not suppressed:
        return songs
    return [s for s in songs if s.get('id') not in suppressed]


def apply_curation(songs: list, registry: Registry) -> list:
    """Apply canonical pins from the registry to built index rows.

    For each registry group:
    - every song sharing the canonical work's computed group_id, plus all
      explicitly listed variant ids (even if fuzzy grouping missed them),
      is remapped to the stable group id ``grp:<canonical-work-id>``
    - the canonical row gets ``canonical: true``
    - non-canonical rows get ``variant_of: <canonical-id>``; explicitly
      listed variants also get their ``variant_label`` (when provided)

    Registry ids that don't exist in the song set produce a stderr warning
    but never fail the build.
    """
    if not registry.groups:
        return songs

    by_id = {s.get('id'): s for s in songs}

    for canonical_id, spec in registry.groups.items():
        spec = spec or {}
        canonical = by_id.get(canonical_id)
        if canonical is None:
            print(f"curation: warning: canonical work '{canonical_id}' not found "
                  f"in the song set; skipping group", file=sys.stderr)
            continue

        new_gid = f"grp:{canonical_id}"
        old_gid = canonical.get('group_id')

        # Remap the whole fuzzy group to the stable id
        if old_gid:
            for song in songs:
                if song.get('group_id') == old_gid:
                    song['group_id'] = new_gid
        canonical['group_id'] = new_gid
        canonical['canonical'] = True

        # Pull in explicitly listed variants (even if fuzzy missed them)
        for variant_id, vspec in (spec.get('variants') or {}).items():
            vspec = vspec or {}
            variant = by_id.get(variant_id)
            if variant is None:
                print(f"curation: warning: variant work '{variant_id}' "
                      f"(group '{canonical_id}') not found in the song set",
                      file=sys.stderr)
                continue
            variant['group_id'] = new_gid
            if vspec.get('label'):
                variant['variant_label'] = vspec['label']

        # Every non-canonical member of the (now unified) group is a variant
        for song in songs:
            if song.get('group_id') == new_gid and song.get('id') != canonical_id:
                song['variant_of'] = canonical_id

    return songs


# ============================================
# Tablature arrangement pins
# ============================================


def tab_pin(work_id: str, instrument: str, registry: Registry) -> Optional[str]:
    """Pinned default arrangement (a source_id) for work+instrument, or None."""
    pins = (registry.tab_pins or {}).get(work_id) or {}
    pinned = pins.get(instrument)
    return str(pinned) if pinned is not None else None


def resolve_tab_defaults(work_id: str, tablature_parts: list,
                         registry: Registry) -> list:
    """Stamp ``default`` on exactly one arrangement per instrument.

    ``tablature_parts`` are index-row tab entries (dicts carrying
    ``instrument`` and ``source_id``) in work.yaml order. For each
    instrument the default is:

    1. the part whose ``source_id`` matches the registry ``tab_pins`` entry
       for (work_id, instrument), if that part exists;
    2. otherwise the FIRST part listed for that instrument — so wave-1
       imports keep the default they already had when alternates land
       after them.

    Returns the same list (mutated in place) for convenience.
    """
    by_instrument = {}
    for part in tablature_parts:
        by_instrument.setdefault(part.get('instrument'), []).append(part)

    for instrument, parts in by_instrument.items():
        pinned = tab_pin(work_id, instrument, registry)
        chosen = None
        if pinned is not None:
            chosen = next(
                (p for p in parts if str(p.get('source_id')) == pinned), None)
            if chosen is None:
                print(f"curation: warning: tab pin {work_id}/{instrument} "
                      f"-> source_id {pinned!r} has no matching part; "
                      f"falling back to the first arrangement", file=sys.stderr)
        if chosen is None:
            chosen = parts[0]
        for part in parts:
            part['default'] = part is chosen
    return tablature_parts


def apply_tab_defaults(songs: list, registry: Registry) -> list:
    """Apply :func:`resolve_tab_defaults` to every indexed song's tab parts."""
    for song in songs:
        parts = song.get('tablature_parts')
        if parts:
            resolve_tab_defaults(song.get('id'), parts, registry)
    return songs


# ============================================
# Index prune (jam-repertoire filter)
# ============================================

# Works from these sources were contributed by users of the site; the prune
# never touches them regardless of what the prune list says.
# 'user-submission' is what process_pending stamps on everything the live
# contribution path writes, charts and tabs alike — it was missing here
# until the shared-writer pass (plan 1c).
USER_SOURCES = {'manual', 'trusted-user', 'pending', 'user-submission'}


def prune_list_path(repo_root) -> Path:
    return Path(repo_root) / 'curation' / 'index_prune.csv'


def load_prune_list(repo_root) -> set:
    """Ids to mark indexed:false. Empty set if the file is absent."""
    path = prune_list_path(repo_root)
    if not path.exists():
        return set()
    import csv
    with open(path) as f:
        rows = csv.DictReader(line for line in f if not line.startswith('#'))
        return {r['id'] for r in rows if r.get('id')}


def apply_index_prune(songs: list, prune_ids: set, registry: Registry,
                      promoted_ids: frozenset = frozenset()) -> list:
    """Stamp indexed:false on non-jam-repertoire rows (non-destructive prune).

    A row is pruned when its id is on the prune list, UNLESS:
    - it came from a user (source in USER_SOURCES or has submitted_by), or
    - it was rescued via the registry's keep: map, or
    - it was promoted by a trusted user (docs/data/promoted_songs.json).
    Rows stay in the index — deep links, lists, and arrangement groups keep
    working — but search/collections exclude indexed:false rows.
    """
    if not prune_ids:
        return songs
    for song in songs:
        if song.get('id') not in prune_ids:
            continue
        if song.get('source') in USER_SOURCES or song.get('submitted_by'):
            continue
        if song.get('id') in (registry.keep or {}):
            continue
        if song.get('id') in promoted_ids:
            continue
        song['indexed'] = False
    return songs


def apply_tag_exclusions(songs: list, registry: Registry) -> list:
    """Editorial tag removals (registry tag_exclusions), e.g. stripping
    BluegrassStandard from country/pop mis-tags. Survives LLM re-tagging
    because it runs at build time from the committed registry."""
    exclusions = registry.tag_exclusions or {}
    if not exclusions:
        return songs
    for song in songs:
        excluded = set(exclusions.get(song.get('id')) or [])
        tags = song.get('tags')
        if not excluded or not tags:
            continue
        # Index rows carry tags as a dict {name: {score...}}; some inputs
        # use plain lists. Preserve the shape — the frontend renders
        # Object.keys(), so flattening a dict to a list breaks the UI.
        if isinstance(tags, dict):
            song['tags'] = {k: v for k, v in tags.items() if k not in excluded}
        else:
            song['tags'] = [t for t in tags if t not in excluded]
    return songs
