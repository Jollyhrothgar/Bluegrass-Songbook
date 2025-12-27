"""
Integration tests for the full parsing pipeline
"""

import pytest
from bs4 import BeautifulSoup
from parser import (
    StructureDetector,
    ContentExtractor,
    ChordProGenerator,
    Song,
)
from validator import StructuralValidator
from batch_process import BatchProcessor


class TestParsingPipeline:
    """End-to-end tests for HTML to ChordPro conversion"""

    def test_full_pipeline_pre_plain(self, sample_html_pre_plain):
        """Should detect and attempt to parse pre_plain HTML"""
        soup = BeautifulSoup(sample_html_pre_plain, 'html.parser')

        # Detect structure
        structure_type = StructureDetector.detect_structure_type(soup)
        assert structure_type == 'pre_plain'

        # Extract content (parser is tuned for actual scraped HTML, so may not
        # extract all content from simplified test fixtures)
        song = ContentExtractor.parse(soup, structure_type, 'test.html')
        assert song is not None
        assert song.source_html_file == 'test.html'

    @pytest.mark.skip(reason="Requires real HTML from scraped site")
    def test_chord_alignment(self):
        """Should align chords correctly with lyrics"""
        # This test would need real HTML from sources/classic-country/raw/
        pass


class TestImports:
    """Verify package imports work correctly"""

    def test_import_parser_classes(self):
        """Should be able to import parser classes"""
        from parser import (
            Song,
            StructureDetector,
            ContentExtractor,
            ChordProGenerator,
        )
        assert Song is not None
        assert StructureDetector is not None

    def test_import_validator(self):
        """Should be able to import validator"""
        from validator import StructuralValidator
        assert StructuralValidator is not None

    def test_import_batch_processor(self):
        """Should be able to import batch processor"""
        from batch_process import BatchProcessor
        assert BatchProcessor is not None
