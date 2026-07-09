#!/usr/bin/env python3
"""
Process a tab correction or submission from a GitHub issue — the tab
twin of process_correction.py, fed by the create-tab-issue edge
function and gated by the human 'approved' label.

Reads ISSUE_BODY / ISSUE_NUMBER / ISSUE_TITLE / ISSUE_AUTHOR from the
environment. Corrections replace a work's tablature OTF; submissions
create a new work. Both record provenance.
"""

import json
import os
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'


# ----------------------------------------------------------------------
# Issue-body parsing
# ----------------------------------------------------------------------

def extract_field(body: str, name: str):
    m = re.search(rf'\*\*{re.escape(name)}:\*\*\s*(.+)', body)
    return m.group(1).strip() if m else None


def extract_otf(body: str):
    """The OTF JSON from the ```json block. Returns a dict or None."""
    m = re.search(r'```json\s*\n(.*?)\n```', body, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def validate_otf(otf) -> list:
    """Sanity checks — returns a list of problems (empty = OK)."""
    problems = []
    if not isinstance(otf, dict):
        return ['not an object']
    tracks = otf.get('tracks')
    if not isinstance(tracks, list) or not tracks:
        problems.append('no tracks')
        return problems
    notation = otf.get('notation') or {}
    for t in tracks:
        tid = t.get('id')
        if not tid:
            problems.append('track without id')
            continue
        if not isinstance(t.get('tuning'), list) or len(t['tuning']) < 3:
            problems.append(f'track {tid}: bad tuning')
        measures = notation.get(tid)
        if not isinstance(measures, list):
            problems.append(f'track {tid}: no notation')
            continue
        nstrings = len(t.get('tuning') or [])
        for m in measures:
            if not isinstance(m.get('measure'), int):
                problems.append(f'track {tid}: measure without number')
                break
            for e in m.get('events', []):
                if not isinstance(e.get('tick'), int) or e['tick'] < 0:
                    problems.append(f'track {tid} m{m.get("measure")}: bad tick')
                    break
                for n in e.get('notes', []):
                    s, f = n.get('s'), n.get('f')
                    if not (isinstance(s, int) and 1 <= s <= nstrings):
                        problems.append(f'track {tid} m{m.get("measure")}: bad string {s}')
                        break
                    if not (isinstance(f, int) and 0 <= f <= 24):
                        problems.append(f'track {tid} m{m.get("measure")}: bad fret {f}')
                        break
    return problems


def slugify(text: str) -> str:
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii').lower()
    text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    return re.sub(r'-+', '-', text) or 'untitled'


# ----------------------------------------------------------------------
# Apply
# ----------------------------------------------------------------------

def apply_correction(works_dir: Path, work_id: str, instrument: str, otf: dict,
                     attribution: str, issue_number: str, issue_author: str) -> Path:
    work_dir = works_dir / work_id
    work_yaml = work_dir / 'work.yaml'
    if not work_yaml.exists():
        raise SystemExit(f'work not found: {work_id}')

    otf_filename = f'{instrument}.otf.json'
    (work_dir / otf_filename).write_text(json.dumps(otf, indent=1))

    work = yaml.safe_load(work_yaml.read_text())
    part = next((p for p in work.get('parts', [])
                 if p.get('type') == 'tablature' and p.get('instrument') == instrument), None)
    if part is None:
        part = {'type': 'tablature', 'instrument': instrument,
                'format': 'otf', 'file': otf_filename, 'provenance': {}}
        work.setdefault('parts', []).append(part)
    part['file'] = otf_filename
    prov = part.setdefault('provenance', {})
    prov['x_corrected_by'] = f'github:{issue_author}' if issue_author else attribution
    prov['x_corrected_attribution'] = attribution
    prov['x_correction_issue'] = int(issue_number) if str(issue_number).isdigit() else issue_number
    prov['x_corrected'] = str(date.today())

    work_yaml.write_text(yaml.dump(work, default_flow_style=False,
                                   allow_unicode=True, sort_keys=False))
    return work_dir


def apply_submission(works_dir: Path, title: str, instrument: str, otf: dict,
                     attribution: str, issue_number: str) -> Path:
    slug = slugify(title)
    work_dir = works_dir / slug
    suffix = 1
    while work_dir.exists():
        work_dir = works_dir / f'{slug}-{suffix}'
        suffix += 1
    work_dir.mkdir(parents=True)

    otf_filename = f'{instrument}.otf.json'
    (work_dir / otf_filename).write_text(json.dumps(otf, indent=1))

    work = {
        'id': work_dir.name,
        'title': title,
        'artist': None,
        'composers': [],
        'tags': ['Instrumental'],
        'parts': [{
            'type': 'tablature',
            'instrument': instrument,
            'format': 'otf',
            'file': otf_filename,
            'default': True,
            'provenance': {
                'source': 'user-submission',
                'author': attribution,
                'submission_issue': int(issue_number) if str(issue_number).isdigit() else issue_number,
                'imported_at': str(date.today()),
            },
        }],
    }
    (work_dir / 'work.yaml').write_text(yaml.dump(
        work, default_flow_style=False, allow_unicode=True, sort_keys=False))
    return work_dir


def process(body: str, issue_number: str, issue_author: str,
            works_dir: Path = WORKS_DIR) -> Path:
    otf = extract_otf(body)
    if otf is None:
        raise SystemExit('no valid OTF JSON block in issue body')
    problems = validate_otf(otf)
    if problems:
        raise SystemExit('OTF validation failed: ' + '; '.join(problems[:5]))

    title = extract_field(body, 'Title') or otf.get('metadata', {}).get('title') or 'Untitled'
    instrument = (extract_field(body, 'Instrument') or 'banjo').lower()
    if not re.fullmatch(r'[a-z0-9-]+', instrument):
        raise SystemExit(f'bad instrument: {instrument}')
    attribution = extract_field(body, 'Submitted by') or 'Rando Calrissian'
    work_id = extract_field(body, 'Work ID')

    if work_id:
        # Work IDs become filesystem paths — allow slug charset only
        if not re.fullmatch(r'[a-z0-9-]+', work_id):
            raise SystemExit(f'bad work id: {work_id}')
        return apply_correction(works_dir, work_id, instrument, otf,
                                attribution, issue_number, issue_author)
    return apply_submission(works_dir, title, instrument, otf,
                            attribution, issue_number)


def main():
    body = os.environ.get('ISSUE_BODY', '')
    number = os.environ.get('ISSUE_NUMBER', '')
    author = os.environ.get('ISSUE_AUTHOR', '')
    work_dir = process(body, number, author)
    Path('/tmp/processed_work_id.txt').write_text(work_dir.name)
    print(f'Processed tab -> {work_dir}')


if __name__ == '__main__':
    main()
