#!/usr/bin/env python3
"""
Validator - Analyzes parsed ChordPro files to find potential errors

This script analyzes all parsed files in the output directory and identifies
outliers based on:
1. Number of verses per song
2. Number of chords per song
3. Number of words per song

It generates histograms and identifies files in the top/bottom 0.1% for each metric.
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict
import json
from dataclasses import dataclass, asdict

try:
    import numpy as np
    import matplotlib.pyplot as plt
except ImportError:
    print("Error: matplotlib and numpy are required. Install with: uv sync")
    sys.exit(1)


@dataclass
class SongMetrics:
    """Metrics for a single song"""
    filename: str
    verse_count: int
    chord_count: int
    word_count: int


def parse_chordpro_file(file_path: Path) -> SongMetrics:
    """Parse a ChordPro file and extract metrics"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Count verses (start_of_verse markers)
    verse_count = len(re.findall(r'\{start_of_verse[^}]*\}', content))
    
    # Count chords (inside square brackets)
    chord_matches = re.findall(r'\[([A-G][#b♯♭]?(?:maj|min|m|sus|dim|aug|add|M)?\d*(?:/[A-G][#b♯♭]?)?)\]', content)
    chord_count = len(chord_matches)
    
    # Count words (exclude metadata and directives)
    # Remove metadata lines
    lines = content.split('\n')
    lyric_lines = []
    for line in lines:
        line = line.strip()
        # Skip metadata and directives
        if (line.startswith('{meta:') or 
            line.startswith('{start_of_') or 
            line.startswith('{end_of_') or
            line.startswith('{c:') or
            not line):
            continue
        # Remove chord markers but keep lyrics
        line = re.sub(r'\[[^\]]+\]', '', line)
        if line.strip():
            lyric_lines.append(line)
    
    # Count words in lyric lines
    word_count = sum(len(line.split()) for line in lyric_lines)
    
    return SongMetrics(
        filename=file_path.name,
        verse_count=verse_count,
        chord_count=chord_count,
        word_count=word_count
    )


def analyze_all_files(output_dir: Path) -> List[SongMetrics]:
    """Analyze all .pro files in the output directory"""
    metrics_list = []
    pro_files = list(output_dir.glob('*.pro'))
    
    print(f"Analyzing {len(pro_files)} ChordPro files...")
    
    for i, pro_file in enumerate(pro_files, 1):
        try:
            metrics = parse_chordpro_file(pro_file)
            metrics_list.append(metrics)
            if i % 1000 == 0:
                print(f"  Processed {i}/{len(pro_files)} files...")
        except Exception as e:
            print(f"  Warning: Failed to parse {pro_file.name}: {e}")
    
    print(f"Successfully analyzed {len(metrics_list)} files")
    return metrics_list


def compute_quantiles(values: List[float]) -> Dict[str, float]:
    """Compute quantiles for a list of values"""
    if not values:
        return {}
    
    arr = np.array(values)
    return {
        'min': float(np.min(arr)),
        'p0.1': float(np.percentile(arr, 0.1)),
        'p1': float(np.percentile(arr, 1)),
        'p5': float(np.percentile(arr, 5)),
        'p25': float(np.percentile(arr, 25)),
        'p50': float(np.percentile(arr, 50)),
        'p75': float(np.percentile(arr, 75)),
        'p95': float(np.percentile(arr, 95)),
        'p99': float(np.percentile(arr, 99)),
        'p99.9': float(np.percentile(arr, 99.9)),
        'max': float(np.max(arr)),
        'mean': float(np.mean(arr)),
        'std': float(np.std(arr))
    }


def find_outliers(metrics_list: List[SongMetrics], metric_name: str, 
                  threshold_low: float, threshold_high: float) -> Tuple[List[SongMetrics], List[SongMetrics]]:
    """Find outliers below and above thresholds"""
    bottom_outliers = []
    top_outliers = []
    
    for metrics in metrics_list:
        value = getattr(metrics, metric_name)
        if value <= threshold_low:
            bottom_outliers.append(metrics)
        elif value >= threshold_high:
            top_outliers.append(metrics)
    
    # Sort by the metric value
    bottom_outliers.sort(key=lambda x: getattr(x, metric_name))
    top_outliers.sort(key=lambda x: getattr(x, metric_name), reverse=True)
    
    return bottom_outliers, top_outliers


