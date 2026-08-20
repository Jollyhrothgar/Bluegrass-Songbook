#!/usr/bin/env python3
"""Add a local ``.pro`` file to the corpus as a work.

Usage:
    uv run python3 scripts/lib/add_song.py /path/to/song.pro
    uv run python3 scripts/lib/add_song.py song.pro --title "Roustabout" --artist "Blue Canyon Boys"
    uv run python3 scripts/lib/add_song.py song.pro --on-collision suffix
    uv run python3 scripts/lib/add_song.py song.pro --skip-index-rebuild

This used to copy the file into ``songs/manual/parsed/`` and rebuild the
LEGACY index. Nothing read that directory: ``build_works_index.py`` (the
primary builder) reads ``works/*/work.yaml``, and even the legacy
``build_index.py`` scans ``sources/*/parsed/`` — a *different* path. So the
command advertised as "add a song to the collection" put the file somewhere
no build has ever looked, said "Added:", and exited 0.
``songs/manual/parsed/roustabout.pro`` is the fossil of that (commit
75e93a7a0, "claude didn't add everything").

It now writes through :mod:`works_writer`, the one writer of ``works/``, so a
manual add gets the same collision refusal, suppression guard and provenance
requirement every other path gets.
"""

import argparse
import re
import sys
from datetime import date
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

import works_writer
from build_index import parse_chordpro_metadata
from work_schema import slugify

#: Provenance stamped on a locally added part. Distinct from the
#: ``user-submission`` / ``trusted-user`` sources the contribution pipeline
#: writes: this file came off somebody's disk, not through review.
MANUAL_SOURCE = 'manual'

SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')

#: ``{key: G}`` or ``{meta: key G}``. The whitespace after the meta spelling
#: is required so ``{meta: keyboard ...}`` cannot read as a key of "board".
_KEY_RE = re.compile(r'\{(?:meta:\s*key\s+|key:\s*)([^}]+)\}', re.IGNORECASE)


class AddSongError(Exception):
    """The add cannot proceed — bad input, or a work already there."""


def repo_root_default() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def parse_song_metadata(content: str) -> dict:
    """Title / artist / composer / key out of a ChordPro chart.

    ``parse_chordpro_metadata`` already understands both spellings
    (``{meta: title X}`` and ``{title: X}``) and is what the index build
    reads, so metadata means the same thing here as it does downstream. It
    has no slot for the key, which is its own directive.
    """
    meta = parse_chordpro_metadata(content)
    key_match = _KEY_RE.search(content)
    return {
        'title': (meta.get('title') or '').strip() or None,
        'artist': (meta.get('artist') or '').strip() or None,
        'composer': (meta.get('composer') or '').strip() or None,
        'key': (key_match.group(1).strip() if key_match else None) or None,
    }


