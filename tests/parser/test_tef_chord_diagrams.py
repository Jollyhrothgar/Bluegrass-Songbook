"""Chord diagrams (G15d3): the chord table plus its anchors, V3 and V2.

Fixtures are the two tiny hand-built files from
``fixtures/build_chord_diagram_fixtures.py`` (it documents the song they
share). The corpus test reproduces the decode session's numbers
(spike/tabledit_export/rea-2026-10-28/validate2.py): of the diagrams whose
shape can be scored against their name with the owning track's tuning,
19 of 21 match; 47 diagrams are name-only; 36 table records are never used
(35 unreferenced, plus one referenced record whose name is empty).

JS counterpart: docs/js/__tests__/chord-diagrams-import.test.js
"""

import glob
import hashlib
import re
import struct
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))
sys.path.insert(0, str(Path(__file__).parent / "fixtures"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
import build_chord_diagram_fixtures as fx  # noqa: E402
import otf_schema  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
V3 = FIXTURES / "chord_diagrams_v3.tef"
# The V3 fixture also holds one decoy 0x75 scale diagram and one 0xf5 special
# character, which the G15e report counts.
DECOYS = {"scale_diagrams": 1, "special_characters": 1}
V2 = FIXTURES / "chord_diagrams_v2.tef"

G = {"name": "G", "frets": [3, 0, 0, 0, 2, 3], "fingers": [3, None, None, None, 1, 2]}
AM7 = {"name": "Am7"}
D = {"name": "D", "frets": [0, 3, 2, 0, 0]}
C7 = {"name": "C7", "frets": [0, 1, 0, 2, 3, None]}   # unreferenced -> longest track (6)

DIAGRAMS = [
    {"measure": 1, "tick": 0, "track": "guitar", "chord": 0},
    {"measure": 1, "tick": 480, "track": "banjo", "chord": 2},
    {"measure": 2, "tick": 0, "track": "banjo", "chord": 1},
    {"measure": 2, "tick": 960, "track": "guitar", "chord": 4},
]


def otf_of(path_or_bytes, tmp_path=None):
    if isinstance(path_or_bytes, (bytes, bytearray)):
        p = tmp_path / "x.tef"
        p.write_bytes(path_or_bytes)
        path_or_bytes = p
    return tef_to_otf(TEFReader(str(path_or_bytes)).parse()).to_dict()


def test_committed_fixtures_are_what_the_builder_builds():
    for name, build in fx.FIXTURES.items():
        assert (FIXTURES / name).read_bytes() == build(), f"rerun the builder for {name}"


def test_v3_table_and_anchors():
    otf = otf_of(V3)
    # byte 32 = 4 gives F its four strings; first_fret 3 survives
    assert otf["chords"] == [G, AM7, D, C7, {"name": "F", "frets": [1, 3, 3, 2], "first_fret": 3}]
    # anchor 3 carries cell bytes dy=-5, dx=3
    expected = [dict(d) for d in DIAGRAMS]
    expected[2].update(dx=3, dy=-5)
    assert otf["chord_diagrams"] == expected
    # the fixture's decoy 0x75 / 0xf5 are counted by G15e; no diagram is dropped
    assert otf["x_source"] == {"skipped": DECOYS}


def test_v3_only_type_0x35_is_an_anchor():
    """The fixture also holds a 0x75 scale diagram and a 0xf5 special
    character: compared on the full byte, neither is a chord anchor."""
    tef = TEFReader(str(V3)).parse()
    assert len(tef.chord_anchors) == 4
    data = V3.read_bytes()
    types = {data[o + 4] for o in range(struct.unpack_from("<I", data, 0x3C)[0], len(data) - 11, 12)}
    assert {0x75, 0xF5, 0x35} <= types


def test_v2_table_and_anchors():
    """Same song through the V2 layout (0x1c, 0x5c and 0x9c anchors). V2 has no
    byte 32, so F takes its guitar track's six strings; the stale 0x00 junk
    after C7's strings is dropped."""
    otf = otf_of(V2)
    assert otf["chords"] == [G, AM7, D, C7,
                             {"name": "F", "frets": [1, 3, 3, 2, None, None], "first_fret": 3}]
    assert otf["chord_diagrams"] == DIAGRAMS


def test_name_only_record_is_just_a_name():
    assert otf_of(V3)["chords"][1] == {"name": "Am7"}


def test_unreferenced_record_is_kept():
    used = {d["chord"] for d in otf_of(V3)["chord_diagrams"]}
    assert 3 not in used
    assert otf_of(V3)["chords"][3]["name"] == "C7"


@pytest.mark.parametrize("path", [V3, V2], ids=["v3", "v2"])
def test_output_is_valid_schema_1_2(path):
    errors, _warnings = otf_schema.check(otf_of(path))
    assert errors == []


def test_text_annotation_and_diagram_coexist():
    """V3 fixture: a 0x39 text at m1 +8 stays an annotation."""
    assert otf_of(V3)["annotations"] == [{"measure": 1, "tick": 240, "text": "G", "track": "banjo"}]


def test_v2_table_that_does_not_parse_reports_the_diagrams(tmp_path):
    """A name byte below 0x20 means the 32-byte run is not chord records.
    Nothing is guessed: no chords, no diagrams, and the number of diagrams
    dropped goes to x_source.skipped.chord_diagrams (the G15e report's shape)."""
    data = bytearray(V2.read_bytes())
    # locate the first record by its name: "G" NUL at +14 of the 14 string bytes
    first = data.index(b"G\x00" + b"\x00" * 15, data.index(b"\x83\x00\x00\x00\x42"))
    data[first] = 0x01
    otf = otf_of(bytes(data), tmp_path)
    assert "chords" not in otf and "chord_diagrams" not in otf
    assert otf["x_source"] == {"skipped": {"chord_diagrams": 4}}


def test_v3_anchor_past_the_table_is_dropped_and_counted(tmp_path):
    data = bytearray(V3.read_bytes())
    # last anchor's chord index 4 -> 99
    at = struct.unpack_from("<I", data, 0x3C)[0]
    anchors = [o for o in range(at, len(data) - 11, 12) if data[o + 4] == 0x35]
    data[anchors[-1] + 5] = 99
    otf = otf_of(bytes(data), tmp_path)
    assert len(otf["chord_diagrams"]) == 3
    assert otf["x_source"] == {"skipped": {**DECOYS, "chord_diagrams": 1}}


def test_v3_table_missing_drops_every_diagram(tmp_path):
    data = bytearray(V3.read_bytes())
    data[88:92] = struct.pack("<I", 0)
    otf = otf_of(bytes(data), tmp_path)
    assert "chord_diagrams" not in otf
    assert otf["x_source"] == {"skipped": {**DECOYS, "chord_diagrams": 4}}


def test_anacrusis_shifts_v2_diagrams_with_the_notes(tmp_path):
    """Header offset 244 == 1 marks a pickup measure: measure-1 notes shift
    left to the first note, and so must the anchors (as text annotations do).
    Every measure-1 component is moved 16 64ths later first, so the flag
    undoes exactly that."""
    data = bytearray(V2.read_bytes())
    for o in range(258, 258 + 6 * struct.unpack_from("<H", data, 256)[0], 6):
        loc = struct.unpack_from("<H", data, o)[0]
        if loc < 256 * 11:
            struct.pack_into("<H", data, o, loc + 64)
    ticks = lambda otf: [d["tick"] for d in otf["chord_diagrams"] if d["measure"] == 1]  # noqa: E731
    assert ticks(otf_of(bytes(data), tmp_path)) == [480, 960]
    struct.pack_into("<H", data, 244, 1)
    assert ticks(otf_of(bytes(data), tmp_path)) == [0, 480]


# --- the corpus --------------------------------------------------------------

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUALITIES = [
    ("maj7", [0, 4, 7, 11]), ("M7", [0, 4, 7, 11]), ("m7b5", [0, 3, 6, 10]),
    ("dim7", [0, 3, 6, 9]), ("dim", [0, 3, 6]), ("aug", [0, 4, 8]), ("+", [0, 4, 8]),
    ("m9", [0, 3, 7, 10, 2]), ("m7", [0, 3, 7, 10]), ("m6", [0, 3, 7, 9]),
    ("m", [0, 3, 7]), ("sus4", [0, 5, 7]), ("sus2", [0, 2, 7]), ("sus", [0, 5, 7]),
    ("9", [0, 4, 7, 10, 2]), ("7", [0, 4, 7, 10]), ("6", [0, 4, 7, 9]),
    ("add9", [0, 4, 7, 2]), ("5", [0, 7]), ("", [0, 4, 7]),
]


def expected_pitch_classes(name):
    """(root, allowed pitch classes) for a chord name, or None if unparseable."""
    m = re.match(r"^([A-G])([#b]?)(.*?)(?:/([A-G][#b]?))?$", name.strip())
    if not m:
        return None
    root = NOTE[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    quality = re.sub(r"\(.*?\)", "", m.group(3).replace("min", "m"))
    for key, intervals in QUALITIES:
        if quality == key:
            break
    else:
        for key, intervals in QUALITIES:
            if key and quality.startswith(key):
                break
        else:
            return None
    allowed = {(root + i) % 12 for i in intervals}
    if m.group(4):
        b = m.group(4)
        allowed.add((NOTE[b[0]] + (1 if b[1:] == "#" else -1 if b[1:] == "b" else 0)) % 12)
    return root % 12, allowed


def corpus_files():
    paths = sorted(glob.glob(str(REPO_ROOT / "sources/*/downloads/*.tef"))
                   + glob.glob(str(REPO_ROOT / "sources/mandozine/tefs/*.tef"))
                   + glob.glob(str(FIXTURES / "*.tef")))
    seen, out = set(), []
    for p in paths:
        digest = hashlib.md5(Path(p).read_bytes()).hexdigest()
        if digest not in seen:
            seen.add(digest)
            out.append(p)
    return out


@pytest.fixture(scope="module")
def corpus():
    files = corpus_files()
    if sum("downloads" in f for f in files) < 100:
        pytest.skip("the Hangout downloads are not checked out")
    parsed = []
    for f in files:
        try:
            parsed.append((f, TEFReader(f).parse()))
        except Exception:  # noqa: BLE001 - unreadable files are not this test's business
            continue
    return parsed


def test_corpus_anchor_counts_and_no_diagram_is_dropped(corpus):
    """1,938 anchors in 57 of the files on disk (the decode session counted
    1,942 in 58: one file with 4 anchors is not in this checkout); 380 are
    V3 (17 files, the session's number). Every table parses."""
    v2 = v3 = 0
    files = 0
    for path, tef in corpus:
        n = len(tef.chord_anchors) + tef.chord_anchors_dropped
        if "skipped_v" in path:
            continue    # G15e fixtures: bare chord records on purpose, no table
        assert tef.chord_anchors_dropped == 0, path
        if "chord_diagrams_v" in path:
            continue
        files += bool(n)
        if tef.header.is_v2:
            v2 += n
        else:
            v3 += n
    assert (v3, v2) == (380, 1558)
    assert files == 57


def test_corpus_v3_diagrams_match_their_names(corpus):
    """The decode session's scoring, through the importer: with the OWNING
    track's tuning, 19 of 21 scorable diagrams spell their name."""
    scored = matched = name_only = 0
    referenced = set()
    unreferenced = 0
    for path, tef in corpus:
        if tef.header.is_v2 or not tef.chord_table or "chord_diagrams_v" in path:
            continue
        counts = [i.num_strings for i in tef.instruments]
        used = {}
        for a in tef.chord_anchors:
            row = a.string_row
            for k, n in enumerate(counts):
                if row < n:
                    used.setdefault(a.index, k)
                    break
                row -= n
        for i, rec in enumerate(tef.chord_table):
            if i not in used:
                unreferenced += 1
                continue
            if all(b == 0xFF for b in rec.strings):
                name_only += 1
                continue
            inst = tef.instruments[used[i]]
            pcs = {(inst.tuning_pitches[s] + (rec.strings[s] & 0x1F)) % 12
                   for s in range(inst.num_strings) if rec.strings[s] != 0xFF}
            want = expected_pitch_classes(rec.name)
            scored += 1
            if want and pcs <= want[1] and want[0] in pcs:
                matched += 1
    assert (scored, matched) == (21, 19)
    assert name_only == 47
    # the session's "36" includes the one scored record whose name is empty
    assert unreferenced == 35
