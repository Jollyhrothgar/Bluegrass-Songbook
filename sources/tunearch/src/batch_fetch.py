#!/usr/bin/env python3
"""
Batch fetch tunes from TuneArch

Usage:
    uv run python batch_fetch.py --limit 100
    uv run python batch_fetch.py --tune "Salt Creek"
    uv run python batch_fetch.py --search "bluegrass reel"
"""

import argparse
import sys
from pathlib import Path

# Add parent to path for imports when run directly
sys.path.insert(0, str(Path(__file__).parent))

from scraper import TuneArchScraper
from chordpro_generator import abc_to_chordpro, save_chordpro
from tune_list import get_tune_list, load_catalog, save_catalog, add_to_catalog


def fetch_single_tune(scraper: TuneArchScraper, tune_name: str, output_dir: Path, verbose: bool = True) -> bool:
    """Fetch a single tune and save as ChordPro. Returns True if successful."""
    if verbose:
        print(f"Fetching: {tune_name}")

    tune = scraper.fetch_tune(tune_name)

    if not tune:
        if verbose:
            print(f"  -> Could not fetch page")
        return False

    if not tune.abc_notation:
        if verbose:
            print(f"  -> No ABC notation found")
        return False

    # Convert to ChordPro
    chordpro = abc_to_chordpro(tune)

    # Save to file
    output_path = save_chordpro(chordpro, output_dir, tune.metadata.title)
    if verbose:
        print(f"  -> Saved: {output_path.name}")

    return True


def main():
    parser = argparse.ArgumentParser(description='Fetch ABC notation from TuneArch')
    parser.add_argument('--limit', type=int, default=10,
                        help='Maximum tunes to fetch (default: 10)')
    parser.add_argument('--tune', type=str,
                        help='Fetch single tune by name')
    parser.add_argument('--search', type=str,
                        help='Search TuneArch and fetch results')
    parser.add_argument('--output-dir', type=Path,
                        default=Path(__file__).parent.parent / 'parsed',
                        help='Output directory for .pro files')
    parser.add_argument('--cache-dir', type=Path,
                        default=Path(__file__).parent.parent / 'raw',
                        help='Cache directory for raw HTML')
    parser.add_argument('--no-cache', action='store_true',
                        help='Skip cache, always fetch fresh')
    parser.add_argument('--quiet', '-q', action='store_true',
                        help='Minimal output')
    args = parser.parse_args()

    output_dir = args.output_dir
    cache_dir = None if args.no_cache else args.cache_dir

    scraper = TuneArchScraper(cache_dir=cache_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    catalog_path = Path(__file__).parent.parent / 'tune_catalog.json'
    catalog = load_catalog(catalog_path)

    success_count = 0
    fail_count = 0

    if args.tune:
        # Fetch single tune
        if fetch_single_tune(scraper, args.tune, output_dir, verbose=not args.quiet):
            add_to_catalog(catalog, args.tune, 'fetched')
            success_count = 1
        else:
            add_to_catalog(catalog, args.tune, 'not_found')
            fail_count = 1

    elif args.search:
        # Search and fetch results
        if not args.quiet:
            print(f"Searching TuneArch for: {args.search}")

        results = scraper.search_tunes(args.search, limit=args.limit)
        if not args.quiet:
            print(f"Found {len(results)} results")

        for tune_name in results:
            if fetch_single_tune(scraper, tune_name, output_dir, verbose=not args.quiet):
                add_to_catalog(catalog, tune_name, 'fetched')
                success_count += 1
            else:
                add_to_catalog(catalog, tune_name, 'not_found')
                fail_count += 1

    else:
        # Batch fetch from curated list
        all_tunes = get_tune_list()
        already_fetched = set(catalog.get('fetched', []))

        # Filter out already fetched and known failures
        tunes_to_fetch = [
            t for t in all_tunes
            if t not in already_fetched and t not in catalog.get('not_found', [])
        ][:args.limit]

        if not args.quiet:
            print(f"Fetching {len(tunes_to_fetch)} tunes (skipping {len(already_fetched)} already fetched)")

        for tune_name in tunes_to_fetch:
            if fetch_single_tune(scraper, tune_name, output_dir, verbose=not args.quiet):
                add_to_catalog(catalog, tune_name, 'fetched')
                success_count += 1
            else:
                add_to_catalog(catalog, tune_name, 'not_found')
                fail_count += 1

            # Save catalog after each tune (for resume on error)
            save_catalog(catalog, catalog_path)

    # Final save
    save_catalog(catalog, catalog_path)

    if not args.quiet:
        print(f"\nResults: {success_count} fetched, {fail_count} failed/not found")
        print(f"Total in catalog: {len(catalog.get('fetched', []))} fetched, {len(catalog.get('not_found', []))} not found")


if __name__ == '__main__':
    main()
