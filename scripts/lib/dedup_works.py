#!/usr/bin/env python3
"""
Detect duplicate works and generate a merge plan.

Loads all works from works/*/work.yaml, groups candidates by normalized title,
scores similarity (title/artist/lyrics/key), and outputs a merge plan JSON.

Usage:
    uv run python scripts/lib/dedup_works.py                     # Detect duplicates
    uv run python scripts/lib/dedup_works.py --output plan.json  # Save merge plan
    uv run python scripts/lib/dedup_works.py --min-confidence 0.8
"""

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import yaml


def normalize_title(title: str) -> str:
    """Normalize title for dedup comparison.

    Strips articles, accents, parentheticals, punctuation.
    Returns lowercase alphanumeric with spaces for fuzzy matching.
    """
    if not title:
        return ''
    text = unicodedata.normalize('NFKD', title)
    text = text.encode('ascii', 'ignore').decode('ascii')
    text = text.lower()
    # Remove parenthetical suffixes: (Live), (C), (Banjo Break)
    text = re.sub(r'\s*\([^)]*\)\s*$', '', text)
    # Remove articles
    text = re.sub(r'\bthe\b', '', text)
    text = re.sub(r'\ba\b', '', text)
    text = re.sub(r'\ban\b', '', text)
    # Remove "lyrics and chords" suffix from bluegrass-lyrics imports
    text = re.sub(r'\s*lyrics\s+and\s+chords\s*$', '', text)
    # Normalize common abbreviations
    text = re.sub(r'\bst\b', 'saint', text)
    text = re.sub(r'\bmt\b', 'mount', text)
    # Keep spaces for fuzzy matching
    text = re.sub(r'[^a-z0-9\s]', '', text)
    text = ' '.join(text.split())
    return text


def normalize_compact(title: str) -> str:
    """Normalize to compact form (no spaces) for exact grouping."""
    return re.sub(r'\s+', '', normalize_title(title))


def normalize_artist(artist: str) -> str:
    """Normalize artist name for comparison."""
    if not artist:
        return ''
    text = unicodedata.normalize('NFKD', artist)
    text = text.encode('ascii', 'ignore').decode('ascii')
    text = text.lower()
    text = re.sub(r'[^a-z0-9]', '', text)
    return text


def normalize_lyrics(text: str) -> str:
    """Normalize lyrics for comparison (first 300 chars)."""
    if not text:
        return ''
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s]', '', text)
    text = ' '.join(text.split())
    return text[:300]


def extract_lyrics_from_chordpro(content: str) -> str:
    """Extract plain lyrics from ChordPro content."""
    lines = []
    in_abc = False
    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('{start_of_abc'):
            in_abc = True
            continue
        if stripped.startswith('{end_of_abc'):
            in_abc = False
            continue
        if in_abc:
            continue
        if stripped.startswith('{'):
            continue
        clean = re.sub(r'\[[^\]]+\]', '', line).strip()
        if clean:
            lines.append(clean)
    return '\n'.join(lines)


