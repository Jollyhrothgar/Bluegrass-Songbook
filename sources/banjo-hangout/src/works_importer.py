"""Works integration for Banjo Hangout tabs.

Matches tabs to existing works and creates new works as needed.
"""

import json
import re
import shutil
import unicodedata
from datetime import date
from pathlib import Path
from typing import Optional

import yaml

from catalog import TabCatalog, TabEntry


# Paths relative to repo root
REPO_ROOT = Path(__file__).parent.parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'
PARSED_DIR = Path(__file__).parent.parent / 'parsed'


def slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    # Normalize unicode
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')

    # Lowercase and replace spaces/special chars
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = text.strip('-')

    # Collapse multiple dashes
    text = re.sub(r'-+', '-', text)

    return text


def normalize_title(title: str) -> str:
    """Normalize title for matching."""
    # Remove common suffixes
    title = re.sub(r'\s*\([^)]*\)\s*$', '', title)  # (key), (version)
    title = re.sub(r'\s*-\s*(tab|banjo|break|solo|arr\.?).*$', '', title, flags=re.I)
    title = re.sub(r'\s*banjo\s*(tab|break|solo)?$', '', title, flags=re.I)

    # Normalize case and whitespace
    title = ' '.join(title.lower().split())

    return title


def find_matching_work(title: str) -> Optional[Path]:
    """Find an existing work that matches this title.

    Returns the work directory path if found, None otherwise.
    """
    normalized = normalize_title(title)
    slug = slugify(normalized)

    # Try exact slug match first
    exact_path = WORKS_DIR / slug
    if exact_path.exists() and (exact_path / 'work.yaml').exists():
        return exact_path

    # Try scanning all works for a normalized title match
    # This catches cases where the slug doesn't exactly match
    for work_dir in WORKS_DIR.iterdir():
        if not work_dir.is_dir():
            continue
        work_yaml = work_dir / 'work.yaml'
        if not work_yaml.exists():
            continue

        try:
            data = yaml.safe_load(work_yaml.read_text())
            work_title = normalize_title(data.get('title', ''))
            if work_title == normalized:
                return work_dir
        except Exception:
            continue

    return None


def load_work(work_dir: Path) -> dict:
    """Load work.yaml from a work directory."""
    work_yaml = work_dir / 'work.yaml'
    return yaml.safe_load(work_yaml.read_text())


def save_work(work_dir: Path, work_data: dict):
    """Save work.yaml to a work directory."""
    work_yaml = work_dir / 'work.yaml'
    work_yaml.write_text(yaml.dump(
        work_data,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False
    ))


def create_new_work(tab: TabEntry, otf_path: Path) -> Path:
    """Create a new work from a tab entry.

    Returns the work directory path.
    """
    normalized = normalize_title(tab.title)
    slug = slugify(normalized)

    # Handle slug conflicts
    work_dir = WORKS_DIR / slug
    suffix = 1
    while work_dir.exists():
        work_dir = WORKS_DIR / f"{slug}-{suffix}"
        suffix += 1

    work_dir.mkdir(parents=True, exist_ok=True)

    # Copy OTF file
    otf_filename = 'banjo.otf.json'
    shutil.copy2(otf_path, work_dir / otf_filename)

    # Create work.yaml
    work_data = {
        'id': work_dir.name,
        'title': tab.title,
        'artist': None,  # Traditional/unknown for tabs
        'composers': [tab.author] if tab.author and tab.author != 'unknown' else [],
        'default_key': tab.key,
        'tags': build_tags(tab),
        'parts': [
            {
                'type': 'tablature',
                'instrument': 'banjo',
                'format': 'otf',
                'file': otf_filename,
                'default': True,
                'provenance': {
                    'source': 'banjo-hangout',
                    'source_url': tab.source_url,
                    'author': tab.author,
                    'imported_at': str(date.today()),
                },
            }
        ],
    }

    save_work(work_dir, work_data)
    return work_dir


