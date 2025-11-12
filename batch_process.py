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
    StructureDetector, ContentExtractor, ChordProGenerator, StructuralValidator
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

    def process_file(self, html_file: Path) -> Tuple[bool, str, str, Dict]:
        """
        Process a single HTML file to ChordPro
        Returns: (success, filename, error_or_structure_type, quality_metrics)
        """
        quality_metrics = {
            'has_content': False,
            'paragraph_count': 0,
            'total_lines': 0,
            'lines_with_chords': 0,
            'lines_with_lyrics': 0,
            'confidence': 0.0,
            'quality_status': 'unknown'
        }
        
        try:
            with open(html_file, 'r', encoding='utf-8', errors='ignore') as f:
                html_content = f.read()

            # Parse
            soup = BeautifulSoup(html_content, 'html.parser')
            structure_type = StructureDetector.detect_structure_type(soup)

            if not structure_type:
                return False, html_file.name, "Could not determine structure type", quality_metrics

            song = ContentExtractor.parse(soup, structure_type, html_file.name)
            
            # Validate quality
            validation_result = StructuralValidator.validate(song)
            quality_metrics.update({
                'has_content': validation_result.metrics.get('has_content', False),
                'paragraph_count': validation_result.metrics.get('paragraph_count', 0),
                'total_lines': validation_result.metrics.get('total_lines', 0),
                'lines_with_chords': validation_result.metrics.get('lines_with_chords', 0),
                'lines_with_lyrics': validation_result.metrics.get('lines_with_lyrics', 0),
                'confidence': validation_result.confidence,
                'quality_status': BatchProcessor._determine_quality_status(song, validation_result)
            })
            
            chordpro = ChordProGenerator.song_to_chordpro(song)

            # Write output file
            output_file = self.output_dir / f"{html_file.stem}.pro"
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(chordpro)

            return True, html_file.name, structure_type, quality_metrics

        except Exception as e:
            return False, html_file.name, str(e), quality_metrics
    
    @staticmethod
    def _determine_quality_status(song, validation_result) -> str:
        """
        Determine quality status: 'complete', 'incomplete', or 'minimal'
        """
        metrics = validation_result.metrics
        
        # Check if has any content at all
        if not metrics.get('has_content', False) or metrics.get('paragraph_count', 0) == 0:
            return 'minimal'
        
        paragraph_count = metrics.get('paragraph_count', 0)
        total_lines = metrics.get('total_lines', 0)
        lines_with_chords = metrics.get('lines_with_chords', 0)
        lines_with_lyrics = metrics.get('lines_with_lyrics', 0)
        
        # Complete: Has multiple paragraphs, substantial lines, and both chords and lyrics
        if (paragraph_count >= 2 and 
            total_lines >= 10 and 
            lines_with_chords >= 3 and 
            lines_with_lyrics >= 5):
            return 'complete'
        
        # Incomplete: Has some content but not enough
        if (paragraph_count >= 1 and 
            total_lines >= 3 and 
            (lines_with_chords > 0 or lines_with_lyrics > 0)):
            return 'incomplete'
        
        # Minimal: Just metadata or very little content
        return 'minimal'

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
                success, filename, info, quality_metrics = future.result()

                if success:
                    self.results['success'].append({
                        'file': filename,
                        'structure_type': info,
                        'quality': quality_metrics
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
        
        # Quality breakdown
        quality_counts = {'complete': 0, 'incomplete': 0, 'minimal': 0}
        for item in self.results['success']:
            quality = item.get('quality', {}).get('quality_status', 'unknown')
            if quality in quality_counts:
                quality_counts[quality] += 1
        
        report.append("Content Quality:")
        report.append(f"  Complete:      {quality_counts['complete']:6} ({quality_counts['complete']/success_count*100:.1f}%)")
        report.append(f"  Incomplete:    {quality_counts['incomplete']:6} ({quality_counts['incomplete']/success_count*100:.1f}%)")
        report.append(f"  Minimal:       {quality_counts['minimal']:6} ({quality_counts['minimal']/success_count*100:.1f}%)")
        report.append("")
        
        # Quality metrics summary
        if self.results['success']:
            avg_confidence = sum(item.get('quality', {}).get('confidence', 0) for item in self.results['success']) / success_count
            avg_paragraphs = sum(item.get('quality', {}).get('paragraph_count', 0) for item in self.results['success']) / success_count
            avg_lines = sum(item.get('quality', {}).get('total_lines', 0) for item in self.results['success']) / success_count
            
            report.append("Quality Metrics (averages):")
            report.append(f"  Avg confidence:  {avg_confidence:.2%}")
            report.append(f"  Avg paragraphs:  {avg_paragraphs:.1f}")
            report.append(f"  Avg lines:       {avg_lines:.1f}")
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
