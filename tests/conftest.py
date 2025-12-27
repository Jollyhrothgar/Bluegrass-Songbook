"""
Pytest configuration and shared fixtures
"""

import sys
from pathlib import Path

import pytest

# Add source directories to Python path for imports
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "classic-country" / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))


@pytest.fixture
def fixtures_path():
    """Path to test fixtures directory"""
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_html_pre_plain():
    """Sample pre_plain structure HTML"""
    return """
    <html>
    <body>
    <pre>
    Test Song Title
    Recorded by Test Artist
    Written by Test Composer

    G               C            D
    This is a test lyric line here
    G                    D       G
    Another line of lyrics too
    </pre>
    </body>
    </html>
    """


@pytest.fixture
def sample_html_pre_tag():
    """Sample pre_tag structure HTML"""
    return """
    <html>
    <body>
    <pre>
    <font face="Courier New">
    <span>Test Song Title</span><br>
    <span>Recorded by Test Artist</span><br>
    <span>Written by Test Composer</span><br>
    <br>
    <span>G               C            D</span><br>
    <span>This is a test lyric line here</span><br>
    </font>
    </pre>
    </body>
    </html>
    """
