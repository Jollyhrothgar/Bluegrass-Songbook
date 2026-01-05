"""Tab catalog management for Banjo Hangout.

Tracks discovered tabs, download status, and conversion status.
"""

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class TabEntry:
    """A single tab entry in the catalog."""
    id: str                          # Banjo Hangout tab ID
    title: str                       # Tab title
    author: str                      # Username who uploaded
    format: str                      # 'tef', 'pdf', 'txt', 'mp3', 'midi'
    source_url: str                  # Full URL to tab page

    # Optional metadata from Banjo Hangout
    genre: Optional[str] = None      # e.g., 'Bluegrass', 'Old-Time'
    style: Optional[str] = None      # e.g., 'Scruggs', 'Clawhammer'
    tuning: Optional[str] = None     # e.g., 'Open G', 'Double C'
    key: Optional[str] = None        # e.g., 'G', 'C'
    difficulty: Optional[str] = None # e.g., 'Beginner', 'Intermediate', 'Expert'

    # Status tracking
    status: str = 'pending'          # pending, downloaded, converted, matched, imported, skipped, error
    error: Optional[str] = None      # Error message if status is 'error'

    # Timestamps
    discovered_at: Optional[str] = None
    downloaded_at: Optional[str] = None
    converted_at: Optional[str] = None
    imported_at: Optional[str] = None

    # Links to artifacts
    work_slug: Optional[str] = None  # Matched/created work slug

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class CatalogMetadata:
    """Catalog-level metadata."""
    source: str = 'banjo-hangout'
    last_scan: Optional[str] = None
    total_tabs: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


class TabCatalog:
    """Manages the tab catalog for Banjo Hangout."""

    def __init__(self, catalog_path: Path):
        self.catalog_path = catalog_path
        self.metadata = CatalogMetadata()
        self.tabs: dict[str, TabEntry] = {}

        if self.catalog_path.exists():
            self.load()

    def load(self) -> None:
        """Load catalog from JSON file."""
        data = json.loads(self.catalog_path.read_text())

        # Load metadata
        meta = data.get('metadata', {})
        self.metadata = CatalogMetadata(
            source=meta.get('source', 'banjo-hangout'),
            last_scan=meta.get('last_scan'),
            total_tabs=meta.get('total_tabs', 0),
        )

        # Load tabs
        self.tabs = {}
        for tab_id, tab_data in data.get('tabs', {}).items():
            self.tabs[tab_id] = TabEntry(**tab_data)

    def save(self) -> None:
        """Save catalog to JSON file."""
        self.metadata.total_tabs = len(self.tabs)

        data = {
            'metadata': self.metadata.to_dict(),
            'tabs': {tab_id: tab.to_dict() for tab_id, tab in self.tabs.items()},
        }

        self.catalog_path.parent.mkdir(parents=True, exist_ok=True)
        self.catalog_path.write_text(json.dumps(data, indent=2))

    def add_tab(self, tab: TabEntry) -> None:
        """Add or update a tab entry."""
        if tab.id not in self.tabs:
            tab.discovered_at = datetime.now().isoformat()
        self.tabs[tab.id] = tab

    def get_tab(self, tab_id: str) -> Optional[TabEntry]:
        """Get a tab by ID."""
        return self.tabs.get(tab_id)

    def update_status(self, tab_id: str, status: str, error: Optional[str] = None) -> None:
        """Update the status of a tab."""
        if tab_id in self.tabs:
            self.tabs[tab_id].status = status
            self.tabs[tab_id].error = error

            # Update timestamp based on status
            now = datetime.now().isoformat()
            if status == 'downloaded':
                self.tabs[tab_id].downloaded_at = now
            elif status == 'converted':
                self.tabs[tab_id].converted_at = now
            elif status in ('matched', 'imported'):
                self.tabs[tab_id].imported_at = now

    def set_work_slug(self, tab_id: str, work_slug: str) -> None:
        """Set the work slug for a matched/imported tab."""
        if tab_id in self.tabs:
            self.tabs[tab_id].work_slug = work_slug

    def get_by_status(self, status: str) -> list[TabEntry]:
        """Get all tabs with a specific status."""
        return [tab for tab in self.tabs.values() if tab.status == status]

    def get_tef_tabs(self) -> list[TabEntry]:
        """Get all tabs in TEF format."""
        return [tab for tab in self.tabs.values() if tab.format == 'tef']

    def get_downloadable(self) -> list[TabEntry]:
        """Get tabs that are ready to download (pending TEF tabs)."""
        return [
            tab for tab in self.tabs.values()
            if tab.status == 'pending' and tab.format == 'tef'
        ]

    def get_convertible(self) -> list[TabEntry]:
        """Get tabs that are ready to convert (downloaded TEF tabs)."""
        return [
            tab for tab in self.tabs.values()
            if tab.status == 'downloaded' and tab.format == 'tef'
        ]

    def get_importable(self) -> list[TabEntry]:
        """Get tabs that are ready to import (converted tabs)."""
        return [
            tab for tab in self.tabs.values()
            if tab.status == 'converted'
        ]

    def stats(self) -> dict:
        """Get catalog statistics."""
        status_counts = {}
        format_counts = {}

        for tab in self.tabs.values():
            status_counts[tab.status] = status_counts.get(tab.status, 0) + 1
            format_counts[tab.format] = format_counts.get(tab.format, 0) + 1

        return {
            'total': len(self.tabs),
            'by_status': status_counts,
            'by_format': format_counts,
        }

    def update_scan_time(self) -> None:
        """Update the last scan timestamp."""
        self.metadata.last_scan = datetime.now().isoformat()
