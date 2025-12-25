#!/usr/bin/env python3
"""
Analyze Changes - Comprehensive before/after comparison with change intelligence

This script compares two validator analysis runs and provides detailed change analysis:
- Summarizes changes for every file (chords, verses, words)
- Flags dramatic changes (>10% for any metric)
- Categorizes changes as positive, negative, or neutral
- Considers 0→>0 changes as always positive (fixing parsing failures)
- Provides summary statistics and recommendations
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
from dataclasses import dataclass, asdict


@dataclass
class FileChange:
    """Represents changes for a single file"""
    filename: str
    verse_count_before: int
    verse_count_after: int
    verse_count_change: int
    verse_count_change_pct: float
    chord_count_before: int
    chord_count_after: int
    chord_count_change: int
    chord_count_change_pct: float
    word_count_before: int
    word_count_after: int
    word_count_change: int
    word_count_change_pct: float
    change_category: str  # 'improved', 'degraded', 'regression', 'neutral', 'fixed'
    needs_review: bool
    review_reason: str


def load_metrics(analysis_dir: Path) -> Dict[str, Dict]:
    """Load metrics from an analysis directory"""
    metrics_path = analysis_dir / 'all_metrics.json'
    
    if not metrics_path.exists():
        print(f"Error: {metrics_path} not found")
        sys.exit(1)
    
    with open(metrics_path, 'r') as f:
        metrics = json.load(f)
    
    # Convert to dict by filename
    if isinstance(metrics, list):
        return {m.get('file', m.get('filename', '')): m for m in metrics}
    return metrics


def calculate_change(before: int, after: int) -> Tuple[int, float]:
    """Calculate absolute and percentage change"""
    change = after - before
    if before == 0:
        # Special case: 0 → >0 is always 100%+ change
        change_pct = 100.0 if after > 0 else 0.0
    else:
        change_pct = (change / before) * 100.0
    return change, change_pct


def categorize_change(
    verse_before: int, verse_after: int,
    chord_before: int, chord_after: int,
    word_before: int, word_after: int,
    verse_pct: float, chord_pct: float, word_pct: float
) -> Tuple[str, bool, str]:
    """
    Categorize the change and determine if it needs review
    
    Returns: (category, needs_review, reason)
    """
    # Check for fixes (0 → >0) - always positive
    was_broken = (verse_before == 0 and chord_before == 0 and word_before == 0)
    is_fixed = (verse_after > 0 or chord_after > 0 or word_after > 0)
    
    if was_broken and is_fixed:
        return ('fixed', False, 'Fixed parsing failure (0→>0)')
    
    # Check for regressions (>0 → 0) - always negative
    was_working = (verse_before > 0 or chord_before > 0 or word_before > 0)
    is_broken = (verse_after == 0 and chord_after == 0 and word_after == 0)
    
    if was_working and is_broken:
        return ('regression', True, 'Regression: working file now broken (>0→0)')
    
    # Check for dramatic changes (>10% in any metric)
    dramatic_changes = []
    if abs(verse_pct) > 10:
        dramatic_changes.append(f'verses: {verse_pct:+.1f}%')
    if abs(chord_pct) > 10:
        dramatic_changes.append(f'chords: {chord_pct:+.1f}%')
    if abs(word_pct) > 10:
        dramatic_changes.append(f'words: {word_pct:+.1f}%')
    
    if dramatic_changes:
        reason = f'Dramatic change: {", ".join(dramatic_changes)}'
        # Determine if it's improvement or degradation
        if verse_after > verse_before and chord_after > chord_before and word_after > word_before:
            return ('improved', True, reason)
        elif verse_after < verse_before and chord_after < chord_before and word_after < word_before:
            return ('degraded', True, reason)
        else:
            return ('mixed', True, reason)
    
    # Check for improvements (all metrics increased)
    if verse_after > verse_before and chord_after > chord_before and word_after > word_before:
        return ('improved', False, 'All metrics increased')
    
    # Check for degradations (all metrics decreased)
    if verse_after < verse_before and chord_after < chord_before and word_after < word_before:
        return ('degraded', True, 'All metrics decreased')
    
    # Neutral change
    return ('neutral', False, 'Minor changes, no significant impact')


def analyze_changes(before_metrics: Dict, after_metrics: Dict) -> List[FileChange]:
    """Analyze changes between two metric sets"""
    changes = []
    
    all_files = set(before_metrics.keys()) | set(after_metrics.keys())
    
    for filename in all_files:
        before = before_metrics.get(filename, {})
        after = after_metrics.get(filename, {})
        
        verse_before = before.get('verse_count', 0)
        verse_after = after.get('verse_count', 0)
        verse_change, verse_pct = calculate_change(verse_before, verse_after)
        
        chord_before = before.get('chord_count', 0)
        chord_after = after.get('chord_count', 0)
        chord_change, chord_pct = calculate_change(chord_before, chord_after)
        
        word_before = before.get('word_count', 0)
        word_after = after.get('word_count', 0)
        word_change, word_pct = calculate_change(word_before, word_after)
        
        category, needs_review, reason = categorize_change(
            verse_before, verse_after,
            chord_before, chord_after,
            word_before, word_after,
            verse_pct, chord_pct, word_pct
        )
        
        change = FileChange(
            filename=filename,
            verse_count_before=verse_before,
            verse_count_after=verse_after,
            verse_count_change=verse_change,
            verse_count_change_pct=verse_pct,
            chord_count_before=chord_before,
            chord_count_after=chord_after,
            chord_count_change=chord_change,
            chord_count_change_pct=chord_pct,
            word_count_before=word_before,
            word_count_after=word_after,
            word_count_change=word_change,
            word_count_change_pct=word_pct,
            change_category=category,
            needs_review=needs_review,
            review_reason=reason
        )
        
        changes.append(change)
    
    return changes


def generate_summary(changes: List[FileChange]) -> Dict:
    """Generate summary statistics"""
    summary = {
        'total_files': len(changes),
        'by_category': defaultdict(int),
        'needs_review': 0,
        'fixed_files': 0,
        'regressions': 0,
        'dramatic_changes': 0,
        'overall_assessment': ''
    }
    
    for change in changes:
        summary['by_category'][change.change_category] += 1
        if change.needs_review:
            summary['needs_review'] += 1
        if change.change_category == 'fixed':
            summary['fixed_files'] += 1
        if change.change_category == 'regression':
            summary['regressions'] += 1
        if abs(change.verse_count_change_pct) > 10 or \
           abs(change.chord_count_change_pct) > 10 or \
           abs(change.word_count_change_pct) > 10:
            summary['dramatic_changes'] += 1
    
    # Overall assessment
    if summary['regressions'] == 0 and summary['fixed_files'] > 0:
        summary['overall_assessment'] = 'POSITIVE: Fixed parsing failures with no regressions'
    elif summary['regressions'] > 0:
        summary['overall_assessment'] = f'NEGATIVE: {summary["regressions"]} regressions detected'
    elif summary['dramatic_changes'] > 0 and summary['fixed_files'] == 0:
        summary['overall_assessment'] = f'CAUTION: {summary["dramatic_changes"]} dramatic changes, review needed'
    else:
        summary['overall_assessment'] = 'NEUTRAL: Minor changes, no significant impact'
    
    return summary


def main():
    parser = argparse.ArgumentParser(
        description='Analyze changes between two validator analysis runs',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic comparison
  uv run python scripts/analyze_changes.py --before analysis_before --after analysis

  # Save detailed report
  uv run python scripts/analyze_changes.py --before analysis_before --after analysis --output report.json

  # Show only files needing review
  uv run python scripts/analyze_changes.py --before analysis_before --after analysis --review-only
        """
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
        help='Output file for detailed JSON report (default: stdout for summary)'
    )
    parser.add_argument(
        '--review-only',
        action='store_true',
        help='Show only files that need review'
    )
    parser.add_argument(
        '--dramatic-only',
        action='store_true',
        help='Show only files with dramatic changes (>10%%)'
    )
    parser.add_argument(
        '--category',
        choices=['fixed', 'improved', 'degraded', 'regression', 'neutral', 'mixed'],
        help='Show only files in this category'
    )
    
    args = parser.parse_args()
    
    print(f"Loading metrics from: {args.before}")
    before_metrics = load_metrics(args.before)
    
    print(f"Loading metrics from: {args.after}")
    after_metrics = load_metrics(args.after)
    
    print("Analyzing changes...")
    changes = analyze_changes(before_metrics, after_metrics)
    
    # Filter changes if requested
    if args.review_only:
        changes = [c for c in changes if c.needs_review]
    elif args.dramatic_only:
        changes = [c for c in changes if 
                   abs(c.verse_count_change_pct) > 10 or
                   abs(c.chord_count_change_pct) > 10 or
                   abs(c.word_count_change_pct) > 10]
    elif args.category:
        changes = [c for c in changes if c.change_category == args.category]
    
    # Generate summary
    summary = generate_summary(changes)
    
    # Build report
    report_lines = []
    report_lines.append("=" * 80)
    report_lines.append("CHANGE ANALYSIS REPORT")
    report_lines.append("=" * 80)
    report_lines.append(f"\nBefore: {args.before}")
    report_lines.append(f"After:  {args.after}")
    report_lines.append(f"\nTotal files analyzed: {summary['total_files']}")
    report_lines.append(f"\n{summary['overall_assessment']}")
    report_lines.append("\n" + "-" * 80)
    report_lines.append("Summary by Category:")
    report_lines.append("-" * 80)
    for category, count in sorted(summary['by_category'].items()):
        pct = (count / summary['total_files']) * 100
        report_lines.append(f"  {category:15} {count:6} ({pct:5.1f}%)")
    
    report_lines.append(f"\nFiles needing review: {summary['needs_review']}")
    report_lines.append(f"Fixed files (0→>0): {summary['fixed_files']}")
    report_lines.append(f"Regressions (>0→0): {summary['regressions']}")
    report_lines.append(f"Dramatic changes (>10%%): {summary['dramatic_changes']}")
    
    # Show detailed changes
    if changes:
        report_lines.append("\n" + "=" * 80)
        report_lines.append("DETAILED CHANGES")
        report_lines.append("=" * 80)
        
        # Group by category
        by_category = defaultdict(list)
        for change in changes:
            by_category[change.change_category].append(change)
        
        for category in ['fixed', 'regression', 'mixed', 'improved', 'degraded', 'neutral']:
            if category not in by_category:
                continue
            
            cat_changes = by_category[category]
            report_lines.append(f"\n{category.upper()} ({len(cat_changes)} files):")
            report_lines.append("-" * 80)
            
            # Sort by magnitude of change
            cat_changes.sort(key=lambda c: max(
                abs(c.verse_count_change_pct),
                abs(c.chord_count_change_pct),
                abs(c.word_count_change_pct)
            ), reverse=True)
            
            for change in cat_changes[:50]:  # Limit to top 50
                report_lines.append(
                    f"  {change.filename:<50} "
                    f"V:{change.verse_count_before:>3}→{change.verse_count_after:<3} "
                    f"({change.verse_count_change_pct:>+6.1f}%) | "
                    f"C:{change.chord_count_before:>3}→{change.chord_count_after:<3} "
                    f"({change.chord_count_change_pct:>+6.1f}%) | "
                    f"W:{change.word_count_before:>4}→{change.word_count_after:<4} "
                    f"({change.word_count_change_pct:>+6.1f}%)"
                )
                if change.needs_review:
                    report_lines.append(f"    ⚠️  {change.review_reason}")
            
            if len(cat_changes) > 50:
                report_lines.append(f"    ... and {len(cat_changes) - 50} more files")
    
    report_text = '\n'.join(report_lines)
    
    # Output
    if args.output:
        # Save detailed JSON
        output_data = {
            'summary': summary,
            'changes': [asdict(c) for c in changes]
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, 'w') as f:
            json.dump(output_data, f, indent=2)
        print(f"\nDetailed JSON report saved to: {args.output}")
        
        # Also save text report
        text_output = args.output.with_suffix('.txt')
        with open(text_output, 'w') as f:
            f.write(report_text)
        print(f"Text report saved to: {text_output}")
    else:
        print("\n" + report_text)


if __name__ == '__main__':
    main()

