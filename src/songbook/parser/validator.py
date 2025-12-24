#!/usr/bin/env python3
"""
Validation framework for parsed songs

Provides multiple levels of validation:
1. Structural validation - checks data integrity
2. Sample comparison - compares against known-good outputs
3. Confidence scoring - assigns quality scores to parsed songs
"""

from dataclasses import dataclass
from typing import List, Optional, Dict, Tuple
import re

from .parser import Song, SongLine, Paragraph


@dataclass
class ValidationIssue:
    """Represents a validation problem"""
    severity: str  # 'error', 'warning', 'info'
    message: str
    location: Optional[str] = None  # e.g., "paragraph 2, line 3"


@dataclass
class ValidationResult:
    """Result of validation checks"""
    valid: bool
    confidence: float  # 0.0 to 1.0
    issues: List[ValidationIssue]
    metrics: Dict[str, any]


class StructuralValidator:
    """Validates structural integrity of parsed songs"""

    @staticmethod
    def validate(song: Song) -> ValidationResult:
        """Run all structural validation checks"""
        issues = []
        metrics = {}

        # Check metadata
        issues.extend(StructuralValidator._check_metadata(song, metrics))

        # Check song content
        issues.extend(StructuralValidator._check_content(song, metrics))

        # Check chord positions
        issues.extend(StructuralValidator._check_chord_positions(song, metrics))

        # Check playback sequence
        issues.extend(StructuralValidator._check_playback_sequence(song, metrics))

        # Calculate confidence score
        confidence = StructuralValidator._calculate_confidence(song, issues, metrics)

        # Determine if valid (no errors, only warnings/info allowed)
        valid = not any(issue.severity == 'error' for issue in issues)

        return ValidationResult(
            valid=valid,
            confidence=confidence,
            issues=issues,
            metrics=metrics
        )

    @staticmethod
    def _check_metadata(song: Song, metrics: Dict) -> List[ValidationIssue]:
        """Validate metadata fields"""
        issues = []

        if not song.title or not song.title.strip():
            issues.append(ValidationIssue('error', 'Missing or empty title'))
        else:
            metrics['has_title'] = True
            metrics['title_length'] = len(song.title)

        if not song.artist or not song.artist.strip():
            issues.append(ValidationIssue('warning', 'Missing artist information'))
        else:
            metrics['has_artist'] = True

        if song.composer:
            metrics['has_composer'] = True

        if song.recorded_by:
            metrics['has_recorded_by'] = True

        return issues

    @staticmethod
    def _check_content(song: Song, metrics: Dict) -> List[ValidationIssue]:
        """Validate song content structure"""
        issues = []

        if not song.song_content:
            issues.append(ValidationIssue('error', 'No song content found'))
            metrics['has_content'] = False
            return issues

        metrics['has_content'] = True

        if not song.song_content.paragraphs:
            issues.append(ValidationIssue('error', 'No paragraphs found'))
            metrics['paragraph_count'] = 0
            return issues

        metrics['paragraph_count'] = len(song.song_content.paragraphs)

        # Check for reasonable paragraph count (1-20 is typical)
        if metrics['paragraph_count'] > 20:
            issues.append(ValidationIssue(
                'warning',
                f'Unusually high paragraph count: {metrics["paragraph_count"]}'
            ))
        elif metrics['paragraph_count'] < 2:
            issues.append(ValidationIssue(
                'warning',
                f'Only {metrics["paragraph_count"]} paragraph(s) found - song may be incomplete'
            ))

        # Check lines per paragraph
        total_lines = 0
        lines_with_chords = 0
        lines_with_lyrics = 0

        for para_idx, para in enumerate(song.song_content.paragraphs):
            if not para.lines:
                issues.append(ValidationIssue(
                    'warning',
                    f'Empty paragraph at index {para_idx}'
                ))
                continue

            total_lines += len(para.lines)

            for line in para.lines:
                if line.chords:
                    lines_with_chords += 1
                if line.lyrics:
                    lines_with_lyrics += 1

        metrics['total_lines'] = total_lines
        metrics['lines_with_chords'] = lines_with_chords
        metrics['lines_with_lyrics'] = lines_with_lyrics

        if total_lines == 0:
            issues.append(ValidationIssue('error', 'No lines found in any paragraph'))
        elif lines_with_lyrics == 0:
            issues.append(ValidationIssue('error', 'No lyrics found in song'))
        elif lines_with_chords == 0:
            issues.append(ValidationIssue('warning', 'No chords found in song'))

        # Calculate chord/lyric ratio
        if lines_with_lyrics > 0:
            chord_ratio = lines_with_chords / lines_with_lyrics
            metrics['chord_lyric_ratio'] = chord_ratio

            # Most songs have chords on 60-100% of lyric lines
            if chord_ratio < 0.3:
                issues.append(ValidationIssue(
                    'warning',
                    f'Low chord coverage: only {chord_ratio:.1%} of lyric lines have chords'
                ))

        return issues

    @staticmethod
    def _check_chord_positions(song: Song, metrics: Dict) -> List[ValidationIssue]:
        """Validate chord position accuracy"""
        issues = []

        if not song.song_content or not song.song_content.paragraphs:
            return issues

        total_chords = 0
        position_errors = 0
        max_position_error = 0

        for para_idx, para in enumerate(song.song_content.paragraphs):
            for line_idx, line in enumerate(para.lines):
                if not line.lyrics or not line.chords:
                    continue

                lyric_length = len(line.lyrics)

                for chord in line.chords:
                    total_chords += 1

                    # Check for negative positions
                    if chord.position < 0:
                        position_errors += 1
                        issues.append(ValidationIssue(
                            'error',
                            f'Negative chord position: {chord.position}',
                            f'paragraph {para_idx}, line {line_idx}'
                        ))

                    # Check for positions beyond lyric length
                    # Allow small overflow (1-2 chars) as this can happen with alignment
                    overflow = chord.position - lyric_length
                    if overflow > 2:
                        position_errors += 1
                        max_position_error = max(max_position_error, overflow)
                        issues.append(ValidationIssue(
                            'error',
                            f'Chord position {chord.position} exceeds lyric length {lyric_length} by {overflow}',
                            f'paragraph {para_idx}, line {line_idx}, chord: {chord.chord}'
                        ))

        metrics['total_chords'] = total_chords
        metrics['chord_position_errors'] = position_errors

        if total_chords > 0:
            metrics['chord_position_error_rate'] = position_errors / total_chords

        return issues

    @staticmethod
    def _check_playback_sequence(song: Song, metrics: Dict) -> List[ValidationIssue]:
        """Validate playback sequence references"""
        issues = []

        if not song.song_content:
            return issues

        if not song.song_content.playback_sequence:
            issues.append(ValidationIssue(
                'warning',
                'Empty playback sequence'
            ))
            return issues

        para_count = len(song.song_content.paragraphs)
        metrics['playback_length'] = len(song.song_content.playback_sequence)

        for idx_pos, para_idx in enumerate(song.song_content.playback_sequence):
            if para_idx < 0 or para_idx >= para_count:
                issues.append(ValidationIssue(
                    'error',
                    f'Invalid playback sequence index: {para_idx} (only {para_count} paragraphs)',
                    f'position {idx_pos} in sequence'
                ))

        # Check if repeat instruction was parsed
        if song.song_content.raw_repeat_instruction_text:
            metrics['has_repeat_instruction'] = True

        return issues

    @staticmethod
    def _calculate_confidence(song: Song, issues: List[ValidationIssue],
                             metrics: Dict) -> float:
        """Calculate confidence score 0.0-1.0"""
        score = 1.0

        # Penalize for errors and warnings
        error_count = sum(1 for issue in issues if issue.severity == 'error')
        warning_count = sum(1 for issue in issues if issue.severity == 'warning')

        score -= error_count * 0.2  # Each error: -0.2
        score -= warning_count * 0.05  # Each warning: -0.05

        # Bonus for good metadata
        if metrics.get('has_title'):
            score += 0.05
        if metrics.get('has_artist'):
            score += 0.05
        if metrics.get('has_composer'):
            score += 0.02

        # Bonus for reasonable structure
        para_count = metrics.get('paragraph_count', 0)
        if 2 <= para_count <= 10:
            score += 0.1
        elif para_count > 10:
            score += 0.05

        # Bonus for good chord coverage
        chord_ratio = metrics.get('chord_lyric_ratio', 0)
        if chord_ratio >= 0.6:
            score += 0.1
        elif chord_ratio >= 0.3:
            score += 0.05

        # Penalty for chord position errors
        error_rate = metrics.get('chord_position_error_rate', 0)
        score -= error_rate * 0.3

        # Clamp to 0.0-1.0
        return max(0.0, min(1.0, score))


