#!/usr/bin/env python3
"""
Finalize a tab PR: the create-tab-pr edge function commits the OTF file
itself to a branch and opens a labeled PR; this script (run by
process-tab-pr.yml ON that branch) validates the OTF and adds what the
reviewer should see in the same diff:
  - work.yaml provenance (corrections) or a fresh work.yaml (submissions)
The workflow then rebuilds the index and pushes to the PR branch.
Merging the PR is the human approval; deploy chains from main as usual.

Env: PR_BODY, PR_NUMBER, PR_AUTHOR, CHANGED_FILES (newline-separated).
"""

import json
import os
import re
import sys
from datetime import date
from pathlib import Path

import works_writer

REPO_ROOT = Path(__file__).parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'


def extract_field(body: str, name: str):
    m = re.search(rf'\*\*{re.escape(name)}:\*\*\s*(.+)', body)
    return m.group(1).strip() if m else None


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


def finalize_tab_file(otf_path: Path, meta: dict) -> Path:
    """Validate one changed OTF and make its work.yaml tell the story.

    meta: {title, attribution, comment, pr_number, pr_author}
    Returns the work directory.
    """
    if not otf_path.exists():
        raise SystemExit(f'changed file missing on branch: {otf_path}')
    try:
        otf = json.loads(otf_path.read_text())
    except json.JSONDecodeError as e:
        raise SystemExit(f'{otf_path}: not valid JSON: {e}')
    problems = validate_otf(otf)
    if problems:
        raise SystemExit(f'{otf_path}: OTF validation failed: ' + '; '.join(problems[:5]))

    work_dir = otf_path.parent
    work_id = work_dir.name
    repo_root = work_dir.parent.parent
    instrument = otf_path.name.replace('.otf.json', '')
    work_yaml = work_dir / 'work.yaml'
    pr_number = meta.get('pr_number')
    issue_ref = int(pr_number) if str(pr_number).isdigit() else pr_number

    # The OTF is already committed on the branch, so no part content is
    # written here — works_writer only authors work.yaml around it.
    try:
        if work_yaml.exists():
            # Correction: record provenance on the matching part
            works_writer.update_part(
                repo_root, work_id,
                match={'type': 'tablature', 'instrument': instrument},
                file=otf_path.name,
                provenance_updates={
                    'x_corrected_by': (f"github:{meta.get('pr_author')}"
                                       if meta.get('pr_author')
                                       else meta.get('attribution')),
                    'x_corrected_attribution': meta.get('attribution'),
                    'x_correction_pr': issue_ref,
                    'x_corrected': str(date.today()),
                },
                add_if_missing=works_writer.PartSpec(
                    file=otf_path.name,
                    type='tablature',
                    format='otf',
                    instrument=instrument,
                    provenance={'source': 'user-submission',
                                'author': meta.get('attribution')},
                ),
                on_suppressed='raise',
            )
        else:
            # Submission: fresh work (the directory already holds the OTF)
            works_writer.create_work(
                repo_root, work_id,
                meta.get('title') or otf.get('metadata', {}).get('title') or 'Untitled',
                works_writer.PartSpec(
                    file=otf_path.name,
                    type='tablature',
                    format='otf',
                    instrument=instrument,
                    default=True,
                    provenance={
                        'source': 'user-submission',
                        'author': meta.get('attribution'),
                        'submission_pr': issue_ref,
                        'imported_at': str(date.today()),
                    },
                ),
                tags=['Instrumental'],
                on_collision='fail',
                allow_existing_dir=True,
                on_suppressed='raise',
            )
    except works_writer.WorksWriterError as e:
        raise SystemExit(f'{otf_path}: {e}')
    return work_dir


def process_changed(changed: list, body: str, pr_number: str, pr_author: str,
                    works_dir: Path = WORKS_DIR) -> list:
    """Process every changed works/*.otf.json. Returns the work dirs."""
    meta = {
        'title': extract_field(body, 'Title'),
        # PR bodies always carry a verified submitter now (identity is
        # derived server-side in create-tab-pr); this fallback only covers
        # hand-opened PRs.
        'attribution': extract_field(body, 'Submitted by') or 'Unknown submitter',
        'comment': None,
        'pr_number': pr_number,
        'pr_author': pr_author,
    }
    done = []
    for rel in changed:
        rel = rel.strip()
        if not rel or not rel.endswith('.otf.json'):
            continue
        p = Path(rel)
        if p.parts[0] != 'works' or len(p.parts) != 3 or '..' in p.parts:
            raise SystemExit(f'refusing path outside works/: {rel}')
        done.append(finalize_tab_file(works_dir / p.parts[1] / p.parts[2], meta))
    if not done:
        raise SystemExit('no changed works/*.otf.json files found in this PR')
    return done


def main():
    body = os.environ.get('PR_BODY', '')
    number = os.environ.get('PR_NUMBER', '')
    author = os.environ.get('PR_AUTHOR', '')
    changed = os.environ.get('CHANGED_FILES', '').splitlines()
    dirs = process_changed(changed, body, number, author)
    Path('/tmp/processed_work_id.txt').write_text(dirs[0].name)
    for d in dirs:
        print(f'Finalized tab -> {d}')


if __name__ == '__main__':
    main()
