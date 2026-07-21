"""OTF (Open Tab Format) exporter for TEF files.

Copied from TablEdit_Reverse project.
"""

import json
from dataclasses import dataclass, field
from typing import Any

from .reader import TEFFile, TEFNoteEvent, TEFInstrument, decode_duration_code


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


# Fingering annotation codes from TEF format (multiples of 6)
FINGERING_MAP = {
    0x06: 'T',  # Thumb
    0x0c: 'I',  # Index
    0x12: 'M',  # Middle
}


@dataclass
class OTFNote:
    """A single note in OTF format."""
    s: int           # String number (1 = highest pitch)
    f: int           # Fret number (0 = open)
    tech: str | None = None    # Technique code (h, p, /, etc.)
    finger: str | None = None  # Fingering annotation (T, I, M)
    dur: int | None = None     # Duration in ticks (for sustained notes)
    tie: bool = False          # True if tied to previous note (no re-articulation)


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


@dataclass
class OTFDocument:
    """Complete OTF document."""
    otf_version: str = "1.0"
    metadata: OTFMetadata = field(default_factory=OTFMetadata)
    timing: OTFTiming = field(default_factory=OTFTiming)
    tracks: list[OTFTrack] = field(default_factory=list)
    notation: dict[str, list[OTFMeasure]] = field(default_factory=dict)
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
            result["tracks"].append({
                "id": track.id,
                "instrument": track.instrument,
                "tuning": track.tuning,
                "capo": track.capo,
                "role": track.role,
            })

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
                        if note.dur:
                            n["dur"] = note.dur
                        if note.tie:
                            n["tie"] = True
                        e["notes"].append(n)
                    m["events"].append(e)
                result["notation"][track_id].append(m)

        # Add reading list if present
        if self.reading_list:
            result["reading_list"] = [
                {"from_measure": e.from_measure, "to_measure": e.to_measure}
                for e in self.reading_list
            ]

        return result

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        try:
            import yaml
            return yaml.dump(self.to_dict(), default_flow_style=False, sort_keys=False, allow_unicode=True)
        except ImportError:
            # Fallback to JSON if yaml not available
            return self.to_json()

    def to_json(self, indent: int = 2) -> str:
        """Convert to JSON string."""
        return json.dumps(self.to_dict(), indent=indent)


