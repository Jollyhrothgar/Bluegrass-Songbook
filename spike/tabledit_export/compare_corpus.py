"""Compare TablEdit exports with our parser, note by note.

    uv run python spike/tabledit_export/compare_corpus.py [OUT_DIR]

Reads OUT_DIR/xml and OUT_DIR/otf (see export_corpus.py), writes
OUT_DIR/compare.json and prints every file that is not VERIFIED.
"""
import glob, json, os, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__))
S = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out')
sys.path.insert(0, os.path.dirname(HERE))
from oracle_verify import xml_parts, normalize_slides

def otf_tracks(path):
    # as oracle_verify.otf_tracks, but bend targets ('b') are excluded like
    # ties: TablEdit's export folds them into the bend on the source note.
    otf = json.load(open(path)); out = {}
    for t in otf['tracks']:
        ms = otf['notation'].get(t['id'], [])
        out[t['id']] = sorted((m['measure'], ev['tick'], n['s'], n['f'], n.get('dur'),
                               n.get('tech') if n.get('tech') in ('h', 'p', '/') else None)
                              for m in ms for ev in m['events'] for n in ev['notes']
                              if not n.get('tie') and n.get('tech') != 'b')
    return out
res = {}
for x in sorted(glob.glob(f'{S}/xml/*.xml')):
    key = os.path.basename(x)[:-4]; o = f'{S}/otf/{key}.json'
    try:
        parts = [normalize_slides(p) for p in xml_parts(x)]
    except Exception as e:
        res[key] = {'verdict': 'XML-ERR', 'detail': str(e)}; continue
    tracks = {t: normalize_slides(n) for t, n in otf_tracks(o).items()}
    if len(parts) == len(tracks):
        pairs = list(zip(tracks, parts))
    else:  # pair each part with its best-overlapping unused track
        pairs, used = [], set()
        for p in parts:
            best = max((t for t in tracks if t not in used),
                       key=lambda t: len(set(tracks[t]) & set(p)), default=None)
            if best: used.add(best); pairs.append((best, p))
    per = {}
    for t, p in pairs:
        a, b = set(tracks[t]), set(p)
        # oracle_verify's DOUBLE-STOP allowance: the export puts a
        # double-stop slur on one string only.
        for extra in list(a - b):
            m, tk, s_, f, dur, tech = extra
            if tech and (m, tk, s_, f, dur, None) in b and any(
                    x[0] == m and x[1] == tk and x[2] != s_ and x[5] == tech for x in b):
                a.discard(extra); a.add((m, tk, s_, f, dur, None))
        per[t] = {'otf': len(a), 'xml': len(b), 'exact': len(a & b),
                  'otf_only': sorted(a - b), 'xml_only': sorted(b - a)}
    unpaired = {t: len(tracks[t]) for t in tracks if t not in per and tracks[t]}
    ok = all(v['otf'] == v['xml'] == v['exact'] for v in per.values())
    res[key] = {'verdict': 'VERIFIED' if ok and not unpaired else ('UNPAIRED' if ok else 'DIVERGED'),
                'parts': len(parts), 'tracks': len(tracks), 'per': per, 'unpaired': unpaired}
json.dump(res, open(f'{S}/compare.json', 'w'), default=list)
c = collections.Counter(r['verdict'] for r in res.values()); print(dict(c))
for k, r in res.items():
    if r['verdict'] != 'VERIFIED':
        print(k, r['verdict'], r.get('detail', ''), {t: (v['exact'], v['otf'], v['xml']) for t, v in r.get('per', {}).items() if v['exact'] != v['otf'] or v['otf'] != v['xml']}, r.get('unpaired') or '')
