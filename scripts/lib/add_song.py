#!/usr/bin/env python3
"""
Add Song - Add a .pro file to the manual songs collection

Usage:
    python3 scripts/lib/add_song.py /path/to/song.pro
    python3 scripts/lib/add_song.py /path/to/song.pro --skip-index-rebuild
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description='Add a song to the manual collection'
    )
    parser.add_argument(
        'song_file',
        type=Path,
        help='Path to the .pro file to add'
    )
    parser.add_argument(
        '--skip-index-rebuild',
        action='store_true',
        help='Skip rebuilding the search index after adding'
    )
    args = parser.parse_args()

    # Validate input file
    song_file = args.song_file.resolve()
    if not song_file.exists():
        print(f"Error: File not found: {song_file}")
        sys.exit(1)
    if song_file.suffix != '.pro':
        print(f"Error: File must have .pro extension: {song_file}")
        sys.exit(1)

    # Determine destination
    repo_root = Path(__file__).parent.parent.parent
    dest_dir = repo_root / 'songs' / 'manual' / 'parsed'
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_file = dest_dir / song_file.name

    # Check for overwrite
    if dest_file.exists():
        print(f"Warning: Overwriting existing file: {dest_file.name}")

    # Copy file
    shutil.copy2(song_file, dest_file)
    print(f"Added: {dest_file.name}")
    print(f"  -> {dest_file}")

    # Rebuild index unless skipped
    if not args.skip_index_rebuild:
        print("")
        print("Rebuilding search index...")
        build_script = repo_root / 'scripts' / 'lib' / 'build_index.py'
        result = subprocess.run(
            ['uv', 'run', 'python3', str(build_script)],
            cwd=repo_root
        )
        if result.returncode != 0:
            print("Warning: Index rebuild failed")
            sys.exit(1)
    else:
        print("")
        print("Skipped index rebuild (--skip-index-rebuild)")
        print("Run './scripts/bootstrap --quick' to rebuild later")


if __name__ == '__main__':
    main()
