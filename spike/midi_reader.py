"""Minimal stdlib Standard MIDI File reader for the Rich-MIDI oracle leg.

TablEdit's "Rich Tablature MIDI" export encodes EVERY module (track) of
a TEF file, one SMF track per module, with each STRING on its own MIDI
channel — which is what lets us recover string/fret (not just pitch)
and per-string pitch bends (chokes). Repeats are unrolled in the MIDI.

Pure stdlib, same policy as the TEF parser.
"""

import struct
from dataclasses import dataclass, field


@dataclass
class MidiNote:
    tick: int          # absolute MIDI ticks from track start
    channel: int
    pitch: int
    velocity: int
    duration: int = 0  # filled when the matching note-off arrives


@dataclass
class MidiBend:
    tick: int
    channel: int
    value: int         # 14-bit, centered at 8192


@dataclass
class MidiTrack:
    name: str = ''
    notes: list = field(default_factory=list)
    bends: list = field(default_factory=list)
    programs: dict = field(default_factory=dict)   # channel -> program
    channels: set = field(default_factory=set)


@dataclass
class MidiFile:
    format: int = 1
    division: int = 240   # ticks per quarter
    tracks: list = field(default_factory=list)
    tempos: list = field(default_factory=list)     # (tick, usec_per_quarter)
    time_signatures: list = field(default_factory=list)  # (tick, num, den)


def _read_varlen(data: bytes, pos: int):
    value = 0
    while True:
        b = data[pos]
        pos += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            return value, pos


def read_midi(path) -> MidiFile:
    data = open(path, 'rb').read()
    if data[:4] != b'MThd':
        raise ValueError(f'not a MIDI file: {path}')
    fmt, ntrks, division = struct.unpack('>HHH', data[8:14])
    mf = MidiFile(format=fmt, division=division)

    pos = 8 + struct.unpack('>I', data[4:8])[0]
    for _ in range(ntrks):
        if data[pos:pos + 4] != b'MTrk':
            raise ValueError(f'expected MTrk at {pos}')
        length = struct.unpack('>I', data[pos + 4:pos + 8])[0]
        end = pos + 8 + length
        p = pos + 8

        track = MidiTrack()
        tick = 0
        running = None
        open_notes = {}  # (channel, pitch) -> MidiNote

        while p < end:
            delta, p = _read_varlen(data, p)
            tick += delta
            status = data[p]
            if status & 0x80:
                p += 1
                if status < 0xF0:
                    running = status
            else:
                status = running

            kind = status & 0xF0
            channel = status & 0x0F

            if kind == 0x90:  # note on
                pitch, vel = data[p], data[p + 1]
                p += 2
                if vel > 0:
                    note = MidiNote(tick=tick, channel=channel, pitch=pitch, velocity=vel)
                    track.notes.append(note)
                    track.channels.add(channel)
                    open_notes[(channel, pitch)] = note
                else:  # running-status note-off
                    n = open_notes.pop((channel, pitch), None)
                    if n:
                        n.duration = tick - n.tick
            elif kind == 0x80:  # note off
                pitch = data[p]
                p += 2
                n = open_notes.pop((channel, pitch), None)
                if n:
                    n.duration = tick - n.tick
            elif kind == 0xE0:  # pitch wheel
                lsb, msb = data[p], data[p + 1]
                p += 2
                track.bends.append(MidiBend(tick=tick, channel=channel,
                                            value=(msb << 7) | lsb))
                track.channels.add(channel)
            elif kind == 0xC0:  # program change
                track.programs[channel] = data[p]
                p += 1
            elif kind in (0xA0, 0xB0):  # aftertouch, controller
                p += 2
            elif kind == 0xD0:  # channel pressure
                p += 1
            elif status == 0xFF:  # meta
                meta = data[p]
                p += 1
                length_, p = _read_varlen(data, p)
                payload = data[p:p + length_]
                p += length_
                if meta == 0x03:
                    track.name = payload.decode('latin-1', 'replace')
                elif meta == 0x51:
                    mf.tempos.append((tick, int.from_bytes(payload[:3], 'big')))
                elif meta == 0x58 and length_ >= 2:
                    mf.time_signatures.append((tick, payload[0], 1 << payload[1]))
                elif meta == 0x2F:
                    break
            elif status in (0xF0, 0xF7):  # sysex
                length_, p = _read_varlen(data, p)
                p += length_
            else:
                raise ValueError(f'unhandled status {status:#x} at {p}')

        mf.tracks.append(track)
        pos = end

    return mf