def instrument_to_otf_id(inst: TEFInstrument) -> str:
    """Generate a clean, canonical ID from instrument name.

    Structural track records carry real names ("Upright Bass", "Acoustic
    Guitar", "Clicks"), so map by keyword to the canonical short ids the
    corpus and frontend already use (guitar, bass, mandolin, banjo, ...)
    instead of hyphenating arbitrary names. A clearly named non-banjo
    5-string track (e.g. a "Clicks" click track) must NOT become "banjo".
    """
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
        # V3 (12-byte record): high bit of the marker byte (byte 5) —
        # oracle-confirmed on 25635 m74 (0xe6 notes = XML tie stops).
        return bool(event.raw_data[5] & 0x80)
    return False


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
    are 16 slots per measure.
    """
    if header.is_v2:
        return (header.v2_ts_size or 256) // 2
    return 8


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
            # Bit 5 (0x20) is an independent flag riding the same byte
            # (oracle: 22446/24093 carry 0x21 = flag+hammer, 12574 has
            # 0x23 = flag+slide; 12124's bare 0x20 notes have no
            # technique). Mask it off; the enum lives in the low bits.
            tech = V2_TECH.get(event.raw_data[4] & 0x1f)
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
    max_gap: int = 8,
) -> dict[tuple[int, int, int], str]:
    """V3 articulations: byte 6 of the 12-byte record, on the SOURCE note,
    names the transition explicitly — 1 = hammer-on, 2 = pull-off,
    3 = slide. Attributed to the DESTINATION note (next note, same track
    and string, within max_gap slots), matching OTF convention.

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

    # Group note events by track and measure.
    #
    # V2: event.position is in the NATIVE TEF grid — 256 units per whole
    # note, ts_size = 256*num/den units per measure. Conversion to MIDI
    # ticks (480/quarter) is exact: 1 unit = 1920/256 = 7.5 ticks. This
    # replaced a lossy 16-slots-per-measure quantization that broke every
    # meter whose real note grid doesn't sit on measure/16 slots (3/4,
    # 6/8 — oracle-confirmed on 13648/18136: slot 90 ticks vs true 120).
    #
    # V3: positions remain in the 16-slots-per-measure grid emitted by
    # parse_note_events(); ticks_per_measure = num * (whole/den) where a
    # quarter is 480 ticks (the old `num * 480` was only correct for /4
    # meters — oracle-confirmed on 13654, 2/2).
    POSITIONS_PER_MEASURE = 16
    beats_per_measure = tef.header.v2_time_num  # Time signature numerator
    denom = tef.header.v2_time_denom or 4
    ticks_per_measure = beats_per_measure * 480 * 4 // denom
    TICKS_PER_POSITION = ticks_per_measure // POSITIONS_PER_MEASURE
    if tef.header.is_v2:
        units_per_measure = tef.header.v2_ts_size or 256
    else:
        units_per_measure = POSITIONS_PER_MEASURE

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
        measure = (event.position // units_per_measure) + 1
        position_in_measure = event.position % units_per_measure
        if tef.header.is_v2:
            # Exact: 1 native unit = 1920/256 = 7.5 ticks. Positions are
            # multiples of 2 in practice (finest TablEdit value = 64th
            # note = 4 units), so the //2 never truncates.
            tick = position_in_measure * 15 // 2
        else:
            tick = position_in_measure * TICKS_PER_POSITION

        # V2 triplet timing (TuxGuitar TESongParser): the duration code
        # (byte3 & 0x0f) encodes the division — code % 3 == 2 means triplet
        # (3:2). The note's position is stored on the straight grid but
        # belongs at x4/3 of its offset within the triplet SPAN, which
        # depends on the note value: span = 2 x base duration, where
        # base = whole >> (code // 3). code 11 = eighth triplet (span one
        # beat, 480), code 8 = quarter triplet (span a half note, 960 —
        # oracle-confirmed on 15313 m53/56: 1440 -> 1600), code 14 = 16th
        # triplet (span 240). Per-note and authoritative; replaces the
        # V3-style 'K'-marker group heuristic, which only matched one
        # dynamic level by accident.
        if (tef.header.is_v2 and event.raw_data and len(event.raw_data) >= 4
                and (event.raw_data[3] & 0x1f) % 3 == 2):
            code = event.raw_data[3] & 0x1f
            span = 2 * (1920 >> (code // 3))
            in_span = tick % span
            tick = tick - in_span + (in_span * 4) // 3

        if measure not in track_events[track_id]:
            track_events[track_id][measure] = []

        track_events[track_id][measure].append((tick, event))

    # Post-process to fix triplet timing
    # Triplet notes have marker 'K' (0x4b) and need tick adjustment
    # 8th note triplet: 3 notes span 2 eighths = 1 beat = 480 ticks
    # Spacing between triplet notes = 480 / 3 = 160 ticks
    TRIPLET_SPAN = 480  # 2 eighth notes = 1 beat
    TRIPLET_SPACING = TRIPLET_SPAN // 3  # 160 ticks between notes

    # V2 triplets are handled per-note from the duration code above; the
    # K-marker group heuristic below is for V3 (12-byte records), where the
    # marker byte is real. Running it on V2 would double-adjust.
    for track_id, measures in ({} if tef.header.is_v2 else track_events).items():
        for measure_num, events in measures.items():
            # Find triplet groups (consecutive positions with 'K' marker)
            triplet_notes = []
            for tick, evt in sorted(events, key=lambda x: x[0]):
                if evt.marker == 'K':
                    triplet_notes.append((tick, evt))

            # Process triplet groups (groups of 3 consecutive K notes)
            if len(triplet_notes) >= 3:
                # Group by starting beat (every 480 ticks = quarter note)
                i = 0
                while i <= len(triplet_notes) - 3:
                    t1, e1 = triplet_notes[i]
                    t2, e2 = triplet_notes[i + 1]
                    t3, e3 = triplet_notes[i + 2]

                    # Check if these 3 notes are consecutive (within 2 positions)
                    if (e2.position - e1.position <= 2) and (e3.position - e2.position <= 2):
                        # Calculate correct triplet ticks
                        # 8th note triplet: 3 notes in 480 ticks (1 beat)
                        base_tick = t1
                        new_ticks = [base_tick, base_tick + TRIPLET_SPACING, base_tick + 2 * TRIPLET_SPACING]

                        # Update the events list with new ticks
                        for j, (old_tick, evt) in enumerate([(t1, e1), (t2, e2), (t3, e3)]):
                            # Find and update in the original list
                            for k, (tick, e) in enumerate(events):
                                if e is evt:
                                    events[k] = (new_ticks[j], e)
                                    break
                        i += 3
                    else:
                        i += 1

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
                        if (evt.raw_data and len(evt.raw_data) >= 12
                                and evt.raw_data[6] == 0x0f):
                            tech = 'x'
                        # Check if this note is tied to the previous note
                        tie = is_tied_note(evt)
                        # Extract fingering annotation from effect2 when bit5 is set
                        finger = None
                        if evt.raw_data and len(evt.raw_data) > 5:
                            fret_byte = evt.raw_data[2]
                            effect2 = evt.raw_data[5]
                            if (fret_byte >> 5) & 0x01 and effect2 in FINGERING_MAP:
                                finger = FINGERING_MAP[effect2]
                        note = OTFNote(s=string, f=fret, tech=tech, finger=finger, tie=tie,
                                       dur=evt.duration_ticks)
                        otf_event.notes.append(note)

                if otf_event.notes:
                    otf_measure.events.append(otf_event)

            if otf_measure.events:
                doc.notation[track_id].append(otf_measure)

    # Store slides as a note + articulation, not TablEdit's triplet-compress
    # timing hack (see normalize_slide_timing / tab-debug SKILL).
    normalize_slide_timing(doc)

    # Reading list
    for entry in tef.reading_list:
        doc.reading_list.append(OTFReadingListEntry(
            from_measure=entry.from_measure,
            to_measure=entry.to_measure,
        ))

    return doc
