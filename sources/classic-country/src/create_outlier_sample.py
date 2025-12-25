#!/usr/bin/env python3
"""
Create Outlier Sample - Generate sample file for viewer from selected outliers

This script takes outlier files and creates a stratified_sample_spot_check.json
file that the viewer can load for validation.
"""

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List


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


def parse_outlier_report(report_path: Path) -> List[Dict]:
    """Parse outlier report and extract file information"""
    outliers = []

    with open(report_path, 'r') as f:
        content = f.read()

    # Parse each outlier entry
    pattern = r'HTML:\s+([^\n]+)\n\s+PRO:\s+([^\n]+)\n\s+([^:]+):\s+(\d+(?:\.\d+)?)'

    for match in re.finditer(pattern, content):
        html_path = match.group(1).strip()
        pro_path = match.group(2).strip()
        metric_name = match.group(3).strip()
        metric_value = float(match.group(4))

        html_filename = Path(html_path).name

        outliers.append({
            'html_path': html_path,
            'pro_path': pro_path,
            'html_filename': html_filename,
            'metric_name': metric_name,
            'metric_value': metric_value
        })

    return outliers


def create_sample_from_outliers(outlier_files: List[str],
                                structure_mapping: Dict[str, str],
                                output_path: Path):
    """
    Create a stratified_sample_spot_check.json file for the viewer

    Args:
        outlier_files: List of HTML filenames to include
        structure_mapping: Dict of filename -> structure_type
        output_path: Where to save the sample JSON
    """
    files = []

    for filename in outlier_files:
        structure_type = structure_mapping.get(filename, 'unknown')
        files.append({
            'name': filename,
            'structure_type': structure_type,
            'has_chords': True  # We'll verify this in the viewer
        })

    sample = {
        'description': 'Outlier sample for validation',
        'total_files': len(files),
        'files': files
    }

    with open(output_path, 'w') as f:
        json.dump(sample, f, indent=2)

    print(f"Sample created: {output_path}")
    print(f"Total files: {len(files)}")


def main():
    parser = argparse.ArgumentParser(
        description='Create viewer sample from outlier files',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '--files',
        nargs='+',
        help='List of HTML filenames to include in sample'
    )
    parser.add_argument(
        '--from-report',
        type=Path,
        help='Load outliers from a specific outlier report (e.g., analysis/reports/chord_count_outliers.txt)'
    )
    parser.add_argument(
        '--count',
        type=int,
        default=10,
        help='Number of outliers to include from report (default: 10)'
    )
    parser.add_argument(
        '--batch-report',
        type=Path,
        default=Path('batch_processing_report.json'),
        help='Path to batch processing report'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=Path('stratified_sample_spot_check.json'),
        help='Output sample file (default: stratified_sample_spot_check.json)'
    )

    args = parser.parse_args()

    # Load structure type mapping
    print(f"Loading batch processing report: {args.batch_report}")
    structure_mapping = load_batch_report(args.batch_report)
    print(f"  Loaded {len(structure_mapping)} file mappings")

    outlier_files = []

    if args.files:
        # Use explicitly provided files
        outlier_files = args.files
        print(f"\nUsing {len(outlier_files)} explicitly provided files")

    elif args.from_report:
        # Load from outlier report
        print(f"\nLoading outliers from: {args.from_report}")
        outliers = parse_outlier_report(args.from_report)
        print(f"  Found {len(outliers)} outliers")

        # Take first N outliers
        outlier_files = [o['html_filename'] for o in outliers[:args.count]]
        print(f"  Selected first {len(outlier_files)} outliers")

    else:
        print("Error: Must provide either --files or --from-report")
        return 1

    # Create sample file
    print(f"\nCreating sample file: {args.output}")
    create_sample_from_outliers(outlier_files, structure_mapping, args.output)

    print(f"\n✅ Sample created! Start viewer with: python3 viewer/server.py")
    print(f"   Then visit: http://localhost:8000")


if __name__ == '__main__':
    main()
