"""
ChordPro Parser - Convert HTML song files to ChordPro format

This package provides tools for parsing HTML song files from
classic-country-song-lyrics.com and converting them to ChordPro format.
"""

from .parser import (
    Song,
    SongContent,
    Paragraph,
    SongLine,
    ChordPosition,
    StructureDetector,
    ContentExtractor,
    ChordProGenerator,
    HTMLNormalizer,
    ChordDetector,
    MetadataExtractor
)

from .validator import (
    ValidationIssue,
    ValidationResult,
    StructuralValidator,
    ComparisonValidator,
    BatchValidator
)

from .batch_processor import BatchProcessor

__version__ = "0.1.0"

__all__ = [
    # Data structures
    'Song',
    'SongContent',
    'Paragraph',
    'SongLine',
    'ChordPosition',
    # Parser components
    'StructureDetector',
    'ContentExtractor',
    'ChordProGenerator',
    'HTMLNormalizer',
    'ChordDetector',
    'MetadataExtractor',
    # Validation
    'ValidationIssue',
    'ValidationResult',
    'StructuralValidator',
    'ComparisonValidator',
    'BatchValidator',
    # Batch processing
    'BatchProcessor',
]
