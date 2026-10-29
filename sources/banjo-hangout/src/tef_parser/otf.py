"""OTF (Open Tab Format) exporter for TEF files.

Copied from TablEdit_Reverse project.
"""

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .reader import (TEFFile, TEFNoteEvent, TEFInstrument, TRIPLET_DURATION_CODES,
                     V3_UNITS_PER_WHOLE, decode_duration_code)


# MIDI note to pitch name conversion
MIDI_TO_PITCH = {
    24: "C1", 25: "C#1", 26: "D1", 27: "D#1", 28: "E1", 29: "F1", 30: "F#1", 31: "G1", 32: "G#1", 33: "A1", 34: "A#1", 35: "B1",
    36: "C2", 37: "C#2", 38: "D2", 39: "D#2", 40: "E2", 41: "F2", 42: "F#2", 43: "G2", 44: "G#2", 45: "A2", 46: "A#2", 47: "B2",
    48: "C3", 49: "C#3", 50: "D3", 51: "D#3", 52: "E3", 53: "F3", 54: "F#3", 55: "G3", 56: "G#3", 57: "A3", 58: "A#3", 59: "B3",
    60: "C4", 61: "C#4", 62: "D4", 63: "D#4", 64: "E4", 65: "F4", 66: "F#4", 67: "G4", 68: "G#4", 69: "A4", 70: "A#4", 71: "B4",
    72: "C5", 73: "C#5", 74: "D5", 75: "D#5", 76: "E5", 77: "F5", 78: "F#5", 79: "G5", 80: "G#5", 81: "A5", 82: "A#5", 83: "B5",
}


def midi_to_pitch_name(midi: int) -> str:
    """Convert MIDI note number to pitch name (e.g., 62 -> 'D4')."""
    return MIDI_TO_PITCH.get(midi, f"MIDI{midi}")


# Fingering byte (V3 note byte 10; V2 effect2 on 0x20-flagged notes) packs BOTH hands base-6: value = 6*pluck + lh_code.
# pluck 1..5 = picking finger (T I M R P; MusicXML pluck p i m a c),
# lh_code 0 = none, else fretting digit = lh_code - 1 (so '3' -> 4).
# Oracle-verified against TablEdit's MusicXML <pluck>/<fingering> on
# Welcome to New York (37/37 notes match, incl. combined values like
# 0x0b = p + finger 4 and 0x0a = p + finger 3).
V3_PLUCK_LETTERS = {1: 'T', 2: 'I', 3: 'M', 4: 'R', 5: 'P'}


