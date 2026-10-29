"""TablEdit's own MIDI for a bend (G15d2): the shape the player must match.

spike/oracle/Welcome to New York - Bill Emerson.mid is TablEdit's Rich-MIDI
export (one MIDI channel per string). Its pitch-bend range is +-8 semitones
(1024 units each), and the bend at tick 3527 ramps to +1.0 semitone under ONE
note-on that covers the source and the destination.
docs/js/__tests__/bends.test.js asserts the player produces the same shape.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "spike"))

from midi_reader import read_midi  # noqa: E402

ORACLE = (Path(__file__).parent.parent.parent / "spike" / "oracle"
          / "Welcome to New York - Bill Emerson.mid")
UNITS_PER_SEMITONE = 8192 // 8


def test_bend_is_one_note_on_ramping_to_the_fret_difference():
    banjo = read_midi(ORACLE).tracks[1]
    ramp = [b for b in banjo.bends if b.channel == 2 and 3500 < b.tick < 3800]
    semitones = [(b.value - 8192) / UNITS_PER_SEMITONE for b in ramp]
    assert semitones == sorted(semitones)             # a ramp, never back down
    assert semitones[-1] == 1.0                       # the fret difference (3 -> 4)

    covering = [n for n in banjo.notes
                if n.channel == 2 and n.tick <= ramp[0].tick < n.tick + n.duration]
    assert len(covering) == 1                         # one attack, no re-pick
    assert covering[0].tick + covering[0].duration > ramp[-1].tick
