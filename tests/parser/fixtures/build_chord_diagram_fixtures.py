"""Build the two feature-isolating chord-diagram fixtures (G15d3).

    uv run python tests/parser/fixtures/build_chord_diagram_fixtures.py

writes ``chord_diagrams_v3.tef`` and ``chord_diagrams_v2.tef`` next to this
file. They are tiny, hand-assembled TEF files (no TablEdit needed) that
carry nothing but a banjo track, a guitar track, a couple of notes and the
chord-diagram table plus its anchors, laid out exactly as ``reader.py``
reads them (V3: table at header pointer 88; V2: u16 count at offset 236,
32-byte records after the text table). ``tests/test_tef_chord_diagrams.py``
and the JS ``chord-diagrams-import.test.js`` assert on both files and
that the committed bytes equal what this script builds.

Both files describe the same song:

  chords table (index: what it exercises)
    0 "G"    guitar shape with fingers
    1 "Am7"  name-only (every string 0xff)
    2 "D"    banjo shape, no fingers
    3 "C7"   never referenced (the table keeps it); V2 leaves 0x00 junk
             past the strings
    4 "F"    first fret 3; V3 stores string count 4 in byte 32

  anchors (measure, position in 64ths, string row -> track)
    m1 +0   guitar row 5  -> chord 0
    m1 +16  banjo  row 0  -> chord 2
    m2 +0   banjo  row 1  -> chord 1 (V3: dy -5, dx 3)
    m2 +32  guitar row 7  -> chord 4
"""
import struct
from pathlib import Path

HERE = Path(__file__).parent

BANJO_TUNING = [62, 59, 55, 50, 67]          # D4 B3 G3 D3 g4
GUITAR_TUNING = [64, 59, 55, 50, 45, 40]     # E4 B3 G3 D3 A2 E2
NOT_PLAYED = 0xFF


def shape(frets, fingers=None):
    """14 per-string bytes: fret | (finger + 1) << 5, 0xff = not played."""
    out = []
    for i, f in enumerate(frets):
        if f is None:
            out.append(NOT_PLAYED)
        else:
            finger = fingers[i] if fingers else None
            out.append(f | ((finger + 1) << 5 if finger else 0))
    return bytes(out) + bytes([NOT_PLAYED]) * (14 - len(out))


# (strings, name, first_fret, byte32 -- V3 only)
CHORDS = [
    (shape([3, 0, 0, 0, 2, 3], [3, None, None, None, 1, 2]), "G", 1, 0),
    (bytes([NOT_PLAYED]) * 14, "Am7", 1, 0),
    (shape([0, 3, 2, 0, 0]), "D", 1, 0),
    (shape([0, 1, 0, 2, 3]), "C7", 1, 0),
    (shape([1, 3, 3, 2]), "F", 3, 4),
]
# V2 leaves stale 0x00 bytes past the strings of the unreferenced record.
V2_JUNK = {3: bytes([0, 0])}

# (measure index from 0, position, string row, chord index, dy, dx)
ANCHORS = [
    (0, 0, 5, 0, 0, 0),
    (0, 16, 0, 2, 0, 0),
    (1, 0, 1, 1, -5, 3),
    (1, 32, 7, 4, 0, 0),
]


def chord_record(i, size):
    strings, name, first, b32 = CHORDS[i]
    rec = bytearray(strings)
    if size == 32 and i in V2_JUNK:
        rec[12:14] = V2_JUNK[i]
    rec += name.encode("ascii").ljust(17, b"\0")
    rec.append(first)
    if size == 36:
        rec += bytes([b32, 0, 0, 0])
    assert len(rec) == size
    return bytes(rec)