def add_song(song_file, *, repo_root=None, work_id: Optional[str] = None,
             title: Optional[str] = None, artist: Optional[str] = None,
             composer: Optional[str] = None, key: Optional[str] = None,
             on_collision: str = 'fail',
             verbose: bool = True) -> works_writer.WriteResult:
    """Create a work from a local ``.pro`` file. Never overwrites one.

    Explicit arguments win over the chart's own ``{meta: ...}`` directives;
    the id defaults to ``slugify(title)`` — the same rule
    ``process_pending.tab_work_slug`` uses when it mints a work — so a
    manual add lands on the slug the rest of the pipeline would have chosen.

    ``on_collision='fail'`` (the default here, unlike the importers) raises
    :class:`works_writer.WorkExistsError`: a human adding one song wants to
    hear that the song is already there, not to quietly mint ``foo-1``.
    Pass ``'suffix'`` when a second arrangement really is intended.
    """
    song_file = Path(song_file).expanduser().resolve()
    repo_root = Path(repo_root) if repo_root else repo_root_default()

    if not song_file.exists():
        raise AddSongError(f"file not found: {song_file}")
    if song_file.suffix != '.pro':
        raise AddSongError(f"file must have a .pro extension: {song_file}")

    content = song_file.read_text()
    if not content.strip():
        raise AddSongError(f"file is empty: {song_file}")
    if not content.endswith('\n'):
        content += '\n'

    meta = parse_song_metadata(content)
    title = (title or meta['title'] or '').strip()
    if not title:
        raise AddSongError(
            f"no title: {song_file.name} has no {{meta: title ...}} (or "
            f"{{title: ...}}) directive — add one, or pass --title")

    artist = (artist or meta['artist'] or '').strip() or None
    composer = (composer or meta['composer'] or '').strip() or None
    key = (key or meta['key'] or '').strip() or None

    if work_id:
        work_id = work_id.strip()
        if not SLUG_RE.match(work_id):
            raise AddSongError(
                f"--id {work_id!r} is not a slug (lowercase words joined by "
                f"single dashes)")
    else:
        work_id = slugify(title)
    if not work_id:
        raise AddSongError(
            f"title {title!r} does not produce a slug — pass --id")

    part = works_writer.PartSpec(
        file='lead-sheet.pro',
        type='lead-sheet',
        format='chordpro',
        default=True,
        content=content,
        provenance={
            'source': MANUAL_SOURCE,
            'source_file': song_file.name,
            'imported_at': date.today().isoformat(),
        },
    )

    return works_writer.create_work(
        repo_root, work_id, title, part,
        artist=artist,
        composers=[composer] if composer else None,
        default_key=key,
        tags=[],
        on_collision=on_collision,
        # A silent skip is what this command was already guilty of. If the
        # id is suppressed or redirected, say so and exit non-zero.
        on_suppressed='raise',
        verbose=verbose,
    )


def rebuild_index(repo_root: Path) -> int:
    """Run the PRIMARY builder. The old code ran ``build_index.py``, which
    reads ``sources/`` and would not have seen the new work either."""
    import subprocess
    return subprocess.run(
        ['uv', 'run', 'python3', 'scripts/lib/build_works_index.py'],
        cwd=repo_root,
    ).returncode


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Add a .pro file to works/ (the song collection)')
    parser.add_argument('song_file', type=Path, help='Path to the .pro file')
    parser.add_argument('--id', dest='work_id',
                        help='Work id (slug). Default: slugify(title)')
    parser.add_argument('--title', help='Override the chart\'s title')
    parser.add_argument('--artist', help='Override the chart\'s artist')
    parser.add_argument('--composer', help='Override the chart\'s composer')
    parser.add_argument('--key', help='Override the chart\'s key')
    parser.add_argument('--on-collision', choices=('fail', 'suffix'),
                        default='fail',
                        help="What to do when the work id is taken: 'fail' "
                             "(default) or 'suffix' (foo -> foo-1)")
    parser.add_argument('--skip-index-rebuild', action='store_true',
                        help='Skip rebuilding the search index after adding')
    args = parser.parse_args(argv)

    repo_root = repo_root_default()
    try:
        result = add_song(
            args.song_file,
            repo_root=repo_root,
            work_id=args.work_id,
            title=args.title,
            artist=args.artist,
            composer=args.composer,
            key=args.key,
            on_collision=args.on_collision,
        )
    except (AddSongError, works_writer.WorksWriterError) as exc:
        print(f"Error: {exc}")
        return 1

    print(f"Added work: {result.work_id}")
    print(f"  -> {result.work_dir / result.part_file}")
    print(f"  -> {result.work_dir / works_writer.WORK_YAML}")

    if args.skip_index_rebuild:
        print("")
        print("Skipped index rebuild (--skip-index-rebuild)")
        print("Run './scripts/bootstrap --quick' to rebuild later")
        return 0

    print("")
    print("Rebuilding search index...")
    if rebuild_index(repo_root) != 0:
        print("Warning: Index rebuild failed")
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
