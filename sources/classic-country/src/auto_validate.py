#!/usr/bin/env python3
"""
Automatic Validation - Regex-based validation and regression detection

This script automatically detects parsing failures by comparing regex-extracted
chords from HTML against parsed chord counts, and tracks regressions across runs.
"""

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
from dataclasses import dataclass, asdict


@dataclass
class FileMetrics:
    """Metrics for a single file"""
    filename: str
    structure_type: str
    regex_chords: int
    parsed_chords: int
    parsed_verses: int
    parsed_words: int
    parsing_failed: bool
    confidence: str  # 'high', 'medium', 'low', 'failed'


def extract_chords_from_html(html_path: Path) -> int:
    """Extract chord count from HTML using regex"""
    try:
        with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
            html_content = f.read()

        # Chord pattern: C, Am7, G/B, F#m, etc.
        # Look for chords that appear on their own line or with spacing
        # This matches the ChordDetector pattern
        chord_pattern = r'\b([A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d*(?:/[A-G][#b]?)?)\b'

        matches = re.findall(chord_pattern, html_content)

        # Filter out common false positives in text
        # Very conservative - only filter "Add" (the word)
        # Most single letters like A, C, D, etc. are likely real chords in this context
        false_positives = {'Add'}

        # Count chords
        chord_count = 0
        for match in matches:
            # Filter out "Add" as it's commonly the English word
            if match in false_positives:
                continue
            chord_count += 1

        return chord_count

    except Exception as e:
        print(f"  Error reading {html_path}: {e}")
        return 0


