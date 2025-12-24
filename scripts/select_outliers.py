#!/usr/bin/env python3
"""
Select Outliers - Stratified sampling of outliers by HTML structure type

This script selects outlier files from the validator analysis, stratified by
HTML structure type (pre_plain, pre_tag, span_br) to ensure representative sampling.
"""

import argparse
import json
import random
import re
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict


def load_batch_report(report_path: Path) -> Dict[str, str]:
    """Load batch processing report and create filename -> structure_type mapping"""
    with open(report_path, 'r') as f:
        report = json.load(f)

    mapping = {}
    for item in report.get('success', []):
        filename = item.get('file', '')
        structure_type = item.get('structure_type', 'unknown')
        mapping[filename] = structure_type

    return mapping


def load_reviewed_files(feedback_path: Path) -> set:
    """Load files that have been reviewed and marked as correct"""
    reviewed = set()

    if not feedback_path.exists():
        return reviewed

    with open(feedback_path, 'r') as f:
        for line in f:
            if line.strip():
                try:
                    feedback = json.loads(line)
                    # Only exclude files marked as "correct"
                    if feedback.get('status') == 'correct':
                        # Convert to just the base filename without .html
                        filename = feedback['file'].replace('.html', '')
                        reviewed.add(filename)
                except json.JSONDecodeError:
                    continue

    return reviewed


def parse_outlier_report(report_path: Path) -> List[Dict]:
    """Parse outlier report and extract file information"""
    outliers = []

    with open(report_path, 'r') as f:
        content = f.read()

    # Parse each outlier entry
    # Format:
    #   HTML: songs/classic-country/raw/filename.html
    #   PRO:  songs/classic-country/parsed/filename.pro
    #   Metric Name: value
    pattern = r'HTML:\s+([^\n]+)\n\s+PRO:\s+([^\n]+)\n\s+([^:]+):\s+(\d+(?:\.\d+)?)'

    for match in re.finditer(pattern, content):
        html_path = match.group(1).strip()
        pro_path = match.group(2).strip()
        metric_name = match.group(3).strip()
        metric_value = float(match.group(4))

        # Extract just the filename from the HTML path
        html_filename = Path(html_path).name

        outliers.append({
            'html_path': html_path,
            'pro_path': pro_path,
            'html_filename': html_filename,
            'metric_name': metric_name,
            'metric_value': metric_value
        })

    return outliers


def stratify_outliers(outliers: List[Dict], structure_mapping: Dict[str, str]) -> Dict[str, List[Dict]]:
    """Group outliers by structure type"""
    by_structure = defaultdict(list)

    for outlier in outliers:
        structure_type = structure_mapping.get(outlier['html_filename'], 'unknown')
        outlier['structure_type'] = structure_type
        by_structure[structure_type].append(outlier)

    return dict(by_structure)


def select_stratified_sample(by_structure: Dict[str, List[Dict]],
                             target_distribution: Dict[str, float],
                             seed: int = 42) -> List[Dict]:
    """
    Select samples weighted by structure type distribution

    Args:
        by_structure: Outliers grouped by structure type
        target_distribution: Dict of structure_type -> percentage (e.g., {'pre_plain': 0.595, ...})
        seed: Random seed for reproducibility
    """
    random.seed(seed)

    # Calculate how many samples to take from each structure type
    total_outliers = sum(len(outliers) for outliers in by_structure.values())

    samples = []
    for structure_type, percentage in sorted(target_distribution.items()):
        outliers = by_structure.get(structure_type, [])
        if not outliers:
            continue

        # Weight the selection probability by the target distribution
        # But ensure at least one sample if outliers exist
        target_count = max(1, int(percentage * len(outliers)))

        # Randomly sample
        sample_count = min(target_count, len(outliers))
        selected = random.sample(outliers, sample_count)
        samples.extend(selected)

    return samples


