#!/usr/bin/env python3
"""Batch import CLI for Hangout Network tabs.

Defaults to Banjo Hangout; pass --site to target a sibling site
(mandolin-hangout, flatpicker-hangout — see site_config.SITES).

Usage:
    uv run python sources/banjo-hangout/src/batch_import.py scan [--limit N] [--letter L]
    uv run python sources/banjo-hangout/src/batch_import.py download [--limit N]
    uv run python sources/banjo-hangout/src/batch_import.py convert [--limit N]
    uv run python sources/banjo-hangout/src/batch_import.py import [--limit N] [--dry-run]
    uv run python sources/banjo-hangout/src/batch_import.py stats
    uv run python sources/banjo-hangout/src/batch_import.py convert-file <tef_path> [output_path]

    ... any command also takes --site <name> (default: banjo-hangout)
"""

import argparse
import sys
from pathlib import Path

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from catalog import TabCatalog
from scraper import HangoutScraper, scan_and_update_catalog
from converter import TEFConverter, batch_convert, convert_single
from site_config import DEFAULT_SITE_NAME, SITES, get_site
from works_importer import batch_import as works_batch_import
from priority_list import build_priority_list, match_title, print_priority_stats


def cmd_scan(args):
    """Scan a Hangout site for available tabs."""
    site = get_site(args.site)
    site.require_base_url()  # before building the (slow) priority list
    catalog = TabCatalog.for_site(site)
    scraper = HangoutScraper(site)

    if args.priority:
        # Priority scan: only keep tabs matching our priority list
        print("Building priority list...")
        priority_list = build_priority_list(site)
        print(f"  {len(priority_list)} priority titles")

        # Determine max priority tier to include
        max_priority = args.max_priority or 5
        priority_titles = {t for t, p in priority_list if p <= max_priority}
        print(f"  {len(priority_titles)} titles at priority <= {max_priority}")

        print(f"\nScanning {site.name} tab archive (priority mode)...")
        all_tabs = scraper.scan_catalog(letters=None, limit=None)

        # Filter to priority tabs only
        matched_tabs = []
        for tab in all_tabs:
            priority = match_title(tab.title, priority_list, site)
            if priority is not None and priority <= max_priority:
                matched_tabs.append((priority, tab))

        # Sort by priority
        matched_tabs.sort(key=lambda x: x[0])

        # Add to catalog
        new_count = 0
        for priority, meta in matched_tabs:
            if meta.format != 'tef':
                continue
            if meta.id in catalog.tabs:
                continue

            from catalog import TabEntry
            tab = TabEntry(
                id=meta.id,
                title=meta.title,
                author=meta.author,
                format=meta.format,
                source_url=meta.download_url,
                genre=meta.genre,
                style=meta.style,
                key=meta.key,
                tuning=meta.tuning,
                difficulty=meta.difficulty,
                status='pending',
            )
            catalog.add_tab(tab)
            new_count += 1
            print(f"  [{priority:2d}] {meta.title}")

            if args.limit and new_count >= args.limit:
                break

        catalog.update_scan_time()
        catalog.save()

        print(f"\nAdded {new_count} priority tabs")

    else:
        # Standard scan
        letters = None
        if args.letter:
            letters = [args.letter.upper()]

        print(f"Scanning {site.name} tab archive...")
        new_count = scan_and_update_catalog(
            catalog, scraper,
            letters=letters,
            limit=args.limit
        )

    stats = catalog.stats()
    print(f"\nTotal TEF tabs in catalog: {stats['by_format'].get('tef', 0)}")
    print(f"Total tabs: {stats['total']}")


def cmd_download(args):
    """Download TEF files from a Hangout site."""
    site = get_site(args.site)
    catalog = TabCatalog.for_site(site)
    scraper = HangoutScraper(site)

    downloadable = catalog.get_downloadable()
    if args.limit:
        downloadable = downloadable[:args.limit]

    print(f"Downloading {len(downloadable)} TEF files...")
    success_count = 0

    for tab in downloadable:
        print(f"  Downloading {tab.id}: {tab.title}")
        result = scraper.download_tab(tab)

        if result:
            catalog.update_status(tab.id, 'downloaded')
            success_count += 1
        else:
            catalog.update_status(tab.id, 'error', 'Download failed')

    catalog.save()
    print(f"\nDownloaded {success_count}/{len(downloadable)} files")


