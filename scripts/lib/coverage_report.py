#!/usr/bin/env python3
"""
Coverage report for the works/ collection.

Measures, for every work in works/, whether it has:
  - chords: a lead-sheet part whose .pro file contains at least one [X] chord
  - lyrics: a lead-sheet part with non-trivial lyric text
  - tab-{banjo,guitar,mandolin,dobro,bass,fiddle}: a tablature part covering
    that instrument (an `ensemble` part counts toward every instrument whose
    track appears in its OTF JSON)
  - abc: an abc-notation part

Also cross-references the canonical tune list (sources/tunearch/src/tune_list.py)
to report how many of those standards have a work, and their tab coverage.

Usage:
    uv run python scripts/lib/coverage_report.py
    uv run python scripts/lib/coverage_report.py --csv coverage.csv
    uv run python scripts/lib/coverage_report.py --gaps
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'

# Add sources/tunearch/src to path for the canonical tune list, following
# the same sys.path.insert pattern used by scripts/lib/build_index.py etc.
sys.path.insert(0, str(REPO_ROOT / 'sources' / 'tunearch' / 'src'))
from tune_list import get_tune_list  # noqa: E402

# Prefer the libyaml-backed loader (CSafeLoader) when available — it's
# roughly 7x faster than the pure-Python SafeLoader, which matters when
# reading 18k+ work.yaml files.
_YAML_LOADER = getattr(yaml, 'CSafeLoader', yaml.SafeLoader)

INSTRUMENTS = ['banjo', 'guitar', 'mandolin', 'dobro', 'bass', 'fiddle']
TAB_DIMENSIONS = [f'tab-{i}' for i in INSTRUMENTS]
DIMENSIONS = ['chords', 'lyrics'] + TAB_DIMENSIONS + ['abc']

# Maps both OTF track `instrument` values (read from ensemble .otf.json
# tracks[].instrument) and direct tablature Part.instrument values onto one
# of our six tab dimensions.
INSTRUMENT_MAP = {
    '5-string-banjo': 'banjo',
    'banjo': 'banjo',
    '6-string-guitar': 'guitar',
    'guitar': 'guitar',
    'mandolin': 'mandolin',
    'resonator-guitar': 'dobro',
    'dobro': 'dobro',
    'upright-bass': 'bass',
    'bass': 'bass',
    'fiddle': 'fiddle',
    'violin': 'fiddle',
}

_unknown_instruments_seen = set()


def _warn_unknown_instrument(instrument, work_id):
    """Log an unrecognized instrument once, then skip it."""
    if instrument in _unknown_instruments_seen:
        return
    _unknown_instruments_seen.add(instrument)
    print(f"  Note: unknown instrument '{instrument}' (first seen on {work_id}), skipping",
          file=sys.stderr)


def normalize_title(text: str) -> str:
    """Normalize a title for canonical-tune matching.

    Lowercase, strip punctuation/apostrophes, collapse whitespace, and drop
    a leading "The"/"A"/"An".
    """
    if not text:
        return ''
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')
    text = text.lower()
    text = re.sub(r"[^\w\s]", '', text)  # strip punctuation/apostrophes
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'^(the|an?)\s+', '', text)
    return text


CHORD_RE = re.compile(r'\[([^\]]+)\]')
CHORD_LOOKS_LIKE_CHORD_RE = re.compile(r'^[A-G]')


def analyze_lead_sheet(content: str) -> tuple[bool, bool]:
    """Return (has_chords, has_lyrics) for a ChordPro lead-sheet's content.

    Mirrors the line-classification in build_works_index.parse_chordpro_content:
    directive lines (start with '{') and embedded ABC blocks don't count as
    lyrics, and only bracketed tokens that look like chords (start with A-G)
    count as chords.
    """
    has_chords = False
    has_lyrics = False
    in_abc = False
    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('{start_of_abc'):
            in_abc = True
            continue
        if stripped.startswith('{end_of_abc'):
            in_abc = False
            continue
        if in_abc:
            continue
        if stripped.startswith('{'):
            continue

        if not has_chords:
            for match in CHORD_RE.finditer(line):
                if CHORD_LOOKS_LIKE_CHORD_RE.match(match.group(1)):
                    has_chords = True
                    break

        if not has_lyrics:
            clean_line = CHORD_RE.sub('', line).strip()
            if clean_line:
                has_lyrics = True

        if has_chords and has_lyrics:
            break

    return has_chords, has_lyrics


def classify_work(work_dir: Path, work: dict) -> dict:
    """Return a dict of dimension -> 0/1 for a single work."""
    dims = {d: 0 for d in DIMENSIONS}
    work_id = work.get('id', work_dir.name)
    parts = work.get('parts') or []

    lead_sheet_files = set()
    tablature_parts = []
    abc_found = False

    for part in parts:
        ptype = part.get('type')
        if ptype == 'lead-sheet':
            lead_sheet_files.add(part.get('file') or 'lead-sheet.pro')
        elif ptype == 'tablature':
            tablature_parts.append(part)
        elif ptype == 'abc-notation':
            abc_found = True

    # Fallback: build_works_index.py treats lead-sheet.pro as authoritative
    # even for works whose work.yaml doesn't spell out an explicit
    # lead-sheet part, so match that tolerance here.
    default_lead_sheet = work_dir / 'lead-sheet.pro'
    if not lead_sheet_files and default_lead_sheet.exists():
        lead_sheet_files.add('lead-sheet.pro')

    for filename in lead_sheet_files:
        path = work_dir / filename
        if not path.exists():
            continue
        try:
            content = path.read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        has_chords, has_lyrics = analyze_lead_sheet(content)
        dims['chords'] = dims['chords'] or int(has_chords)
        dims['lyrics'] = dims['lyrics'] or int(has_lyrics)

    for part in tablature_parts:
        instrument = part.get('instrument')
        filename = part.get('file')

        if instrument == 'ensemble':
            if not filename:
                continue
            path = work_dir / filename
            if not path.exists():
                continue
            try:
                otf = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, json.JSONDecodeError):
                continue
            for track in otf.get('tracks', []):
                track_instrument = track.get('instrument')
                mapped = INSTRUMENT_MAP.get(track_instrument)
                if mapped:
                    dims[f'tab-{mapped}'] = 1
                else:
                    _warn_unknown_instrument(track_instrument, work_id)
        else:
            mapped = INSTRUMENT_MAP.get(instrument)
            if mapped:
                dims[f'tab-{mapped}'] = 1
            elif instrument:
                _warn_unknown_instrument(instrument, work_id)

    if abc_found:
        dims['abc'] = 1

    return dims


def scan_works(works_dir: Path) -> list[dict]:
    """Load every works/*/work.yaml and classify it. Returns list of row dicts."""
    rows = []
    work_dirs = sorted(p for p in works_dir.iterdir() if p.is_dir())
    for work_dir in work_dirs:
        yaml_path = work_dir / 'work.yaml'
        if not yaml_path.exists():
            continue
        try:
            with open(yaml_path, encoding='utf-8') as fh:
                work = yaml.load(fh, Loader=_YAML_LOADER)
        except yaml.YAMLError as exc:
            print(f"  Warning: failed to parse {yaml_path}: {exc}", file=sys.stderr)
            continue
        if not work:
            continue
        dims = classify_work(work_dir, work)
        rows.append({
            'id': work.get('id', work_dir.name),
            'title': work.get('title', ''),
            **dims,
        })
    return rows


def dedupe_tune_list(titles: list[str]) -> list[str]:
    """Dedupe the canonical tune list by normalized title, preserving order."""
    seen = set()
    result = []
    for title in titles:
        key = normalize_title(title)
        if key in seen:
            continue
        seen.add(key)
        result.append(title)
    return result


def build_title_index(rows: list[dict]) -> dict:
    """Map normalized title -> list of matching row dicts."""
    index = {}
    for row in rows:
        index.setdefault(normalize_title(row['title']), []).append(row)
    return index


def print_summary(rows: list[dict], tune_list: list[str], gaps: bool = False) -> None:
    total = len(rows)
    print(f"Coverage report: {total} works\n")

    print(f"{'Dimension':<12} {'Count':>8} {'Pct':>8}")
    print('-' * 30)
    for dim in DIMENSIONS:
        count = sum(r[dim] for r in rows)
        pct = (count / total * 100) if total else 0.0
        print(f"{dim:<12} {count:>8} {pct:>7.1f}%")

    # --- Canonical tune-list cross-reference ---
    by_title = build_title_index(rows)

    matched = []   # list of (title, [row, ...])
    unmatched = []
    for title in tune_list:
        rows_for_title = by_title.get(normalize_title(title))
        if rows_for_title:
            matched.append((title, rows_for_title))
        else:
            unmatched.append(title)

    n_tunes = len(tune_list)
    n_matched = len(matched)
    print(f"\nCanonical tune list ({n_tunes} tunes, deduped):")
    if n_tunes:
        print(f"  {n_matched}/{n_tunes} have a work ({n_matched / n_tunes * 100:.1f}%)")
    else:
        print("  (empty tune list)")

    print(f"\n{'Tab dimension':<12} {'Count':>8} {'Pct of matched':>16}")
    print('-' * 40)
    for dim in TAB_DIMENSIONS:
        count = sum(1 for _, tune_rows in matched if any(r[dim] for r in tune_rows))
        pct = (count / n_matched * 100) if n_matched else 0.0
        print(f"{dim:<12} {count:>8} {pct:>15.1f}%")

    if gaps:
        print("\n--- Gaps: canonical tunes with no work ---")
        if unmatched:
            for title in unmatched:
                print(f"  {title}")
        else:
            print("  (none)")

        print("\n--- Gaps: canonical works with no tab of any kind ---")
        found_any = False
        for title, tune_rows in matched:
            for row in tune_rows:
                if not any(row[dim] for dim in TAB_DIMENSIONS):
                    print(f"  {title} ({row['id']})")
                    found_any = True
        if not found_any:
            print("  (none)")


def write_csv(rows: list[dict], path: Path) -> None:
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        writer = csv.writer(fh)
        writer.writerow(['id', 'title'] + DIMENSIONS)
        for row in rows:
            writer.writerow([row['id'], row['title']] + [row[d] for d in DIMENSIONS])


def main() -> int:
    parser = argparse.ArgumentParser(description='Coverage report for works/')
    parser.add_argument('--csv', type=Path, default=None,
                         help='Write the full per-work matrix to this CSV path')
    parser.add_argument('--gaps', action='store_true',
                         help='Print canonical tunes/works with coverage gaps')
    args = parser.parse_args()

    if not WORKS_DIR.exists():
        print(f"Error: {WORKS_DIR} not found", file=sys.stderr)
        return 1

    rows = scan_works(WORKS_DIR)
    tune_list = dedupe_tune_list(get_tune_list())

    print_summary(rows, tune_list, gaps=args.gaps)

    if args.csv:
        write_csv(rows, args.csv)
        print(f"\nWrote {len(rows)} rows to {args.csv}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
