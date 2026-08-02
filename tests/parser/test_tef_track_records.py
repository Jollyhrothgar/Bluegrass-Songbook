"""Structural track/instrument record parsing (replaces name-pattern scanning).

TEF files store track definitions in binary records — name-pattern scanning
is a dead end (unnamed tracks, prose mentions, wrong string counts).

V2 (sequential/ASCII-header) format — 50-byte records located near EOF
(TuxGuitar TEInputStream.readTracks()):
  +0  u16 numStrings
  +2  u16 firstStringIndex (cumulative)
  +8  u8  MIDI program
  +12 u8  capo
  +20 12 bytes tuning, string 1 first, MIDI pitch = 96 - byte;
      only numStrings bytes valid — the rest is stale garbage
  +32 name[16], NUL-terminated (may be empty -> TablEdit shows GM program name)
Located by backward scan validated by cumulative first-string indices and
header byte 240 (total strings) / 241 (tracks - 1).

Packed variant (rare, e.g. wheel_hoss-2430): header says 1 track but ONE
record holds TWO sub-tracks: +0 total strings, +4 u16 = sub-track-1 string
count, +8/+10 the two MIDI programs, +12/+14 the two capos, tunings
concatenated. TablEdit displays these as separate (unnamed) tracks.

V3 (binary container, magic 'debt'/'tbed' at 0x38) — header dword 0x60
points to [u16 record_size=68][u16 count] then 68-byte records (name[36]).

Tuning bytes store the SOUNDING pitch including capo — never add capo again.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from tef_parser import TEFReader, tef_to_otf  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
DOWNLOADS = REPO_ROOT / "sources" / "banjo-hangout" / "downloads"

OPEN_G = [62, 59, 55, 50, 67]           # D4 B3 G3 D3 g4
GUITAR_STD = [64, 59, 55, 50, 45, 40]   # E4 B3 G3 D3 A2 E2
BASS_EADG = [43, 38, 33, 28]            # G2 D2 A1 E1
MANDOLIN = [76, 69, 62, 55]             # E5 A4 D4 G3


# ---------------------------------------------------------------- V2 records

def test_18998_structural_records():
    """Both records found at EOF with exact names, counts, and tunings.

    Track 2 is named 'Banjo' but has SIX strings tuned EADGBE — only the
    structural record gets this right.
    """
    tef = TEFReader(str(FIXTURES / "18998_dup_banjo.tef")).parse()
    assert [i.name for i in tef.instruments] == ["Banjo open G", "Banjo"]
    assert [i.num_strings for i in tef.instruments] == [5, 6]
    assert tef.instruments[0].tuning_pitches == OPEN_G
    assert tef.instruments[1].tuning_pitches == GUITAR_STD
    assert [i.capo for i in tef.instruments] == [0, 0]


def test_wheel_hoss_packed_record_unnamed_tracks():
    """11449/wheel_hoss: header claims 1 track x 10 strings; the packed
    record is guitar (6, EADGBE, prog 25) + bass (4, EADG, prog 33).
    Names are empty -> derived from the GM program.
    """
    tef = TEFReader(str(FIXTURES / "wheel_hoss_2430_packed_tracks.tef")).parse()
    assert len(tef.instruments) == 2, [i.name for i in tef.instruments]
    g, b = tef.instruments
    assert g.num_strings == 6
    assert g.tuning_pitches == GUITAR_STD
    assert "guitar" in g.name.lower()
    assert b.num_strings == 4
    assert b.tuning_pitches == BASS_EADG
    assert "bass" in b.name.lower()


def test_wheel_hoss_otf_tracks_and_no_conflicts():
    """OTF gets real guitar + bass tracks (not a default 5-string banjo),
    every note lands on a valid string of its track, and no impossible
    same-string double-frets appear.
    """
    tef = TEFReader(str(FIXTURES / "wheel_hoss_2430_packed_tracks.tef")).parse()
    otf = tef_to_otf(tef).to_dict()

    ids = [t["id"] for t in otf["tracks"]]
    assert len(ids) == 2 and len(set(ids)) == 2, ids
    by_id = {t["id"]: t for t in otf["tracks"]}
    assert any("guitar" in t["instrument"] for t in otf["tracks"])
    assert "unknown" not in otf["notation"]

    for track_id, measures in otf["notation"].items():
        max_string = len(by_id[track_id]["tuning"])
        for m in measures:
            for ev in m["events"]:
                by_string = {}
                for n in ev["notes"]:
                    assert 1 <= n["s"] <= max_string, (
                        f"{track_id} m{m['measure']}: string {n['s']} > {max_string}")
                    assert by_string.setdefault(n["s"], n["f"]) == n["f"], (
                        f"{track_id} m{m['measure']} t{ev['tick']}: "
                        f"string {n['s']} double-fret")


# ---------------------------------------------------------------- V3 records

@pytest.mark.skipif(not (DOWNLOADS / "27493.tef").exists(),
                    reason="downloads corpus not present")
def test_27493_v3_pointer_table_all_four_tracks():
    tef = TEFReader(str(DOWNLOADS / "27493.tef")).parse()
    names = [i.name.strip() for i in tef.instruments]
    assert names == ["Guitar", "Bass", "Mandolin", "Banjo"]
    assert [i.num_strings for i in tef.instruments] == [6, 4, 4, 5]
    assert tef.instruments[0].tuning_pitches == GUITAR_STD
    assert tef.instruments[1].tuning_pitches == BASS_EADG
    assert tef.instruments[2].tuning_pitches == MANDOLIN
    assert tef.instruments[3].tuning_pitches == OPEN_G


@pytest.mark.skipif(not (DOWNLOADS / "23398.tef").exists(),
                    reason="downloads corpus not present")
def test_23398_single_banjo_unchanged():
    """Oracle-verified file (101/101) must keep its single open-G banjo."""
    tef = TEFReader(str(DOWNLOADS / "23398.tef")).parse()
    assert len(tef.instruments) == 1
    inst = tef.instruments[0]
    assert inst.num_strings == 5
    assert inst.tuning_pitches == OPEN_G
    otf = tef_to_otf(tef).to_dict()
    assert [t["id"] for t in otf["tracks"]] == ["banjo"]


# ----------------------------------------------------------------- capo

@pytest.mark.skipif(not (DOWNLOADS / "11245.tef").exists(),
                    reason="downloads corpus not present")
def test_11245_capo_metadata_and_sounding_tuning():
    """Capo-2 banjo/guitar: capo recorded as metadata, tuning bytes already
    hold the sounding pitch (open G + 2 = [64,61,57,52,69]) — no double shift.
    """
    tef = TEFReader(str(DOWNLOADS / "11245.tef")).parse()
    assert [i.num_strings for i in tef.instruments] == [5, 6, 4, 4]
    banjo = tef.instruments[0]
    assert banjo.capo == 2
    assert banjo.tuning_pitches == [p + 2 for p in OPEN_G]
    assert tef.instruments[2].tuning_pitches == MANDOLIN  # no capo
    assert tef.instruments[2].capo == 0


# ----------------------------------------------------------- percussion

# u16 @ record+6 == 98 marks a drum track. Its 8 "tuning" bytes are drum-kit
# staff-line assignments, so the `96 - b` pitch formula must not run on them —
# doing so fabricated a tuning (C#4-D#4-F#3-D4-A3-C#3-F3-G#2) that the player
# then sounded as arbitrary guitar notes.

def test_2927_percussion_track_is_flagged_not_pitched():
    """MandoTom2's Gold Rush: 4 melodic tracks + 1 drum track."""
    tef = TEFReader(str(FIXTURES / "2927_gold_rush_percussion.tef")).parse()
    perc = [i for i in tef.instruments if i.is_percussion]
    assert len(perc) == 1
    assert perc[0].num_strings == 8
    # No fabricated pitches, and the flag never leaks onto melodic tracks
    assert perc[0].tuning_pitches == []
    assert all(not i.is_percussion for i in tef.instruments if i is not perc[0])
    assert [i.num_strings for i in tef.instruments] == [4, 4, 4, 4, 8]


