"""Upgrade oracle_manifest verdicts with Rich-MIDI evidence.

A PARTIAL file (MusicXML verified its one exported module) becomes
VERIFIED when the Rich-MIDI leg confirms EVERY track at 100% — Mike's
policy: verified means the whole file matches the oracle exactly.

Usage: python3 spike/midi_upgrade.py <pid> <export.mid>
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from midi_verify import verify

MANIFEST = Path(__file__).parent / 'oracle_manifest.json'


def main():
    pid, midi_path = sys.argv[1], sys.argv[2]
    manifest = json.loads(MANIFEST.read_text())
    entry = next(e for e in manifest if e['pid'] == pid)

    report = verify(entry['otf'], midi_path)
    entry['result']['midi'] = {
        'file': str(midi_path),
        'verdict': report['verdict'],
        'tracks': {
            tid: {k: r[k] for k in ('otf', 'midi', 'exact', 'missing_count',
                                    'extra_count', 'bends', 'swing') if k in r}
            for tid, r in report['tracks'].items() if 'error' not in r
        },
    }

    old = entry['result']['verdict']
    if report['verdict'] == 'VERIFIED' and old == 'PARTIAL':
        entry['result']['verdict'] = 'VERIFIED'
        entry['result']['verified_by'] = ['musicxml', 'rich-midi']
        print(f"{pid}: PARTIAL -> VERIFIED (all {len(report['tracks'])} tracks via Rich MIDI)")
    else:
        print(f"{pid}: verdict stays {old}; midi says {report['verdict']}")

    MANIFEST.write_text(json.dumps(manifest, indent=1))


if __name__ == '__main__':
    main()
