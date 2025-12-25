#!/usr/bin/env python3
"""
Quick Fix Workflow for Bug Reports

Provides a streamlined workflow for fixing parsing bugs reported via the UI:
1. Re-parse a single song and show git diff
2. Run quick regression checks on a sample
3. Full batch reparse with diff summary

Usage:
    # Re-parse single song and show diff
    python3 scripts/quick_fix.py --song yourcheatingheart

    # Re-parse song and run sample regression check
    python3 scripts/quick_fix.py --song yourcheatingheart --check-sample

    # Full batch reparse with diff summary (after parser change)
    python3 scripts/quick_fix.py --batch

    # Show diff summary of current changes
    python3 scripts/quick_fix.py --diff-summary

    # Rollback all changes
    python3 scripts/quick_fix.py --rollback
"""

import subprocess
import sys
import argparse
import re
from pathlib import Path


PARSED_DIR = Path("sources/classic-country/parsed")
RAW_DIR = Path("sources/classic-country/raw")


def run_git_diff(file_path=None, stat_only=False):
    """Run git diff and return output"""
    cmd = ["git", "diff", "--color=always"]
    if stat_only:
        cmd.append("--stat")
    if file_path:
        cmd.append(str(file_path))
    else:
        cmd.append(str(PARSED_DIR))

    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def get_changed_files():
    """Get list of changed files in parsed directory"""
    result = subprocess.run(
        ["git", "diff", "--name-only", str(PARSED_DIR)],
        capture_output=True,
        text=True
    )
    files = [f for f in result.stdout.strip().split('\n') if f]
    return files


def parse_single_song(song_id):
    """Re-parse a single song from raw HTML"""
    raw_file = RAW_DIR / f"{song_id}.html"
    parsed_file = PARSED_DIR / f"{song_id}.pro"

    if not raw_file.exists():
        print(f"Error: Raw file not found: {raw_file}")
        return False

    # Import parser and run
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from songbook.parser.parser import parse_html_to_chordpro

    print(f"Parsing: {raw_file}")

    with open(raw_file, 'r', encoding='utf-8', errors='replace') as f:
        html_content = f.read()

    result = parse_html_to_chordpro(html_content, str(raw_file))

    if result.success:
        with open(parsed_file, 'w', encoding='utf-8') as f:
            f.write(result.chordpro)
        print(f"Written: {parsed_file}")
        return True
    else:
        print(f"Parse failed: {result.error}")
        return False


def show_diff(song_id=None):
    """Show git diff for a song or all changes"""
    if song_id:
        file_path = PARSED_DIR / f"{song_id}.pro"
        diff = run_git_diff(file_path)
    else:
        diff = run_git_diff()

    if diff:
        print("\n" + "="*70)
        print("GIT DIFF")
        print("="*70)
        print(diff)
    else:
        print("\nNo changes detected")


def show_diff_summary():
    """Show summary of all changes"""
    changed_files = get_changed_files()

    print("\n" + "="*70)
    print(f"CHANGE SUMMARY: {len(changed_files)} files modified")
    print("="*70)

    if not changed_files:
        print("No changes to parsed files")
        return

    # Show stat summary
    stat = run_git_diff(stat_only=True)
    print(stat)

    # Analyze change types
    additions = 0
    deletions = 0

    diff_output = subprocess.run(
        ["git", "diff", "--numstat", str(PARSED_DIR)],
        capture_output=True,
        text=True
    )

    for line in diff_output.stdout.strip().split('\n'):
        if line:
            parts = line.split('\t')
            if len(parts) >= 2:
                try:
                    additions += int(parts[0])
                    deletions += int(parts[1])
                except ValueError:
                    pass

    print(f"\nTotal: +{additions} -{deletions} lines across {len(changed_files)} files")

    # Show first few changed files
    print(f"\nChanged files (first 10):")
    for f in changed_files[:10]:
        print(f"  {f}")
    if len(changed_files) > 10:
        print(f"  ... and {len(changed_files) - 10} more")