def build_v3() -> bytes:
    head = bytearray(0x100)
    head[3] = 0x03
    head[205] = 0x0A
    head[0x38:0x3C] = b"tbed"
    head[6:8] = struct.pack("<H", 120)

    tracks = struct.pack("<HH", 68, 2)
    first = 0
    for name, tuning in (("Banjo", BANJO_TUNING), ("Guitar", GUITAR_TUNING)):
        rec = bytearray(68)
        rec[0:4] = struct.pack("<HH", len(tuning), first)
        rec[8:10] = struct.pack("<H", 105 if name == "Banjo" else 25)
        for k, pitch in enumerate(tuning):
            rec[20 + k] = 96 - pitch
        rec[32:32 + len(name)] = name.encode()
        tracks += bytes(rec)
        first += len(tuning)
    total = first

    texts = struct.pack("<H", 1) + struct.pack("<H", 2) + b"G\0"
    chords = struct.pack("<HH", 36, len(CHORDS)) + b"".join(
        chord_record(i, 36) for i in range(len(CHORDS)))

    def cell(measure, pos, row, type_byte, b5=0, b6=0, b7=0, b8=0):
        loc = 8 * ((measure * 64 + pos) * total + row)
        return struct.pack("<IBBBBBBBB", loc, type_byte, b5, b6, b7, b8, 0, 0, 0)

    comps = [
        cell(0, 0, 0, 0x01, 0x03),          # banjo open string 1, quarter note
        cell(0, 0, 5, 0x01, 0x03),          # guitar open string 1
        cell(1, 0, 0, 0x01, 0x03),          # measure 2 has notes too, so it is drawn
        cell(1, 0, 5, 0x01, 0x03),
        cell(0, 0, 0, 0x75, 0, 0, 0, 0),    # scale diagram: NOT a chord anchor
        cell(0, 8, 0, 0xF5, 0x70, 0x10),    # special character: NOT a chord anchor
        cell(0, 8, 0, 0x39, 0),             # text "G" at the same spot as nothing
    ]
    for m, pos, row, idx, dy, dx in ANCHORS:
        comps.append(cell(m, pos, row, 0x35, idx & 0xFF, idx >> 8, dy & 0xFF, dx & 0xFF))
    comps.append(struct.pack("<I", 0xFFFFFFFF) + bytes(8))

    body = bytearray()
    ptrs = {}
    for key, blob in (("tracks", tracks), ("texts", texts), ("chords", chords)):
        ptrs[key] = 0x100 + len(body)
        body += blob
    ptrs["comps"] = 0x100 + len(body)
    body += b"".join(comps)
    head[0x3C:0x40] = struct.pack("<I", ptrs["comps"])
    head[84:88] = struct.pack("<I", ptrs["texts"])
    head[88:92] = struct.pack("<I", ptrs["chords"])
    head[0x60:0x64] = struct.pack("<I", ptrs["tracks"])
    title = b"Chord Diagrams V3\0"
    head[0xC0:0xC2] = struct.pack("<H", len(title))
    head[0xC2:0xC2 + len(title)] = title
    return bytes(head + body)


def build_v2() -> bytes:
    head = bytearray(258)
    head[0:0x30] = b"Chord Diagrams V2\0composer\0comments\0".ljust(0x30, b"\0")
    head[200:202] = struct.pack("<H", 2)       # measures
    head[202] = 4                              # 4/4
    head[204] = 4
    head[205] = 3
    head[220:222] = struct.pack("<H", 120)
    head[228:230] = struct.pack("<H", 1)       # one free text
    head[236:238] = struct.pack("<H", len(CHORDS))
    head[240] = 11                             # banjo 5 + guitar 6 strings
    head[241] = 1                              # tracks - 1

    ts, strings = 256, 11

    def comp(measure, pos, row, fret_byte, b3):
        loc = pos * 4 + ts * (row + strings * measure)   # pos in 64ths -> 256 grid
        return struct.pack("<HBBBB", loc, fret_byte, b3, 0, 0)

    comps = [
        comp(0, 0, 0, 0x01, 0x03),             # banjo open string 1, quarter note
        comp(0, 0, 5, 0x01, 0x03),             # guitar open string 1
        comp(1, 0, 0, 0x01, 0x03),             # measure 2 has notes too, so it is drawn
        comp(1, 0, 5, 0x01, 0x03),
    ]
    fret_bytes = [0x1C, 0x1C, 0x5C, 0x9C]      # all three V2 anchor codes
    for (m, pos, row, idx, _dy, _dx), fb in zip(ANCHORS, fret_bytes):
        comps.append(comp(m, pos, row, fb, idx))
    # the stream runs measure by measure (a falling measure number means overflow)
    comps.sort(key=lambda c: struct.unpack("<H", c[:2])[0] // (ts * strings))
    head[256:258] = struct.pack("<H", len(comps))

    texts = struct.pack("<H", 2) + b"G\0"
    chords = b"".join(chord_record(i, 32) for i in range(len(CHORDS)))
    tracks = b""
    first = 0
    for name, tuning in (("Banjo", BANJO_TUNING), ("Guitar", GUITAR_TUNING)):
        rec = bytearray(50)
        rec[0:4] = struct.pack("<HH", len(tuning), first)
        rec[4:6] = struct.pack("<H", 0x63)
        rec[8] = 105 if name == "Banjo" else 25
        for k, pitch in enumerate(tuning):
            rec[20 + k] = 96 - pitch
        rec[32:32 + len(name)] = name.encode()
        tracks += bytes(rec)
        first += len(tuning)
    return bytes(head) + b"".join(comps) + texts + chords + tracks


FIXTURES = {
    "chord_diagrams_v3.tef": build_v3,
    "chord_diagrams_v2.tef": build_v2,
}

if __name__ == "__main__":
    for name, build in FIXTURES.items():
        (HERE / name).write_bytes(build())
        print("wrote", name)
