"""Rich-MIDI oracle leg: verify an OTF against TablEdit's Rich Tablature
MIDI export — ALL modules, not just the one MusicXML shows.

What the MIDI gives us (from inspecting the three samples):
- format 1; division typically 240 (scale ticks by 480/division)
- one SMF track per TEF module, names matching the TEF track names
- repeats UNROLLED (the OTF side must unroll via its reading_list)
- per-string channels only when 16 channels suffice (Jerusalem Ridge's
  19 strings don't fit, so most tracks collapse to one channel) —
  therefore we verify (tick, PITCH) multisets per track, which is
  string-agnostic but exact: pitch = sounding tuning + fret
- pitch bends = chokes (per-channel), a later recovery target

Usage:
    python3 spike/midi_verify.py <parsed.otf.json> <export.mid>

Verdict mirrors oracle_verify.py: VERIFIED requires every track to
match 100% (Mike's policy: heuristics are triage, never a stopping
point).
"""

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from midi_reader import read_midi

PITCH = {}
for i, name in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']):
    for octave in range(9):
        PITCH[f'{name}{octave}'] = 12 + octave * 12 + i

TPQ = 480  # our tick domain


def measure_ticks_map(otf):
    """Written measure -> tick length (ts-change aware)."""
    num, den = (otf['metadata'].get('time_signature') or '4/4').split('/')
    default = int(int(num) * (4 / int(den)) * TPQ)
    overrides = {}
    for c in otf['metadata'].get('time_signature_changes', []) or []:
        n, d = c['time_signature'].split('/')
        overrides[c['measure']] = int(int(n) * (4 / int(d)) * TPQ)
    return default, overrides


def unrolled_starts(otf, max_measure):
    """Playback-order (display) list of written measures + abs start ticks,
    honoring the reading list (repeats unrolled, like the MIDI)."""
    rl = otf.get('reading_list') or []
    order = []
    if rl:
        for r in rl:
            order.extend(range(r['from_measure'], r['to_measure'] + 1))
    else:
        order = list(range(1, max_measure + 1))

    default, overrides = measure_ticks_map(otf)
    starts = []
    t = 0
    for m in order:
        starts.append((m, t))
        t += overrides.get(m, default)
    return starts


def otf_track_events(otf, track):
    """Unrolled (absTick, pitch) pairs for one track. Tie continuations
    are skipped (MIDI does not re-attack them)."""
    notation = otf['notation'].get(track['id']) or []
    by_measure = {m['measure']: m for m in notation}
    max_measure = max((m['measure'] for m in notation), default=1)
    tuning = [PITCH[p] for p in track['tuning']]

    out = []
    for written, start in unrolled_starts(otf, max_measure):
        m = by_measure.get(written)
        if not m:
            continue
        for e in m['events']:
            for n in e['notes']:
                if n.get('tie'):
                    continue
                out.append((start + e['tick'], tuning[n['s'] - 1] + n['f']))
    return out


def detect_swing(want, got, beat=TPQ):
    """If every mismatch is an OFF-BEAT onset shifted by one uniform
    positive delta, that's TablEdit swing/shuffle PLAYBACK on this
    module (notation is straight; 27493's banjo plays off-beat eighths
    +40 ticks). Returns the delta or None.

    Pure verification logic: the notation is verified EXACTLY once the
    documented playback transform is accounted for.
    """
    missing = sorted((want - got).elements())
    extra = sorted((got - want).elements())
    if not missing or len(missing) != len(extra):
        return None

    by_pitch_m, by_pitch_e = {}, {}
    for t, p in missing:
        by_pitch_m.setdefault(p, []).append(t)
    for t, p in extra:
        by_pitch_e.setdefault(p, []).append(t)
    if set(by_pitch_m) != set(by_pitch_e):
        return None

    deltas = set()
    for p, ts in by_pitch_m.items():
        es = by_pitch_e[p]
        if len(ts) != len(es):
            return None
        for a, b in zip(ts, es):
            deltas.add(b - a)
            if a % beat != beat // 2:   # only off-beats swing
                return None
    if len(deltas) == 1:
        d = deltas.pop()
        if 0 < d < beat // 2:
            return d
    return None


def apply_swing(events, delta, beat=TPQ):
    return [(t + delta if t % beat == beat // 2 else t, p) for t, p in events]


def match_tracks(otf, midi):
    """Pair OTF tracks with MIDI tracks by (normalized) name."""
    pairs = []
    midi_named = [(t.name.strip().lower(), t) for t in midi.tracks if t.notes]
    for track in otf['tracks']:
        tid = track['id'].lower()
        best = None
        for name, mt in midi_named:
            if tid in name or name in tid or name.startswith(tid):
                best = mt
                break
        pairs.append((track, best))
    return pairs


def verify(otf_path, midi_path):
    otf = json.loads(Path(otf_path).read_text())
    midi = read_midi(midi_path)
    scale = TPQ / midi.division

    report = {'file': str(otf_path), 'midi': str(midi_path), 'tracks': {}}
    all_exact = True
    for track, mt in match_tracks(otf, midi):
        if mt is None:
            report['tracks'][track['id']] = {'error': 'no MIDI track matched'}
            all_exact = False
            continue
        events = otf_track_events(otf, track)
        want = Counter(events)
        got = Counter((round(n.tick * scale), n.pitch) for n in mt.notes)

        swing = None
        if want != got:
            swing = detect_swing(want, got)
            if swing is not None:
                want = Counter(apply_swing(events, swing))

        missing = want - got
        extra = got - want
        exact = sum((want & got).values())
        report['tracks'][track['id']] = {
            'swing': swing,
            'otf': sum(want.values()),
            'midi': sum(got.values()),
            'exact': exact,
            'missing': sorted(missing.elements())[:10],
            'missing_count': sum(missing.values()),
            'extra': sorted(extra.elements())[:10],
            'extra_count': sum(extra.values()),
            'bends': len(mt.bends),
        }
        if missing or extra:
            all_exact = False

    report['verdict'] = 'VERIFIED' if all_exact else 'DIVERGED'
    return report


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    report = verify(sys.argv[1], sys.argv[2])
    for tid, r in report['tracks'].items():
        if 'error' in r:
            print(f"{tid}: {r['error']}")
            continue
        swing = f" swing=+{r['swing']}" if r.get('swing') else ''
        print(f"{tid}: otf={r['otf']} midi={r['midi']} exact={r['exact']} "
              f"missing={r['missing_count']} extra={r['extra_count']} bends={r['bends']}{swing}")
        if r['missing_count']:
            print(f"   missing (tick,pitch): {r['missing'][:6]}")
        if r['extra_count']:
            print(f"   extra   (tick,pitch): {r['extra'][:6]}")
    print('VERDICT:', report['verdict'])


if __name__ == '__main__':
    main()
