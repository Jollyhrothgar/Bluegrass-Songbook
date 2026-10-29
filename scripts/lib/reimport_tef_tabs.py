#!/usr/bin/env python3
"""Re-import published TEF tabs with the current importer (G15d, batch 3).

Two jobs, both re-runnable (a second run changes nothing):

1. ``works/*/*.otf.json`` tablature parts whose ``work.yaml`` provenance points
   at a TEF on disk.  Works are authoritative, so a part is refreshed ONLY
   when the file still equals the PREVIOUS importer's output (the importer at
   ``--previous-rev``, run in a subprocess from ``git archive`` so the old and
   new ``tef_parser`` never mix) on ``tracks``, ``notation``, ``annotations``
   and ``reading_list``.  Skipped, never touched: parts with
   ``provenance.submitted_by``, parts a reader corrected
   (``x_corrected_by`` / ``x_derived_from``), and parts that no longer match.
   A refresh takes ``tracks notation annotations reading_list measure_marks
   chords chord_diagrams`` from the new importer, keeps the file's metadata and
   ``x_source`` (minus ``skipped``: the report is for files a reader opens, not
   for published takes), and stamps the current ``otf_version``.

2. ``sources/*/parsed/*.otf.json`` (Tier-2 import records): every file with a
   TEF on disk is regenerated from the new importer, keeping the existing
   ``x_source`` and the catalog-derived title / key.  ``x_source.skipped`` IS
   kept here.

Output goes through ``otf_format.serialize``.  A new document that fails
``otf_schema.check`` aborts the run before anything is written.

    uv run python scripts/lib/reimport_tef_tabs.py --dry-run
    uv run python scripts/lib/reimport_tef_tabs.py
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'lib'))

from otf_format import OTF_VERSION, serialize  # noqa: E402

PREVIOUS_REV = 'e33562593'

#: Compared (old importer vs file) before a works part may be refreshed.
COMPARED = ('tracks', 'notation', 'annotations', 'reading_list')
#: Taken from the new importer on a refresh. A field the new importer does not
#: produce is removed from the file.
TAKEN = COMPARED + ('measure_marks', 'chords', 'chord_diagrams')
#: Empty and absent are the same thing when comparing.
_EMPTY_OK = ('annotations', 'reading_list')

HANGOUT_SOURCES = ('banjo-hangout', 'fiddle-hangout', 'flatpicker-hangout',
                   'mandolin-hangout', 'reso-hangout')


# ---------------------------------------------------------------- decisions

def provenance_skip(prov: dict):
    """Why a part is off limits, or None."""
    if prov.get('submitted_by'):
        return 'submitted'
    if prov.get('x_corrected_by') or prov.get('x_derived_from'):
        return 'corrected'
    return None


def first_difference(existing: dict, old: dict):
    """First of COMPARED where the file differs from the old importer, or None."""
    for field in COMPARED:
        a, b = existing.get(field), old.get(field)
        if field in _EMPTY_OK:
            a, b = a or [], b or []
        if a != b:
            return field
    return None


def refreshed(existing: dict, new: dict) -> dict:
    """The existing works file with the new importer's musical fields."""
    out = {k: v for k, v in existing.items() if k not in TAKEN}
    for field in TAKEN:
        if field in new and new[field] not in (None, [], {}):
            out[field] = new[field]
        else:
            out.pop(field, None)
    xs = {k: v for k, v in (existing.get('x_source') or {}).items() if k != 'skipped'}
    if xs:
        out['x_source'] = xs
    else:
        out.pop('x_source', None)
    out['otf_version'] = OTF_VERSION
    return out


def regenerated(existing, new: dict, tef_name: str) -> dict:
    """A parsed/ record: the new document, with the old x_source and title/key."""
    out = dict(new)
    skipped = (new.get('x_source') or {}).get('skipped')
    xs = dict((existing or {}).get('x_source') or {
        'type': 'local', 'source_file': tef_name})
    xs.pop('skipped', None)
    if skipped:
        xs['skipped'] = skipped
    out['x_source'] = xs
    if existing:
        meta = dict(out.get('metadata') or {})
        for key in ('title', 'key'):
            if (existing.get('metadata') or {}).get(key):
                meta[key] = existing['metadata'][key]
        out['metadata'] = meta
    out['otf_version'] = OTF_VERSION
    return out


