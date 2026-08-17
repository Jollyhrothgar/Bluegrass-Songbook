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


def part_instrument(otf_path: Path, declared) -> str:
    """The corpus instrument this OTF file publishes as.

    Historically read straight off the filename, which worked while every
    tab was `works/<slug>/<instrument>.otf.json`. Same-instrument siblings
    break that: `banjo-mfa3k2px9.otf.json` is a banjo tab, not a
    "banjo-mfa3k2px9" one. The PR body's declared instrument is
    authoritative when the filename is that instrument's — the edge
    function validates it against the same [a-z0-9-] rule — and the
    filename stem remains the fallback for hand-opened PRs.
    """
    stem = otf_path.name[:-len('.otf.json')] if otf_path.name.endswith('.otf.json') \
        else otf_path.stem
    if declared and re.fullmatch(r'[a-z0-9-]+', declared):
        if stem == declared or stem.startswith(f'{declared}-'):
            return declared
    return stem


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
    instrument = part_instrument(otf_path, meta.get('instrument'))
    work_yaml = work_dir / 'work.yaml'
    pr_number = meta.get('pr_number')
    issue_ref = int(pr_number) if str(pr_number).isdigit() else pr_number

    # Three shapes reach here, and only the middle one is a correction:
    #   - no work.yaml            → a submission that mints its own work
    #   - work.yaml, no such FILE → a NEW tab for an existing song: either
    #                               an instrument it lacked (the bounty
    #                               case) or another take on one it has
    #                               (a sibling arrangement). Append the
    #                               part; stamp it as a submission.
    #   - work.yaml with the FILE → a correction to published content
    #
    # Keyed on the FILE, not the instrument. A work can carry several
    # arrangements per instrument (foggy-mountain-breakdown has eight
    # banjo takes), so "this work already has a banjo part" says nothing
    # about whether THIS file is new — and treating an incoming sibling as
    # a correction would repoint an existing part at it, orphaning the
    # take it used to name.
    work = works_writer.load_work(repo_root, work_id) if work_yaml.exists() else None
    is_correction = bool(work and works_writer.find_parts(
        work, {'type': 'tablature', 'file': otf_path.name}))
    submission_provenance = {
        'source': 'user-submission',
        # What makes THIS take distinguishable from the work's other takes
        # on the same instrument: work_schema requires every alternate
        # tablature arrangement to carry a source_id, and build_works_index
        # folds it into the published filename. The submission PR is the
        # only stable id a user-submitted tab has.
        'source_id': f'pr-{issue_ref}' if pr_number else None,
        'author': meta.get('attribution'),
        'submission_pr': issue_ref,
        'imported_at': str(date.today()),
    }

    # The OTF is already committed on the branch, so no part content is
    # written here — works_writer only authors work.yaml around it.
    try:
        if work_yaml.exists() and not is_correction:
            # New part on an existing work: no x_corrected_* stamps — this
            # content was never published, so there is nothing it corrects.
            # add_part APPENDS and refuses a genuine identity collision;
            # it never reads-modifies-writes what's already there, so the
            # existing takes keep their files, defaults and provenance.
            works_writer.add_part(
                repo_root, work_id,
                works_writer.PartSpec(
                    file=otf_path.name,
                    type='tablature',
                    format='otf',
                    instrument=instrument,
                    provenance=dict(submission_provenance),
                ),
                on_suppressed='raise',
            )
        elif work_yaml.exists():
            # Correction: record provenance on the matching part
            works_writer.update_part(
                repo_root, work_id,
                match={'type': 'tablature', 'file': otf_path.name},
                provenance_updates={
                    'x_corrected_by': (f"github:{meta.get('pr_author')}"
                                       if meta.get('pr_author')
                                       else meta.get('attribution')),
                    'x_corrected_attribution': meta.get('attribution'),
                    'x_correction_pr': issue_ref,
                    'x_corrected': str(date.today()),
                },
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
                    provenance=dict(submission_provenance),
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
        # The corpus instrument name, declared by create-tab-pr. Needed
        # because a sibling arrangement's filename carries a uniquifying
        # suffix the instrument name doesn't.
        'instrument': extract_field(body, 'Instrument'),
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
