#!/usr/bin/env python3
"""
Regression Testing Workflow

Automates pre/post comparison testing for parser changes:
1. Creates baseline analysis from current output
2. Runs batch process with changes
3. Creates post-change analysis
4. Compares results and flags regressions
5. Generates summary report

Usage:
    # Full regression test
    python3 scripts/regression_test.py --name repeat_fix

    # Skip baseline if already created
    python3 scripts/regression_test.py --name repeat_fix --skip-baseline

    # Quick test on subset
    python3 scripts/regression_test.py --name quick_test --quick
"""

import subprocess
import sys
import argparse
import json
import os
from pathlib import Path
from datetime import datetime

# Paths relative to repo root (script is called from repo root by test runner)
SOURCE_DIR = Path("sources/classic-country")
SRC_DIR = SOURCE_DIR / "src"
VALIDATOR_SCRIPT = SRC_DIR / "validator_cli.py"
BATCH_SCRIPT = SRC_DIR / "batch_process.py"
ANALYZE_SCRIPT = SRC_DIR / "analyze_changes.py"


def check_git_status():
    """Check if sources/classic-country/parsed/ has uncommitted changes"""
    result = subprocess.run(
        ["git", "status", "--porcelain", "sources/classic-country/parsed/"],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        return None, "Git not available or not a git repository"

    changed_files = [line for line in result.stdout.strip().split('\n') if line]
    return changed_files, None


def count_output_changes():
    """Count how many files in sources/classic-country/parsed/ have changed"""
    changed_files, error = check_git_status()
    if error:
        return 0, error
    return len(changed_files), None


def run_command(cmd, description, capture=False):
    """Run a command and handle errors"""
    print(f"\n{'='*70}")
    print(f"{description}")
    print(f"{'='*70}")

    if capture:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    else:
        result = subprocess.run(cmd, shell=True)

    if result.returncode != 0:
        if capture:
            print(f"Error: {result.stderr}")
        print(f"\n❌ Command failed with exit code {result.returncode}")
        sys.exit(1)

    if capture:
        print(result.stdout)
        return result.stdout

    return None


def load_summary(analysis_dir):
    """Load summary statistics from analysis directory"""
    summary_path = Path(analysis_dir) / 'summary_statistics.json'
    if not summary_path.exists():
        return None

    with open(summary_path, 'r') as f:
        return json.load(f)


def print_summary_comparison(before_dir, after_dir):
    """Print a comparison of summary statistics"""
    before = load_summary(before_dir)
    after = load_summary(after_dir)

    if not before or not after:
        print("⚠️  Could not load summary statistics for comparison")
        return

    print(f"\n{'='*70}")
    print("SUMMARY COMPARISON")
    print(f"{'='*70}")

    # Files analyzed
    files_before = before.get('total_files', 0)
    files_after = after.get('total_files', 0)
    print(f"\nFiles analyzed:")
    print(f"  Before: {files_before:,}")
    print(f"  After:  {files_after:,}")
    if files_before != files_after:
        print(f"  ⚠️  File count changed by {files_after - files_before:+,}")

    # Average metrics
    metrics = ['verse_count', 'chord_count', 'word_count']
    for metric in metrics:
        before_avg = before.get(f'mean_{metric}', 0)
        after_avg = after.get(f'mean_{metric}', 0)
        change_pct = ((after_avg - before_avg) / before_avg * 100) if before_avg > 0 else 0

        print(f"\nAverage {metric.replace('_', ' ')}:")
        print(f"  Before: {before_avg:.2f}")
        print(f"  After:  {after_avg:.2f}")
        if abs(change_pct) > 0.1:
            print(f"  Change: {change_pct:+.2f}%")


def main():
    parser = argparse.ArgumentParser(
        description='Automated regression testing for parser changes',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full regression test
  python3 scripts/regression_test.py --name repeat_fix

  # Skip baseline if already created
  python3 scripts/regression_test.py --name repeat_fix --skip-baseline

  # Review existing comparison
  python3 scripts/regression_test.py --name repeat_fix --skip-baseline --skip-batch
        """
    )
    parser.add_argument('--name', required=True,
                       help='Name for this test run (e.g., "repeat_fix")')
    parser.add_argument('--skip-baseline', action='store_true',
                       help='Skip baseline analysis (use existing)')
    parser.add_argument('--skip-batch', action='store_true',
                       help='Skip batch process (only rerun comparison)')
    args = parser.parse_args()

    name = args.name
    # Put analysis dirs in source directory
    before_dir = SOURCE_DIR / f"analysis_before_{name}"
    after_dir = SOURCE_DIR / f"analysis_after_{name}"

    print(f"\n{'#'*70}")
    print(f"# REGRESSION TESTING: {name}")
    print(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'#'*70}")

    # Check git status before making changes
    if not args.skip_batch:
        change_count, error = count_output_changes()
        if error:
            print(f"\n⚠️  Warning: {error}")
            print("   Git rollback will not be available")
        elif change_count > 0:
            print(f"\n⚠️  Warning: sources/classic-country/parsed/ has {change_count} uncommitted changes")
            print("   These will be overwritten by batch processing")
            print(f"\n   To save current state:")
            print(f"   git add sources/classic-country/parsed/ && git commit -m 'Pre-{name} baseline'")
            print(f"\n   To discard current changes:")
            print(f"   git checkout HEAD -- sources/classic-country/parsed/")
            response = input("\n   Continue anyway? (y/N): ")
            if response.lower() != 'y':
                print("Aborted.")
                sys.exit(0)

    # Step 1: Create baseline analysis (unless skipped)
    if not args.skip_baseline:
        if Path(before_dir).exists():
            print(f"\n⚠️  Baseline analysis already exists: {before_dir}/")
            response = input("Overwrite? (y/N): ")
            if response.lower() != 'y':
                print("Using existing baseline analysis")
            else:
                run_command(
                    f"rm -rf {before_dir} && uv run python3 {VALIDATOR_SCRIPT} --analysis-dir {before_dir}",
                    "Step 1: Creating baseline analysis from current output"
                )
        else:
            run_command(
                f"uv run python3 {VALIDATOR_SCRIPT} --analysis-dir {before_dir}",
                "Step 1: Creating baseline analysis from current output"
            )
    else:
        print(f"\n📋 Skipping baseline analysis, using existing: {before_dir}/")
        if not Path(before_dir).exists():
            print(f"❌ Error: {before_dir} does not exist")
            print(f"   Run without --skip-baseline to create it")
            sys.exit(1)

    # Step 2: Run batch process (unless skipped)
    if not args.skip_batch:
        run_command(
            f"uv run python3 {BATCH_SCRIPT}",
            "Step 2: Running batch process with changes"
        )
    else:
        print(f"\n📋 Skipping batch process")

    # Step 3: Create post-change analysis
    if not args.skip_batch:
        run_command(
            f"uv run python3 {VALIDATOR_SCRIPT} --analysis-dir {after_dir}",
            "Step 3: Creating post-change analysis"
        )
    else:
        print(f"\n📋 Using existing post-change analysis: {after_dir}/")
        if not Path(after_dir).exists():
            print(f"❌ Error: {after_dir} does not exist")
            print(f"   Run without --skip-batch to create it")
            sys.exit(1)

    # Step 4: Compare results
    comparison_output = run_command(
        f"uv run python3 {ANALYZE_SCRIPT} --before {before_dir} --after {after_dir}",
        "Step 4: Comparing results and detecting regressions",
        capture=True
    )

    # Step 5: Print summary comparison
    print_summary_comparison(before_dir, after_dir)

    # Step 6: Check final git status and provide rollback info
    final_change_count, _ = count_output_changes()

    # Step 7: Final summary
    print(f"\n{'='*70}")
    print("✅ REGRESSION TESTING COMPLETE")
    print(f"{'='*70}")
    print(f"\n📊 Analysis Directories:")
    print(f"   Before: {before_dir}/")
    print(f"   After:  {after_dir}/")
    print(f"\n📈 Reports:")
    print(f"   Histograms: {after_dir}/histograms/")
    print(f"   Outliers:   {after_dir}/reports/")
    print(f"   Metrics:    {after_dir}/all_metrics.json")

    # Git rollback instructions
    if final_change_count and final_change_count > 0:
        print(f"\n🔄 Git Status:")
        print(f"   {final_change_count:,} files changed in sources/classic-country/parsed/")
        print(f"\n   To commit these changes:")
        print(f"   git add sources/classic-country/parsed/ && git commit -m 'Apply {name} changes'")
        print(f"\n   To rollback all changes:")
        print(f"   git checkout HEAD -- sources/classic-country/parsed/")
        print(f"\n   To rollback specific files:")
        print(f"   git checkout HEAD -- sources/classic-country/parsed/<filename>.pro")

    print(f"\n💡 Next Steps:")
    print(f"   - Review comparison output above")
    print(f"   - Check files flagged for review")
    print(f"   - Manually validate changed files in viewer")
    print(f"   - Decide: commit changes or rollback")
    print(f"\n   To rerun comparison only:")
    print(f"   python3 scripts/regression_test.py --name {name} --skip-baseline --skip-batch")
    print()


if __name__ == '__main__':
    main()