def run_sample_check(sample_size=50):
    """Run parser on a sample and check for unexpected changes"""
    import random

    raw_files = list(RAW_DIR.glob("*.html"))
    sample = random.sample(raw_files, min(sample_size, len(raw_files)))

    print(f"\n" + "="*70)
    print(f"SAMPLE REGRESSION CHECK: {len(sample)} files")
    print("="*70)

    # Get initial state
    initial_changes = set(get_changed_files())

    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from songbook.parser.parser import parse_html_to_chordpro

    parsed = 0
    failed = 0

    for raw_file in sample:
        song_id = raw_file.stem
        parsed_file = PARSED_DIR / f"{song_id}.pro"

        with open(raw_file, 'r', encoding='utf-8', errors='replace') as f:
            html_content = f.read()

        result = parse_html_to_chordpro(html_content, str(raw_file))

        if result.success:
            with open(parsed_file, 'w', encoding='utf-8') as f:
                f.write(result.chordpro)
            parsed += 1
        else:
            failed += 1

    # Check what changed
    final_changes = set(get_changed_files())
    new_changes = final_changes - initial_changes

    print(f"\nResults:")
    print(f"  Parsed: {parsed}")
    print(f"  Failed: {failed}")
    print(f"  New changes: {len(new_changes)} files")

    if new_changes:
        print(f"\nNewly changed files:")
        for f in sorted(new_changes)[:10]:
            print(f"  {f}")
        if len(new_changes) > 10:
            print(f"  ... and {len(new_changes) - 10} more")


def run_batch():
    """Run full batch process"""
    print("\n" + "="*70)
    print("RUNNING FULL BATCH PROCESS")
    print("="*70)

    result = subprocess.run(
        ["uv", "run", "python3", "batch_process.py"],
        cwd=Path(__file__).parent.parent
    )

    if result.returncode != 0:
        print("Batch process failed")
        return False

    show_diff_summary()
    return True


def rollback():
    """Rollback all changes to parsed files"""
    changed = get_changed_files()
    if not changed:
        print("No changes to rollback")
        return

    print(f"\nRolling back {len(changed)} files...")
    result = subprocess.run(
        ["git", "checkout", "HEAD", "--", str(PARSED_DIR)],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        print("Rollback complete")
    else:
        print(f"Rollback failed: {result.stderr}")


def main():
    parser = argparse.ArgumentParser(
        description='Quick fix workflow for bug reports',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Re-parse single song and show diff
  python3 scripts/quick_fix.py --song yourcheatingheart

  # Re-parse and check sample for regressions
  python3 scripts/quick_fix.py --song yourcheatingheart --check-sample

  # Show current diff summary
  python3 scripts/quick_fix.py --diff-summary

  # Full batch reparse
  python3 scripts/quick_fix.py --batch

  # Rollback all changes
  python3 scripts/quick_fix.py --rollback
        """
    )
    parser.add_argument('--song', help='Song ID to re-parse (without extension)')
    parser.add_argument('--check-sample', action='store_true',
                       help='Run sample regression check after parsing')
    parser.add_argument('--batch', action='store_true',
                       help='Run full batch process')
    parser.add_argument('--diff-summary', action='store_true',
                       help='Show summary of current changes')
    parser.add_argument('--rollback', action='store_true',
                       help='Rollback all changes to parsed files')
    parser.add_argument('--sample-size', type=int, default=50,
                       help='Sample size for regression check (default: 50)')

    args = parser.parse_args()

    # Handle actions
    if args.rollback:
        rollback()
        return

    if args.diff_summary:
        show_diff_summary()
        return

    if args.batch:
        run_batch()
        return

    if args.song:
        success = parse_single_song(args.song)
        if success:
            show_diff(args.song)
            if args.check_sample:
                run_sample_check(args.sample_size)
        return

    # No action specified, show help
    parser.print_help()


if __name__ == '__main__':
    main()
