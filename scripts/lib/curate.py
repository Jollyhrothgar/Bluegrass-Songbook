#!/usr/bin/env python3
"""Convergence CLI for the editorial curation registry.

Usage (via ./scripts/utility curate ...):
    curate report                     # multi-version groups without a canonical pin
    curate pin <canonical-id> [variant-id ...] [--label LABEL]
    curate suppress <work-id> --reason "..."

The registry lives at curation/registry.yaml and is applied at index build
time (see curation.py / build_works_index.py).
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from curation import load_registry, save_registry

REPO_ROOT = Path(__file__).parent.parent.parent
INDEX_PATH = REPO_ROOT / 'docs' / 'data' / 'index.jsonl'


def load_index() -> list:
    if not INDEX_PATH.exists():
        print(f"Error: index not found at {INDEX_PATH}. "
              f"Run ./scripts/bootstrap --quick first.", file=sys.stderr)
        sys.exit(1)
    songs = []
    with open(INDEX_PATH, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                songs.append(json.loads(line))
    return songs


def cmd_report(args):
    """List multi-version groups that have no canonical pin yet."""
    songs = load_index()

    by_group = {}
    for song in songs:
        gid = song.get('group_id')
        if gid:
            by_group.setdefault(gid, []).append(song)

    unpinned = []
    for gid, members in by_group.items():
        if len(members) < 2:
            continue
        if any(m.get('canonical') for m in members):
            continue  # already pinned
        unpinned.append((gid, members))

    # Easiest decisions first: smallest groups, then alphabetical title
    unpinned.sort(key=lambda item: (
        len(item[1]),
        (item[1][0].get('title') or '').lower(),
    ))

    shown = unpinned[:args.limit] if args.limit else unpinned
    for gid, members in shown:
        title = members[0].get('title', '(untitled)')
        print(f"\n{title}  ({len(members)} versions, group_id={gid})")
        for m in sorted(members, key=lambda s: s.get('id', '')):
            first_line = (m.get('first_line') or '')[:60]
            print(f"  {m.get('id')}"
                  f"  source={m.get('source', '?')}"
                  f"  key={m.get('key', '?')}"
                  f"  chords={m.get('chord_count', 0)}"
                  f"  \"{first_line}\"")

    print(f"\n{len(unpinned)} multi-version groups without a canonical pin"
          + (f" (showing {len(shown)})" if args.limit and len(shown) < len(unpinned) else ""))
    if unpinned:
        print("Pin one with: ./scripts/utility curate pin <canonical-id> [variant-id ...]")


def cmd_pin(args):
    """Pin a canonical work (and optionally label its variants)."""
    registry = load_registry(REPO_ROOT)

    # Warn (don't fail) about ids missing from the index — the registry is
    # applied at build time, which warns again; this is just early feedback.
    if INDEX_PATH.exists():
        known_ids = {s.get('id') for s in load_index()}
        for work_id in [args.canonical_id, *args.variant_ids]:
            if work_id not in known_ids:
                print(f"warning: '{work_id}' not found in the current index",
                      file=sys.stderr)

    group = registry.groups.setdefault(args.canonical_id, {}) or {}
    registry.groups[args.canonical_id] = group
    variants = group.setdefault('variants', {}) or {}
    group['variants'] = variants

    for variant_id in args.variant_ids:
        entry = variants.setdefault(variant_id, {}) or {}
        variants[variant_id] = entry
        if args.label:
            entry['label'] = args.label

    save_registry(registry)
    print(f"Pinned '{args.canonical_id}' as canonical"
          + (f" with variants: {', '.join(args.variant_ids)}" if args.variant_ids else ""))
    print(f"Registry updated: {registry.path}")
    print("Rebuild the index to apply: ./scripts/bootstrap --quick")


def cmd_suppress(args):
    """Suppress a work id (filtered from the index, refused by importers)."""
    registry = load_registry(REPO_ROOT)
    registry.suppressed[args.work_id] = {
        'reason': args.reason,
        'suppressed_at': date.today().isoformat(),
    }
    save_registry(registry)
    print(f"Suppressed '{args.work_id}': {args.reason}")
    print(f"Registry updated: {registry.path}")
    print("Rebuild the index to apply: ./scripts/bootstrap --quick")


def main():
    parser = argparse.ArgumentParser(
        prog='curate', description='Editorial curation registry management')
    sub = parser.add_subparsers(dest='command', required=True)

    p_report = sub.add_parser(
        'report', help='List multi-version groups without a canonical pin')
    p_report.add_argument('--limit', type=int, default=None,
                          help='Show at most N groups')
    p_report.set_defaults(func=cmd_report)

    p_pin = sub.add_parser('pin', help='Pin a canonical work for its group')
    p_pin.add_argument('canonical_id', help='Work id of the canonical version')
    p_pin.add_argument('variant_ids', nargs='*',
                       help='Explicit variant work ids (joined even if fuzzy grouping missed them)')
    p_pin.add_argument('--label', help='Version-picker label for the listed variants')
    p_pin.set_defaults(func=cmd_pin)

    p_sup = sub.add_parser('suppress', help='Suppress a work id')
    p_sup.add_argument('work_id', help='Work id to suppress')
    p_sup.add_argument('--reason', required=True, help='Why it is suppressed')
    p_sup.set_defaults(func=cmd_suppress)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
