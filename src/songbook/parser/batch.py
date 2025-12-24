#!/usr/bin/env python3
"""
Batch processor for HTML song corpus

Processes all HTML files in a directory, generates ChordPro output,
validates results, and produces comprehensive statistics.
"""

import os
import sys
import json
from pathlib import Path
from typing import List, Tuple, Optional
from dataclasses import asdict
import argparse

from bs4 import BeautifulSoup

from .parser import (
    StructureDetector, ContentExtractor, ChordProGenerator,
    Song, HTMLNormalizer
)
from .validator import StructuralValidator, BatchValidator, ValidationResult


class BatchProcessor:
    """Processes HTML files in batch"""

    def __init__(self, input_dir: str, output_dir: str, jsonl_output: Optional[str] = None):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.jsonl_output = Path(jsonl_output) if jsonl_output else None

        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Track statistics
        self.stats = {
            'total_files': 0,
            'parseable_files': 0,
            'unparseable_files': 0,
            'structure_types': {},
            'songs_parsed': [],
            'failed_files': [],
            'validation_results': []
        }

    def find_html_files(self) -> List[Path]:
        """Find all HTML files in input directory"""
        html_files = []

        for file_path in self.input_dir.rglob('*.html'):
            html_files.append(file_path)

        # Sort for consistent processing order
        return sorted(html_files)

    def process_file(self, file_path: Path) -> Tuple[Optional[Song], Optional[str]]:
        """
        Process a single HTML file

        Returns: (Song object or None, error message or None)
        """
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                html_content = f.read()
        except Exception as e:
            return None, f"Failed to read file: {e}"

        # Check if parseable
        if not StructureDetector.has_parseable_content(html_content):
            return None, "No parseable song content found"

        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            structure_type = StructureDetector.detect_structure_type(soup)

            if not structure_type:
                return None, "Could not determine HTML structure type"

            # Track structure type
            self.stats['structure_types'][structure_type] = \
                self.stats['structure_types'].get(structure_type, 0) + 1

            # Parse the song
            song = ContentExtractor.parse(soup, structure_type, str(file_path.name))

            return song, None

        except Exception as e:
            return None, f"Parse error: {e}"

    def save_outputs(self, song: Song, file_path: Path):
        """Save ChordPro and optionally JSONL output"""
        # Generate ChordPro
        chordpro = ChordProGenerator.song_to_chordpro(song)

        # Create output filename (same name, .pro extension)
        output_filename = file_path.stem + '.pro'
        output_path = self.output_dir / output_filename

        # Write ChordPro file
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(chordpro)

        # Optionally append to JSONL
        if self.jsonl_output:
            song_dict = asdict(song)
            with open(self.jsonl_output, 'a', encoding='utf-8') as f:
                f.write(json.dumps(song_dict) + '\n')

    def process_batch(self, limit: Optional[int] = None) -> dict:
        """
        Process all HTML files in batch

        Args:
            limit: Optional limit on number of files to process (for testing)

        Returns: Statistics dictionary
        """
        html_files = self.find_html_files()

        if limit:
            html_files = html_files[:limit]

        self.stats['total_files'] = len(html_files)

        print(f"Found {len(html_files)} HTML files")
        print(f"Processing...")

        # Clear JSONL file if it exists
        if self.jsonl_output and self.jsonl_output.exists():
            self.jsonl_output.unlink()

        parsed_songs = []

        for i, file_path in enumerate(html_files, 1):
            # Progress indicator
            if i % 10 == 0 or i == len(html_files):
                print(f"  Progress: {i}/{len(html_files)} ({i/len(html_files)*100:.1f}%)", end='\r')

            song, error = self.process_file(file_path)

            if error:
                self.stats['unparseable_files'] += 1
                self.stats['failed_files'].append({
                    'file': str(file_path.name),
                    'error': error
                })
                continue

            if not song:
                self.stats['unparseable_files'] += 1
                self.stats['failed_files'].append({
                    'file': str(file_path.name),
                    'error': 'Unknown parsing error'
                })
                continue

            # Successfully parsed
            self.stats['parseable_files'] += 1

            # Validate
            validation_result = StructuralValidator.validate(song)

            validation_summary = {
                'file': str(file_path.name),
                'valid': validation_result.valid,
                'confidence': validation_result.confidence,
                'errors': len([i for i in validation_result.issues if i.severity == 'error']),
                'warnings': len([i for i in validation_result.issues if i.severity == 'warning']),
                'metrics': validation_result.metrics
            }
            self.stats['validation_results'].append(validation_summary)

            # Save outputs
            try:
                self.save_outputs(song, file_path)
                parsed_songs.append((str(file_path.name), song))
            except Exception as e:
                print(f"\nError saving output for {file_path.name}: {e}")

        print()  # Clear progress line

        # Generate batch statistics
        if parsed_songs:
            batch_stats = BatchValidator.validate_corpus(parsed_songs)
            self.stats['batch_validation'] = batch_stats

        return self.stats

    def print_report(self):
        """Print processing report"""
        print("\n" + "=" * 70)
        print("BATCH PROCESSING REPORT")
        print("=" * 70)

        print(f"\nFiles Processed: {self.stats['total_files']}")
        print(f"  Parseable: {self.stats['parseable_files']}")
        print(f"  Unparseable: {self.stats['unparseable_files']}")

        if self.stats['total_files'] > 0:
            success_rate = self.stats['parseable_files'] / self.stats['total_files'] * 100
            print(f"  Success Rate: {success_rate:.1f}%")

        print(f"\nHTML Structure Types:")
        for struct_type, count in sorted(self.stats['structure_types'].items()):
            print(f"  {struct_type}: {count}")

        # Validation statistics
        if 'batch_validation' in self.stats:
            bv = self.stats['batch_validation']
            print(f"\nValidation Results:")
            print(f"  Valid: {bv['valid']}")
            print(f"  Invalid: {bv['invalid']}")
            print(f"\n  Confidence Distribution:")
            print(f"    High (>80%): {bv['high_confidence']}")
            print(f"    Medium (50-80%): {bv['medium_confidence']}")
            print(f"    Low (<50%): {bv['low_confidence']}")
            print(f"\n  Average Confidence: {bv['avg_confidence']:.2%}")
            print(f"  Total Errors: {bv['error_count']}")
            print(f"  Total Warnings: {bv['warning_count']}")

        # Show some failed files
        if self.stats['failed_files']:
            print(f"\nFailed Files (showing first 10):")
            for failure in self.stats['failed_files'][:10]:
                print(f"  {failure['file']}: {failure['error']}")

        # Show low confidence files
        low_confidence_files = [
            v for v in self.stats['validation_results']
            if v['confidence'] < 0.5
        ]
        if low_confidence_files:
            print(f"\nLow Confidence Files ({len(low_confidence_files)}):")
            for val in sorted(low_confidence_files, key=lambda x: x['confidence'])[:10]:
                print(f"  {val['file']}: {val['confidence']:.2%} "
                      f"(errors: {val['errors']}, warnings: {val['warnings']})")

        print(f"\nOutput written to: {self.output_dir}")
        if self.jsonl_output:
            print(f"JSONL written to: {self.jsonl_output}")

    def save_report(self, report_file: str):
        """Save detailed statistics to JSON file"""
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(self.stats, f, indent=2)
        print(f"\nDetailed report saved to: {report_file}")


