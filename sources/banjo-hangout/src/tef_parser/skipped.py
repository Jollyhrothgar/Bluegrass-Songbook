"""Count what a TablEdit file holds that OTF does not keep (G15e).

``count_skipped`` walks the raw component records, independent of the
importers' note decoding, and returns ``{key: count}`` with the keys in the
order of ``SKIPPED_KEYS``. Only non-zero counts are returned. The JS twin is
``docs/js/tef-import/skipped.js``; the two must agree (golden-gated). The
label shown to readers for each key lives in ``docs/js/tef-skipped.js`` and in
the ``x_source`` description of ``docs/schema/otf.schema.json``.

Counted (TablEdit's component types, V3 type byte / V2 fret byte):

    tempo_changes        0xfe                          (V2: same byte)
    instrument_changes   0x7e MIDI patch change
    scale_diagrams       0x75                          (V2 0x3c 0x7c 0xbc)
    accents              0x37 accent, 0x38 crescendo   (V2 0x1e 0x9e)
    slurs                0x3d slur / bracket           (V2 0x3d)
    picking_marks        0x3e stroke with no note      (V2 0x3e)
    special_characters   0xf5 special char, 0xb6 sign  (V2 0x5d 0xdd)
    percussion           0x78                          (V2 0xde)
    lyrics               non-blank lines of the V3 u16-string at pointer 0x4C
    tapping              notes with effect 9 (the kind is kept as fx, the amount is not)
    vibrato              notes with effect 10 (same)
    tremolo_bar          notes with attribute 5 or 6
    other                a component type the importer does not recognise

NOT counted, because they do not change what the tab says: rests (0x33),
voices, line breaks and spacing / layout marks (0x36, 0x7d, 0x9d, 0xbd, 0xbe,
0xfd), and anything an importer already keeps (text 0x39, time signatures,
reading guides 0xb7 / V2 0x5e). Chord diagrams (0x35, V2 0x1c/0x5c/0x9c) are
the chord-diagram importer's: it adds ``chord_diagrams`` itself, and only when
a V2 chord table fails to parse. Per-track volume and pan are not counted: the
track bytes that hold them are unknown.
"""
from __future__ import annotations

import re
import struct

SKIPPED_KEYS = [
    "tempo_changes", "instrument_changes", "scale_diagrams", "accents",
    "slurs", "picking_marks", "special_characters", "percussion",
    "chord_diagrams", "lyrics", "tapping", "vibrato", "tremolo_bar", "other",
]

# V3 component type byte (compared whole: 0x35 chord vs 0x75 scale vs 0xf5
# special character) -> key.
V3_COUNTED = {
    0x37: "accents", 0x38: "accents", 0x3d: "slurs", 0x3e: "picking_marks",
    0x75: "scale_diagrams", 0x78: "percussion", 0x7e: "instrument_changes",
    0xb6: "special_characters", 0xf5: "special_characters",
    0xfe: "tempo_changes",
}
# Specials that are ported, owned by another piece, or layout only.
V3_IGNORED = {0x35, 0x36, 0x39, 0x7d, 0xb7, 0xbd, 0xbe, 0xfd}
V3_REST = 0x33

# V2 fret byte (whole byte; low 5 bits >= 0x1a) -> key, per TablEdit's V2
# upgrade FUN_1000459c4 and the by-type-byte rows of the census.
V2_COUNTED = {
    0x1e: "accents", 0x9e: "accents", 0x3d: "slurs", 0x3e: "picking_marks",
    0x3c: "scale_diagrams", 0x7c: "scale_diagrams", 0xbc: "scale_diagrams",
    0x5d: "special_characters", 0xdd: "special_characters",
    0xde: "percussion", 0x7e: "instrument_changes", 0xfe: "tempo_changes",
}
V2_IGNORED = {0x1a, 0x1d, 0x1c, 0x5c, 0x9c, 0x5e, 0x7d, 0x9d, 0xbd, 0xbe, 0xfd}
V2_TIME_SIGNATURE = 0x1b          # low 5 bits, any flags
V2_LAYOUT_CODES = {0x0b, 0x0c, 0x0d, 0x0e, 0xc0, 0xd0}

EFFECT_TAPPING, EFFECT_VIBRATO = 9, 10
TREMOLO_BAR_ATTRIBUTES = (5, 6)