def generate_histogram(values: List[float], metric_name: str, output_path: Path, 
                      title: str, xlabel: str):
    """Generate a histogram for a metric"""
    if not values:
        return
    
    plt.figure(figsize=(10, 6))
    plt.hist(values, bins=50, edgecolor='black', alpha=0.7)
    plt.title(title, fontsize=14, fontweight='bold')
    plt.xlabel(xlabel, fontsize=12)
    plt.ylabel('Number of Songs', fontsize=12)
    plt.grid(axis='y', alpha=0.3)
    
    # Add statistics text
    mean_val = np.mean(values)
    median_val = np.median(values)
    stats_text = f'Mean: {mean_val:.1f}\nMedian: {median_val:.1f}'
    plt.text(0.98, 0.98, stats_text, transform=plt.gca().transAxes,
             verticalalignment='top', horizontalalignment='right',
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
    
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()


def save_outliers_report(bottom_outliers: List[SongMetrics], 
                        top_outliers: List[SongMetrics],
                        metric_name: str, output_path: Path,
                        threshold_low: float, threshold_high: float,
                        html_dir: Path, pro_dir: Path):
    """Save outliers report to a file"""
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(f"Outliers Report: {metric_name.replace('_', ' ').title()}\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Thresholds: Bottom 0.1% <= {threshold_low:.2f}, Top 0.1% >= {threshold_high:.2f}\n\n")
        
        f.write(f"Bottom 0.1% ({len(bottom_outliers)} files):\n")
        f.write("-" * 80 + "\n")
        for metrics in bottom_outliers:
            value = getattr(metrics, metric_name)
            html_filename = metrics.filename.replace('.pro', '.html')
            html_path = html_dir / html_filename
            pro_path = pro_dir / metrics.filename
            f.write(f"  HTML: {html_path}\n")
            f.write(f"  PRO:  {pro_path}\n")
            f.write(f"  {metric_name.replace('_', ' ').title()}: {value}\n")
            f.write("\n")
        
        f.write(f"\n\nTop 0.1% ({len(top_outliers)} files):\n")
        f.write("-" * 80 + "\n")
        for metrics in top_outliers:
            value = getattr(metrics, metric_name)
            html_filename = metrics.filename.replace('.pro', '.html')
            html_path = html_dir / html_filename
            pro_path = pro_dir / metrics.filename
            f.write(f"  HTML: {html_path}\n")
            f.write(f"  PRO:  {pro_path}\n")
            f.write(f"  {metric_name.replace('_', ' ').title()}: {value}\n")
            f.write("\n")


def main():
    parser = argparse.ArgumentParser(
        description='Analyze parsed ChordPro files to find potential errors'
    )
    parser.add_argument(
        '--output-dir',
        type=str,
        default='songs/classic-country/parsed',
        help='Directory containing .pro files (default: songs/classic-country/parsed)'
    )
    parser.add_argument(
        '--html-dir',
        type=str,
        default='songs/classic-country/raw',
        help='Directory containing .html files (default: songs/classic-country/raw)'
    )
    parser.add_argument(
        '--analysis-dir',
        type=str,
        default='analysis',
        help='Directory for analysis artifacts (default: analysis)'
    )
    parser.add_argument(
        '--threshold',
        type=float,
        default=0.1,
        help='Outlier threshold percentage (default: 0.1)'
    )
    
    args = parser.parse_args()
    
    output_dir = Path(args.output_dir)
    html_dir = Path(args.html_dir)
    analysis_dir = Path(args.analysis_dir)
    threshold_pct = args.threshold
    
    if not output_dir.exists():
        print(f"Error: Output directory not found: {output_dir}")
        sys.exit(1)
    
    if not html_dir.exists():
        print(f"Warning: HTML directory not found: {html_dir}")
        print("  HTML paths in reports will be based on expected location")
    
    # Create analysis directory structure
    analysis_dir.mkdir(exist_ok=True)
    histograms_dir = analysis_dir / 'histograms'
    reports_dir = analysis_dir / 'reports'
    histograms_dir.mkdir(exist_ok=True)
    reports_dir.mkdir(exist_ok=True)
    
    # Analyze all files
    metrics_list = analyze_all_files(output_dir)
    
    if not metrics_list:
        print("Error: No files found to analyze")
        sys.exit(1)
    
    # Extract metrics
    verse_counts = [m.verse_count for m in metrics_list]
    chord_counts = [m.chord_count for m in metrics_list]
    word_counts = [m.word_count for m in metrics_list]
    
    # Compute quantiles for each metric
    print("\nComputing statistics...")
    verse_stats = compute_quantiles(verse_counts)
    chord_stats = compute_quantiles(chord_counts)
    word_stats = compute_quantiles(word_counts)
    
    # Save summary statistics
    summary = {
        'total_files': len(metrics_list),
        'threshold_percentage': threshold_pct,
        'verse_count': verse_stats,
        'chord_count': chord_stats,
        'word_count': word_stats
    }
    
    summary_path = analysis_dir / 'summary_statistics.json'
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    print(f"Summary statistics saved to: {summary_path}")
    
    # Find outliers for each metric
    metrics_to_check = [
        ('verse_count', verse_counts, 'Verses per Song', 'Number of Verses'),
        ('chord_count', chord_counts, 'Chords per Song', 'Number of Chords'),
        ('word_count', word_counts, 'Words per Song', 'Number of Words')
    ]
    
    print(f"\nFinding outliers (top/bottom {threshold_pct}%)...")
    
    for metric_name, values, title, xlabel in metrics_to_check:
        # Get thresholds
        threshold_low = np.percentile(values, threshold_pct)
        threshold_high = np.percentile(values, 100 - threshold_pct)
        
        # Find outliers
        bottom_outliers, top_outliers = find_outliers(
            metrics_list, metric_name, threshold_low, threshold_high
        )
        
        # Generate histogram
        histogram_path = histograms_dir / f'{metric_name}_histogram.png'
        generate_histogram(values, metric_name, histogram_path, title, xlabel)
        print(f"  Histogram saved: {histogram_path}")
        
        # Save outliers report
        report_path = reports_dir / f'{metric_name}_outliers.txt'
        save_outliers_report(
            bottom_outliers, top_outliers, metric_name, report_path,
            threshold_low, threshold_high, html_dir, output_dir
        )
        print(f"  Outliers report saved: {report_path}")
        print(f"    Bottom {threshold_pct}%: {len(bottom_outliers)} files")
        print(f"    Top {threshold_pct}%: {len(top_outliers)} files")
    
    # Save all metrics as JSON for further analysis
    all_metrics_path = analysis_dir / 'all_metrics.json'
    with open(all_metrics_path, 'w', encoding='utf-8') as f:
        json.dump([asdict(m) for m in metrics_list], f, indent=2)
    print(f"\nAll metrics saved to: {all_metrics_path}")
    
    print(f"\n✅ Analysis complete! Results in: {analysis_dir}")
    print(f"   - Histograms: {histograms_dir}")
    print(f"   - Outlier reports: {reports_dir}")
    print(f"   - Summary statistics: {summary_path}")


if __name__ == '__main__':
    main()