def test_2613_percussion_detected_despite_lying_name():
    """The flag beats the name: this drum track is named "Guitar Standard".

    Its drum-line bytes are byte-identical to 2927's "Percussion..." track,
    so any name- or string-count-based rule misfiles it as a guitar.
    """
    tef = TEFReader(str(FIXTURES / "2613_gold_rush_percussion_misnamed.tef")).parse()
    perc = [i for i in tef.instruments if i.is_percussion]
    assert len(perc) == 1
    assert perc[0].name == "Guitar Standard"
    assert perc[0].tuning_pitches == []


def test_percussion_otf_track_is_untuned_and_typed():
    """OTF must say "percussion" outright — no fake tuning, no fake instrument."""
    tef = TEFReader(str(FIXTURES / "2927_gold_rush_percussion.tef")).parse()
    tracks = tef_to_otf(tef).to_dict()["tracks"]
    perc = [t for t in tracks if t.get("percussion")]
    assert len(perc) == 1
    assert perc[0] == {
        "id": "percussion", "instrument": "percussion", "tuning": [],
        "capo": 0, "role": "percussion", "percussion": True, "lines": 8,
    }
    # Melodic tracks are untouched and carry no percussion keys
    assert [t["id"] for t in tracks] == [
        "mandolin", "guitar", "bass", "fiddle", "percussion"]
    assert all("percussion" not in t for t in tracks[:4])


def test_misnamed_percussion_does_not_become_a_guitar():
    """Regression: 2613's drum track used to publish as a 6-string guitar
    with EIGHT tuning entries."""
    tef = TEFReader(str(FIXTURES / "2613_gold_rush_percussion_misnamed.tef")).parse()
    tracks = tef_to_otf(tef).to_dict()["tracks"]
    assert [t["instrument"] for t in tracks] == [
        "mandolin", "mandolin", "upright-bass", "percussion"]
    assert tracks[-1]["tuning"] == []