class ComparisonValidator:
    """Validates by comparing against known-good outputs"""

    @staticmethod
    def compare_with_expected(song: Song, expected_chordpro: str) -> ValidationResult:
        """Compare generated ChordPro with expected output"""
        from .parser import ChordProGenerator

        issues = []
        metrics = {}

        # Generate ChordPro from parsed song
        generated = ChordProGenerator.song_to_chordpro(song)

        # Normalize both for comparison (strip extra whitespace, etc)
        generated_normalized = ComparisonValidator._normalize_chordpro(generated)
        expected_normalized = ComparisonValidator._normalize_chordpro(expected_chordpro)

        # Compare line by line
        gen_lines = generated_normalized.split('\n')
        exp_lines = expected_normalized.split('\n')

        metrics['generated_lines'] = len(gen_lines)
        metrics['expected_lines'] = len(exp_lines)

        if len(gen_lines) != len(exp_lines):
            issues.append(ValidationIssue(
                'warning',
                f'Line count mismatch: generated {len(gen_lines)}, expected {len(exp_lines)}'
            ))

        # Compare each line
        mismatches = 0
        for i, (gen_line, exp_line) in enumerate(zip(gen_lines, exp_lines)):
            if gen_line != exp_line:
                mismatches += 1
                # Only report first few mismatches to avoid spam
                if mismatches <= 5:
                    issues.append(ValidationIssue(
                        'error',
                        f'Line {i+1} mismatch',
                        f'Expected: {exp_line[:50]}...\nGot: {gen_line[:50]}...'
                    ))

        metrics['line_mismatches'] = mismatches

        if mismatches == 0:
            confidence = 1.0
            valid = True
        else:
            # Calculate similarity
            total_lines = max(len(gen_lines), len(exp_lines))
            similarity = 1.0 - (mismatches / total_lines)
            confidence = similarity
            valid = similarity > 0.9  # Allow 10% difference

        return ValidationResult(
            valid=valid,
            confidence=confidence,
            issues=issues,
            metrics=metrics
        )

    @staticmethod
    def _normalize_chordpro(text: str) -> str:
        """Normalize ChordPro text for comparison"""
        # Remove extra blank lines
        lines = [line.rstrip() for line in text.split('\n')]
        # Remove consecutive blank lines
        normalized = []
        prev_blank = False
        for line in lines:
            is_blank = not line.strip()
            if is_blank and prev_blank:
                continue
            normalized.append(line)
            prev_blank = is_blank

        return '\n'.join(normalized)