def extract_metrics_from_pro(pro_path: Path) -> Tuple[int, int, int]:
    """Extract chord count, verse count, and word count from ChordPro file"""
    try:
        with open(pro_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        # Count chords: [C], [Am7], [G/B], etc.
        chord_pattern = r'\[([A-G][#b]?(?:maj|min|m|sus|dim|aug|add)?\d*(?:/[A-G][#b]?)?)\]'
        chords = re.findall(chord_pattern, content)

        # Count verses/sections
        verse_pattern = r'\{start_of_(?:verse|chorus|bridge)'
        verses = re.findall(verse_pattern, content)

        # Count words (excluding directives and chords)
        # Remove all {directives}
        text = re.sub(r'\{[^}]+\}', '', content)
        # Remove all [chords]
        text = re.sub(r'\[[^\]]+\]', '', text)
        # Count words
        words = text.split()

        return len(chords), len(verses), len(words)

    except Exception as e:
        print(f"  Error reading {pro_path}: {e}")
        return 0, 0, 0


def calculate_confidence(regex_chords: int, parsed_chords: int, parsed_verses: int, parsed_words: int) -> str:
    """Calculate confidence level for parsing quality"""

    # Definite failure: HTML has chords but parsed output has none
    if regex_chords >= 5 and parsed_chords == 0:
        return 'failed'

    # Low confidence: Large mismatch in chord counts
    if regex_chords > 0 and parsed_chords > 0:
        ratio = min(regex_chords, parsed_chords) / max(regex_chords, parsed_chords)
        if ratio < 0.5:  # More than 50% difference
            return 'low'

    # Low confidence: Very few verses or words
    if parsed_verses < 2 or parsed_words < 20:
        return 'low'

    # Medium confidence: Moderate mismatch
    if regex_chords > 0 and parsed_chords > 0:
        ratio = min(regex_chords, parsed_chords) / max(regex_chords, parsed_chords)
        if ratio < 0.8:  # 20-50% difference
            return 'medium'

    # High confidence: Everything looks good
    return 'high'


def analyze_all_files(html_dir: Path, output_dir: Path, batch_report_path: Path) -> Dict[str, FileMetrics]:
    """Analyze all files and generate metrics"""

    # Load batch report for structure types
    with open(batch_report_path, 'r') as f:
        batch_report = json.load(f)

    structure_map = {}
    for item in batch_report.get('success', []):
        filename = item.get('file', '')
        structure_type = item.get('structure_type', 'unknown')
        structure_map[filename] = structure_type

    print(f"Analyzing files from {output_dir}")
    print(f"Loaded structure types for {len(structure_map)} files")

    metrics = {}
    pro_files = list(output_dir.glob('*.pro'))
    total = len(pro_files)

    for i, pro_path in enumerate(pro_files):
        if (i + 1) % 1000 == 0:
            print(f"  Processed {i + 1}/{total} files...")

        filename = pro_path.stem
        html_path = html_dir / f"{filename}.html"

        if not html_path.exists():
            continue

        # Extract metrics
        regex_chords = extract_chords_from_html(html_path)
        parsed_chords, parsed_verses, parsed_words = extract_metrics_from_pro(pro_path)
        structure_type = structure_map.get(f"{filename}.html", 'unknown')

        # Determine if parsing failed
        parsing_failed = (regex_chords >= 5 and parsed_chords == 0)

        # Calculate confidence
        confidence = calculate_confidence(regex_chords, parsed_chords, parsed_verses, parsed_words)

        metrics[filename] = FileMetrics(
            filename=filename,
            structure_type=structure_type,
            regex_chords=regex_chords,
            parsed_chords=parsed_chords,
            parsed_verses=parsed_verses,
            parsed_words=parsed_words,
            parsing_failed=parsing_failed,
            confidence=confidence
        )

    print(f"  Completed: {len(metrics)} files analyzed")
    return metrics


def detect_regressions(baseline_metrics: Dict[str, FileMetrics],
                       current_metrics: Dict[str, FileMetrics]) -> Dict[str, Tuple[FileMetrics, FileMetrics]]:
    """Detect files that got worse between baseline and current"""

    regressions = {}

    for filename, current in current_metrics.items():
        if filename not in baseline_metrics:
            continue

        baseline = baseline_metrics[filename]

        # Check for regressions
        got_worse = False

        # Definite regression: was working, now failed
        if not baseline.parsing_failed and current.parsing_failed:
            got_worse = True

        # Confidence decreased
        confidence_order = {'high': 3, 'medium': 2, 'low': 1, 'failed': 0}
        if confidence_order[current.confidence] < confidence_order[baseline.confidence]:
            got_worse = True

        # Significant metric decrease (>20%)
        if baseline.parsed_chords > 0 and current.parsed_chords > 0:
            chord_ratio = current.parsed_chords / baseline.parsed_chords
            if chord_ratio < 0.8:
                got_worse = True

        if baseline.parsed_words > 0 and current.parsed_words > 0:
            word_ratio = current.parsed_words / baseline.parsed_words
            if word_ratio < 0.8:
                got_worse = True

        if got_worse:
            regressions[filename] = (baseline, current)

    return regressions


def generate_report(metrics: Dict[str, FileMetrics], output_path: Path):
    """Generate comprehensive validation report"""

    # Group by confidence level
    by_confidence = defaultdict(list)
    for filename, m in metrics.items():
        by_confidence[m.confidence].append(m)

    # Group failed files by structure type
    failed_by_structure = defaultdict(list)
    for filename, m in metrics.items():
        if m.parsing_failed:
            failed_by_structure[m.structure_type].append(m)

    report = {
        'summary': {
            'total_files': len(metrics),
            'failed': len(by_confidence['failed']),
            'low_confidence': len(by_confidence['low']),
            'medium_confidence': len(by_confidence['medium']),
            'high_confidence': len(by_confidence['high']),
        },
        'failed_by_structure': {
            structure: len(files)
            for structure, files in failed_by_structure.items()
        },
        'failed_files': [
            {
                'filename': m.filename,
                'structure_type': m.structure_type,
                'regex_chords': m.regex_chords,
                'parsed_chords': m.parsed_chords,
            }
            for m in sorted(by_confidence['failed'], key=lambda x: x.structure_type)
        ],
        'low_confidence_files': [
            {
                'filename': m.filename,
                'structure_type': m.structure_type,
                'regex_chords': m.regex_chords,
                'parsed_chords': m.parsed_chords,
                'parsed_verses': m.parsed_verses,
                'parsed_words': m.parsed_words,
            }
            for m in sorted(by_confidence['low'], key=lambda x: x.structure_type)[:50]  # Limit to 50
        ]
    }

    with open(output_path, 'w') as f:
        json.dump(report, f, indent=2)

    return report


def print_summary(report: dict, regressions: Optional[Dict] = None):
    """Print summary to console"""

    summary = report['summary']

    print("\n" + "="*80)
    print("AUTOMATIC VALIDATION REPORT")
    print("="*80)
    print(f"\nTotal files analyzed: {summary['total_files']}")
    print(f"\nConfidence Levels:")
    print(f"  ✅ High confidence:   {summary['high_confidence']:5} ({summary['high_confidence']/summary['total_files']*100:5.1f}%)")
    print(f"  ⚠️  Medium confidence: {summary['medium_confidence']:5} ({summary['medium_confidence']/summary['total_files']*100:5.1f}%)")
    print(f"  ⚠️  Low confidence:    {summary['low_confidence']:5} ({summary['low_confidence']/summary['total_files']*100:5.1f}%)")
    print(f"  ❌ Failed parsing:    {summary['failed']:5} ({summary['failed']/summary['total_files']*100:5.1f}%)")

    if summary['failed'] > 0:
        print(f"\n{'='*80}")
        print("PARSING FAILURES BY STRUCTURE TYPE")
        print("="*80)
        for structure, count in sorted(report['failed_by_structure'].items()):
            print(f"  {structure:12} {count:5} files")

        print(f"\n  First 10 failed files:")
        for item in report['failed_files'][:10]:
            print(f"    {item['filename']}.html ({item['structure_type']})")
            print(f"      HTML has {item['regex_chords']} chords, parsed 0 chords")

    if regressions is not None and len(regressions) > 0:
        print(f"\n{'='*80}")
        print(f"⚠️  REGRESSIONS DETECTED: {len(regressions)} files got worse")
        print("="*80)
        for filename, (baseline, current) in list(regressions.items())[:10]:
            print(f"  {filename}.html:")
            print(f"    Chords: {baseline.parsed_chords} → {current.parsed_chords}")
            print(f"    Words:  {baseline.parsed_words} → {current.parsed_words}")
            print(f"    Confidence: {baseline.confidence} → {current.confidence}")

    print(f"\n{'='*80}")


def main():
    parser = argparse.ArgumentParser(description='Automatic validation with regression detection')
    parser.add_argument(
        '--html-dir',
        type=Path,
        default=Path('sources/classic-country/raw'),
        help='Directory containing HTML files'
    )
    parser.add_argument(
        '--output-dir',
        type=Path,
        default=Path('sources/classic-country/parsed'),
        help='Directory containing ChordPro output files'
    )
    parser.add_argument(
        '--batch-report',
        type=Path,
        default=Path('batch_processing_report.json'),
        help='Path to batch processing report'
    )
    parser.add_argument(
        '--baseline',
        type=Path,
        help='Path to baseline metrics (for regression detection)'
    )
    parser.add_argument(
        '--save-metrics',
        type=Path,
        help='Save metrics to file (for future baseline)'
    )
    parser.add_argument(
        '--report',
        type=Path,
        default=Path('validation_report.json'),
        help='Path to save validation report'
    )

    args = parser.parse_args()

    # Analyze current files
    current_metrics = analyze_all_files(args.html_dir, args.output_dir, args.batch_report)

    # Detect regressions if baseline provided
    regressions = None
    if args.baseline and args.baseline.exists():
        print(f"\nLoading baseline metrics from: {args.baseline}")
        with open(args.baseline, 'r') as f:
            baseline_data = json.load(f)

        baseline_metrics = {
            filename: FileMetrics(**data)
            for filename, data in baseline_data.items()
        }

        print(f"  Loaded {len(baseline_metrics)} baseline files")
        print("\nDetecting regressions...")
        regressions = detect_regressions(baseline_metrics, current_metrics)
        print(f"  Found {len(regressions)} regressions")

    # Generate report
    print(f"\nGenerating report: {args.report}")
    report = generate_report(current_metrics, args.report)

    # Print summary
    print_summary(report, regressions)

    # Save metrics for future baseline
    if args.save_metrics:
        print(f"\nSaving metrics to: {args.save_metrics}")
        metrics_dict = {
            filename: asdict(metrics)
            for filename, metrics in current_metrics.items()
        }
        with open(args.save_metrics, 'w') as f:
            json.dump(metrics_dict, f, indent=2)

    print(f"\n✅ Validation complete!")
    print(f"   Report saved to: {args.report}")
    if args.save_metrics:
        print(f"   Metrics saved to: {args.save_metrics}")


if __name__ == '__main__':
    main()