def main():
    parser = argparse.ArgumentParser(
        description='Batch process HTML song files to ChordPro format'
    )
    parser.add_argument(
        'input_dir',
        help='Directory containing HTML files to process'
    )
    parser.add_argument(
        '-o', '--output-dir',
        default='songs/classic-country/parsed',
        help='Directory for ChordPro output files (default: songs/classic-country/parsed/)'
    )
    parser.add_argument(
        '-j', '--jsonl',
        help='Optional JSONL output file for structured data'
    )
    parser.add_argument(
        '-r', '--report',
        default='batch_report.json',
        help='JSON file for detailed statistics (default: batch_report.json)'
    )
    parser.add_argument(
        '-l', '--limit',
        type=int,
        help='Limit number of files to process (for testing)'
    )

    args = parser.parse_args()

    # Check input directory exists
    if not os.path.isdir(args.input_dir):
        print(f"Error: Input directory not found: {args.input_dir}")
        sys.exit(1)

    # Create processor
    processor = BatchProcessor(
        input_dir=args.input_dir,
        output_dir=args.output_dir,
        jsonl_output=args.jsonl
    )

    # Process batch
    print(f"Input directory: {args.input_dir}")
    print(f"Output directory: {args.output_dir}")
    if args.jsonl:
        print(f"JSONL output: {args.jsonl}")
    if args.limit:
        print(f"Processing limit: {args.limit} files")
    print()

    stats = processor.process_batch(limit=args.limit)

    # Print and save report
    processor.print_report()
    processor.save_report(args.report)


if __name__ == "__main__":
    main()