def cmd_convert(args):
    """Convert downloaded TEF files to OTF format."""
    site = get_site(args.site)
    catalog = TabCatalog.for_site(site)
    converter = TEFConverter(site)

    convertible = catalog.get_convertible()
    print(f"Found {len(convertible)} files ready to convert")

    converted_count = batch_convert(catalog, converter, limit=args.limit)
    print(f"\nConverted {converted_count} files")


def cmd_import(args):
    """Import converted tabs into works/ directory."""
    site = get_site(args.site)
    catalog = TabCatalog.for_site(site)

    importable = catalog.get_importable()
    print(f"Found {len(importable)} tabs ready to import")

    imported_count = works_batch_import(
        catalog,
        limit=args.limit,
        dry_run=args.dry_run,
        site=site
    )

    if not args.dry_run:
        print(f"\nImported {imported_count} tabs to works/")


def cmd_stats(args):
    """Show catalog statistics."""
    site = get_site(args.site)
    catalog = TabCatalog.for_site(site)
    stats = catalog.stats()

    print(f"{site.name} Tab Catalog Stats")
    print("=" * 40)
    print(f"Total tabs:     {stats['total']}")
    print()
    print("By status:")
    for status, count in sorted(stats['by_status'].items()):
        print(f"  {status:12s}: {count}")
    print()
    print("By format:")
    for fmt, count in sorted(stats['by_format'].items()):
        print(f"  {fmt:12s}: {count}")


def cmd_priorities(args):
    """Show priority list statistics."""
    print_priority_stats(get_site(args.site))


def cmd_convert_file(args):
    """Convert a single TEF file (standalone, no catalog)."""
    tef_path = Path(args.tef_path)
    output_path = Path(args.output_path) if args.output_path else None

    if not tef_path.exists():
        print(f"Error: File not found: {tef_path}")
        sys.exit(1)

    print(f"Converting {tef_path}...")
    result = convert_single(tef_path, output_path)

    if result:
        print(f"Output: {result}")
    else:
        print("Conversion failed")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='Hangout Network tab import')

    # --site applies to every command (default keeps the Banjo Hangout paths)
    site_parser = argparse.ArgumentParser(add_help=False)
    site_parser.add_argument('--site', default=DEFAULT_SITE_NAME,
                             choices=sorted(SITES),
                             help=f'Hangout site to work on (default: {DEFAULT_SITE_NAME})')

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # scan
    scan_parser = subparsers.add_parser('scan', parents=[site_parser],
                                        help='Scan a Hangout site for tabs')
    scan_parser.add_argument('--limit', type=int, help='Maximum tabs to scan')
    scan_parser.add_argument('--letter', type=str, help='Only scan one letter (A-Z or 0)')
    scan_parser.add_argument('--priority', action='store_true',
                            help='Only scan for priority tabs (matching tune list + works)')
    scan_parser.add_argument('--max-priority', type=int, default=5,
                            help='Maximum priority tier to include (1-5=essential, 6-10=common, default: 5)')

    # download
    dl_parser = subparsers.add_parser('download', parents=[site_parser],
                                      help='Download TEF files')
    dl_parser.add_argument('--limit', type=int, help='Maximum files to download')

    # convert
    conv_parser = subparsers.add_parser('convert', parents=[site_parser],
                                        help='Convert TEF to OTF')
    conv_parser.add_argument('--limit', type=int, help='Maximum files to convert')

    # import
    imp_parser = subparsers.add_parser('import', parents=[site_parser],
                                       help='Import to works/')
    imp_parser.add_argument('--limit', type=int, help='Maximum tabs to import')
    imp_parser.add_argument('--dry-run', action='store_true', help='Show what would be imported')

    # stats
    subparsers.add_parser('stats', parents=[site_parser],
                          help='Show catalog statistics')

    # priorities
    subparsers.add_parser('priorities', parents=[site_parser],
                          help='Show priority list statistics')

    # convert-file
    cf_parser = subparsers.add_parser('convert-file', help='Convert single TEF file')
    cf_parser.add_argument('tef_path', help='Path to TEF file')
    cf_parser.add_argument('output_path', nargs='?', help='Output path (optional)')

    args = parser.parse_args()

    commands = {
        'scan': cmd_scan,
        'download': cmd_download,
        'convert': cmd_convert,
        'import': cmd_import,
        'stats': cmd_stats,
        'priorities': cmd_priorities,
        'convert-file': cmd_convert_file,
    }

    handler = commands.get(args.command)
    if handler is None:
        parser.print_help()
        sys.exit(1)

    try:
        handler(args)
    except ValueError as e:  # unknown/unconfigured site
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