def decide_part(prov: dict, existing: dict, old: dict, new: dict):
    """``(action, detail)``; action is submitted / corrected / mismatch / refresh."""
    why = provenance_skip(prov)
    if why:
        return why, None
    field = first_difference(existing, old)
    if field:
        return 'mismatch', field
    return 'refresh', None


# ------------------------------------------------------------ finding TEFs

def tef_for_tab_id(directory: Path, tab_id: str):
    """``{id}.tef`` or the scraper's ``{id}_tef*.tef`` (one match, else None)."""
    if not directory.is_dir():
        return None
    hits = sorted(p for p in directory.glob('*.tef')
                  if p.stem == tab_id or p.stem.startswith(f'{tab_id}_tef'))
    return hits[0] if len(hits) == 1 else None


def tef_for_provenance(root: Path, prov: dict):
    source = prov.get('source')
    if not source:
        return None
    base = root / 'sources' / source
    if prov.get('source_id') and source in HANGOUT_SOURCES:
        return tef_for_tab_id(base / 'downloads', str(prov['source_id']))
    name = prov.get('source_file')
    if name:
        for cand in (base / name, base / 'tefs' / name, base / 'downloads' / name):
            if cand.suffix == '.tef' and cand.is_file():
                return cand
    return None


def tef_for_parsed(root: Path, path: Path, existing: dict):
    site = path.parents[1].name
    base = root / 'sources' / site
    xs = existing.get('x_source') or {}
    for key in ('download_file', 'source_file'):
        for d in ('downloads', 'tefs'):
            if xs.get(key) and (base / d / xs[key]).is_file():
                return base / d / xs[key]
    stem = path.name[:-len('.otf.json')]
    tab_id = stem[:-4] if stem.endswith('_tef') else stem
    hit = tef_for_tab_id(base / 'downloads', tab_id)
    if hit and xs.get('source_id') not in (None, tab_id):
        return None
    return hit


# ---------------------------------------------------------------- importers

_OLD_WORKER = r'''
import json, sys
root, listing, out = sys.argv[1:4]
sys.path.insert(0, root + "/sources/banjo-hangout/src")
from tef_parser import TEFReader, tef_to_otf
result = {}
for p in json.load(open(listing)):
    try:
        result[p] = tef_to_otf(TEFReader(p).parse()).to_dict()
    except Exception as e:
        result[p] = {"__error__": str(e)}
json.dump(result, open(out, "w"))
'''


def run_old_importer(rev: str, tefs: list) -> dict:
    """{tef path: otf dict} from the importer at ``rev`` (subprocess, temp copy)."""
    with tempfile.TemporaryDirectory(prefix='tef-old-') as tmp:
        tmp = Path(tmp)
        tar = subprocess.run(
            ['git', '-C', str(ROOT), 'archive', rev,
             'sources/banjo-hangout/src', 'scripts/lib', 'docs/schema'],
            check=True, capture_output=True).stdout
        subprocess.run(['tar', '-x', '-C', str(tmp)], input=tar, check=True)
        listing, out = tmp / 'list.json', tmp / 'out.json'
        listing.write_text(json.dumps([str(p) for p in tefs]))
        subprocess.run([sys.executable, '-c', _OLD_WORKER, str(tmp), str(listing), str(out)],
                       check=True, stdout=subprocess.DEVNULL, cwd=tmp)
        return json.loads(out.read_text())


def run_new_importer(tefs: list) -> dict:
    sys.path.insert(0, str(ROOT / 'sources' / 'banjo-hangout' / 'src'))
    from converter import notation_sanity_error
    from tef_parser import TEFReader, tef_to_otf
    result = {}
    for p in tefs:
        try:
            doc = tef_to_otf(TEFReader(str(p)).parse()).to_dict()
            err = notation_sanity_error(doc.get('notation') or {})
            result[str(p)] = {'__error__': err} if err else doc
        except Exception as e:  # noqa: BLE001
            result[str(p)] = {'__error__': str(e)}
    return result


