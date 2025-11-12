#!/usr/bin/env python3
"""
Compare Analysis Results - Compare two validator analysis runs

This script compares the results of two validator runs to identify:
- Changes in distribution statistics
- Files that changed significantly
- Overall improvements/degradations
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict


def load_analysis(analysis_dir: Path) -> Tuple[Dict, Dict]:
    """Load summary statistics and all metrics from an analysis directory"""
    summary_path = analysis_dir / 'summary_statistics.json'
    metrics_path = analysis_dir / 'all_metrics.json'
    
    if not summary_path.exists():
        print(f"Error: {summary_path} not found")
        sys.exit(1)
    if not metrics_path.exists():
        print(f"Error: {metrics_path} not found")
        sys.exit(1)
    
    with open(summary_path, 'r') as f:
        summary = json.load(f)
    
    with open(metrics_path, 'r') as f:
        metrics = json.load(f)
    
    # Convert metrics list to dict by filename for easier lookup
    # Handle both list and dict formats
    if isinstance(metrics, list):
        metrics_dict = {m.get('file', m.get('filename', '')): m for m in metrics}
    else:
        metrics_dict = metrics
    
    return summary, metrics_dict


def format_number(value: float, is_percent: bool = False) -> str:
    """Format a number for display"""
    if is_percent:
        return f"{value:.2f}%"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def compare_statistics(before: Dict, after: Dict, metric_name: str) -> List[str]:
    """Compare statistics for a single metric"""
    lines = []
    
    if metric_name not in before or metric_name not in after:
        return lines
    
    before_stats = before[metric_name]
    after_stats = after[metric_name]
    
    if isinstance(before_stats, dict) and isinstance(after_stats, dict):
        lines.append(f"\n{metric_name.replace('_', ' ').title()}:")
        lines.append("=" * 80)
        
        # Compare key statistics
        stats_to_compare = ['mean', 'median', 'p50', 'p1', 'p99', 'min', 'max']
        
        for stat in stats_to_compare:
            if stat in before_stats and stat in after_stats:
                before_val = before_stats[stat]
                after_val = after_stats[stat]
                diff = after_val - before_val
                diff_pct = (diff / before_val * 100) if before_val != 0 else 0
                
                lines.append(
                    f"  {stat:8}  {format_number(before_val):>12} → {format_number(after_val):>12} "
                    f"({diff:+.2f}, {diff_pct:+.2f}%)"
                )
    
    return lines


def find_changed_files(before_metrics: Dict, after_metrics: Dict, threshold: float = 0.1) -> Dict[str, List]:
    """Find files that changed significantly"""
    changed = {
        'improved': [],  # Files that went from 0/low to higher values
        'degraded': [],  # Files that went from high to lower values
        'changed': []    # Other significant changes
    }
    
    all_files = set(before_metrics.keys()) | set(after_metrics.keys())
    
    for filename in all_files:
        before = before_metrics.get(filename, {})
        after = after_metrics.get(filename, {})
        
        # Check each metric
        for metric in ['verse_count', 'chord_count', 'word_count']:
            before_val = before.get(metric, 0)
            after_val = after.get(metric, 0)
            
            if before_val == after_val:
                continue
            
            # Significant change (more than threshold percent)
            if before_val == 0 and after_val > 0:
                changed['improved'].append({
                    'file': filename,
                    'metric': metric,
                    'before': before_val,
                    'after': after_val
                })
            elif before_val > 0 and after_val == 0:
                changed['degraded'].append({
                    'file': filename,
                    'metric': metric,
                    'before': before_val,
                    'after': after_val
                })
            elif abs(after_val - before_val) / max(before_val, 1) > threshold:
                changed['changed'].append({
                    'file': filename,
                    'metric': metric,
                    'before': before_val,
                    'after': after_val,
                    'change_pct': ((after_val - before_val) / max(before_val, 1)) * 100
                })
    
    return changed


def main():
    parser = argparse.ArgumentParser(
        description='Compare two validator analysis runs',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '--before',
        type=Path,
        required=True,
        help='Path to analysis directory from before the change'
    )
    parser.add_argument(
        '--after',
        type=Path,
        required=True,
        help='Path to analysis directory from after the change'
    )
    parser.add_argument(
        '--output',
        type=Path,
        help='Output file for comparison report (default: stdout)'
    )
    parser.add_argument(
        '--show-changed-files',
        action='store_true',
        help='Show list of files that changed significantly'
    )
    
    args = parser.parse_args()
    
    print(f"Loading analysis from: {args.before}")
    before_summary, before_metrics = load_analysis(args.before)
    
    print(f"Loading analysis from: {args.after}")
    after_summary, after_metrics = load_analysis(args.after)
    
    # Build comparison report
    report = []
    report.append("=" * 80)
    report.append("ANALYSIS COMPARISON REPORT")
    report.append("=" * 80)
    report.append(f"\nBefore: {args.before}")
    report.append(f"After:  {args.after}")
    report.append(f"\nTotal files analyzed:")
    report.append(f"  Before: {before_summary.get('total_files', 'N/A')}")
    report.append(f"  After:  {after_summary.get('total_files', 'N/A')}")
    
    # Compare statistics for each metric
    for metric in ['verse_count', 'chord_count', 'word_count']:
        report.extend(compare_statistics(before_summary, after_summary, metric))
    
    # Find changed files
    if args.show_changed_files:
        report.append("\n" + "=" * 80)
        report.append("CHANGED FILES")
        report.append("=" * 80)
        
        changed = find_changed_files(before_metrics, after_metrics)
        
        report.append(f"\nImproved (0 → >0): {len(changed['improved'])} files")
        if changed['improved']:
            # Group by metric
            by_metric = defaultdict(list)
            for item in changed['improved']:
                by_metric[item['metric']].append(item)
            
            for metric, items in by_metric.items():
                report.append(f"\n  {metric}:")
                for item in sorted(items, key=lambda x: x['after'], reverse=True)[:10]:
                    report.append(f"    {item['file']:<50} {item['before']:>4} → {item['after']:>4}")
                if len(items) > 10:
                    report.append(f"    ... and {len(items) - 10} more")
        
        report.append(f"\nDegraded (>0 → 0): {len(changed['degraded'])} files")
        if changed['degraded']:
            for item in changed['degraded'][:10]:
                report.append(f"    {item['file']:<50} {item['metric']:<15} {item['before']:>4} → {item['after']:>4}")
            if len(changed['degraded']) > 10:
                report.append(f"    ... and {len(changed['degraded']) - 10} more")
        
        report.append(f"\nOther significant changes: {len(changed['changed'])} files")
        if changed['changed']:
            for item in sorted(changed['changed'], key=lambda x: abs(x['change_pct']), reverse=True)[:10]:
                report.append(
                    f"    {item['file']:<50} {item['metric']:<15} "
                    f"{item['before']:>4} → {item['after']:>4} ({item['change_pct']:+.1f}%)"
                )
            if len(changed['changed']) > 10:
                report.append(f"    ... and {len(changed['changed']) - 10} more")
    
    # Output report
    report_text = '\n'.join(report)
    
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, 'w') as f:
            f.write(report_text)
        print(f"\nComparison report saved to: {args.output}")
    else:
        print("\n" + report_text)


if __name__ == '__main__':
    main()

