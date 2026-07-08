"""Tests for the Rich-MIDI oracle leg (spike/midi_reader + midi_verify).

The MIDI leg verifies ALL modules of a TEF (MusicXML exports only one)
by comparing (tick, pitch) multisets per track, with per-track swing
playback detection (27493's banjo plays off-beat eighths +40 ticks —
notation is straight, playback swings).
"""

import struct
import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'spike'))

from midi_reader import read_midi  # noqa: E402
from midi_verify import (  # noqa: E402
    detect_swing, apply_swing, unrolled_starts, otf_track_events,
)


# ---------------------------------------------------------------------
# Synthetic SMF fixture
# ---------------------------------------------------------------------

def _varlen(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def _track(events):
    payload = b''
    for delta, msg in events:
        payload += _varlen(delta) + msg
    payload += b'\x00\xff\x2f\x00'  # end of track
    return b'MTrk' + struct.pack('>I', len(payload)) + payload


def synth_midi(tmp_path):
    header = b'MThd' + struct.pack('>IHHH', 6, 1, 2, 240)
    meta = _track([(0, b'\xff\x03\x05Title'),
                   (0, b'\xff\x51\x03\x07\xa1\x20'),
                   (0, b'\xff\x58\x04\x04\x02\x18\x08')])
    # channel 2: two notes (one via running status), a bend, note-offs
    music = _track([
        (0, b'\xff\x03\x05Banjo'),
        (0, b'\xc2\x69'),                 # program 105 on ch 2
        (0, b'\x92\x3e\x40'),             # note on D4
        (120, b'\x3e\x00'),               # running-status note off
        (0, b'\x40\x50'),                 # running-status note ON E4
        (60, b'\xe2\x00\x50'),            # pitch bend
        (60, b'\x82\x40\x00'),            # note off E4
    ])
    p = tmp_path / 't.mid'
    p.write_bytes(header + meta + music)
    return p


class TestMidiReader:
    def test_reads_structure_notes_and_bends(self, tmp_path):
        mf = read_midi(synth_midi(tmp_path))
        assert mf.division == 240
        assert len(mf.tracks) == 2
        assert mf.tempos == [(0, 500000)]
        assert mf.time_signatures == [(0, 4, 4)]

        t = mf.tracks[1]
        assert t.name == 'Banjo'
        assert t.programs == {2: 105}
        assert [(n.tick, n.pitch, n.duration) for n in t.notes] == [
            (0, 0x3e, 120), (120, 0x40, 120),
        ]
        assert [(b.tick, b.channel, b.value) for b in t.bends] == [(180, 2, 0x50 << 7)]

    def test_rejects_non_midi(self, tmp_path):
        p = tmp_path / 'x.mid'
        p.write_bytes(b'not midi')
        with pytest.raises(ValueError):
            read_midi(p)


class TestSwingDetection:
    def test_detects_uniform_offbeat_delay(self):
        want = Counter([(0, 60), (240, 62), (480, 64), (720, 62)])
        got = Counter([(0, 60), (280, 62), (480, 64), (760, 62)])
        assert detect_swing(want, got) == 40
        assert Counter(apply_swing(sorted(want.elements()), 40)) == got

    def test_rejects_mixed_deltas(self):
        want = Counter([(240, 62), (720, 62)])
        got = Counter([(280, 62), (770, 62)])
        assert detect_swing(want, got) is None

    def test_rejects_onbeat_shifts(self):
        want = Counter([(0, 60), (480, 64)])
        got = Counter([(40, 60), (520, 64)])
        assert detect_swing(want, got) is None

    def test_no_swing_when_exact(self):
        want = Counter([(0, 60)])
        assert detect_swing(want, Counter(want)) is None


class TestUnrolledStarts:
    OTF = {
        'metadata': {
            'time_signature': '2/2',
            'time_signature_changes': [{'measure': 3, 'time_signature': '2/4'}],
        },
        'reading_list': [
            {'from_measure': 1, 'to_measure': 4},
            {'from_measure': 3, 'to_measure': 4},
        ],
        'tracks': [{'id': 'banjo', 'tuning': ['D4', 'B3', 'G3', 'D3', 'G4']}],
        'notation': {'banjo': [
            {'measure': 3, 'events': [
                {'tick': 0, 'notes': [{'s': 1, 'f': 0}]},
                {'tick': 480, 'notes': [{'s': 1, 'f': 2, 'tie': True}]},
            ]},
        ]},
    }

    def test_short_measures_and_repeats(self):
        starts = unrolled_starts(self.OTF, 4)
        # m1=1920, m2=1920, m3(2/4)=960, m4=1920, then repeat m3..m4
        assert starts == [(1, 0), (2, 1920), (3, 3840), (4, 4800),
                          (3, 6720), (4, 7680)]

    def test_track_events_unroll_and_skip_ties(self):
        ev = otf_track_events(self.OTF, self.OTF['tracks'][0])
        # the m3 note plays in BOTH passes; the tied note never re-attacks
        assert ev == [(3840, 62), (6720, 62)]
