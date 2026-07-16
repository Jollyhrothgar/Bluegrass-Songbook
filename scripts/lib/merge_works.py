#!/usr/bin/env python3
"""
Execute a merge plan to consolidate duplicate works.

Reads a merge plan JSON (from dedup_works.py), copies parts from source works
into canonical works, updates work.yaml, creates redirects.json, and optionally
deletes source work directories.

Usage:
    uv run python scripts/lib/merge_works.py plan.json                 # Dry run
    uv run python scripts/lib/merge_works.py plan.json --execute       # Actually merge
    uv run python scripts/lib/merge_works.py plan.json --tier high     # Only high confidence
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import yaml


def load_work_yaml(work_dir: Path) -> dict:
    """Load work.yaml from a work directory."""
    work_yaml = work_dir / 'work.yaml'
    if not work_yaml.exists():
        return None
    with open(work_yaml) as f:
        return yaml.safe_load(f)


def save_work_yaml(work_dir: Path, data: dict):
    """Save work.yaml to a work directory."""
    work_yaml = work_dir / 'work.yaml'
    with open(work_yaml, 'w') as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def merge_tags(canonical_tags: list, source_tags: list) -> list:
    """Union tags, preserving order (canonical first)."""
    seen = set()
    result = []
    for tag in (canonical_tags or []) + (source_tags or []):
        if tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


def merge_notes(canonical_notes: str, source_notes: str) -> str:
    """Combine notes from both works."""
    parts = []
    if canonical_notes:
        parts.append(canonical_notes.strip())
    if source_notes and source_notes.strip() != (canonical_notes or '').strip():
        parts.append(source_notes.strip())
    return '\n\n'.join(parts) if parts else None


def part_signature(part: dict) -> str:
    """Generate a signature for a part to detect duplicates."""
    return f"{part.get('type', '')}|{part.get('format', '')}|{part.get('instrument', '')}"


def execute_merge(plan_path: Path, works_dir: Path, dry_run: bool = True,
                  min_tier: str = 'low') -> dict:
    """Execute the merge plan.

    Returns a summary dict with merge results and redirects.
    """
    with open(plan_path) as f:
        plan = json.load(f)

    tier_order = {'high': 3, 'medium': 2, 'low': 1}
    min_tier_val = tier_order.get(min_tier, 1)

    # Filter by tier
    plan = [g for g in plan if tier_order.get(g['tier'], 0) >= min_tier_val]

    redirects = {}
    merged_count = 0
    skipped_count = 0
    errors = []

    for group in plan:
        canonical_id = str(group['canonical'])
        merge_ids = [str(m) for m in group['merge']]
        canonical_dir = works_dir / canonical_id

        if not canonical_dir.exists():
            errors.append(f"Canonical work dir not found: {canonical_id}")
            skipped_count += 1
            continue

        canonical_work = load_work_yaml(canonical_dir)
        if not canonical_work:
            errors.append(f"Cannot load work.yaml for canonical: {canonical_id}")
            skipped_count += 1
            continue

        canonical_parts = canonical_work.get('parts', [])
        existing_signatures = {part_signature(p) for p in canonical_parts}

        for source_id in merge_ids:
            source_dir = works_dir / source_id
            if not source_dir.exists():
                errors.append(f"Source work dir not found: {source_id}")
                continue

            source_work = load_work_yaml(source_dir)
            if not source_work:
                errors.append(f"Cannot load work.yaml for source: {source_id}")
                continue

            action = f"Merge {source_id} -> {canonical_id}"

            # Merge tags
            canonical_work['tags'] = merge_tags(
                canonical_work.get('tags', []),
                source_work.get('tags', [])
            )

            # Merge notes
            merged_notes = merge_notes(
                canonical_work.get('notes'),
                source_work.get('notes')
            )
            if merged_notes:
                canonical_work['notes'] = merged_notes

            # Copy parts from source that don't already exist in canonical
            source_parts = source_work.get('parts', [])
            parts_added = 0
            for part in source_parts:
                sig = part_signature(part)
                if sig in existing_signatures:
                    continue

                # Copy the part file
                source_file = source_dir / part['file']
                if source_file.exists():
                    dest_file = canonical_dir / part['file']
                    # Avoid filename collisions
                    if dest_file.exists():
                        stem = dest_file.stem
                        suffix = dest_file.suffix
                        counter = 1
                        while dest_file.exists():
                            dest_file = canonical_dir / f"{stem}-{counter}{suffix}"
                            counter += 1
                        part['file'] = dest_file.name

                    if not dry_run:
                        shutil.copy2(source_file, dest_file)

                canonical_parts.append(part)
                existing_signatures.add(sig)
                parts_added += 1

            # Copy any other files (PDFs, images, etc.) that aren't tracked in parts
            if not dry_run:
                for f in source_dir.iterdir():
                    if f.name == 'work.yaml':
                        continue
                    dest = canonical_dir / f.name
                    if not dest.exists():
                        shutil.copy2(f, dest)

            # If canonical was a placeholder and source has content, upgrade status
            if canonical_work.get('status') == 'placeholder' and source_parts:
                canonical_work['status'] = 'complete'
                if 'status' in canonical_work and canonical_work['status'] == 'complete':
                    del canonical_work['status']  # 'complete' is the default

            # Update key if canonical has none but source does
            if not canonical_work.get('default_key') and source_work.get('default_key'):
                canonical_work['default_key'] = source_work['default_key']

            # Update artist if canonical has none but source does
            if not canonical_work.get('artist') and source_work.get('artist'):
                canonical_work['artist'] = source_work['artist']

            # Merge composers
            existing_composers = set(canonical_work.get('composers', []))
            for composer in source_work.get('composers', []):
                if composer not in existing_composers:
                    canonical_work.setdefault('composers', []).append(composer)
                    existing_composers.add(composer)

            if dry_run:
                print(f"  [DRY RUN] {action} (+{parts_added} parts)")
            else:
                print(f"  {action} (+{parts_added} parts)")

            # Record redirect
            redirects[source_id] = canonical_id

        # Update canonical work.yaml
        canonical_work['parts'] = canonical_parts
        if not dry_run:
            save_work_yaml(canonical_dir, canonical_work)

        # Delete source directories
        for source_id in merge_ids:
            source_dir = works_dir / source_id
            if source_dir.exists():
                if not dry_run:
                    shutil.rmtree(source_dir)
                    print(f"  Deleted {source_dir}")

        merged_count += 1

    return {
        'merged_groups': merged_count,
        'skipped': skipped_count,
        'redirects': redirects,
        'errors': errors,
        'total_redirects': len(redirects),
    }


def main():
    parser = argparse.ArgumentParser(description='Execute a merge plan')
    parser.add_argument('plan', type=str, help='Path to merge plan JSON')
    parser.add_argument('--execute', action='store_true',
                        help='Actually execute the merge (default: dry run)')
    parser.add_argument('--tier', choices=['high', 'medium', 'low'], default='low',
                        help='Minimum confidence tier to merge (default: low)')
    parser.add_argument('--works-dir', type=str, default='works',
                        help='Path to works directory')
    parser.add_argument('--redirects-output', type=str, default='docs/data/redirects.json',
                        help='Output file for URL redirects')
    args = parser.parse_args()

    plan_path = Path(args.plan)
    if not plan_path.exists():
        print(f"Error: {plan_path} not found")
        return 1

    works_dir = Path(args.works_dir)
    if not works_dir.exists():
        print(f"Error: {works_dir} not found")
        return 1

    dry_run = not args.execute
    if dry_run:
        print("=== DRY RUN (use --execute to apply changes) ===\n")

    result = execute_merge(plan_path, works_dir, dry_run=dry_run, min_tier=args.tier)

    print(f"\n{'='*60}")
    print(f"MERGE {'PREVIEW' if dry_run else 'COMPLETE'}")
    print(f"{'='*60}")
    print(f"Groups merged: {result['merged_groups']}")
    print(f"Skipped: {result['skipped']}")
    print(f"Total redirects: {result['total_redirects']}")

    if result['errors']:
        print(f"\nErrors ({len(result['errors'])}):")
        for err in result['errors']:
            print(f"  - {err}")

    # Write redirects file
    if not dry_run and result['redirects']:
        redirects_path = Path(args.redirects_output)

        # Merge with existing redirects if file exists
        existing = {}
        if redirects_path.exists():
            with open(redirects_path) as f:
                existing = json.load(f)

        existing.update(result['redirects'])
        redirects_path.parent.mkdir(parents=True, exist_ok=True)
        with open(redirects_path, 'w') as f:
            json.dump(existing, f, indent=2, sort_keys=True)
        print(f"\nRedirects written to {redirects_path} ({len(existing)} total)")

    if dry_run:
        print(f"\nTo execute: uv run python scripts/lib/merge_works.py {args.plan} --execute --tier {args.tier}")

    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
