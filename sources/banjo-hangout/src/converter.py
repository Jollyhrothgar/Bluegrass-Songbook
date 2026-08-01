"""TEF to OTF converter for Hangout Network tabs.

Converts downloaded TEF files to OTF JSON format.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import Optional

from tef_parser import TEFReader, tef_to_otf
from catalog import TabCatalog, TabEntry
from site_config import SiteConfig, resolve_instrument


def notation_sanity_error(notation: dict) -> Optional[str]:
    """Reject conversions that are structurally implausible.

    A misparsed TEF (wrong record stride, HTML saved as .tef) tends to
    produce either zero events or a handful of notes scattered across
    thousands of phantom measures. Both shapes previously sailed through
    to live pages — fail loudly instead.
    """
    total_events = 0
    distinct = 0
    max_measure = 0
    for measures in notation.values():
        if not isinstance(measures, list):
            continue
        for m in measures:
            total_events += len(m.get('events', []))
            distinct += 1
            max_measure = max(max_measure, m.get('measure', 0))
    if total_events == 0:
        return 'Empty notation (0 events)'
    if max_measure > 0 and distinct / max_measure < 0.5:
        return (f'Sparse notation ({distinct} occupied of {max_measure} '
                f'measures) — likely misparsed TEF variant')
    return None


class TEFConverter:
    """Converts TEF files to OTF JSON format."""

    def __init__(self, site: SiteConfig, downloads_dir: Path = None, output_dir: Path = None):
        self.site = site
        self.downloads_dir = downloads_dir or site.downloads_dir
        self.output_dir = output_dir or site.parsed_dir

    def convert(self, tef_path: Path, tab: TabEntry) -> tuple[Optional[Path], Optional[dict]]:
        """Convert a TEF file to OTF JSON.

        Args:
            tef_path: Path to TEF file
            tab: TabEntry with metadata for attribution

        Returns:
            (output_path, metadata) tuple, or (None, None) on failure
        """
        try:
            # Parse TEF file
            reader = TEFReader(tef_path)
            tef = reader.parse()

            # Convert to OTF
            otf = tef_to_otf(tef)

            # Get OTF as dict and add site attribution
            otf_dict = otf.to_dict()

            error = notation_sanity_error(otf_dict.get('notation') or {})
            if error:
                print(f"Error converting {tef_path}: {error}")
                return None, None

            # Add source attribution. `source_id` is the tab detail id (the
            # catalog key) — RECORD it here rather than leaving downstream
            # checks to re-derive it from the storage filename: on the older
            # Hangout scheme ({slug}-{n}.tef) that number is a per-file
            # ATTACHMENT id in a different namespace, so a filename regex can
            # never confirm the pairing. build_works_index's provenance gate
            # compares work.yaml's source_id against this field.
            otf_dict['x_source'] = {
                'type': self.site.source,
                'source_id': tab.id.split('_')[0],
                'url': tab.source_url,
                'download_file': tef_path.name,  # debugging only — not an id
                'author': tab.author,
                'converted_at': datetime.now().isoformat(),
            }

            # Override title from tab metadata if available
            if tab.title:
                otf_dict['metadata']['title'] = tab.title

            # Add key if known
            if tab.key:
                otf_dict['metadata']['key'] = tab.key

            # Write output
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.output_dir / f"{tab.id}.otf.json"
            output_path.write_text(json.dumps(otf_dict, indent=2))

            # Extract metadata for catalog/works. `instrument` is the short
            # id the work.yaml part and the OTF filename use — detected from
            # the tracks, not assumed from the site.
            metadata = {
                'title': otf_dict['metadata'].get('title', tef.title),
                'key': tab.key or otf_dict['metadata'].get('key'),
                'tempo': otf_dict['metadata'].get('tempo'),
                'time_signature': otf_dict['metadata'].get('time_signature'),
                'instrument': resolve_instrument(otf_dict.get('tracks', []),
                                                 self.site.fallback_instrument),
                'measures': len(otf.notation.get(otf.tracks[0].id, [])) if otf.tracks else 0,
            }

            return output_path, metadata

        except Exception as e:
            print(f"Error converting {tef_path}: {e}")
            return None, None


def batch_convert(catalog: TabCatalog, converter: TEFConverter, limit: int = None) -> int:
    """Convert all downloaded TEF files to OTF format.

    Args:
        catalog: TabCatalog with tab entries
        converter: TEFConverter instance
        limit: Maximum number of files to convert

    Returns:
        Number of successfully converted files
    """
    convertible = catalog.get_convertible()
    if limit:
        convertible = convertible[:limit]

    converted_count = 0
    for tab in convertible:
        tef_path = converter.downloads_dir / f"{tab.id}.tef"

        if not tef_path.exists():
            catalog.update_status(tab.id, 'error', 'TEF file not found')
            continue

        print(f"Converting {tab.id}: {tab.title}")
        output_path, metadata = converter.convert(tef_path, tab)

        if output_path:
            catalog.update_status(tab.id, 'converted')
            converted_count += 1
        else:
            catalog.update_status(tab.id, 'error', 'Conversion failed')

    catalog.save()
    return converted_count


def convert_single(tef_path: Path, output_path: Path = None) -> Optional[Path]:
    """Convert a single TEF file to OTF JSON.

    Standalone conversion without catalog tracking.

    Args:
        tef_path: Path to TEF file
        output_path: Optional output path (default: same dir, .otf.json extension)

    Returns:
        Path to output file, or None on failure
    """
    if output_path is None:
        output_path = tef_path.with_suffix('.otf.json')

    try:
        reader = TEFReader(tef_path)
        tef = reader.parse()
        otf = tef_to_otf(tef)

        otf_dict = otf.to_dict()

        error = notation_sanity_error(otf_dict.get('notation') or {})
        if error:
            print(f"Error converting {tef_path}: {error}")
            return None

        otf_dict['x_source'] = {
            'type': 'local',
            'source_file': tef_path.name,
            'converted_at': datetime.now().isoformat(),
        }

        output_path.write_text(json.dumps(otf_dict, indent=2))
        return output_path

    except Exception as e:
        print(f"Error converting {tef_path}: {e}")
        return None
