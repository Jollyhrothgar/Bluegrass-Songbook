"""
Tests for structure detection
"""

import pytest
from bs4 import BeautifulSoup
from src.songbook import StructureDetector


class TestStructureDetector:
    """Tests for StructureDetector.detect_structure_type()"""

    def test_detect_pre_plain_structure(self, sample_html_pre_plain):
        """Should detect pre_plain structure"""
        soup = BeautifulSoup(sample_html_pre_plain, 'html.parser')
        result = StructureDetector.detect_structure_type(soup)
        assert result == 'pre_plain'

    def test_detect_pre_tag_structure(self, sample_html_pre_tag):
        """Should detect pre_tag structure"""
        soup = BeautifulSoup(sample_html_pre_tag, 'html.parser')
        result = StructureDetector.detect_structure_type(soup)
        assert result == 'pre_tag'

    def test_detect_no_structure_for_empty_html(self):
        """Should return None for empty HTML"""
        soup = BeautifulSoup("<html><body></body></html>", 'html.parser')
        result = StructureDetector.detect_structure_type(soup)
        assert result is None