def main():
    parser = argparse.ArgumentParser(
        description='Select outlier files stratified by HTML structure type',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '--metric',
        choices=['chord_count', 'verse_count', 'word_count'],
        default='chord_count',
        help='Which metric to analyze (default: chord_count)'
    )
    parser.add_argument(
        '--count',
        type=int,
        default=1,
        help='Number of outliers to select from each end (default: 1)'
    )
    parser.add_argument(
        '--batch-report',
        type=Path,
        default=Path('batch_processing_report.json'),
        help='Path to batch processing report'
    )
    parser.add_argument(
        '--analysis-dir',
        type=Path,
        default=Path('analysis'),
        help='Path to analysis directory'
    )
    parser.add_argument(
        '--seed',
        type=int,
        default=42,
        help='Random seed for reproducibility'
    )

    args = parser.parse_args()

    # Load structure type mapping
    print(f"Loading batch processing report: {args.batch_report}")
    structure_mapping = load_batch_report(args.batch_report)
    print(f"  Loaded {len(structure_mapping)} file mappings")

    # Load reviewed files to skip
    feedback_path = Path('viewer/feedback.jsonl')
    reviewed_files = load_reviewed_files(feedback_path)
    if reviewed_files:
        print(f"  Excluding {len(reviewed_files)} files already marked as correct")

    # Count structure types
    structure_counts = defaultdict(int)
    for structure_type in structure_mapping.values():
        structure_counts[structure_type] += 1

    total_files = sum(structure_counts.values())
    print(f"\nStructure type distribution:")
    for structure_type, count in sorted(structure_counts.items()):
        pct = (count / total_files) * 100
        print(f"  {structure_type:12} {count:6} ({pct:5.1f}%)")

    # Load outlier report
    outlier_report_path = args.analysis_dir / 'reports' / f'{args.metric}_outliers.txt'
    print(f"\nLoading outlier report: {outlier_report_path}")
    outliers = parse_outlier_report(outlier_report_path)

    # Filter out already reviewed files
    outliers_before = len(outliers)
    outliers = [o for o in outliers if Path(o['html_path']).stem not in reviewed_files]
    if outliers_before > len(outliers):
        print(f"  Filtered out {outliers_before - len(outliers)} already-reviewed files")

    print(f"  Found {len(outliers)} total outliers")

    # Separate into bottom and top outliers
    # Bottom outliers have low metric values, top outliers have high values
    outliers.sort(key=lambda x: x['metric_value'])

    # Split at median
    midpoint = len(outliers) // 2
    bottom_outliers = outliers[:midpoint]
    top_outliers = outliers[midpoint:]

    print(f"  Bottom outliers (low {args.metric}): {len(bottom_outliers)}")
    print(f"  Top outliers (high {args.metric}): {len(top_outliers)}")

    # Stratify both groups
    bottom_by_structure = stratify_outliers(bottom_outliers, structure_mapping)
    top_by_structure = stratify_outliers(top_outliers, structure_mapping)

    # Target distribution (based on corpus)
    target_dist = {
        'pre_plain': 0.595,
        'pre_tag': 0.319,
        'span_br': 0.087
    }

    # Select samples
    print(f"\nSelecting {args.count} bottom outlier(s) (stratified)...")
    bottom_samples = select_stratified_sample(bottom_by_structure, target_dist, args.seed)[:args.count]

    print(f"Selecting {args.count} top outlier(s) (stratified)...")
    # For top outliers, reverse sort to get highest values
    for structure_outliers in top_by_structure.values():
        structure_outliers.sort(key=lambda x: x['metric_value'], reverse=True)
    top_samples = select_stratified_sample(top_by_structure, target_dist, args.seed + 1)[:args.count]

    # Display results
    print("\n" + "=" * 80)
    print("SELECTED OUTLIERS")
    print("=" * 80)

    print(f"\n{'BOTTOM OUTLIERS'} (way too few {args.metric.replace('_', ' ')}):")
    print("-" * 80)
    for i, outlier in enumerate(bottom_samples, 1):
        print(f"\n{i}. Structure Type: {outlier['structure_type']}")
        print(f"   HTML: {outlier['html_path']}")
        print(f"   PRO:  {outlier['pro_path']}")
        print(f"   {outlier['metric_name']}: {outlier['metric_value']}")

    print(f"\n\n{'TOP OUTLIERS'} (way too many {args.metric.replace('_', ' ')}):")
    print("-" * 80)
    for i, outlier in enumerate(top_samples, 1):
        print(f"\n{i}. Structure Type: {outlier['structure_type']}")
        print(f"   HTML: {outlier['html_path']}")
        print(f"   PRO:  {outlier['pro_path']}")
        print(f"   {outlier['metric_name']}: {outlier['metric_value']}")

    print("\n" + "=" * 80)
    print(f"Total selected: {len(bottom_samples) + len(top_samples)} files")
    print("=" * 80)


if __name__ == '__main__':
    main()
