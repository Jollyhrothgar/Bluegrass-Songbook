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


def cmd_unprune(args):
    """Rescue a work from the index prune (curation/index_prune.csv)."""
    from curation import load_prune_list
    prune_ids = load_prune_list(REPO_ROOT)
    if args.work_id not in prune_ids:
        print(f"Note: '{args.work_id}' is not on the prune list "
              f"(adding a keep entry anyway — harmless).")
    registry = load_registry(REPO_ROOT)
    registry.keep[args.work_id] = {'reason': args.reason}
    save_registry(registry)
    print(f"Kept '{args.work_id}': {args.reason}")
    print(f"Registry updated: {registry.path}")
    print("Rebuild the index to apply: ./scripts/bootstrap --quick")


def cmd_exclude_tag(args):
    """Editorially remove tags from a work (survives LLM re-tagging)."""
    registry = load_registry(REPO_ROOT)
    existing = set(registry.tag_exclusions.get(args.work_id, []))
    existing.update(args.tags)
    registry.tag_exclusions[args.work_id] = sorted(existing)
    save_registry(registry)
    print(f"Excluded tags on '{args.work_id}': {', '.join(sorted(existing))}")
    print("Rebuild the index to apply: ./scripts/bootstrap --quick")


def cmd_lint(args):
    """Scan the built index for likely data errors.

    Classes:
      A. split-duplicates — same normalized title in multiple groups
         (shows as duplicate search results; fix: `curate pin`)
      B. over-merges — one group whose members' first lines barely match
         (different songs folded together; fix: registry or source)
      C. hygiene — blank artist/title, non-placeholder rows with no content
    """
    import csv as _csv
    import difflib
    import re as _re
    import unicodedata

    def norm_title(text):
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', str(text))
        text = text.encode('ascii', 'ignore').decode('ascii').lower()
        text = _re.sub(r'\s*\([^)]*\)\s*$', '', text)
        for art in ('the ', 'a ', 'an '):
            if text.startswith(art):
                text = text[len(art):]
        return _re.sub(r'[^a-z0-9]', '', text)

    def norm_line(text):
        text = unicodedata.normalize('NFKD', str(text or ''))
        text = text.encode('ascii', 'ignore').decode('ascii').lower()
        return ' '.join(_re.sub(r'[^a-z0-9\s]', '', text).split())

    index_path = REPO_ROOT / 'docs' / 'data' / 'index.jsonl'
    rows = [json.loads(l) for l in open(index_path)]
    searchable = [r for r in rows if r.get('indexed') is not False]

    findings = []

    # A: same normalized title, multiple groups (searchable only — these
    # render as duplicate search results)
    by_title = {}
    for r in searchable:
        by_title.setdefault(norm_title(r.get('title')), []).append(r)
    for t, members in sorted(by_title.items()):
        groups = {m.get('group_id') for m in members}
        if t and len(groups) > 1:
            sims = []
            base = norm_line(members[0].get('first_line'))
            for m in members[1:]:
                sims.append(difflib.SequenceMatcher(
                    None, base, norm_line(m.get('first_line'))).ratio())
            best = max(sims) if sims else 0
            findings.append({
                'class': 'split-duplicate',
                'key': t,
                'ids': ' | '.join(m['id'] for m in members),
                'detail': f"{len(groups)} groups; first-line similarity {best:.0%}",
                'likely_same_song': best >= 0.5,
            })

    # B: multi-member groups with dissimilar first lines (over-merge)
    by_group = {}
    for r in rows:
        if r.get('group_id'):
            by_group.setdefault(r['group_id'], []).append(r)
    for gid, members in sorted(by_group.items()):
        if len(members) < 2:
            continue
        base = norm_line(members[0].get('first_line'))
        worst = 1.0
        for m in members[1:]:
            worst = min(worst, difflib.SequenceMatcher(
                None, base, norm_line(m.get('first_line'))).ratio())
        if worst < 0.4:
            findings.append({
                'class': 'over-merge',
                'key': gid,
                'ids': ' | '.join(m['id'] for m in members),
                'detail': f"first-line similarity {worst:.0%}",
                'likely_same_song': False,
            })

    # C: hygiene
    for r in searchable:
        if not str(r.get('title') or '').strip():
            findings.append({'class': 'blank-title', 'key': r['id'], 'ids': r['id'], 'detail': '', 'likely_same_song': ''})
        if not str(r.get('artist') or '').strip() and r.get('source') != 'tunearch':
            findings.append({'class': 'blank-artist', 'key': r['id'], 'ids': r['id'], 'detail': f"src={r.get('source')}", 'likely_same_song': ''})

    out = REPO_ROOT / 'curation' / 'lint_report.csv'
    with open(out, 'w', newline='') as f:
        w = _csv.DictWriter(f, fieldnames=['class', 'key', 'ids', 'detail', 'likely_same_song'])
        w.writeheader()
        w.writerows(findings)

    from collections import Counter
    counts = Counter(f['class'] for f in findings)
    print("Index lint results:")
    for cls, n in counts.most_common():
        print(f"  {cls:16s} {n}")
    strong = [f for f in findings if f['class'] == 'split-duplicate' and f['likely_same_song']]
    print(f"\nStrong pin candidates (split duplicates, similar first lines): {len(strong)}")
    for f in strong[:15]:
        print(f"  {f['key']:35s} {f['ids']}")
    print(f"\nFull report: {out}")


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

    p_unp = sub.add_parser('unprune', help='Rescue a work from the index prune')
    p_unp.add_argument('work_id', help='Work id to keep indexed')
    p_unp.add_argument('--reason', required=True, help='Why it IS jam repertoire')
    p_unp.set_defaults(func=cmd_unprune)

    p_lint = sub.add_parser('lint', help='Scan the index for likely data errors')
    p_lint.set_defaults(func=cmd_lint)

    p_ext = sub.add_parser('exclude-tag', help='Editorially remove tags from a work')
    p_ext.add_argument('work_id', help='Work id')
    p_ext.add_argument('tags', nargs='+', help='Tag names to exclude')
    p_ext.set_defaults(func=cmd_exclude_tag)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
