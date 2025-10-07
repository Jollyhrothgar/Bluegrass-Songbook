#!/usr/bin/env python3
"""
Batch processor for converting HTML files to ChordPro format
Uses multithreading for efficient processing of large corpus
"""

import json
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Tuple
import time
from bs4 import BeautifulSoup

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

from src.chordpro_parser import (
    StructureDetector, ContentExtractor, ChordProGenerator
)


class BatchProcessor:
    """Process HTML files to ChordPro format in parallel"""

    def __init__(self, input_dir: str, output_dir: str, max_workers: int = 8):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.max_workers = max_workers
        self.results = {
            'success': [],
            'failed': [],
            'total': 0,
            'start_time': None,
            'end_time': None
        }

    def process_file(self, html_file: Path) -> Tuple[bool, str, str]:
        """
        Process a single HTML file to ChordPro
        Returns: (success, filename, error_or_structure_type)
        """
        try:
            with open(html_file, 'r', encoding='utf-8', errors='ignore') as f:
                html_content = f.read()

            # Parse
            soup = BeautifulSoup(html_content, 'html.parser')
            structure_type = StructureDetector.detect_structure_type(soup)

            if not structure_type:
                return False, html_file.name, "Could not determine structure type"

            song = ContentExtractor.parse(soup, structure_type, html_file.name)
            chordpro = ChordProGenerator.song_to_chordpro(song)

            # Write output file
            output_file = self.output_dir / f"{html_file.stem}.pro"
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(chordpro)

            return True, html_file.name, structure_type

        except Exception as e:
            return False, html_file.name, str(e)

    def process_all(self, pattern: str = "*.html") -> Dict:
        """Process all HTML files matching pattern"""
        # Ensure output directory exists
        self.output_dir.mkdir(exist_ok=True)

        # Get all HTML files
        html_files = list(self.input_dir.glob(pattern))
        self.results['total'] = len(html_files)
        self.results['start_time'] = time.time()

        print(f"Found {len(html_files)} HTML files to process")
        print(f"Using {self.max_workers} worker threads")
        print(f"Output directory: {self.output_dir}")
        print("-" * 60)

        # Process files in parallel
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all tasks
            future_to_file = {
                executor.submit(self.process_file, html_file): html_file
                for html_file in html_files
            }

            # Process results as they complete
            completed = 0
            for future in as_completed(future_to_file):
                completed += 1
                success, filename, info = future.result()

                if success:
                    self.results['success'].append({
                        'file': filename,
                        'structure_type': info
                    })
                else:
                    self.results['failed'].append({
                        'file': filename,
                        'error': info
                    })

                # Progress update every 100 files
                if completed % 100 == 0:
                    success_rate = len(self.results['success']) / completed * 100
                    print(f"Processed {completed}/{len(html_files)} files "
                          f"({success_rate:.1f}% success)")

        self.results['end_time'] = time.time()
        return self.results

    def generate_report(self) -> str:
        """Generate summary report"""
        duration = self.results['end_time'] - self.results['start_time']
        success_count = len(self.results['success'])
        failed_count = len(self.results['failed'])
        total = self.results['total']
        success_rate = (success_count / total * 100) if total > 0 else 0

        report = []
        report.append("=" * 60)
        report.append("BATCH PROCESSING REPORT")
        report.append("=" * 60)
        report.append(f"Total files:     {total}")
        report.append(f"Successful:      {success_count} ({success_rate:.1f}%)")
        report.append(f"Failed:          {failed_count} ({100-success_rate:.1f}%)")
        report.append(f"Duration:        {duration:.1f} seconds")
        report.append(f"Speed:           {total/duration:.1f} files/second")
        report.append("")

        # Structure type breakdown
        structure_counts = {}
        for item in self.results['success']:
            stype = item['structure_type']
            structure_counts[stype] = structure_counts.get(stype, 0) + 1

        report.append("Structure Types:")
        for stype, count in sorted(structure_counts.items()):
            pct = count / success_count * 100
            report.append(f"  {stype:15} {count:6} ({pct:.1f}%)")
        report.append("")

        # Error breakdown (top 10)
        if self.results['failed']:
            error_counts = {}
            for item in self.results['failed']:
                error = item['error']
                # Truncate long errors
                if len(error) > 50:
                    error = error[:47] + "..."
                error_counts[error] = error_counts.get(error, 0) + 1

            report.append("Top Error Types:")
            for error, count in sorted(error_counts.items(), key=lambda x: -x[1])[:10]:
                report.append(f"  [{count:4}] {error}")
            report.append("")

        report.append("=" * 60)

        return "\n".join(report)

    def save_detailed_report(self, filepath: str):
        """Save detailed JSON report"""
        with open(filepath, 'w') as f:
            json.dump(self.results, f, indent=2)
        print(f"Detailed report saved to: {filepath}")


def main():
    """Main entry point"""
    # Configuration
    input_dir = "html"
    output_dir = "output"
    max_workers = 16  # Adjust based on CPU cores

    # Create processor
    processor = BatchProcessor(input_dir, output_dir, max_workers)

    # Process all files
    print("Starting batch processing...")
    print()
    results = processor.process_all()

    # Generate and display report
    print()
    print(processor.generate_report())

    # Save detailed report
    processor.save_detailed_report("batch_processing_report.json")

    # Exit code based on success rate
    success_rate = len(results['success']) / results['total'] * 100
    if success_rate < 95:
        print(f"\nWARNING: Success rate ({success_rate:.1f}%) below 95% threshold")
        sys.exit(1)
    else:
        print(f"\nSUCCESS: {success_rate:.1f}% success rate achieved!")
        sys.exit(0)


if __name__ == '__main__':
    main()