def add_part_to_work(work_dir: Path, tab: TabEntry, otf_path: Path) -> bool:
    """Add a banjo tab part to an existing work.

    Returns True if the part was added, False if already exists.
    """
    work_data = load_work(work_dir)

    # Check if a banjo tab already exists
    for part in work_data.get('parts', []):
        if part.get('type') == 'tablature' and part.get('instrument') == 'banjo':
            # Already has a banjo tab, skip
            return False

    # Copy OTF file
    otf_filename = 'banjo.otf.json'
    shutil.copy2(otf_path, work_dir / otf_filename)

    # Add part
    new_part = {
        'type': 'tablature',
        'instrument': 'banjo',
        'format': 'otf',
        'file': otf_filename,
        'provenance': {
            'source': 'banjo-hangout',
            'source_url': tab.source_url,
            'author': tab.author,
            'imported_at': str(date.today()),
        },
    }

    # Add tags if work doesn't have them
    existing_tags = set(work_data.get('tags', []))
    for tag in build_tags(tab):
        if tag not in existing_tags:
            if 'tags' not in work_data:
                work_data['tags'] = []
            work_data['tags'].append(tag)

    if 'parts' not in work_data:
        work_data['parts'] = []
    work_data['parts'].append(new_part)

    save_work(work_dir, work_data)
    return True


def build_tags(tab: TabEntry) -> list[str]:
    """Build tags from Banjo Hangout metadata."""
    tags = ['Instrumental']  # All tabs are instrumentals

    # Genre mapping
    genre_map = {
        'bluegrass': 'Bluegrass',
        'old-time': 'OldTime',
        'old time': 'OldTime',
        'oldtime': 'OldTime',
        'folk': 'Folk',
        'gospel': 'Gospel',
        'blues': 'Blues',
    }

    if tab.genre:
        genre_lower = tab.genre.lower()
        for pattern, tag in genre_map.items():
            if pattern in genre_lower:
                tags.append(tag)
                break

    # Style mapping
    style_map = {
        'scruggs': 'Scruggs',
        'melodic': 'Melodic',
        'clawhammer': 'Clawhammer',
    }

    if tab.style:
        style_lower = tab.style.lower()
        for pattern, tag in style_map.items():
            if pattern in style_lower:
                tags.append(tag)
                break

    return tags


def import_tab(catalog: TabCatalog, tab: TabEntry) -> Optional[str]:
    """Import a single converted tab to works/.

    Returns the work slug if successful, None otherwise.
    """
    # Find the converted OTF file
    otf_path = PARSED_DIR / f"{tab.id}.otf.json"
    if not otf_path.exists():
        print(f"  Error: OTF file not found: {otf_path}")
        return None

    # Try to match to existing work
    matching_work = find_matching_work(tab.title)

    if matching_work:
        # Add to existing work
        if add_part_to_work(matching_work, tab, otf_path):
            print(f"  Added to existing work: {matching_work.name}")
            return matching_work.name
        else:
            print(f"  Skipped: work {matching_work.name} already has banjo tab")
            return None
    else:
        # Create new work
        work_dir = create_new_work(tab, otf_path)
        print(f"  Created new work: {work_dir.name}")
        return work_dir.name


def batch_import(catalog: TabCatalog, limit: int = None, dry_run: bool = False) -> int:
    """Import all importable tabs to works/.

    Args:
        catalog: TabCatalog with tab entries
        limit: Maximum number to import
        dry_run: If True, just print what would be done

    Returns:
        Number of tabs imported
    """
    importable = catalog.get_importable()
    if limit:
        importable = importable[:limit]

    if dry_run:
        print(f"\n[DRY RUN] Would import {len(importable)} tabs:")
        for tab in importable[:20]:
            matching = find_matching_work(tab.title)
            if matching:
                print(f"  {tab.title} -> add to {matching.name}")
            else:
                print(f"  {tab.title} -> create new work")
        if len(importable) > 20:
            print(f"  ... and {len(importable) - 20} more")
        return 0

    imported_count = 0
    for tab in importable:
        print(f"Importing: {tab.title}")
        work_slug = import_tab(catalog, tab)

        if work_slug:
            catalog.update_status(tab.id, 'imported')
            catalog.set_work_slug(tab.id, work_slug)
            imported_count += 1
        else:
            catalog.update_status(tab.id, 'skipped', 'Could not import')

    catalog.save()
    return imported_count
