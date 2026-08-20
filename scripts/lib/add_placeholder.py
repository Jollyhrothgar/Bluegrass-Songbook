#!/usr/bin/env python3
"""Create a placeholder work in ``works/``.

A placeholder is a work with metadata and **no parts at all** — no lead
sheet, no tab. It appears in search and can be added to lists, and carries
``status: placeholder`` so the frontend (``utils.isPlaceholder``) and the
bounty board can tell it apart from a work that actually has content.

Usage:
    uv run python3 scripts/lib/add_placeholder.py "Rebecca" --artist "Jim Mills" --key B --tags Bluegrass,Instrumental
    uv run python3 scripts/lib/add_placeholder.py "Ground Hog" --notes "Traditional old-time tune"

It writes through :mod:`works_writer`, the one writer of ``works/``. It used
to author ``work.yaml`` itself with a bare ``yaml.dump`` and its own
collision loop, and asked NEITHER the suppression registry nor the redirect
map — so it could mint a work at an id an admin had deleted, or at an id the
merge tool had already pointed somewhere else. Those are the exact two
questions ``works_writer.Guards.blocked`` exists to ask, and this was the
last hand-writer left outside it.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import works_writer
from work_schema import slugify

#: What marks a work as having no content yet. Read by the frontend
#: (``utils.isPlaceholder``) and the bounty board; ``work_schema.Work``
#: defines the other value as ``complete``.
PLACEHOLDER_STATUS = 'placeholder'


class AddPlaceholderError(Exception):
    """The placeholder cannot be created — bad input."""


def repo_root_default() -> Path:
    return Path(__file__).parent.parent.parent


def create_placeholder(title: str, *, repo_root=None, artist: str = None,
                       key: str = None, composers: list[str] = None,
                       tags: list[str] = None, notes: str = None,
                       youtube: str = None, strum_machine: str = None,
                       on_collision: str = 'suffix',
                       verbose: bool = True) -> works_writer.WriteResult:
    """Create a placeholder work (metadata only, ``parts: []``).

    The id is ``slugify(title)`` — the same rule every other minting path
    uses. Collision handling, suppression and redirects are
    ``works_writer.create_work``'s to decide: ``on_collision='suffix'`` keeps
    the behaviour this CLI has always had (``rebecca`` → ``rebecca-1``), and
    a suppressed or redirected id now RAISES instead of quietly resurrecting
    the work an admin deleted.

    ``repo_root`` is the repo (not the ``works/`` directory) because the
    guards live at ``curation/registry.yaml``, ``docs/data/deleted_songs.json``
    and ``docs/data/redirects.json``.
    """
    repo_root = Path(repo_root) if repo_root else repo_root_default()

    title = (title or '').strip()
    if not title:
        raise AddPlaceholderError('a title is required')

    work_id = slugify(title)
    if not work_id:
        raise AddPlaceholderError(
            f"title {title!r} does not produce a slug")

    extra = {'status': PLACEHOLDER_STATUS}
    if notes:
        extra['notes'] = notes
    external = {}
    if youtube:
        external['youtube'] = youtube
    if strum_machine:
        external['strum_machine'] = strum_machine
    if external:
        extra['external'] = external

    return works_writer.create_work(
        repo_root, work_id, title, None,
        artist=artist,
        composers=composers,
        default_key=key,
        tags=tags,
        extra=extra,
        on_collision=on_collision,
        # Say so and exit non-zero. A placeholder minted onto a suppressed
        # or merged-away id is the failure this conversion exists to stop —
        # skipping silently would just move it out of sight.
        on_suppressed='raise',
        verbose=verbose,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Create a placeholder work (metadata stub with no content)'
    )
    parser.add_argument('title', help='Song title')
    parser.add_argument('--artist', help='Artist name')
    parser.add_argument('--key', help='Default key (e.g., G, Am, Bb)')
    parser.add_argument('--composers', help='Comma-separated composer names')
    parser.add_argument('--tags', help='Comma-separated tags (e.g., Bluegrass,Instrumental)')
    parser.add_argument('--notes', help='Community-visible notes about the song')
    parser.add_argument('--youtube', help='YouTube URL')
    parser.add_argument('--strum-machine', help='Strum Machine URL')
    parser.add_argument('--on-collision', choices=('suffix', 'fail'),
                        default='suffix',
                        help="What to do when the work id is taken: 'suffix' "
                             "(default, rebecca -> rebecca-1) or 'fail'")
    parser.add_argument('--repo-root', type=Path, default=None,
                        help='Repo to write into (default: this checkout). '
                             'For trying the command against a scratch corpus')
    parser.add_argument('--skip-index-rebuild', action='store_true',
                        help='Skip rebuilding the search index after adding')
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root) if args.repo_root else repo_root_default()
    composers = [c.strip() for c in args.composers.split(',')] if args.composers else None
    tags = [t.strip() for t in args.tags.split(',')] if args.tags else None

    try:
        result = create_placeholder(
            args.title,
            repo_root=repo_root,
            artist=args.artist,
            key=args.key,
            composers=composers,
            tags=tags,
            notes=args.notes,
            youtube=args.youtube,
            strum_machine=args.strum_machine,
            on_collision=args.on_collision,
        )
    except (AddPlaceholderError, works_writer.WorksWriterError) as exc:
        print(f"Error: {exc}")
        return 1

    print(f"Created placeholder: {result.work_id}")
    print(f"  -> {result.work_dir / works_writer.WORK_YAML}")

    if args.skip_index_rebuild:
        print("")
        print("Skipped index rebuild (--skip-index-rebuild)")
        print("Run './scripts/bootstrap --quick' to rebuild later")
        return 0

    print("")
    print("Rebuilding search index...")
    import subprocess
    if subprocess.run(['uv', 'run', 'python3',
                       'scripts/lib/build_works_index.py'],
                      cwd=repo_root).returncode != 0:
        print("Warning: Index rebuild failed")
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