def similarity(a: str, b: str) -> float:
    """String similarity ratio (0-1)."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def load_work(work_dir: Path) -> dict:
    """Load a work and its lyrics from a work directory."""
    work_yaml = work_dir / 'work.yaml'
    if not work_yaml.exists():
        return None

    with open(work_yaml) as f:
        work = yaml.safe_load(f)

    if not work or not work.get('id'):
        return None

    # Ensure id is always a string (YAML may parse numeric IDs as int)
    work['id'] = str(work['id'])

    # Load lyrics from lead sheet if available
    lead_sheet = work_dir / 'lead-sheet.pro'
    lyrics = ''
    if lead_sheet.exists():
        content = lead_sheet.read_text(encoding='utf-8')
        lyrics = extract_lyrics_from_chordpro(content)

    parts = work.get('parts', [])
    part_count = len(parts)
    has_lead_sheet = lead_sheet.exists()
    has_tablature = any(p.get('type') == 'tablature' for p in parts)
    has_document = any(p.get('type') == 'document' for p in parts)
    is_placeholder = work.get('status') == 'placeholder'

    return {
        'id': work['id'],
        'dir': str(work_dir),
        'title': work.get('title', ''),
        'artist': work.get('artist', ''),
        'key': work.get('default_key', ''),
        'tags': work.get('tags', []),
        'notes': work.get('notes', ''),
        'status': work.get('status', 'complete'),
        'parts': parts,
        'lyrics': lyrics,
        'part_count': part_count,
        'has_lead_sheet': has_lead_sheet,
        'has_tablature': has_tablature,
        'has_document': has_document,
        'is_placeholder': is_placeholder,
    }


def choose_canonical(works: list[dict]) -> dict:
    """Choose the canonical work from a group of duplicates.

    Priority:
    1. Most parts
    2. Has lead sheet > has tablature > has document > placeholder
    3. Shorter slug (less likely to have numeric suffix)
    """
    def score(w):
        return (
            w['part_count'],
            1 if w['has_lead_sheet'] else 0,
            1 if w['has_tablature'] else 0,
            1 if w['has_document'] else 0,
            0 if w['is_placeholder'] else 1,
            0 if str(w['id']).isdigit() else 1,  # penalize purely numeric IDs
            -1 * len(str(w['id'])),  # prefer shorter slugs
        )
    return max(works, key=score)


def keys_compatible(key1: str, key2: str) -> bool:
    """Check if two keys are the same or relative major/minor."""
    if not key1 or not key2:
        return True  # unknown keys are compatible
    k1, k2 = key1.upper(), key2.upper()
    if k1 == k2:
        return True
    # Relative major/minor pairs
    relatives = {
        'C': 'AM', 'AM': 'C',
        'G': 'EM', 'EM': 'G',
        'D': 'BM', 'BM': 'D',
        'A': 'F#M', 'F#M': 'A',
        'E': 'C#M', 'C#M': 'E',
        'B': 'G#M', 'G#M': 'B',
        'F': 'DM', 'DM': 'F',
        'BB': 'GM', 'GM': 'BB',
        'EB': 'CM', 'CM': 'EB',
        'AB': 'FM', 'FM': 'AB',
    }
    return relatives.get(k1) == k2


def consolidate_groups(groups: list[dict], works_by_id: dict) -> list[dict]:
    """Merge overlapping groups where a work appears in multiple groups.

    Uses Union-Find to identify connected components, then re-picks canonical.
    """
    if not groups:
        return groups

    # Build Union-Find
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # Union all IDs within each group
    for g in groups:
        all_ids = [g['canonical']] + g['merge']
        for i in range(1, len(all_ids)):
            union(all_ids[0], all_ids[i])

    # Group by root
    components = defaultdict(set)
    all_ids_seen = set()
    for g in groups:
        for id_ in [g['canonical']] + g['merge']:
            root = find(id_)
            components[root].add(id_)
            all_ids_seen.add(id_)

    # Rebuild groups — one per component
    consolidated = []
    for root, ids in components.items():
        if len(ids) < 2:
            continue

        component_works = [works_by_id[id_] for id_ in ids if id_ in works_by_id]
        if len(component_works) < 2:
            continue

        canonical = choose_canonical(component_works)
        others = [w for w in component_works if w['id'] != canonical['id']]

        # Take the highest confidence from the original groups that contributed
        max_confidence = 0
        reasons = []
        for g in groups:
            group_ids = set([g['canonical']] + g['merge'])
            if group_ids & ids:
                max_confidence = max(max_confidence, g['confidence'])
                reasons.append(g['reason'])

        tier = 'high' if max_confidence >= 0.9 else ('medium' if max_confidence >= 0.8 else 'low')

        consolidated.append({
            'canonical': canonical['id'],
            'canonical_title': canonical['title'],
            'merge': [w['id'] for w in others],
            'merge_titles': [w['title'] for w in others],
            'confidence': max_confidence,
            'tier': tier,
            'reason': '; '.join(dict.fromkeys(reasons)),  # deduplicate reasons
            'details': {
                'canonical_parts': canonical['part_count'],
                'canonical_has_lead_sheet': canonical['has_lead_sheet'],
                'canonical_is_placeholder': canonical['is_placeholder'],
                'merge_info': [
                    {
                        'id': w['id'],
                        'title': w['title'],
                        'artist': w['artist'] or '(none)',
                        'parts': w['part_count'],
                        'has_lead_sheet': w['has_lead_sheet'],
                        'is_placeholder': w['is_placeholder'],
                    }
                    for w in others
                ],
            },
        })

    return consolidated


def detect_duplicates(works_dir: Path, min_confidence: float = 0.7) -> list[dict]:
    """Detect duplicate works and return merge plan.

    Returns list of merge groups:
    [
        {
            "canonical": "slug-id",
            "merge": ["other-slug-1", "other-slug-2"],
            "confidence": 0.95,
            "reason": "Same title, same artist, canonical has more parts",
            "tier": "high",
            "details": { ... }
        }
    ]
    """
    print(f"Loading works from {works_dir}...")

    # Load all works
    works = []
    for work_dir in sorted(works_dir.iterdir()):
        if not work_dir.is_dir():
            continue
        work = load_work(work_dir)
        if work:
            works.append(work)

    print(f"Loaded {len(works)} works")

    # Group by normalized compact title
    title_groups = defaultdict(list)
    for work in works:
        norm = normalize_compact(work['title'])
        if norm:
            title_groups[norm].append(work)

    # Also group by prefix bucket for fuzzy matching
    prefix_buckets = defaultdict(list)
    work_to_norm = {}
    for work in works:
        norm = normalize_title(work['title'])
        work_to_norm[work['id']] = norm
        if len(norm) >= 3:
            prefix = norm[:3]
            prefix_buckets[prefix].append(work)

    # Phase 1: Exact normalized title matches
    merge_plan = []
    seen = set()

    for norm_title, group in title_groups.items():
        if len(group) < 2:
            continue

        # Sub-group by normalized artist
        artist_groups = defaultdict(list)
        for work in group:
            norm_artist = normalize_artist(work['artist'])
            # Treat "Traditional" as a wildcard — group with any artist
            if norm_artist == 'traditional' or not norm_artist:
                artist_groups['_traditional_'].append(work)
            else:
                artist_groups[norm_artist].append(work)

        # Merge traditional works into each artist group
        traditional_works = artist_groups.pop('_traditional_', [])

        # If ONLY traditional works, treat as one group
        if not artist_groups and traditional_works:
            artist_groups['_traditional_'] = traditional_works
        else:
            # Add traditional works to each artist group
            for artist, artist_works in artist_groups.items():
                artist_works.extend(traditional_works)

        for artist, artist_works in artist_groups.items():
            if len(artist_works) < 2:
                continue

            # Check lyrics similarity within this group
            # Sub-divide by lyrics to avoid merging different songs with same title
            lyrics_subgroups = []
            for work in artist_works:
                norm_lyrics = normalize_lyrics(work['lyrics'])
                placed = False
                for subgroup in lyrics_subgroups:
                    rep_lyrics = normalize_lyrics(subgroup[0]['lyrics'])
                    # If both have lyrics, require similarity
                    if norm_lyrics and rep_lyrics:
                        if similarity(norm_lyrics, rep_lyrics) >= 0.5:
                            subgroup.append(work)
                            placed = True
                            break
                    else:
                        # One or both lack lyrics — group together
                        subgroup.append(work)
                        placed = True
                        break
                if not placed:
                    lyrics_subgroups.append([work])

            for subgroup in lyrics_subgroups:
                if len(subgroup) < 2:
                    continue

                # Skip if all already seen
                ids = frozenset(w['id'] for w in subgroup)
                if ids in seen:
                    continue
                seen.add(ids)

                canonical = choose_canonical(subgroup)
                others = [w for w in subgroup if w['id'] != canonical['id']]

                if not others:
                    continue

                # Score confidence
                confidence = 0.9  # High base — exact title match

                # Boost for matching artist
                artists = set(normalize_artist(w['artist']) for w in subgroup if w['artist'])
                if len(artists) <= 1:
                    confidence += 0.05

                # Boost for key compatibility
                keys = [w['key'] for w in subgroup if w['key']]
                if keys and all(keys_compatible(keys[0], k) for k in keys[1:]):
                    confidence += 0.03

                # Penalty for different lyrics
                lyrics_list = [normalize_lyrics(w['lyrics']) for w in subgroup if w['lyrics']]
                if len(lyrics_list) >= 2:
                    avg_sim = sum(
                        similarity(lyrics_list[i], lyrics_list[j])
                        for i in range(len(lyrics_list))
                        for j in range(i + 1, len(lyrics_list))
                    ) / max(1, len(lyrics_list) * (len(lyrics_list) - 1) / 2)
                    if avg_sim < 0.7:
                        confidence -= 0.2

                confidence = max(0.0, min(1.0, confidence))

                if confidence < min_confidence:
                    continue

                tier = 'high' if confidence >= 0.9 else ('medium' if confidence >= 0.8 else 'low')

                reasons = []
                reasons.append(f"Same normalized title: '{norm_title}'")
                if len(artists) <= 1:
                    reasons.append("Same or compatible artist")
                if canonical['has_lead_sheet']:
                    reasons.append("Canonical has lead sheet")
                if any(w['is_placeholder'] for w in others):
                    reasons.append("Merging placeholder(s) into work with content")

                merge_plan.append({
                    'canonical': canonical['id'],
                    'canonical_title': canonical['title'],
                    'merge': [w['id'] for w in others],
                    'merge_titles': [w['title'] for w in others],
                    'confidence': round(confidence, 3),
                    'tier': tier,
                    'reason': '; '.join(reasons),
                    'details': {
                        'canonical_parts': canonical['part_count'],
                        'canonical_has_lead_sheet': canonical['has_lead_sheet'],
                        'canonical_is_placeholder': canonical['is_placeholder'],
                        'merge_info': [
                            {
                                'id': w['id'],
                                'title': w['title'],
                                'artist': w['artist'] or '(none)',
                                'parts': w['part_count'],
                                'has_lead_sheet': w['has_lead_sheet'],
                                'is_placeholder': w['is_placeholder'],
                            }
                            for w in others
                        ],
                    },
                })

    # Phase 2: Fuzzy title matches (within prefix buckets)
    # Only for works NOT already in a merge group
    merged_ids = set()
    for group in merge_plan:
        merged_ids.add(group['canonical'])
        merged_ids.update(group['merge'])

    TITLE_SIMILARITY = 0.85

    for prefix, bucket in prefix_buckets.items():
        # Filter out already-merged works
        bucket = [w for w in bucket if w['id'] not in merged_ids]
        if len(bucket) < 2:
            continue

        for i in range(len(bucket)):
            for j in range(i + 1, len(bucket)):
                w1, w2 = bucket[i], bucket[j]
                n1, n2 = work_to_norm[w1['id']], work_to_norm[w2['id']]

                # Quick length filter
                if abs(len(n1) - len(n2)) > max(len(n1), len(n2)) * 0.2:
                    continue

                title_sim = similarity(n1, n2)
                if title_sim < TITLE_SIMILARITY:
                    continue

                # Check artist compatibility
                a1, a2 = normalize_artist(w1['artist']), normalize_artist(w2['artist'])
                if a1 and a2 and a1 != a2:
                    # Different artists with different non-traditional names — skip
                    if a1 != 'traditional' and a2 != 'traditional':
                        continue

                # Check lyrics
                l1, l2 = normalize_lyrics(w1['lyrics']), normalize_lyrics(w2['lyrics'])
                if l1 and l2:
                    if similarity(l1, l2) < 0.5:
                        continue
                elif not (title_sim >= 0.95):
                    # Neither has lyrics and title match isn't near-perfect
                    continue

                ids = frozenset([w1['id'], w2['id']])
                if ids in seen:
                    continue
                seen.add(ids)

                pair = [w1, w2]
                canonical = choose_canonical(pair)
                other = w1 if canonical['id'] == w2['id'] else w2

                confidence = min(0.95, title_sim)  # Cap at 0.95 for fuzzy

                if confidence < min_confidence:
                    continue

                tier = 'high' if confidence >= 0.9 else ('medium' if confidence >= 0.8 else 'low')

                merge_plan.append({
                    'canonical': canonical['id'],
                    'canonical_title': canonical['title'],
                    'merge': [other['id']],
                    'merge_titles': [other['title']],
                    'confidence': round(confidence, 3),
                    'tier': tier,
                    'reason': f"Fuzzy title match ({title_sim:.0%}): '{w1['title']}' ~ '{w2['title']}'",
                    'details': {
                        'canonical_parts': canonical['part_count'],
                        'canonical_has_lead_sheet': canonical['has_lead_sheet'],
                        'canonical_is_placeholder': canonical['is_placeholder'],
                        'merge_info': [
                            {
                                'id': other['id'],
                                'title': other['title'],
                                'artist': other['artist'] or '(none)',
                                'parts': other['part_count'],
                                'has_lead_sheet': other['has_lead_sheet'],
                                'is_placeholder': other['is_placeholder'],
                            }
                        ],
                    },
                })

    # Consolidate overlapping groups (e.g., A<-B and B<-C should become A<-[B,C])
    merge_plan = consolidate_groups(merge_plan, {w['id']: w for w in works})

    # Sort by confidence descending
    merge_plan.sort(key=lambda x: (-x['confidence'], str(x['canonical'])))

    return merge_plan


def print_summary(plan: list[dict]):
    """Print a human-readable summary of the merge plan."""
    high = [g for g in plan if g['tier'] == 'high']
    medium = [g for g in plan if g['tier'] == 'medium']
    low = [g for g in plan if g['tier'] == 'low']

    total_merges = sum(len(g['merge']) for g in plan)

    print(f"\n{'='*60}")
    print(f"DEDUP MERGE PLAN")
    print(f"{'='*60}")
    print(f"Total merge groups: {len(plan)}")
    print(f"Total works to merge: {total_merges}")
    print(f"  High confidence (>=0.9): {len(high)} groups")
    print(f"  Medium confidence (0.8-0.9): {len(medium)} groups")
    print(f"  Low confidence (0.7-0.8): {len(low)} groups")

    if high:
        print(f"\n--- HIGH CONFIDENCE (auto-merge candidates) ---")
        for g in high[:20]:
            merge_ids = ', '.join(g['merge'])
            print(f"  {g['canonical']} <- [{merge_ids}]  ({g['confidence']:.0%})")
            print(f"    {g['reason']}")
        if len(high) > 20:
            print(f"  ... and {len(high) - 20} more")

    if medium:
        print(f"\n--- MEDIUM CONFIDENCE (review recommended) ---")
        for g in medium[:10]:
            merge_ids = ', '.join(g['merge'])
            print(f"  {g['canonical']} <- [{merge_ids}]  ({g['confidence']:.0%})")
            print(f"    {g['reason']}")
        if len(medium) > 10:
            print(f"  ... and {len(medium) - 10} more")

    if low:
        print(f"\n--- LOW CONFIDENCE (manual review required) ---")
        for g in low[:5]:
            merge_ids = ', '.join(g['merge'])
            print(f"  {g['canonical']} <- [{merge_ids}]  ({g['confidence']:.0%})")
            print(f"    {g['reason']}")
        if len(low) > 5:
            print(f"  ... and {len(low) - 5} more")


def main():
    parser = argparse.ArgumentParser(description='Detect duplicate works')
    parser.add_argument('--output', '-o', type=str, default=None,
                        help='Output file for merge plan JSON')
    parser.add_argument('--min-confidence', type=float, default=0.7,
                        help='Minimum confidence threshold (default: 0.7)')
    parser.add_argument('--tier', choices=['high', 'medium', 'low'], default=None,
                        help='Only output groups at this confidence tier or above')
    parser.add_argument('--works-dir', type=str, default='works',
                        help='Path to works directory')
    args = parser.parse_args()

    works_dir = Path(args.works_dir)
    if not works_dir.exists():
        print(f"Error: {works_dir} not found")
        return 1

    plan = detect_duplicates(works_dir, min_confidence=args.min_confidence)

    # Filter by tier if requested
    if args.tier:
        tier_order = {'high': 3, 'medium': 2, 'low': 1}
        min_tier = tier_order[args.tier]
        plan = [g for g in plan if tier_order[g['tier']] >= min_tier]

    print_summary(plan)

    if args.output:
        output_path = Path(args.output)
        with open(output_path, 'w') as f:
            json.dump(plan, f, indent=2)
        print(f"\nMerge plan written to {output_path}")
    else:
        print(f"\nRun with --output plan.json to save the merge plan")

    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