def decode_fingering(code: int) -> tuple[str | None, int | None]:
    """Decode (pluck_letter, left_hand_digit) from a fingering byte."""
    if not 0 < code <= 35:
        return None, None
    pluck = V3_PLUCK_LETTERS.get(code // 6)
    lh_code = code % 6
    lh = lh_code - 1 if lh_code else None
    return pluck, lh


def v3_fingering(event: TEFNoteEvent) -> tuple[str | None, int | None]:
    """Decode (pluck_letter, left_hand_digit) from a V3 note's byte 10."""
    raw = event.raw_data
    return decode_fingering(raw[10] if raw and len(raw) >= 12 else 0)


def _otf_format():
    """scripts/lib/otf_format.py: the one OTF serializer (shared with
    process_pending, which runs from scripts/lib). This package sits
    elsewhere, so put scripts/lib on the path the first time it is needed."""
    try:
        import otf_format
    except ImportError:
        lib = Path(__file__).resolve().parents[4] / 'scripts' / 'lib'
        sys.path.insert(0, str(lib))
        import otf_format
    return otf_format


# The shared, dependency-free OTF helpers (scripts/lib/otf_format.py), under the
# names the importers use: OTF_VERSION, DYN_LEVELS (loudest first),
# decode_mark_raw(raw), ensure_version_at_least(doc, '1.2').
OTF_VERSION = _otf_format().OTF_VERSION
DYN_LEVELS = _otf_format().DYN_LEVELS
decode_mark_raw = _otf_format().decode_mark_raw
ensure_version_at_least = _otf_format().ensure_version_at_least


@dataclass
class OTFNote:
    """A single note in OTF format."""
    s: int           # String number (1 = highest pitch)
    f: int           # Fret number (0 = open)
    tech: str | None = None    # Technique code (h, p, /, etc.)
    finger: str | None = None  # Picking-hand fingering (T, I, M, R, P)
    lh: int | None = None      # Fretting-hand digit (0-4), circled in display
    dur: int | None = None     # Duration in ticks (for sustained notes)
    tie: bool = False          # True if tied to previous note (no re-articulation)
    fx: list[str] | None = None    # TablEdit per-note effects (FX_ORDER)
    grace: dict | None = None      # {"f": fret, "kind"?: GRACE_KINDS}


@dataclass
class OTFEvent:
    """A note event at a specific tick position."""
    tick: int
    notes: list[OTFNote] = field(default_factory=list)


@dataclass
class OTFMeasure:
    """A measure containing note events."""
    measure: int
    events: list[OTFEvent] = field(default_factory=list)


@dataclass
class OTFTrack:
    """A track/instrument in OTF format."""
    id: str
    instrument: str
    tuning: list[str]
    capo: int = 0
    role: str = "lead"
    # Percussion tracks are NOT pitched: `tuning` is empty and a note's
    # `s` is a drum-kit staff line, not a string, so `f` is a hit variant
    # rather than a fret. Consumers must not run tuning[s] + f on them.
    # `lines` carries the staff-line count `tuning` would otherwise imply.
    percussion: bool = False
    lines: int = 0


@dataclass
class OTFTiming:
    """Timing configuration."""
    ticks_per_beat: int = 480


@dataclass
class OTFMetadata:
    """Song metadata."""
    title: str = ""
    composer: str | None = None
    arranger: str | None = None
    key: str | None = None
    time_signature: str = "4/4"
    tempo: int = 100
    # Per-measure overrides: [{"measure": 17, "time_signature": "2/4"}, ...].
    # Each override applies only to its measure; all others follow
    # time_signature. Additive — consumers that don't know it ignore it.
    time_signature_changes: list = field(default_factory=list)


@dataclass
class OTFReadingListEntry:
    """Reading list entry for playback order."""
    from_measure: int
    to_measure: int
    name: str = ""   # Optional section label ("Intro", "Part A1", ...)


@dataclass
class OTFAnnotation:
    """A placed free-text annotation ("Long Choke", chord letters, ...)."""
    measure: int     # 1-indexed written measure
    tick: int        # Tick offset within the measure
    text: str


@dataclass
class OTFDocument:
    """Complete OTF document."""
    otf_version: str = OTF_VERSION
    metadata: OTFMetadata = field(default_factory=OTFMetadata)
    timing: OTFTiming = field(default_factory=OTFTiming)
    tracks: list[OTFTrack] = field(default_factory=list)
    notation: dict[str, list[OTFMeasure]] = field(default_factory=dict)
    annotations: list[OTFAnnotation] = field(default_factory=list)
    reading_list: list[OTFReadingListEntry] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for YAML/JSON serialization."""
        result = {
            "otf_version": self.otf_version,
            "metadata": {
                "title": self.metadata.title,
                "time_signature": self.metadata.time_signature,
                "tempo": self.metadata.tempo,
            },
            "timing": {
                "ticks_per_beat": self.timing.ticks_per_beat,
            },
            "tracks": [],
            "notation": {},
        }

        # Add optional metadata
        if self.metadata.time_signature_changes:
            result["metadata"]["time_signature_changes"] = self.metadata.time_signature_changes
        if self.metadata.composer:
            result["metadata"]["composer"] = self.metadata.composer
        if self.metadata.key:
            result["metadata"]["key"] = self.metadata.key

        # Add tracks
        for track in self.tracks:
            t = {
                "id": track.id,
                "instrument": track.instrument,
                "tuning": track.tuning,
                "capo": track.capo,
                "role": track.role,
            }
            # Emitted only for drum tracks, so pitched tabs stay byte-identical
            if track.percussion:
                t["percussion"] = True
                t["lines"] = track.lines
            result["tracks"].append(t)

        # Add notation per track
        for track_id, measures in self.notation.items():
            result["notation"][track_id] = []
            for measure in measures:
                m = {"measure": measure.measure, "events": []}
                for event in measure.events:
                    e = {"tick": event.tick, "notes": []}
                    for note in event.notes:
                        n = {"s": note.s, "f": note.f}
                        if note.tech:
                            n["tech"] = note.tech
                        if note.finger:
                            n["finger"] = note.finger
                        if note.lh is not None:
                            n["lh"] = note.lh
                        if note.dur:
                            n["dur"] = note.dur
                        if note.tie:
                            n["tie"] = True
                        if note.fx:
                            n["fx"] = list(note.fx)
                        if note.grace:
                            n["grace"] = dict(note.grace)
                        e["notes"].append(n)
                    m["events"].append(e)
                result["notation"][track_id].append(m)

        # Add placed free-text annotations if present
        if self.annotations:
            result["annotations"] = [
                {"measure": a.measure, "tick": a.tick, "text": a.text}
                for a in self.annotations
            ]

        # Add reading list if present
        if self.reading_list:
            result["reading_list"] = []
            for e in self.reading_list:
                entry = {"from_measure": e.from_measure, "to_measure": e.to_measure}
                if e.name:
                    entry["name"] = e.name
                result["reading_list"].append(entry)

        return result

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        try:
            import yaml
            return yaml.dump(self.to_dict(), default_flow_style=False, sort_keys=False, allow_unicode=True)
        except ImportError:
            # Fallback to JSON if yaml not available
            return self.to_json()

    def to_json(self) -> str:
        """The canonical OTF file text (scripts/lib/otf_format.py, G15b)."""
        return _otf_format().serialize(self.to_dict())


def instrument_to_otf_id(inst: TEFInstrument) -> str:
    """Generate a clean, canonical ID from instrument name.

    Structural track records carry real names ("Upright Bass", "Acoustic
    Guitar", "Clicks"), so map by keyword to the canonical short ids the
    corpus and frontend already use (guitar, bass, mandolin, banjo, ...)
    instead of hyphenating arbitrary names. A clearly named non-banjo
    5-string track (e.g. a "Clicks" click track) must NOT become "banjo".

    The percussion flag wins over every name/string-count rule below,
    because a drum track's name can lie (2613's is "Guitar Standard") and
    its line count collides with real instruments (5-line drum tracks were
    landing on the `num_strings == 5 -> banjo` rule).
    """
    if inst.is_percussion:
        return "percussion"
    name = inst.name.lower()
    # 4-string tenor banjo (before the generic keyword scan)
    if inst.num_strings == 4 and ("banjo" in name or "tenor" in name or "cgdg" in name or "cgda" in name):
        return "tenor-banjo"
    # Keyword -> canonical id ("bass" before "guitar": a "Bass Guitar" is a bass)
    for keyword, otf_id in (
        ("mandolin", "mandolin"),
        ("ukulele", "ukulele"),
        ("dobro", "dobro"),
        ("resonator", "dobro"),
        ("fiddle", "fiddle"),
        ("violin", "fiddle"),
        ("bass", "bass"),
        ("guitar", "guitar"),
        ("banjo", "banjo"),
        ("piano", "piano"),
        ("click", "clicks"),
    ):
        if keyword in name:
            return otf_id
    # Unnamed/tuning-only 5-string instruments are banjos
    # (handles "D Tuning", "G Tuning", etc.)
    if inst.num_strings == 5:
        return "banjo"
    # Remove common suffixes
    for suffix in [" open g", " standard", " gdae", " gda"]:
        name = name.replace(suffix, "")
    # Replace spaces with hyphens
    name = name.replace(" ", "-")
    return name


def instrument_to_type(inst: TEFInstrument) -> str:
    """Map instrument name to standard type identifier."""
    if inst.is_percussion:
        return "percussion"
    name = inst.name.lower()
    # 4-string tenor banjo (check before generic banjo check)
    if inst.num_strings == 4 and ("banjo" in name or "tenor" in name or "cgdg" in name or "cgda" in name):
        return "tenor-banjo"
    if "banjo" in name or inst.num_strings == 5:
        return "5-string-banjo"
    elif "mandolin" in name:
        return "mandolin"
    elif "guitar" in name:
        return "6-string-guitar"
    elif "bass" in name:
        return "upright-bass"
    elif "dobro" in name or "resonator" in name:
        return "dobro"
    elif "fiddle" in name or "violin" in name:
        return "fiddle"
    else:
        return f"{inst.num_strings}-string"


def is_tied_note(event: TEFNoteEvent) -> bool:
    """Check if this note is tied to the previous note (same pitch, extends duration).

    V2 byte3 layout (oracle-derived): bits 0-4 duration code, bits 5-7
    dynamic. Dynamics 0-5 are real volume levels (6 unused in the
    corpus); dynamic 7 is the TIE sentinel. The old `byte3 & 0x80` rule
    also caught dynamics 4 and 5 (0x80-0xBF) and silently dropped those
    notes as phantom ties (21690 m4, 21999 m10, 22446, 23439 — their
    oracle exports show plain notes, while every true XML tie in the
    corpus is a dynamic-7 note, e.g. 21690 m4 0xe9, wheel_hoss 0xe3).

    Tied notes should not be re-articulated - they just extend the previous note's duration.
    """
    if event.raw_data and len(event.raw_data) >= 6:
        if len(event.raw_data) == 6:  # V2
            return (event.raw_data[3] >> 5) & 0x07 == 7
        # V3 (12-byte record): byte 5 is the V2 duration byte, copied
        # unchanged by TablEdit's V2 upgrade (FUN_1000459c4), so the tie is
        # the same dynamic-7 sentinel (25635 m74: 0xe6 = XML tie stops).
        # Testing bit 7 alone also caught dynamics 4-6 and hid 4,528 played
        # notes in 12 files (11721's guitar beat-3 chords are 0x86).
        return (event.raw_data[5] >> 5) & 0x07 == 7
    return False


# TablEdit's per-note effects, in its own vocabulary (fix-it A15). The note
# effect enum is V3 byte 6 / V2 effect1 & 0x0f (string table at 0x1000f57e0);
# 1-3 are transitions (tech h/p/slide), 12 is the bend the connect-bit
# heuristic already marks 'b', 15 is the dead note 'x'. The rest are `fx`.
EFFECT_FX = {4: "choke", 5: "brush", 6: "harmonic", 7: "artificial-harmonic",
             8: "muted", 9: "tap", 10: "vibrato", 11: "tremolo",
             13: "bend-release", 14: "roll"}
# Attribute byte (V3 byte 8; V2 effect2 under fret-byte flag 0x80), read by
# FUN_10001f594: low nibble = attribute, high nibble = a second effect.
ATTRIBUTE_FX = {1: "let-ring", 2: "slap", 4: "ghost", 7: "staccato"}
SECOND_FX = {3: "roll", 5: "brush", 6: "harmonic", 7: "artificial-harmonic",
             8: "let-ring", 9: "ghost"}
SECOND_DEAD = 10
# V2 effect2 values under flag 0x80 that TablEdit turns into layout flags.
V2_LAYOUT_CODES = {0x0b, 0x0c, 0x0d, 0x0e, 0xc0, 0xd0}
# Canonical order of `fx`: the order the vocabulary is listed in the format doc.
FX_ORDER = ["brush", "roll", "choke", "ghost", "staccato", "let-ring", "muted",
            "harmonic", "artificial-harmonic", "tap", "vibrato", "tremolo",
            "bend", "bend-release", "slap"]
GRACE_KINDS = [None, "hp", "slide", "bend", "mordent", "double", "gruppetto", "trill"]


def _attribute_byte(event: TEFNoteEvent) -> int:
    raw = event.raw_data or b""
    if len(raw) >= 12:
        return raw[8]
    if len(raw) >= 6 and raw[2] & 0xe0 == 0x80 and raw[5] not in V2_LAYOUT_CODES:
        return raw[5]
    return 0


def note_fx(event: TEFNoteEvent) -> list[str]:
    """`fx` for one note: its effect plus its attribute and second effect."""
    raw = event.raw_data or b""
    if len(raw) >= 12:
        effect = raw[6] & 0x0f
    elif len(raw) >= 6:
        effect = raw[4] & 0x0f
    else:
        return []
    fx = set()
    if effect in EFFECT_FX:
        fx.add(EFFECT_FX[effect])
    attr = _attribute_byte(event)
    hi, lo = attr >> 4, attr & 0x0f
    if hi != 3 and lo in ATTRIBUTE_FX:
        fx.add(ATTRIBUTE_FX[lo])
    if hi in SECOND_FX:
        fx.add(SECOND_FX[hi])
    return [f for f in FX_ORDER if f in fx]


def note_grace(event: TEFNoteEvent) -> dict | None:
    """The grace note TablEdit hangs on a MAIN note: flag 0x40 on the V3
    type byte / V2 fret byte, fret in bits 0-4 and kind in bits 5-7 of V3
    byte 7 / V2 effect2 (GraceNote dialog, FUN_10001d130). Checked against
    TablEdit's export: grace and main pitches match in every file tried."""
    raw = event.raw_data or b""
    if len(raw) >= 12 and raw[4] & 0x40:
        g = raw[7]
    elif len(raw) >= 6 and len(raw) < 12 and raw[2] & 0xe0 == 0x40:
        g = raw[5]
    else:
        return None
    grace = {"f": g & 0x1f}
    if GRACE_KINDS[g >> 5]:
        grace["kind"] = GRACE_KINDS[g >> 5]
    return grace


def is_dead_note(event: TEFNoteEvent) -> bool:
    """TablEdit's note effect is the low nibble of V3 byte 6 / V2 effect1
    (bits 4-5 are the voice), and 15 is 'Dead note' (string table at
    0x1000f57e0). The V2 path used to ignore it, so 20,029 V2 dead notes
    in 84 files imported as ringing notes (fix-it A15)."""
    raw = event.raw_data
    if not raw:
        return False
    if _attribute_byte(event) >> 4 == SECOND_DEAD:
        return True
    if len(raw) >= 12:
        return raw[6] & 0x0f == 0x0f
    return len(raw) >= 6 and raw[4] & 0x0f == 0x0f


def has_legato_effect(event: TEFNoteEvent) -> bool:
    """Check if a note has a legato effect (hammer-on, pull-off, or slide).

    For V2 format, effect1 byte values:
    - 0x01: Hammer-on/pull-off (direction-based)
    - 0x02: Legato marker
    - 0x03: Slide (0x01 | 0x02 combined)
    - 0x04: Bend (1/4 step) - NOT legato, don't include

    Note: The 'L' marker in V2 format often means "lead/melody note", not legato.
    Only use marker='L' as fallback when raw_data is unavailable (V3 without effect bytes).
    """
    # Check effect bytes from raw_data (V2 format) - this is the reliable source
    if event.raw_data and len(event.raw_data) >= 5:
        effect1 = event.raw_data[4]
        # Only bits 0 and 1 indicate legato effects (0x03 mask)
        # Bit 2 (0x04) is bend, not legato
        if effect1 & 0x03:
            return True

    return False


def is_slide_effect(event: TEFNoteEvent) -> bool:
    """Check if a note has a slide effect.

    For V2 format, effect1=0x03 (bits 0 and 1 both set) indicates slide.
    """
    if event.raw_data and len(event.raw_data) >= 5:
        effect1 = event.raw_data[4]
        # 0x03 = slide (both hammer and legato bits set)
        if effect1 == 0x03:
            return True
    return False


def technique_from_event(event: TEFNoteEvent) -> str | None:
    """Map TEF articulation to OTF technique code.

    Note: This is a fallback for V3 format. V2 format uses direction-based
    detection in compute_articulations() which is more accurate.

    The 'L' marker in V2 format means "lead/melody note", not legato.
    Only effect bytes are reliable for articulation detection.
    """
    # RETIRED (2026-07-10): this used to read raw_data[5] as a V3
    # articulation — but byte 5 of the V3 record is the DURATION byte
    # (bits 0-4 duration code, bit 7 tie). A plain half note (code 3)
    # decoded as a bogus slide; real V3 techniques live in byte 6 and
    # are attributed by compute_articulations_v3(). Kept as an explicit
    # no-op so call sites don't silently regrow a wrong heuristic.
    return None


def articulation_max_gap(header) -> int:
    """Half a measure, in the units event.position carries for this format.

    V2 positions are native grid units (ts_size per measure); V3 positions
    are 64th-note units, 64 per 4/4 measure.
    """
    if header.is_v2:
        return (header.v2_ts_size or 256) // 2
    return V3_UNITS_PER_WHOLE // 2


def triplet_duration_code(event: TEFNoteEvent) -> int | None:
    """The note's duration code when TablEdit plays it as a triplet."""
    raw = event.raw_data
    if not raw:
        return None
    if len(raw) == 12:
        code = raw[5] & 0x1f          # V3 duration byte
    elif len(raw) >= 4:
        code = raw[3] & 0x1f          # V2 duration byte
    else:
        return None
    return code if code in TRIPLET_DURATION_CODES else None


def compute_articulations(
    note_events: list[TEFNoteEvent],
    max_gap: int | None = None,
) -> dict[tuple[int, int, int], str]:
    """V2 techniques (oracle-fit 2026-07-11: 38/39 downloads-backed V2
    files match TablEdit's MusicXML exports exactly; the 39th, 18779,
    differs only where the EXPORT is lossy — see double-stops below).

    effect1 (byte 4 of the 6-byte record, on the SOURCE note) is an
    ENUM — the same one V3 uses in byte 6:

        1 = hammer-on    2 = pull-off    3 = slide

    NOT a bitfield and NOT direction-based. TablEdit marks whatever the
    author chose (11245/21420 contain descending hammer-ons the old
    direction rule inverted to pull-offs), and other values (0x04
    bend/choke, 0x05, 0x0f, 0x20, ...) are unrelated effects: masking
    them with & 0x03 fabricated 19 phantom techniques in 24112 alone,
    and the old whole-file plausibility gate (any effect1 > 4 =>
    distrust everything) threw away ALL techniques in 12 files that
    really have them. The gate's own justification cited 27493 — a V3
    file that no longer routes through this function.

    Pairing: the technique lands on the NEXT note of the same
    (track, string), but only when it starts within the SOURCE's
    written duration — 11830 has a slide flag whose would-be
    destination sits after an intervening rest, and TablEdit shows no
    slur there. (max_gap is kept for call compatibility; adjacency is
    the real rule now.)

    Double-stop slides mark BOTH strings (18779 m8: s2 f1->3 over
    s4 f3->5). TablEdit's MusicXML export carries the slur on only one
    string of such pairs; ours are the musically complete reading.

    Returns:
        Dict mapping (track, position, string) to technique code for
        DESTINATION notes.
    """
    V2_TECH = {1: "h", 2: "p", 3: "/"}
    articulations: dict[tuple[int, int, int], str] = {}
    if max_gap is None:
        max_gap = 128  # half of a 4/4 measure in native units

    notes_by_track_string: dict[tuple[int, int], list[TEFNoteEvent]] = {}
    for event in note_events:
        if not event.is_melody:
            continue
        # V2 records only (6 bytes); V3 events (12 bytes) are handled by
        # compute_articulations_v3 — their byte 4 is the fret/type byte
        # and would alias the enum.
        if not event.raw_data or len(event.raw_data) != 6:
            continue
        result = event.decode_string_fret()
        if not result:
            continue
        string, _ = result
        notes_by_track_string.setdefault((event.track, string), []).append(event)

    for (track, string), notes in notes_by_track_string.items():
        notes.sort(key=lambda e: e.position)
        for i, event in enumerate(notes):
            # The effect enum is the low nibble; bits 4-5 are independent
            # flags riding the same byte (TablEdit FUN_10001f594 reads
            # `effect1 & 0x0f`; oracle: 22446/24093 carry 0x21 = flag +
            # hammer, 12574 has 0x23 = flag + slide, 643 has 0x31-0x33).
            tech = V2_TECH.get(event.raw_data[4] & 0x0f)
            if not tech or i + 1 >= len(notes):
                continue
            next_event = notes[i + 1]
            if max_gap and next_event.position - event.position > max_gap:
                continue
            # Open-string destinations pair only when ADJACENT (the
            # destination starts exactly when the source's written
            # duration ends): 13788 slides f3->f0 with gap == duration
            # and TablEdit marks them; 11830's f4 slide has a rest
            # before its f0 'destination' and TablEdit shows nothing —
            # that flag is a slide-out. Fretted destinations pair
            # regardless of small rests (22446 m30: slide across a
            # 720-tick gap, marked in the export).
            next_result = next_event.decode_string_fret()
            if next_result and next_result[1] == 0:
                dur_units = decode_duration_code(
                    event.raw_data[3] & 0x1f) / 7.5
                if next_event.position - event.position > dur_units:
                    continue
            articulations[(track, next_event.position, string)] = tech

    return articulations


def compute_articulations_v3(
    note_events: list[TEFNoteEvent],
    max_gap: int = V3_UNITS_PER_WHOLE // 2,
) -> dict[tuple[int, int, int], str]:
    """V3 articulations: byte 6 of the 12-byte record, on the SOURCE note,
    names the transition explicitly — 1 = hammer-on, 2 = pull-off,
    3 = slide. Attributed to the DESTINATION note (next note, same track
    and string, within max_gap 64th-note units), matching OTF convention.

    Oracle-fit on 25635 vs TablEdit's MusicXML: byte6 counts (14 slides,
    5 hammers incl. the m9 chain, 3 pull-offs) match the export's
    hammer-on/pull-off/slide elements exactly. V3 techniques had died
    silently: compute_articulations' effect1 plausibility gate always
    trips for V3 (raw byte 4 is the fret/type byte there, always > 4),
    and the old technique_from_event fallback misread byte 5 — which is
    the DURATION byte (a plain half note, code 3, would render a bogus
    slide).
    """
    V3_TECH = {1: "h", 2: "p", 3: "/"}
    articulations: dict[tuple[int, int, int], str] = {}

    by_string: dict[tuple[int, int], list[TEFNoteEvent]] = {}
    for event in note_events:
        if not event.is_melody:
            continue
        if not event.raw_data or len(event.raw_data) < 12:
            continue
        result = event.decode_string_fret()
        if not result:
            continue
        string, _ = result
        by_string.setdefault((event.track, string), []).append(event)

    for (track, string), notes in by_string.items():
        notes.sort(key=lambda e: e.position)
        for i, event in enumerate(notes):
            tech = V3_TECH.get(event.raw_data[6] & 0x1f)
            if not tech or i + 1 >= len(notes):
                continue
            next_event = notes[i + 1]
            if next_event.position - event.position <= max_gap:
                articulations[(track, next_event.position, string)] = tech

    return articulations


def bend_destination_keys(note_events, articulations):
    """Keys (track, position, string) of BEND/CHOKE notes.

    The tie sentinel (V2 dynamic-7 / V3 byte-5 bit-7) actually means "connected
    to the previous note on this string." That renders as a TIE only when the
    fret is unchanged (same pitch). When the fret DIFFERS and the note carries no
    hammer/pull/slide (those already own the connection — e.g. 25635 m74's slide
    destination, left untouched here), it's a bend/choke: TablEdit's own display
    shows a bend, though its MusicXML exports it lossily as a tie-stop. We surface
    it as a 'b' technique instead of a phantom tie.

    Corpus-safe: zero notes in the 40+ file corpus meet all three conditions
    (connect-bit AND fret change AND no h/p/slide), so this changes no existing
    output; it only fixes real bends (e.g. Bill Emerson's "Welcome to New York"
    m4, str3 fret 3->4). Full +1-semitone playback glide is tracked in #184.
    """
    by_track_string: dict = {}
    for event in note_events:
        if not event.is_melody:
            continue
        sf = event.decode_string_fret()
        if not sf:
            continue
        by_track_string.setdefault((event.track, sf[0]), []).append(
            (event.position, sf[1], event))

    keys = set()
    for (track, string), notes in by_track_string.items():
        notes.sort(key=lambda x: x[0])
        for i, (position, fret, event) in enumerate(notes):
            if i == 0 or not is_tied_note(event):
                continue
            if notes[i - 1][1] == fret:
                continue  # same fret = genuine tie
            if articulations.get((track, position, string)) is not None:
                continue  # h/p/slide already carries the connection
            keys.add((track, position, string))
    return keys


# Common banjo tunings (MIDI note numbers)
# Format: [string1, string2, string3, string4, string5] where string1 is highest
BANJO_TUNINGS = {
    'open g': [62, 59, 55, 50, 67],           # D4, B3, G3, D3, g4 (gDGBD)
    'standard open g': [62, 59, 55, 50, 67],  # Same as open g
    'double c': [62, 60, 55, 48, 67],         # D4, C4, G3, C3, g4 (gCGCD)
    'g modal': [62, 60, 55, 50, 67],          # D4, C4, G3, D3, g4 (gDGCD) - sawmill
    'sawmill': [62, 60, 55, 50, 67],          # Same as g modal
    'd tuning': [62, 57, 54, 50, 69],         # D4, A3, F#3, D3, a4 (aDF#AD)
    'open d': [62, 57, 54, 50, 69],           # Same as d tuning
    'drop c': [62, 59, 55, 48, 67],           # D4, B3, G3, C3, g4 (gCGBD)
}


def parse_tuning_string(tuning_str: str) -> list[int] | None:
    """Parse a tuning string like 'Double C (gCGCD)' to MIDI pitches.

    Returns list of 5 MIDI note numbers or None if not recognized.
    """
    if not tuning_str:
        return None

    tuning_lower = tuning_str.lower()

    # Try to match known tuning names
    for name, pitches in BANJO_TUNINGS.items():
        if name in tuning_lower:
            return pitches

    return None


# ── TablEdit slide-timing quirk ─────────────────────────────────────────────
# TablEdit fakes the SOUND of a slide by storing rendering-hostile microtiming
# rather than a plain "note + slide articulation". For a slide 5→8 it emits, on
# one beat: a straight source note, a short rest gap, then the slide TARGET
# compressed to a triplet value and shifted OFF the beat grid. (Confirmed in the
# raw TEF duration code AND in TablEdit's own MusicXML export, e.g. salt-creek
# 20627 m1: source dur120 slide-start, <forward 40>, target dur80 time-mod 3:2
# slide-stop — i.e. in OTF ticks: source@0/dur240, target@320/dur160.) This is
# TablEdit's way of making its MIDI playback audibly slide; it is NOT a musical
# triplet. See .claude/skills/tab-debug/SKILL.md.
#
# OTF stores the musical truth instead: the slide target as a normal on-grid
# note of its real length, carrying only the "/" articulation. Playback renders
# the slide feel (see docs/js/renderers/tab-player.js). The oracle stays green
# because spike/oracle_verify.py applies THIS SAME transform to the MusicXML
# side before comparing (so the check now means "same notes as TablEdit, modulo
# the documented slide policy").
#
# Scope guard: we only re-time the "triplet-compress" shape (a slide target that
# is BOTH off the 16th grid AND carries a triplet duration). We gate on the
# slide technique so genuine musical triplets — which are never slides — are
# untouched. (The distinct "32nd grace-slide" shape is intentionally left as-is
# for now.)

def retimed_slide_target(target_tick, target_dur, target_tech,
                         source_tick, source_dur, ticks_per_beat):
    """Return (tick, dur) for a slide target, re-timed on-grid if it is the
    TablEdit triplet-compress hack, else the inputs unchanged.

    Shared by the parser (otf.py) and the oracle (oracle_verify.py) so both
    sides normalize identically. Pure and idempotent: a target already on-grid
    with a straight duration is returned unchanged.

    The target is contiguous with its source (gap removed) and absorbs the
    freed time: new_tick = source_end, new_dur extends to the original target
    end. salt-creek m1: (320,160) with source (0,240) -> (240,240).
    """
    if target_tech not in ("/", "\\") or not target_dur:
        return target_tick, target_dur
    whole = ticks_per_beat * 4          # a whole note (1920 at tpb=480)
    sixteenth = ticks_per_beat // 4     # 120 at tpb=480
    # triplet duration: whole/dur is a whole multiple of 3 (160->12, 320->6,
    # 80->24); straight values (240->8, 120->16) are not.
    is_triplet_dur = whole % target_dur == 0 and (whole // target_dur) % 3 == 0
    off_grid = target_tick % sixteenth != 0
    if not (is_triplet_dur and off_grid):
        return target_tick, target_dur
    if source_tick is None or source_dur is None:
        return target_tick, target_dur
    new_tick = source_tick + source_dur
    # only pattern A: the de-gapped onset must land cleanly on the grid, at or
    # before the current (delayed) onset.
    if new_tick % sixteenth != 0 or new_tick > target_tick:
        return target_tick, target_dur
    new_dur = (target_tick + target_dur) - new_tick
    return new_tick, new_dur


def normalize_slide_timing(doc: OTFDocument) -> None:
    """Re-time TablEdit triplet-compress slide targets onto the grid, in place.

    See the module comment above `retimed_slide_target` for the TablEdit quirk
    this undoes. Only slide targets that are alone in their event are moved (the
    hack is a single melodic note, never a chord), so genuine chords and the
    already-clean on-grid slides (e.g. salt-creek m7) are left byte-identical.
    """
    tpb = doc.timing.ticks_per_beat
    for measures in doc.notation.values():
        for measure in measures:
            events = sorted(measure.events, key=lambda e: e.tick)
            last_on_string: dict[int, tuple[int, OTFNote]] = {}
            moves = []  # (event, note, new_tick, new_dur)
            for event in events:
                for note in event.notes:
                    if note.tech in ("/", "\\") and len(event.notes) == 1:
                        src = last_on_string.get(note.s)
                        if src is not None:
                            s_tick, s_note = src
                            new_tick, new_dur = retimed_slide_target(
                                event.tick, note.dur, note.tech,
                                s_tick, s_note.dur, tpb)
                            if new_tick != event.tick:
                                moves.append((event, note, new_tick, new_dur))
                    last_on_string[note.s] = (event.tick, note)
            for old_event, note, new_tick, new_dur in moves:
                note.dur = new_dur
                measure.events.remove(old_event)
                existing = next((e for e in measure.events if e.tick == new_tick), None)
                if existing is not None:
                    existing.notes.append(note)
                else:
                    measure.events.append(OTFEvent(tick=new_tick, notes=[note]))
            measure.events.sort(key=lambda e: e.tick)


def tef_to_otf(tef: TEFFile, tuning_override: str | None = None) -> OTFDocument:
    """Convert a parsed TEF file to OTF format.

    Args:
        tef: Parsed TEF file
        tuning_override: Optional tuning string like 'Double C (gCGCD)' to override default

    Returns:
        OTFDocument ready for serialization
    """
    doc = OTFDocument()

    # Metadata
    doc.metadata.title = tef.title or tef.path.stem
    if tef.header.is_v2:
        doc.metadata.time_signature = f"{tef.header.v2_time_num}/{tef.header.v2_time_denom}"
        if tef.header.v2_composer:
            doc.metadata.composer = tef.header.v2_composer
    elif tef.v3_global_ts:
        # V3: the measure table is the authoritative meter (27493 is
        # 4/4 per its own table and TablEdit's export — the old "2/2"
        # guess below mislabeled it; 4/4 and 2/2 are both 1920 ticks,
        # so tick math and oracle verification are unaffected).
        doc.metadata.time_signature = (
            f"{tef.v3_global_ts[0]}/{tef.v3_global_ts[1]}")
    else:
        # V3 with no measure table: legacy guess
        doc.metadata.time_signature = "2/2"  # Cut time for bluegrass
    # Per-measure overrides come from the reader for BOTH formats:
    # V2 type-27 components and the V3 measure table (oracle-confirmed
    # on 27493 m30/m49).
    doc.metadata.time_signature_changes = [
        {"measure": c.measure,
         "time_signature": f"{c.numerator}/{c.denominator}"}
        for c in tef.time_signature_changes
    ]

    # A file may RE-LABEL every measure with one signature (same-length
    # type-27 markers — e.g. 21874: 2/2 header, explicit 4/4 on all 24
    # measures). Promote a uniform, all-measure re-label to the global
    # signature instead of emitting N per-measure entries. Mixed or
    # partial coverage stays per-measure (OTF changes apply to their own
    # measure only, reverting to the global signature after).
    if tef.header.is_v2 and doc.metadata.time_signature_changes:
        changes = doc.metadata.time_signature_changes
        sigs = {c["time_signature"] for c in changes}
        total = tef.header.v2_measures or 0
        if (len(sigs) == 1 and total > 0
                and {c["measure"] for c in changes} == set(range(1, total + 1))):
            doc.metadata.time_signature = sigs.pop()
            doc.metadata.time_signature_changes = []

    # Header tempo, quarter-note BPM. Oracle-verified corpus-wide
    # (40/40 files match TablEdit's MusicXML/Rich-MIDI tempo metas):
    # V2 = the header tempo field, V3 = u16 @ 0x06. The old hardcoded
    # 100 made every tab play at the wrong speed (25635 is 260 — the
    # site played it at ~38% speed).
    tempo = (tef.header.v2_tempo if tef.header.is_v2
             else getattr(tef.header, "v3_tempo", 0))
    doc.metadata.tempo = tempo if 30 <= (tempo or 0) <= 500 else 100

    # Tracks from instruments
    # Default tunings when TEF parsing fails to extract tuning
    DEFAULT_TUNINGS = {
        '5-string-banjo': [62, 59, 55, 50, 67],  # D4, B3, G3, D3, G4 (Open G)
        'tenor-banjo': [67, 62, 55, 48],         # G4, D4, G3, C3 (CGdg - Irish/American tenor)
        'mandolin': [76, 69, 62, 55],            # E5, A4, D4, G3
        '6-string-guitar': [64, 59, 55, 50, 45, 40],  # E4, B3, G3, D3, A2, E2
    }

    # Uniquify duplicate ids (banjo, banjo-2, …) instead of skipping them.
    # Skipping shortened doc.tracks and broke `doc.tracks[event.track]`
    # index alignment, dumping later tracks' notes into "unknown"; the
    # pre-dedupe behavior merged same-kind tracks onto one notation key,
    # creating impossible same-string fret conflicts (e.g. 10750 Katy Hill:
    # 3 guitar tracks merged -> 308 phantom "missing notes" downstream).
    seen_track_ids: dict[str, int] = {}
    for inst in tef.instruments:
        track_id = instrument_to_otf_id(inst)

        count = seen_track_ids.get(track_id, 0) + 1
        seen_track_ids[track_id] = count
        if count > 1:
            track_id = f"{track_id}-{count}"

        inst_type = instrument_to_type(inst)

        # A drum track has no tuning to fall back to — inventing one (which
        # is what the banjo default below would do) is exactly what made
        # percussion play back as pitched notes.
        if inst.is_percussion:
            doc.tracks.append(OTFTrack(
                id=track_id,
                instrument=inst_type,
                tuning=[],
                capo=0,
                role="percussion",
                percussion=True,
                lines=inst.num_strings,
            ))
            continue

        # Use extracted tuning if available, otherwise use default
        if inst.tuning_pitches:
            tuning = [midi_to_pitch_name(p) for p in inst.tuning_pitches]
        else:
            default_pitches = DEFAULT_TUNINGS.get(inst_type, DEFAULT_TUNINGS['5-string-banjo'])
            tuning = [midi_to_pitch_name(p) for p in default_pitches]

        track = OTFTrack(
            id=track_id,
            instrument=inst_type,
            tuning=tuning,
            capo=inst.capo,
            role="lead" if "banjo" in inst.name.lower() or "mandolin" in inst.name.lower() else "rhythm",
        )
        doc.tracks.append(track)

    # Create default track if no instruments were detected
    # This happens with some TEF files that don't have instrument definitions
    if not doc.tracks:
        # Use tuning override if provided, otherwise default to Open G
        if tuning_override:
            override_pitches = parse_tuning_string(tuning_override)
            if override_pitches:
                default_pitches = override_pitches
            else:
                default_pitches = DEFAULT_TUNINGS['5-string-banjo']
        else:
            default_pitches = DEFAULT_TUNINGS['5-string-banjo']

        default_tuning = [midi_to_pitch_name(p) for p in default_pitches]
        doc.tracks.append(OTFTrack(
            id="banjo",
            instrument="5-string-banjo",
            tuning=default_tuning,
            capo=0,
            role="lead",
        ))

    # Pre-compute articulations based on note sequence and fret direction
    # This gives us a map of (track, position, string) -> technique for destination notes
    # V2 positions are native grid units — pass a half-measure gap in those units.
    # V3 has its own explicit per-note articulation byte (byte 6).
    if tef.header.is_v2:
        articulations = compute_articulations(
            tef.note_events, max_gap=articulation_max_gap(tef.header))
    else:
        articulations = compute_articulations_v3(tef.note_events)

    # Bend/choke notes: connect-bit + fret change + no h/p/slide (see
    # bend_destination_keys). Surfaced as a 'b' technique instead of a tie.
    bend_keys = bend_destination_keys(tef.note_events, articulations)

    # Group note events by track and measure.
    #
    # V2: event.position is in the NATIVE TEF grid — 256 units per whole
    # note, ts_size = 256*num/den units per measure. Conversion to MIDI
    # ticks (480/quarter) is exact: 1 unit = 1920/256 = 7.5 ticks. This
    # replaced a lossy 16-slots-per-measure quantization that broke every
    # meter whose real note grid doesn't sit on measure/16 slots (3/4,
    # 6/8 — oracle-confirmed on 13648/18136: slot 90 ticks vs true 120).
    #
    # V3: positions are continuous 64ths of a whole note (30 ticks each);
    # TEFFile.v3_locate() splits them by the measure table, so measures of
    # any length (2/4 in 27493, 6/4 in 3404) keep all their notes.
    V3_TICKS_PER_UNIT = 1920 // V3_UNITS_PER_WHOLE
    units_per_measure = tef.header.v2_ts_size or 256

    track_events: dict[str, dict[int, list[tuple[int, TEFNoteEvent]]]] = {}

    for event in tef.note_events:
        if not event.is_melody:
            continue

        # Get track ID
        if event.track < len(doc.tracks):
            track_id = doc.tracks[event.track].id
        else:
            track_id = "unknown"

        if track_id not in track_events:
            track_events[track_id] = {}

        # Calculate measure and tick within measure
        if tef.header.is_v2:
            measure = (event.position // units_per_measure) + 1
            position_in_measure = event.position % units_per_measure
        else:
            index, position_in_measure = tef.v3_locate(event.position)
            measure = index + 1
        if tef.header.is_v2:
            # 1 native unit = 1920/256 = 7.5 ticks. TablEdit's V2 loader
            # places each record at (loc << 1) & ~3, the V3 64th-note grid,
            # so a position off that grid is floored to it (old files such
            # as 10545 stored triplets at true positions like 213/256).
            tick = (position_in_measure & ~3) * 15 // 2
        else:
            tick = position_in_measure * V3_TICKS_PER_UNIT

        # Triplet timing (TuxGuitar TESongParser): the duration code (V2
        # byte3, V3 byte5, & 0x1f) encodes the division —
        # TRIPLET_DURATION_CODES are 3:2. The note's position is stored on
        # the straight grid but belongs at x4/3 of its offset within the
        # triplet SPAN, which depends on the note value: span = 2 x base
        # duration, where base = whole >> (code // 3). code 11 = eighth
        # triplet (span one beat, 480), code 8 = quarter triplet (span a
        # half note, 960 — oracle-confirmed on 15313 m53/56: 1440 -> 1600),
        # code 14 = 16th triplet (span 240). Per-note and authoritative for
        # both formats; it replaced a V3 'K'-marker group heuristic that
        # only matched one dynamic level (25151 m15 has a '+' middle note).
        # Only a note on the straight storage step (3/4 of its triplet
        # duration) is compressed: 10545's true-position triplets sit at
        # 150/300 of a 120-tick step, and TablEdit plays them unretimed.
        code = triplet_duration_code(event)
        if code is not None:
            span = 2 * (1920 >> (code // 3))
            step = decode_duration_code(code) * 3 // 4
            in_span = tick % span
            if in_span % step == 0:
                tick = tick - in_span + (in_span * 4) // 3

        if measure not in track_events[track_id]:
            track_events[track_id][measure] = []

        track_events[track_id][measure].append((tick, event))

    # Build notation structure
    for track_id, measures in track_events.items():
        doc.notation[track_id] = []

        for measure_num in sorted(measures.keys()):
            events = measures[measure_num]

            # Group events by tick position (for chords)
            events_by_tick: dict[int, list[TEFNoteEvent]] = {}
            for tick, evt in events:
                if tick not in events_by_tick:
                    events_by_tick[tick] = []
                events_by_tick[tick].append(evt)

            otf_measure = OTFMeasure(measure=measure_num)

            for tick in sorted(events_by_tick.keys()):
                otf_event = OTFEvent(tick=tick)

                for evt in events_by_tick[tick]:
                    # (An old "rhythm marker" skip dropped notes whose
                    # raw_data[4] was 0x0e/0x0f. In V2 that byte is
                    # effect1 and appears on real strummed chords
                    # (oracle: 20853 m34, 11829 mandolin chops); in V3
                    # it's the component-type byte, so the skip silently
                    # killed every fret-13/14 note (oracle: 25635
                    # m48-51). Removed on both paths.)
                    result = evt.decode_string_fret()
                    if result:
                        string, fret = result
                        # Look up technique from pre-computed articulations map
                        # (track, position, string) -> technique for destination notes
                        art_key = (evt.track, evt.position, string)
                        tech = articulations.get(art_key)
                        # Fall back to direct event technique for V3 or explicit effects
                        if tech is None:
                            tech = technique_from_event(evt)
                        # V3 byte 6 == 0x0f marks a DEAD/MUTED note (the
                        # chop 'x'): a per-note property, unlike the
                        # transition enum (1 h / 2 p / 3 sl) that byte
                        # otherwise carries. 27493's mandolin chop chords
                        # all carry it; they rendered as ringing open
                        # strings before (Mike caught the missing
                        # note-type). Takes precedence over any paired
                        # transition tech.
                        if is_dead_note(evt):
                            tech = 'x'
                        # Check if this note is tied to the previous note
                        tie = is_tied_note(evt)
                        # ...unless it's really a bend/choke (connect bit but a
                        # fret change, no h/p/slide): render 'b', not a tie.
                        if (evt.track, evt.position, string) in bend_keys:
                            tie = False
                            tech = 'b'
                        # Fingering: when a V2 fret byte's flag bits are
                        # exactly 0x20, TablEdit's V2 upgrade (FUN_1000459c4)
                        # copies effect2 into the cell byte V3 stores at
                        # record offset 10 — the same base-6 pluck + fretting
                        # digit code (see v3_fingering).
                        finger = None
                        lh = None
                        if tef.header.is_v2:
                            if (evt.raw_data and len(evt.raw_data) > 5
                                    and evt.raw_data[2] & 0xe0 == 0x20):
                                finger, lh = decode_fingering(evt.raw_data[5])
                        else:
                            finger, lh = v3_fingering(evt)
                        note = OTFNote(s=string, f=fret, tech=tech, finger=finger,
                                       lh=lh, tie=tie, dur=evt.duration_ticks,
                                       fx=note_fx(evt) or None,
                                       grace=note_grace(evt))
                        otf_event.notes.append(note)

                if otf_event.notes:
                    otf_measure.events.append(otf_event)

            if otf_measure.events:
                doc.notation[track_id].append(otf_measure)

    # Store slides as a note + articulation, not TablEdit's triplet-compress
    # timing hack (see normalize_slide_timing / tab-debug SKILL).
    normalize_slide_timing(doc)

    # Placed free-text annotations (V3 0x39 components: "Long Choke",
    # chord letters, section banners). Positions share the note grid, so
    # the same 64-units-per-measure math applies.
    for te in tef.text_events:
        if tef.header.is_v2:
            index, offset = divmod(te.position, units_per_measure)
            tick = (offset & ~3) * 15 // 2
        else:
            index, offset = tef.v3_locate(te.position)
            tick = offset * V3_TICKS_PER_UNIT
        doc.annotations.append(OTFAnnotation(
            measure=index + 1,
            tick=tick,
            text=te.text,
        ))

    # Reading list (with section labels when the file names its entries)
    for entry in tef.reading_list:
        doc.reading_list.append(OTFReadingListEntry(
            from_measure=entry.from_measure,
            to_measure=entry.to_measure,
            name=entry.name,
        ))

    return doc