V3_LYRICS_PTR = 0x4C
V3_POINTER_RANGE = range(0x40, 0xA0, 4)


def _tremolo_bar(attribute: int) -> bool:
    return attribute >> 4 != 3 and attribute & 0x0F in TREMOLO_BAR_ATTRIBUTES


def _lyric_lines(data: bytes) -> int:
    """Non-blank lines of the u16-length string at pointer 0x4C."""
    if len(data) < V3_LYRICS_PTR + 4:
        return 0
    ptr = struct.unpack_from("<I", data, V3_LYRICS_PTR)[0]
    if not 0 < ptr <= len(data) - 2:
        return 0
    length = struct.unpack_from("<H", data, ptr)[0]
    text = data[ptr + 2:ptr + 2 + length]
    return sum(1 for line in re.split(rb"[\r\n]+", text)
               if line.strip(b" \t\x00"))


def _count_v3(data: bytes, counts: dict[str, int]) -> None:
    if len(data) < 0x40:
        return
    start = struct.unpack_from("<I", data, 0x3C)[0]
    if start < 0x100 or start >= len(data):
        return
    end = len(data)
    for ptr in V3_POINTER_RANGE:
        target = struct.unpack_from("<I", data, ptr)[0]
        if start < target < end:
            end = target
    offset = start
    while offset + 12 <= end:
        rec = data[offset:offset + 12]
        offset += 12
        if struct.unpack_from("<I", rec, 0)[0] == 0xFFFFFFFF:
            break
        kind = rec[4]
        if kind & 0x3F < V3_REST:
            low = kind & 0x1F
            if 1 <= low <= 0x19:                      # a note
                effect = rec[6] & 0x0F
                if effect == EFFECT_TAPPING:
                    counts["tapping"] = counts.get("tapping", 0) + 1
                elif effect == EFFECT_VIBRATO:
                    counts["vibrato"] = counts.get("vibrato", 0) + 1
                if _tremolo_bar(rec[8]):
                    counts["tremolo_bar"] = counts.get("tremolo_bar", 0) + 1
            continue
        if kind & 0x3F == V3_REST or kind in V3_IGNORED:
            continue
        key = V3_COUNTED.get(kind, "other")
        counts[key] = counts.get(key, 0) + 1


def _count_v2(data: bytes, header, stride: int, counts: dict[str, int]) -> None:
    offset = header.v2_component_offset
    for _ in range(header.v2_component_count):
        if offset + stride > len(data):
            break
        rec = data[offset:offset + stride]
        offset += stride
        fret_byte = rec[2]
        raw = fret_byte & 0x1F
        if raw == V2_TIME_SIGNATURE:
            continue
        if 0x01 <= raw <= 0x19 or (raw == 0x1A and fret_byte != 0x1A):
            if stride < 6:
                continue                              # 4-byte layout: no effects
            if not fret_byte & 0x80 and rec[5] == 0x07:
                continue                              # chord overlay, dropped on import
            effect = rec[4] & 0x0F
            if effect == EFFECT_TAPPING:
                counts["tapping"] = counts.get("tapping", 0) + 1
            elif effect == EFFECT_VIBRATO:
                counts["vibrato"] = counts.get("vibrato", 0) + 1
            if (fret_byte & 0xE0 == 0x80 and rec[5] not in V2_LAYOUT_CODES
                    and _tremolo_bar(rec[5])):
                counts["tremolo_bar"] = counts.get("tremolo_bar", 0) + 1
            continue
        if raw < 0x1A or fret_byte in V2_IGNORED:     # raw 0 is filler
            continue
        key = V2_COUNTED.get(fret_byte, "other")
        counts[key] = counts.get(key, 0) + 1


def count_skipped(data: bytes, header, stride: int = 6) -> dict[str, int]:
    """What this file holds that OTF does not keep: ``{key: count}``, non-zero only."""
    counts: dict[str, int] = {}
    if header.is_v2:
        _count_v2(data, header, stride, counts)
    else:
        _count_v3(data, counts)
        lyrics = _lyric_lines(data)
        if lyrics:
            counts["lyrics"] = lyrics
    return {k: counts[k] for k in SKIPPED_KEYS if counts.get(k)}
