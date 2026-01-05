"""OTF (Open Tab Format) exporter for TEF files.

Copied from TablEdit_Reverse project.
"""

import json
from dataclasses import dataclass, field
from typing import Any

from .reader import TEFFile, TEFNoteEvent, TEFInstrument


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


@dataclass
class OTFNote:
    """A single note in OTF format."""
    s: int           # String number (1 = highest pitch)
    f: int           # Fret number (0 = open)
    tech: str | None = None  # Technique code (h, p, /, etc.)
    dur: int | None = None   # Duration in ticks (for sustained notes)
    tie: bool = False        # True if tied to previous note (no re-articulation)


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
    """Generate a clean ID from instrument name."""
    name = inst.name.lower()
    # Remove common suffixes
    for suffix in [" open g", " standard", " gdae", " gda"]:
        name = name.replace(suffix, "")
    # Replace spaces with hyphens
    name = name.replace(" ", "-")
    return name


def instrument_to_type(inst: TEFInstrument) -> str:
    """Map instrument name to standard type identifier."""
    name = inst.name.lower()
    if "banjo" in name:
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

    In V2 format, the high bit (0x80) on byte 3 (marker byte) indicates a tie.
    Tied notes should not be re-articulated - they just extend the previous note's duration.
    """
    if event.raw_data and len(event.raw_data) >= 4:
        marker_byte = event.raw_data[3]
        return bool(marker_byte & 0x80)
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
    # Check effect bytes from raw_data
    if event.raw_data and len(event.raw_data) >= 5:
        effect1 = event.raw_data[4]

        # V2 format: byte 4 contains effect1 bits
        # bit 0 (0x01): Hammer-on indicator
        # bit 1 (0x02): Legato (h or p depending on direction)
        # bit 2 (0x04): Bend (1/4 step) - NOT a pull-off, ignore for now
        # Note: 0x01 and 0x02 (legato) are handled by compute_articulations() for V2
        # which uses direction-based detection

        # V3 format: byte 5 contains articulation
        if len(event.raw_data) > 5:
            art_byte = event.raw_data[5]
            if art_byte == 1:
                return "h"  # Hammer-on
            elif art_byte == 2:
                return "p"  # Pull-off
            elif art_byte == 3:
                return "/"  # Slide

    return None


def compute_articulations(note_events: list[TEFNoteEvent]) -> dict[tuple[int, int, int], str]:
    """Compute articulation techniques based on note sequence and fret direction.

    In TablEdit V2 format, legato is marked with 0x02 on the SOURCE note, but
    the actual technique (hammer-on vs pull-off) depends on fret direction:
    - Going to higher fret = hammer-on (h)
    - Going to lower fret = pull-off (p)

    The technique marker should be on the DESTINATION note in standard tab notation.

    Returns:
        Dict mapping (track, position, string) to technique code for DESTINATION notes
    """
    articulations: dict[tuple[int, int, int], str] = {}

    # Group notes by track and string, sorted by position
    notes_by_track_string: dict[tuple[int, int], list[TEFNoteEvent]] = {}

    for event in note_events:
        if not event.is_melody:
            continue
        result = event.decode_string_fret()
        if not result:
            continue
        string, fret = result
        key = (event.track, string)
        if key not in notes_by_track_string:
            notes_by_track_string[key] = []
        notes_by_track_string[key].append(event)

    # Sort each group by position
    for key in notes_by_track_string:
        notes_by_track_string[key].sort(key=lambda e: e.position)

    # Process each track/string sequence
    for (track, string), notes in notes_by_track_string.items():
        for i, event in enumerate(notes):
            if not has_legato_effect(event):
                continue

            result = event.decode_string_fret()
            if not result:
                continue
            _, source_fret = result

            # Find the next note on the same string
            if i + 1 < len(notes):
                next_event = notes[i + 1]
                next_result = next_event.decode_string_fret()
                if next_result:
                    _, dest_fret = next_result

                    # Check if notes are close enough to be a legato pair (within 2 positions)
                    if next_event.position - event.position <= 2:
                        # Check for slide first (effect1=0x03)
                        if is_slide_effect(event):
                            tech = "/"  # Slide
                        elif dest_fret > source_fret:
                            tech = "h"  # Hammer-on (going up)
                        else:
                            tech = "p"  # Pull-off (going down or same fret)

                        # Apply technique to DESTINATION note
                        dest_key = (track, next_event.position, string)
                        articulations[dest_key] = tech

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
    else:
        # V3 defaults
        doc.metadata.time_signature = "2/2"  # Cut time for bluegrass

    # Use 100 BPM as default - extracted tempos from TEF files are often unreliable
    doc.metadata.tempo = 100

    # Tracks from instruments
    # Default tunings when TEF parsing fails to extract tuning
    DEFAULT_TUNINGS = {
        '5-string-banjo': [62, 59, 55, 50, 67],  # D4, B3, G3, D3, G4 (Open G)
        'mandolin': [76, 69, 62, 55],            # E5, A4, D4, G3
        '6-string-guitar': [64, 59, 55, 50, 45, 40],  # E4, B3, G3, D3, A2, E2
    }

    seen_track_ids = set()
    for inst in tef.instruments:
        track_id = instrument_to_otf_id(inst)

        # Skip duplicate track IDs (keep first occurrence)
        if track_id in seen_track_ids:
            continue
        seen_track_ids.add(track_id)

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
    articulations = compute_articulations(tef.note_events)

    # Group note events by track and measure
    # TEF position is in 16th note grid, 16 positions per measure
    # Calculate ticks per position based on actual time signature from TEF
    # ticks_per_beat = 480 (standard MIDI), ticks_per_measure = beats * 480
    POSITIONS_PER_MEASURE = 16
    beats_per_measure = tef.header.v2_time_num  # Time signature numerator (e.g., 4 for 4/4)
    ticks_per_measure = beats_per_measure * 480
    TICKS_PER_POSITION = ticks_per_measure // POSITIONS_PER_MEASURE

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
        measure = (event.position // POSITIONS_PER_MEASURE) + 1
        position_in_measure = event.position % POSITIONS_PER_MEASURE
        tick = position_in_measure * TICKS_PER_POSITION

        if measure not in track_events[track_id]:
            track_events[track_id][measure] = []

        track_events[track_id][measure].append((tick, event))

    # Post-process to fix triplet timing
    # Triplet notes have marker 'K' (0x4b) and need tick adjustment
    # 8th note triplet: 3 notes span 2 eighths = 1 beat = 480 ticks
    # Spacing between triplet notes = 480 / 3 = 160 ticks
    TRIPLET_SPAN = 480  # 2 eighth notes = 1 beat
    TRIPLET_SPACING = TRIPLET_SPAN // 3  # 160 ticks between notes

    for track_id, measures in track_events.items():
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
                    # Skip rhythm marker notes (effect1=0x0f or 0x0e)
                    # These are often ghost notes or percussion indicators
                    if evt.raw_data and len(evt.raw_data) >= 5:
                        effect1 = evt.raw_data[4]
                        if effect1 in (0x0e, 0x0f):
                            continue

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
                        # Check if this note is tied to the previous note
                        tie = is_tied_note(evt)
                        note = OTFNote(s=string, f=fret, tech=tech, tie=tie)
                        otf_event.notes.append(note)

                if otf_event.notes:
                    otf_measure.events.append(otf_event)

            if otf_measure.events:
                doc.notation[track_id].append(otf_measure)

    # Reading list
    for entry in tef.reading_list:
        doc.reading_list.append(OTFReadingListEntry(
            from_measure=entry.from_measure,
            to_measure=entry.to_measure,
        ))

    return doc