# --------------------------------------------------------------------- main

def collect_works(root: Path):
    import yaml
    for wy in sorted((root / 'works').glob('*/work.yaml')):
        data = yaml.safe_load(wy.read_text(encoding='utf-8')) or {}
        for part in data.get('parts') or []:
            if part.get('format') == 'otf' and part.get('file'):
                yield wy.parent / part['file'], part.get('provenance') or {}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dry-run', action='store_true', help='print what would change, write nothing')
    ap.add_argument('--previous-rev', default=PREVIOUS_REV)
    ap.add_argument('--root', type=Path, default=ROOT)
    args = ap.parse_args(argv)
    root = args.root

    from otf_schema import check

    works, no_tef = [], []
    for path, prov in collect_works(root):
        if provenance_skip(prov):
            works.append((path, prov, None))
            continue
        tef = tef_for_provenance(root, prov)
        if tef:
            works.append((path, prov, tef))
        else:
            no_tef.append(path)
    parsed = []
    for path in sorted(root.glob('sources/*/parsed/*.otf.json')):
        existing = json.loads(path.read_text(encoding='utf-8'))
        tef = tef_for_parsed(root, path, existing)
        if tef:
            parsed.append((path, existing, tef))

    tefs = sorted({t for _, _, t in works if t} | {t for _, _, t in parsed})
    old = run_old_importer(args.previous_rev, tefs)
    new = run_new_importer(tefs)

    report = {'refresh': [], 'submitted': [], 'corrected': [], 'mismatch': [],
              'new_failed': [], 'no_tef': no_tef}
    writes, bugs = [], []
    for path, prov, tef in works:
        existing = json.loads(path.read_text(encoding='utf-8'))
        why = provenance_skip(prov)
        if why:
            report[why].append(path)
            continue
        o, n = old[str(tef)], new[str(tef)]
        if '__error__' in o or '__error__' in n:
            report['mismatch'].append((path, f'importer error: {o.get("__error__") or n.get("__error__")}'))
            continue
        action, detail = decide_part(prov, existing, o, n)
        if action == 'mismatch':
            report['mismatch'].append((path, detail))
            continue
        doc = refreshed(existing, n)
        errors, _ = check(doc)
        if errors:
            bugs.append((path, errors[:3]))
            continue
        report['refresh'].append(path)
        writes.append((path, doc))
    regen = []
    for path, existing, tef in parsed:
        n = new[str(tef)]
        if '__error__' in n:
            report['new_failed'].append((path, n['__error__']))
            continue
        doc = regenerated(existing, n, tef.name)
        errors, _ = check(doc)
        if errors:
            bugs.append((path, errors[:3]))
            continue
        regen.append(path)
        writes.append((path, doc))

    print(f'works: refresh {len(report["refresh"])}, submitted {len(report["submitted"])}, '
          f'corrected {len(report["corrected"])}, mismatch {len(report["mismatch"])}, '
          f'no TEF on disk {len(no_tef)}')
    for path, field in report['mismatch']:
        print(f'  mismatch {path.relative_to(root)}: {field}')
    for key in ('submitted', 'corrected'):
        for path in report[key]:
            print(f'  {key} {path.relative_to(root)}')
    print(f'parsed: regenerate {len(regen)}, importer failed {len(report["new_failed"])}')
    for path, err in report['new_failed']:
        print(f'  failed {path.relative_to(root)}: {err}')
    if bugs:
        print('BUG: new importer output fails the schema; nothing written:')
        for path, errors in bugs:
            print(f'  {path.relative_to(root)}: {errors}')
        return 2
    if args.dry_run:
        print('dry run: nothing written')
        return 0
    for path, doc in writes:
        text = serialize(doc)
        if path.read_text(encoding='utf-8') != text:
            path.write_text(text, encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
