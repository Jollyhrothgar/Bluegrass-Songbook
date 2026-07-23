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

Used by:
- build_works_index.py: ``filter_suppressed()`` (registry.suppressed ∪
  deleted_songs.json) and ``apply_curation()`` (stable ``grp:`` group ids,
  ``canonical`` / ``variant_of`` / ``variant_label`` fields).
- Importers (process_submission, process_correction, migrate_to_works,
  banjo-hangout works_importer): ``is_suppressed()`` guard so suppressed
  works are never re-created from sources.
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


def is_suppressed(work_id: str, registry: Registry, deleted_songs: dict = None) -> bool:
    """True if a work id must not be (re)created by importers.

    Checks the exact id against registry.suppressed ∪ deleted_songs, and
    also the collision-suffix base (``foo-1`` is refused when ``foo`` is
    suppressed) so importers can't resurrect a suppressed song under a
    collision-suffixed slug.
    """
    suppressed = set(registry.suppressed or {})
    if deleted_songs:
        suppressed |= set(deleted_songs)
    if work_id in suppressed:
        return True
    base = _COLLISION_SUFFIX_RE.sub('', work_id)
    return base != work_id and base in suppressed


def filter_suppressed(songs: list, deleted_songs: dict, registry: Registry) -> list:
    """Drop songs whose exact id is in registry.suppressed ∪ deleted_songs.

    Exact-id match only (mirrors the historical deleted_songs filter);
    collision-suffix base matching applies to import guards, not here.
    """
    suppressed = set(registry.suppressed or {}) | set(deleted_songs or {})
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