class BatchValidator:
    """Validates entire corpus and generates statistics"""

    @staticmethod
    def validate_corpus(songs: List[Tuple[str, Song]]) -> Dict:
        """Validate a batch of songs and return statistics"""
        stats = {
            'total': len(songs),
            'valid': 0,
            'invalid': 0,
            'high_confidence': 0,  # > 0.8
            'medium_confidence': 0,  # 0.5 - 0.8
            'low_confidence': 0,  # < 0.5
            'error_count': 0,
            'warning_count': 0,
            'files_with_errors': [],
            'files_with_warnings': [],
            'confidence_scores': [],
        }

        for filename, song in songs:
            result = StructuralValidator.validate(song)

            if result.valid:
                stats['valid'] += 1
            else:
                stats['invalid'] += 1
                stats['files_with_errors'].append(filename)

            # Track confidence
            stats['confidence_scores'].append(result.confidence)

            if result.confidence > 0.8:
                stats['high_confidence'] += 1
            elif result.confidence > 0.5:
                stats['medium_confidence'] += 1
            else:
                stats['low_confidence'] += 1

            # Count issues
            errors = [i for i in result.issues if i.severity == 'error']
            warnings = [i for i in result.issues if i.severity == 'warning']

            stats['error_count'] += len(errors)
            stats['warning_count'] += len(warnings)

            if warnings and filename not in stats['files_with_errors']:
                stats['files_with_warnings'].append(filename)

        # Calculate average confidence
        if stats['confidence_scores']:
            stats['avg_confidence'] = sum(stats['confidence_scores']) / len(stats['confidence_scores'])
            stats['min_confidence'] = min(stats['confidence_scores'])
            stats['max_confidence'] = max(stats['confidence_scores'])

        return stats


