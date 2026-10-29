#!/usr/bin/env python3
"""Rewrite every tracked OTF file into the canonical layout (G15b).

Re-runnable: a file already in the layout is left alone. For each file it
asserts the parsed value is the same before and after (strictly: ``120`` and
``120.0``, ``1`` and ``true`` differ). A file whose value WOULD change (it
holds a ``_`` key the layout drops, or a fractional number) is not rewritten
and is listed; the exit status is then 1.

    uv run python scripts/lib/reformat_otf.py            # rewrite
    uv run python scripts/lib/reformat_otf.py --check    # list, change nothing

Scope (the spec's four places, tracked files only): works/*/*.otf.json,
docs/data/tabs/*_tef.otf.json, tests/parser/fixtures/*.otf.json and
sources/*/parsed/*.otf.json.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from otf_format import serialize  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SCOPE = ['works/*/*.otf.json', 'docs/data/tabs/*_tef.otf.json',
         'tests/parser/fixtures/*.otf.json', 'sources/*/parsed/*.otf.json']


def tracked_files(root: Path = REPO_ROOT) -> list:
    out = subprocess.run(['git', 'ls-files', *SCOPE], cwd=root,
                         capture_output=True, text=True, check=True).stdout
    return [root / p for p in out.split('\n') if p]


def _strict(value) -> str:
    """A form in which equal text means an equal value, type for type."""
    return json.dumps(value, sort_keys=True, ensure_ascii=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true',
                    help='report files not in the layout; write nothing')
    args = ap.parse_args(argv)

    files = tracked_files()
    changed, same, value_changes = [], 0, []
    before_bytes = after_bytes = 0
    for path in files:
        raw = path.read_bytes()
        doc = json.loads(raw.decode('utf-8'))
        try:
            text = serialize(doc)
        except ValueError as e:
            value_changes.append((path, str(e)))
            continue
        if _strict(json.loads(text)) != _strict(doc):
            value_changes.append((path, 'value would change'))
            continue
        out = text.encode('utf-8')
        before_bytes += len(raw)
        after_bytes += len(out)
        if out == raw:
            same += 1
            continue
        changed.append(path)
        if not args.check:
            path.write_bytes(out)

    verb = 'would rewrite' if args.check else 'rewrote'
    print(f'{len(files)} files in scope: {verb} {len(changed)}, '
          f'{same} already canonical, {len(value_changes)} would change value '
          f'(left alone)')
    print(f'bytes (rewritable files): {before_bytes} -> {after_bytes}')
    for path, why in value_changes:
        print(f'  VALUE CHANGE {path.relative_to(REPO_ROOT)}: {why}')
    return 1 if value_changes else 0


if __name__ == '__main__':
    sys.exit(main())
