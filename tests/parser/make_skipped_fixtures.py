"""Build the two G15e "skipped" fixtures from real fixtures, byte by byte.

    uv run python tests/parser/make_skipped_fixtures.py

``fixtures/skipped_v3_all.tef`` is ``cherokee_shuffle_21874_v3.tef`` and
``fixtures/skipped_v2_all.tef`` is ``18998_dup_banjo.tef``, each with some
note records overwritten so the file holds a distinct number of every counted
feature (and a few records that must NOT be counted). The expected counts are
in ``EXPECTED_V3`` / ``EXPECTED_V2``; ``test_tef_skipped.py`` and
``docs/js/__tests__/tef-skipped.test.js`` both assert them. Only the type and
effect bytes change; locations are left alone so the rest of the file still
parses as before.
"""
import struct
from pathlib import Path

HERE = Path(__file__).parent / "fixtures"

EXPECTED_V3 = {
    "tempo_changes": 2, "instrument_changes": 1, "scale_diagrams": 3,
    "accents": 4, "slurs": 5, "picking_marks": 6, "special_characters": 7,
    "percussion": 8, "free_text": 3, "tapping": 9, "vibrato": 10,
    "tremolo_bar": 11, "other": 12,
}
EXPECTED_V2 = {k: v for k, v in EXPECTED_V3.items() if k != "free_text"}
# V2 has no free-text block we can count, and its specials are other bytes.

# (type byte, how many) — V3 whole-byte component types.
V3_SPECIALS = [
    (0xFE, 2), (0x7E, 1), (0x75, 3), (0x37, 2), (0x38, 2), (0x3D, 5),
    (0x3E, 6), (0xF5, 3), (0xB6, 4), (0x78, 8), (0x3B, 12),
    # not counted: rest, line break, spacing, beam break, stem length,
    # syncopation change, chord diagram, text, reading guide
    (0x33, 2), (0x36, 3), (0x7D, 1), (0xBD, 1), (0xBE, 1), (0xFD, 1),
    (0x35, 2), (0x39, 1), (0xB7, 1),
]
# V2 fret bytes, same idea.
V2_SPECIALS = [
    (0xFE, 2), (0x7E, 1), (0x3C, 1), (0x7C, 1), (0xBC, 1), (0x1E, 2),
    (0x9E, 2), (0x3D, 5), (0x3E, 6), (0x5D, 3), (0xDD, 4), (0xDE, 8),
    (0x1F, 7), (0xDC, 5),
    # not counted
    (0x1A, 2), (0x9D, 3), (0x7D, 1), (0xBD, 1), (0xBE, 1), (0xFD, 1),
    (0x1C, 2), (0x5E, 1),
]
FREE_TEXT = b"First line of notes\r\nSecond line\r\n\r\nThird line\x00"


def v3() -> bytes:
    data = bytearray((HERE / "cherokee_shuffle_21874_v3.tef").read_bytes())
    start = struct.unpack_from("<I", data, 0x3C)[0]
    i = 4
    for kind, n in V3_SPECIALS:
        for _ in range(n):
            data[start + 12 * i + 4] = kind
            i += 1
    for effect_byte, attr, n in ((9, 0, 9), (10, 0, 10), (0, 5, 6), (0, 6, 5)):
        for _ in range(n):
            rec = start + 12 * i
            assert data[rec + 4] & 0x1F in range(1, 0x1A), "patched a non-note"
            data[rec + 6] = effect_byte
            data[rec + 8] = attr
            i += 1
    assert i < (len(data) - start) // 12
    # End the component region the way TablEdit does (0xFFFFFFFF), then pad
    # with 20 zero records so parse_note_events stops before the free text.
    data += b"\xff\xff\xff\xff" + bytes(8) + bytes(12 * 20)
    # free text: a new u16-length string at the end, pointed to from 0x4C
    struct.pack_into("<I", data, 0x4C, len(data))
    data += struct.pack("<H", len(FREE_TEXT)) + FREE_TEXT
    return bytes(data)


def v2() -> bytes:
    data = bytearray((HERE / "18998_dup_banjo.tef").read_bytes())
    count = struct.unpack_from("<H", data, 256)[0]
    base = 258
    i = 4

    def next_note():
        nonlocal i
        while data[base + 6 * i + 2] & 0x1F not in range(1, 0x1A):
            i += 1
        i += 1
        return base + 6 * (i - 1)

    for kind, n in V2_SPECIALS:
        for _ in range(n):
            data[next_note() + 2] = kind
    for effect, attr, n in ((9, 0, 9), (10, 0, 10), (0, 5, 6), (0, 6, 5)):
        for _ in range(n):
            rec = next_note()
            data[rec + 4] = effect
            if attr:
                data[rec + 2] = (data[rec + 2] & 0x1F) | 0x80
                data[rec + 5] = attr
    assert i < count
    return bytes(data)


if __name__ == "__main__":
    (HERE / "skipped_v3_all.tef").write_bytes(v3())
    (HERE / "skipped_v2_all.tef").write_bytes(v2())
    print("wrote skipped_v3_all.tef, skipped_v2_all.tef")
