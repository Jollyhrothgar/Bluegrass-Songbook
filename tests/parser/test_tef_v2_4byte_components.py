"""V2 sub-variant with 4-byte component records (and a 64-unit grid).

The common TEF V2 layout stores one component per 6 bytes and puts note
positions on a 256-units-per-whole-note grid. An OLDER sub-variant packs
the same leading fields into 4 bytes and uses a 64-unit grid:

  bytes 0-1  location (position/string/measure — same formula)
  byte 2     component type + fret (bits 0-4 = fret+1)
  byte 3     duration code (bits 0-3) + dynamic (bits 5-7)
  -- no effect1/effect2 bytes at all --

Detection is STRUCTURAL (TEFReader.v2_component_stride), not a magic
byte: `count` 6-byte records simply do not fit in the file. For the one
known example, 10591 (Fire on the Mountain, guitar+bass duet):
component_offset 258, count 638, filesize 3632 -> 258 + 6*638 = 4086
overruns EOF by 454 bytes, while 258 + 4*638 = 2810 fits.

Ground truths for 10591 (header says 62 measures, 4/4, 10 strings):
- 551 notes spanning measures 1..62, frets 0..8, every note on the 16th
  grid, strings 1..6 (guitar) + 1..4 (bass).
- Read at stride 6 / grid 256 the same stream yields a plausible-looking
  324 notes across 5510 measures with 186 off-grid positions, which is
  exactly the "silent garbage" the loud-failure cross-check now blocks.
- data[205] == 0x00 here vs 0x03/0x0a in healthy 6-byte files. That is a
  corroborating observation only (n=1) and deliberately NOT used to
  discriminate the variant.

The 6-byte path must stay byte-identical: test_six_byte_variant_unchanged
diffs a full OTF document against output captured before the change.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402
from tef_parser.reader import TEFParseError  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"

FOUR_BYTE = FIXTURES / "10591_fire_on_the_mountain_v2_4byte.tef"
SIX_BYTE = FIXTURES / "21802_fingering_annotations.tef"
SIX_BYTE_EXPECTED = FIXTURES / "21802_fingering_annotations.expected.otf.json"


@pytest.fixture(scope="module")
def tef():
    return TEFReader(str(FOUR_BYTE)).parse()


@pytest.fixture(scope="module")
def reader():
    r = TEFReader(str(FOUR_BYTE))
    r.parse()
    return r


@pytest.fixture(scope="module")
def otf(tef):
    return tef_to_otf(tef).to_dict()


def all_notes(otf: dict) -> list[tuple[str, int, int, int, int]]:
    """(track, measure, tick, string, fret) for every note in the doc."""
    out = []
    for track, measures in otf["notation"].items():
        for m in measures:
            for ev in m["events"]:
                for n in ev["notes"]:
                    out.append((track, m["measure"], ev["tick"], n["s"], n["f"]))
    return sorted(out)


# --- detection -------------------------------------------------------------

def test_stride_detection_picks_four(reader, tef):
    """Structural: `count` 6-byte records overrun EOF, 4-byte ones fit."""
    h = tef.header
    assert h.is_v2
    assert (h.v2_component_offset, h.v2_component_count) == (258, 638)
    assert len(reader.data) == 3632
    assert h.v2_component_offset + 6 * h.v2_component_count > len(reader.data)
    assert h.v2_component_offset + 4 * h.v2_component_count <= len(reader.data)
    assert reader.v2_component_stride(h) == 4


def test_six_byte_files_still_detected_as_six():
    r = TEFReader(str(SIX_BYTE))
    tef = r.parse()
    assert r.v2_component_stride(tef.header) == 6


def test_records_carry_no_effect_bytes(tef):
    """raw_data is the record AS STORED, so the length gates in otf.py
    (is_tie / has_legato_effect / is_slide_effect / compute_articulations)
    all correctly decline to read effect bytes that do not exist.
    """
    assert {len(e.raw_data) for e in tef.note_events} == {4}


def test_no_articulations_or_annotations(otf):
    """No effect bytes -> no techniques, no fingerings, no text."""
    assert not otf.get("annotations")
    for track, measures in otf["notation"].items():
        for m in measures:
            for ev in m["events"]:
                for n in ev["notes"]:
                    assert "tech" not in n, (track, m["measure"], n)
                    assert "finger" not in n and "lh" not in n


# --- decode oracle ---------------------------------------------------------

def test_note_count(tef):
    assert len(tef.note_events) == 551


def test_measure_span_matches_header(tef, otf):
    """Grid 64 puts the notes in measures 1..62, exactly the measure count
    the header declares. Grid 256 collapses them into measures 1..16.
    """
    assert tef.header.v2_measures == 62
    measures = {m for _, m, _, _, _ in all_notes(otf)}
    assert (min(measures), max(measures)) == (1, 62)


def test_fret_range(otf):
    frets = {f for _, _, _, _, f in all_notes(otf)}
    assert (min(frets), max(frets)) == (0, 8)


def test_every_note_on_the_sixteenth_grid(otf):
    """1 native unit = 30 ticks on the 64 grid, a 16th = 120 ticks. Grid
    256 leaves 186 of the 551 notes off any sensible grid.
    """
    notes = all_notes(otf)
    assert len(notes) == 551
    off_grid = [n for n in notes if n[2] % 120]
    assert off_grid == []


def test_positions_reported_in_canonical_grid(tef):
    """Positions are scaled up to the canonical 256-per-whole-note grid so
    otf.py, the anacrusis shift and articulation_max_gap need no changes.
    """
    ts_size = tef.header.v2_ts_size
    assert ts_size == 256
    measures = {e.position // ts_size + 1 for e in tef.note_events}
    assert (min(measures), max(measures)) == (1, 62)
    # 4-byte grid step (a 64th note) is 4 canonical units.
    assert all(e.position % 4 == 0 for e in tef.note_events)


def test_tracks_and_strings(otf, tef):
    """Guitar (6) + bass (4) = the header's 10 strings, packed into one
    track record.
    """
    assert tef.header.v2_strings == 10
    assert [t["id"] for t in otf["tracks"]] == ["guitar", "bass"]
    per_track = {}
    for track, _, _, s, _ in all_notes(otf):
        per_track.setdefault(track, set()).add(s)
    assert max(per_track["guitar"]) <= 6
    assert max(per_track["bass"]) <= 4


def test_durations_never_overrun_the_next_note(tef):
    """Bit 4 (0x10) of byte 3 is a double-dot flag in the 6-byte layout
    but NOT here: it is set on 382/551 notes, and decoding it as a double
    dot makes 266 notes run past the next note on their own string.
    Masking it off yields zero overruns.
    """
    by_string: dict[tuple[int, int], list] = {}
    for e in tef.note_events:
        by_string.setdefault((e.track, e.extra), []).append(e)
    overruns = 0
    for events in by_string.values():
        events.sort(key=lambda e: e.position)
        for cur, nxt in zip(events, events[1:]):
            gap = (nxt.position - cur.position) * 15 // 2  # units -> ticks
            if cur.duration_ticks > gap:
                overruns += 1
    assert overruns == 0


def test_reading_list_read_at_the_right_offset(tef):
    """The reading list sits immediately after the components, so its
    offset depends on the stride too (at stride 6 it landed past EOF and
    came back empty).
    """
    entries = [(e.from_measure, e.to_measure) for e in tef.reading_list]
    assert entries == [(1, 8), (1, 8), (9, 12), (9, 12), (13, 22),
                       (15, 32), (33, 58), (1, 14), (59, 62)]
    assert all(1 <= f <= 62 and 1 <= t <= 62 for f, t in entries)


# --- loud failure ----------------------------------------------------------

def test_absurd_measure_numbers_raise(monkeypatch):
    """A future unknown sub-variant must NOT silently produce a
    5510-measure OTF. Forcing 10591 back to the 6-byte stride reproduces
    exactly that misread and must now blow up.
    """
    reader = TEFReader(str(FOUR_BYTE))
    monkeypatch.setattr(TEFReader, "v2_component_stride",
                        lambda self, header: 6)
    with pytest.raises(TEFParseError) as excinfo:
        reader.parse()
    msg = str(excinfo.value)
    assert "measure" in msg and "stride=6" in msg


def test_healthy_files_stay_well_inside_the_bound():
    """The bound (2 * header measures + 16) is enormously slack: across
    the corpus the highest decoded measure equals the header's count
    exactly. Spot-checked here on the packed-track fixture.
    """
    tef = TEFReader(str(FIXTURES / "wheel_hoss_2430_packed_tracks.tef")).parse()
    ts_size = tef.header.v2_ts_size
    max_measure = max(e.position // ts_size + 1 for e in tef.note_events)
    assert max_measure <= tef.header.v2_measures


# --- 6-byte regression -----------------------------------------------------

def test_six_byte_variant_unchanged():
    """Full-document diff against OTF captured from the pre-change parser
    (regenerate ONLY when the 6-byte path legitimately changes).
    """
    expected = json.loads(SIX_BYTE_EXPECTED.read_text())
    got = tef_to_otf(TEFReader(str(SIX_BYTE)).parse()).to_dict()
    assert got == expected
