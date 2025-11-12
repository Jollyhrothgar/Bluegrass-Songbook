#!/usr/bin/env python3
"""
Chord Counter - Counts chords in ChordPro files or directories

This script analyzes ChordPro format files and provides statistics
about chord usage and frequency.
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Optional
from collections import Counter


def count_chords_in_file(file_path: Path) -> Counter:
    """Count chords in a single ChordPro file"""
    with open(file_path, 'r') as file:
        content = file.read()
    # Match chords inside square brackets: [G], [F], [Em], [D7], [Am], etc.
    chords = re.findall(r'\[([A-G][#b♯♭]?(?:maj|min|m|sus|dim|aug|add|M)?\d*(?:/[A-G][#b♯♭]?)?)\]', content)
    return Counter(chords)


def count_chords_in_directory(directory: Path, recursive: bool = False) -> Counter:
    """Count chords in all .pro files in a directory"""
    # Placeholder implementation
    chord_counter = Counter()
    # TODO: Implement directory scanning and counting
    return chord_counter


def main():
    """
    Main CLI entry point with various argparse patterns demonstrated
    """
    # Pattern 1: Basic ArgumentParser with description
    parser = argparse.ArgumentParser(
        description='Count and analyze chords in ChordPro files',
        # Optional: Customize help formatting
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s song.pro                    # Count chords in a single file
  %(prog)s output/ --recursive         # Count chords in directory recursively
  %(prog)s output/ --top 10            # Show top 10 most common chords
  %(prog)s output/ --format json       # Output results as JSON
        '''
    )

    # Pattern 2: Positional argument (required)
    parser.add_argument(
        'input',
        type=str,  # argparse automatically converts to string, but explicit is clear
        help='Input file or directory to analyze'
    )

    # Pattern 3: Optional argument with short and long flags, default value
    parser.add_argument(
        '-o', '--output',
        type=str,
        default=None,
        help='Output file path (default: print to stdout)'
    )

    # Pattern 4: Optional argument with type conversion
    parser.add_argument(
        '-t', '--top',
        type=int,
        default=20,
        metavar='N',
        help='Show top N most common chords (default: 20)'
    )

    # Pattern 5: Boolean flag (store_true)
    parser.add_argument(
        '-r', '--recursive',
        action='store_true',
        help='Recursively search subdirectories'
    )

    # Pattern 6: Boolean flag (store_false) - inverted logic
    parser.add_argument(
        '--no-sort',
        action='store_false',
        dest='sort',
        default=True,
        help='Do not sort results by frequency'
    )

    # Pattern 7: Argument with choices (validation)
    parser.add_argument(
        '-f', '--format',
        choices=['text', 'json', 'csv'],
        default='text',
        help='Output format (default: text)'
    )

    # Pattern 8: Optional argument with required value
    parser.add_argument(
        '--min-count',
        type=int,
        default=1,
        metavar='COUNT',
        help='Minimum count threshold to include chord (default: 1)'
    )

    # Pattern 9: Multiple values (nargs)
    parser.add_argument(
        '--exclude',
        nargs='+',
        default=[],
        metavar='CHORD',
        help='Chords to exclude from analysis (space-separated)'
    )

    # Pattern 10: Optional argument that can be specified multiple times
    parser.add_argument(
        '--include-pattern',
        action='append',
        default=[],
        metavar='PATTERN',
        help='File patterns to include (can be specified multiple times)'
    )

    # Pattern 11: Verbose flag with count (v, -vv, -vvv)
    parser.add_argument(
        '-v', '--verbose',
        action='count',
        default=0,
        help='Increase verbosity (use -vv for more verbose output)'
    )

    # Parse arguments
    args = parser.parse_args()

    # Convert input to Path object
    input_path = Path(args.input)

    # Validate input exists
    if not input_path.exists():
        parser.error(f"Input path does not exist: {args.input}")

    # Pattern 12: Conditional logic based on arguments
    if input_path.is_file():
        if args.verbose >= 1:
            print(f"Processing file: {input_path}", file=sys.stderr)
        chord_counts = count_chords_in_file(input_path)
    elif input_path.is_dir():
        if args.verbose >= 1:
            print(f"Processing directory: {input_path}", file=sys.stderr)
        chord_counts = count_chords_in_directory(input_path, recursive=args.recursive)
    else:
        parser.error(f"Input must be a file or directory: {args.input}")

    # Apply filters
    if args.exclude:
        for chord in args.exclude:
            chord_counts.pop(chord, None)

    # Filter by min_count
    chord_counts = {k: v for k, v in chord_counts.items() if v >= args.min_count}

    # Sort if requested
    if args.sort:
        chord_counts = dict(sorted(chord_counts.items(), key=lambda x: x[1], reverse=True))

    # Limit to top N
    top_chords = dict(list(chord_counts.items())[:args.top])

    # Output results based on format
    output_text = ""
    if args.format == 'text':
        output_text = format_text_output(top_chords, args)
    elif args.format == 'json':
        output_text = format_json_output(top_chords, args)
    elif args.format == 'csv':
        output_text = format_csv_output(top_chords, args)

    # Write output
    if args.output:
        output_path = Path(args.output)
        output_path.write_text(output_text)
        if args.verbose >= 1:
            print(f"Results written to: {output_path}", file=sys.stderr)
    else:
        print(output_text)


def format_text_output(chord_counts: dict, args: argparse.Namespace) -> str:
    """Format output as human-readable text"""
    if not chord_counts:
        return "No chords found.\n"
    
    lines = ["Chord Counts:\n", "-" * 30 + "\n"]
    for chord, count in chord_counts.items():
        lines.append(f"{chord:15} {count:>6}\n")
    return "".join(lines)


def format_json_output(chord_counts: dict, args: argparse.Namespace) -> str:
    """Format output as JSON"""
    import json
    return json.dumps(chord_counts, indent=2) + "\n"


def format_csv_output(chord_counts: dict, args: argparse.Namespace) -> str:
    """Format output as CSV"""
    lines = ["chord,count\n"]
    for chord, count in chord_counts.items():
        lines.append(f"{chord},{count}\n")
    return "".join(lines)


if __name__ == '__main__':
    main()

