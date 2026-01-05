#!/usr/bin/env python3
"""Batch convert TEF files to OTF format with validation and logging.

Uses catalog metadata for:
- Title fallback when TEF title is invalid
- Author attribution
- Genre/style → tags mapping
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from tef_parser.reader import TEFReader
from tef_parser.otf import tef_to_otf
from catalog import TabCatalog, TabEntry


# Genre/style to tag mapping
GENRE_TAG_MAP = {
    'bluegrass': 'Bluegrass',
    'old time': 'OldTime',
    'old-time': 'OldTime',
    'folk': 'Folk',
    'gospel': 'Gospel',
    'blues': 'Blues',
    'country': 'ClassicCountry',
}

STYLE_TAG_MAP = {
    'scruggs': 'Scruggs',
    'bluegrass (scruggs)': 'Scruggs',
    'melodic': 'Melodic',
    'clawhammer': 'Clawhammer',
    'clawhammer and old-time': 'Clawhammer',
}


def map_to_tags(genre: Optional[str], style: Optional[str]) -> list[str]:
    """Map BH genre/style to songbook tags."""
    tags = ['Instrumental']  # All tabs are instrumentals

    if genre:
        genre_lower = genre.lower()
        for pattern, tag in GENRE_TAG_MAP.items():
            if pattern in genre_lower:
                if tag not in tags:
                    tags.append(tag)
                break

    if style:
        style_lower = style.lower()
        for pattern, tag in STYLE_TAG_MAP.items():
            if pattern in style_lower:
                if tag not in tags:
                    tags.append(tag)
                break

    return tags


def slugify(title: str) -> str:
    """Convert title to URL-friendly slug."""
    slug = title.lower()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s_]+', '-', slug)
    slug = re.sub(r'-+', '-', slug)
    return slug.strip('-')[:50]


def clean_title(title: str) -> str:
    """Clean up title by removing file extensions and null bytes."""
    if not title:
        return ""
    # Remove null bytes
    title = title.replace('\x00', '').strip()
    # Remove common file extensions
    for ext in ['.tef', '.TEF', '_tef', '_TEF']:
        if title.endswith(ext):
            title = title[:-len(ext)]
    return title.strip()


def is_valid_title(title: str) -> bool:
    """Check if title is valid (not just filename, no nulls, meaningful)."""
    title = clean_title(title)
    if not title:
        return False
    if re.match(r'^\d+$', title):  # Just numbers
        return False
    if len(title) < 2:
        return False
    return True


def extract_tef_metadata(tef) -> dict:
    """Extract TEF metadata for provenance tracking."""
    meta = {
        'format_version': 'v2' if tef.header.is_v2 else 'v3',
        'time_signature': f"{tef.header.v2_time_num}/{tef.header.v2_time_denom}" if tef.header.is_v2 else None,
    }

    if tef.header.is_v2:
        meta['v2_title'] = tef.header.v2_title or None
        meta['v2_composer'] = tef.header.v2_composer or None

    # Track info
    meta['tracks'] = len(tef.instruments) if tef.instruments else 0
    meta['note_events'] = len(tef.note_events)

    return {k: v for k, v in meta.items() if v is not None}


def convert_tef_file(
    tef_path: Path,
    works_dir: Path,
    tabs_dir: Path,
    catalog_entry: Optional[TabEntry] = None
) -> dict:
    """Convert a single TEF file. Returns status dict.

    Args:
        tef_path: Path to TEF file
        works_dir: Directory for work output
        tabs_dir: Directory for tab files (docs/data/tabs)
        catalog_entry: Optional catalog entry with BH metadata for fallback
    """
    tef_id = tef_path.stem.replace('_tef', '')

    result = {
        'tef_id': tef_id,
        'tef_file': tef_path.name,
        'status': 'unknown',
        'slug': None,
        'title': None,
        'error': None,
        'tef_metadata': None,
        'catalog_metadata': None,
    }

    # Extract catalog metadata if available
    if catalog_entry:
        result['catalog_metadata'] = {
            'title': catalog_entry.title,
            'author': catalog_entry.author,
            'genre': catalog_entry.genre,
            'style': catalog_entry.style,
            'key': catalog_entry.key,
            'tuning': catalog_entry.tuning,
            'difficulty': catalog_entry.difficulty,
            'source_url': catalog_entry.source_url,
        }

    try:
        # Parse TEF
        reader = TEFReader(tef_path)
        tef = reader.parse()

        # Extract metadata for logging
        result['tef_metadata'] = extract_tef_metadata(tef)
        result['title'] = tef.title

        # Determine title: prefer catalog, fallback to TEF
        raw_tef_title = tef.title or tef_path.stem
        tef_title = clean_title(raw_tef_title)
        tef_title_valid = is_valid_title(raw_tef_title)

        # Use catalog title if TEF title is invalid
        if catalog_entry and catalog_entry.title:
            title = catalog_entry.title
            result['title_source'] = 'catalog'
        elif tef_title_valid:
            title = tef_title
            result['title_source'] = 'tef'
        else:
            result['status'] = 'skipped'
            result['error'] = f'Invalid title (TEF: {repr(raw_tef_title)}, catalog: {catalog_entry.title if catalog_entry else "none"})'
            return result

        # Convert to OTF (pass catalog tuning if available)
        tuning_override = catalog_entry.tuning if catalog_entry else None
        otf = tef_to_otf(tef, tuning_override=tuning_override)
        otf_json = otf.to_json()
        otf_data = json.loads(otf_json)

        # Validate notation has content
        notation = otf_data.get('notation', {})
        total_events = sum(
            len(m.get('events', []))
            for measures in notation.values()
            if isinstance(measures, list)
            for m in measures
        )

        if total_events == 0:
            result['status'] = 'skipped'
            result['error'] = f'Empty notation (0 events) - format: {result["tef_metadata"].get("format_version")}'
            return result

        # Create slug
        slug = slugify(title)
        if not slug:
            slug = f'banjo-tab-{tef_id}'
        result['slug'] = slug

        # Create work directory
        work_dir = works_dir / slug
        work_dir.mkdir(exist_ok=True)

        # Save OTF
        (work_dir / 'banjo.otf.json').write_text(otf_json)
        (tabs_dir / f'{slug}-banjo.otf.json').write_text(otf_json)

        # Build tags from catalog metadata
        tags = map_to_tags(
            catalog_entry.genre if catalog_entry else None,
            catalog_entry.style if catalog_entry else None
        )
        tags_str = ', '.join(tags)

        # Get author from catalog
        author = catalog_entry.author if catalog_entry else 'unknown'

        # Get download URL from catalog (more accurate than page URL)
        download_url = catalog_entry.source_url if catalog_entry else f'https://www.banjohangout.org/tab/{tef_id}'

        # Create work.yaml with full provenance
        work_yaml_path = work_dir / 'work.yaml'
        tef_meta = result['tef_metadata']

        work_yaml = f'''id: {slug}
title: "{title.replace('"', '\\"')}"
tags: [{tags_str}]
parts:
  - type: tablature
    instrument: banjo
    format: otf
    file: banjo.otf.json
    default: true
    provenance:
      source: banjo-hangout
      source_id: '{tef_id}'
      source_url: {download_url}
      author: "{author}"
      imported_at: '{datetime.now().strftime("%Y-%m-%d")}'
      tef_format: {tef_meta.get('format_version', 'unknown')}
      tef_time_sig: {tef_meta.get('time_signature', 'null')}
      tef_tracks: {tef_meta.get('tracks', 0)}
      tef_events: {tef_meta.get('note_events', 0)}
'''
        work_yaml_path.write_text(work_yaml)

        result['status'] = 'success'
        result['events'] = total_events
        result['tags'] = tags

    except Exception as e:
        result['status'] = 'error'
        result['error'] = str(e)

    return result


def batch_convert(
    downloads_dir: Path,
    works_dir: Path,
    tabs_dir: Path,
    log_path: Path,
    catalog: Optional[TabCatalog] = None
):
    """Convert all TEF files with validation and logging.

    Args:
        downloads_dir: Directory containing TEF files
        works_dir: Output directory for works
        tabs_dir: Output directory for tab files
        log_path: Path to write conversion log
        catalog: Optional catalog for metadata lookup
    """
    results = {
        'timestamp': datetime.now().isoformat(),
        'summary': {'success': 0, 'skipped': 0, 'error': 0},
        'files': []
    }

    tef_files = sorted(downloads_dir.glob('*.tef'))

    for tef_path in tef_files:
        # Look up catalog entry by TEF ID
        tef_id = tef_path.stem.replace('_tef', '')
        catalog_entry = None
        if catalog:
            # Try both ID formats (with and without _tef suffix)
            catalog_entry = catalog.get_tab(f'{tef_id}_tef') or catalog.get_tab(tef_id)

        result = convert_tef_file(tef_path, works_dir, tabs_dir, catalog_entry)
        results['files'].append(result)
        results['summary'][result['status']] = results['summary'].get(result['status'], 0) + 1

    # Write log
    log_path.write_text(json.dumps(results, indent=2))

    return results


def main():
    base_dir = Path(__file__).parent.parent
    downloads_dir = base_dir / 'downloads'
    works_dir = base_dir.parent.parent / 'works'
    tabs_dir = base_dir.parent.parent / 'docs' / 'data' / 'tabs'
    log_path = base_dir / 'conversion_log.json'
    catalog_path = base_dir / 'tab_catalog.json'

    # Load catalog for metadata
    catalog = None
    if catalog_path.exists():
        catalog = TabCatalog(catalog_path)
        print(f'Loaded catalog with {len(catalog.tabs)} entries')

    print(f'Converting TEF files from {downloads_dir}...')

    results = batch_convert(downloads_dir, works_dir, tabs_dir, log_path, catalog)

    # Print summary
    s = results['summary']
    print(f"\nConversion complete:")
    print(f"  Success: {s.get('success', 0)}")
    print(f"  Skipped: {s.get('skipped', 0)}")
    print(f"  Errors:  {s.get('error', 0)}")
    print(f"\nLog written to: {log_path}")


if __name__ == '__main__':
    main()
