"""
Songbook - A toolkit for parsing, analyzing, and searching song collections

Modules:
- parser: HTML to ChordPro conversion
- analysis: Key detection and chord normalization (coming soon)
- search: Search index building (coming soon)
"""

from .parser import (
    # Data structures
    Song,
    SongContent,
    Paragraph,
    SongLine,
    ChordPosition,
    # Parser components
    StructureDetector,
    ContentExtractor,
    ChordProGenerator,
    HTMLNormalizer,
    ChordDetector,
    MetadataExtractor,
    # Validation
    ValidationIssue,
    ValidationResult,
    StructuralValidator,
    ComparisonValidator,
    BatchValidator,
    # Batch processing
    BatchProcessor,
)

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