if __name__ == "__main__":
    # Test with example files
    from .parser import ContentExtractor, StructureDetector
    from bs4 import BeautifulSoup

    test_files = [
        ('man_of_constant_sorrow_input.html', 'man_of_constant_sorrow_output.txt'),
        ('old_home_place_input.html', 'old_home_place_output.txt')
    ]

    print("=" * 60)
    print("VALIDATION REPORT")
    print("=" * 60)

    all_songs = []

    for html_file, expected_file in test_files:
        print(f"\n{html_file}")
        print("-" * 60)

        # Parse the HTML
        with open(html_file, 'r', encoding='utf-8') as f:
            html_content = f.read()

        soup = BeautifulSoup(html_content, 'html.parser')
        structure_type = StructureDetector.detect_structure_type(soup)
        song = ContentExtractor.parse(soup, structure_type, html_file)

        all_songs.append((html_file, song))

        # Structural validation
        result = StructuralValidator.validate(song)

        print(f"Valid: {result.valid}")
        print(f"Confidence: {result.confidence:.2%}")
        print(f"\nMetrics:")
        for key, value in result.metrics.items():
            print(f"  {key}: {value}")

        if result.issues:
            print(f"\nIssues ({len(result.issues)}):")
            for issue in result.issues:
                location = f" [{issue.location}]" if issue.location else ""
                print(f"  [{issue.severity.upper()}]{location} {issue.message}")

        # Comparison validation (if expected output exists)
        try:
            with open(expected_file, 'r', encoding='utf-8') as f:
                expected = f.read()

            comp_result = ComparisonValidator.compare_with_expected(song, expected)
            print(f"\nComparison with expected output:")
            print(f"  Match: {comp_result.valid}")
            print(f"  Similarity: {comp_result.confidence:.2%}")
            if comp_result.issues:
                print(f"  Issues: {len(comp_result.issues)}")
                for issue in comp_result.issues[:3]:  # Show first 3
                    print(f"    [{issue.severity}] {issue.message}")
        except FileNotFoundError:
            print(f"\nNo expected output file found: {expected_file}")

    # Batch statistics
    print("\n" + "=" * 60)
    print("BATCH STATISTICS")
    print("=" * 60)

    stats = BatchValidator.validate_corpus(all_songs)
    print(f"Total files: {stats['total']}")
    print(f"Valid: {stats['valid']}")
    print(f"Invalid: {stats['invalid']}")
    print(f"\nConfidence distribution:")
    print(f"  High (>80%): {stats['high_confidence']}")
    print(f"  Medium (50-80%): {stats['medium_confidence']}")
    print(f"  Low (<50%): {stats['low_confidence']}")
    print(f"\nAverage confidence: {stats['avg_confidence']:.2%}")
    print(f"Errors: {stats['error_count']}")
    print(f"Warnings: {stats['warning_count']}")
