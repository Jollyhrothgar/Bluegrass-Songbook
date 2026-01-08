"""Binary reader for TEF files.

Copied from TablEdit_Reverse project.
"""

from dataclasses import dataclass, field
from pathlib import Path
import struct


class TEFVersionError(Exception):
    """Raised when a TEF file version is not supported."""

    def __init__(self, version: str, message: str = None):
        self.version = version
        if message is None:
            message = f"TEF version {version} is not supported. This parser only supports version 3.x files."
        super().__init__(message)


@dataclass
class TEFHeader:
    """TEF file header information."""
    format_id: int          # Bytes 0-1: format identifier (0x0010 for v3, 0 for v2)
    version_major: int      # Byte 3: major version (3 for v3, 2 for v2)
    version_minor: int      # Byte 2: minor version
    raw_header: bytes       # First 64 bytes for analysis
    # V2-specific fields (populated only for v2 files)
    v2_title: str = ""
    v2_composer: str = ""
    v2_comments: str = ""
    v2_header_end: int = 0  # Offset where v2 header ends and data begins
    v2_measures: int = 0    # Number of measures
    v2_time_num: int = 4    # Time signature numerator
    v2_time_denom: int = 4  # Time signature denominator
    v2_tempo: int = 120     # Tempo in BPM
    v2_strings: int = 4     # Total number of strings
    v2_tracks: int = 1      # Number of tracks
    v2_component_offset: int = 0  # Offset to component data
    v2_component_count: int = 0   # Number of components
    v2_repeats_count: int = 0    # Number of reading list entries

    @property
    def version(self) -> str:
        return f"{self.version_major}.{self.version_minor:02d}"

    @property
    def is_v2(self) -> bool:
        return self.version_major == 2

    @property
    def v2_ts_size(self) -> int:
        """Time slice size for v2 position calculations."""
        if self.v2_time_denom == 0:
            return 256
        return (256 * self.v2_time_num) // self.v2_time_denom


@dataclass
class TEFString:
    """A string extracted from the TEF file."""
    offset: int
    value: str
    length: int


@dataclass
class TEFInstrument:
    """Instrument definition from TEF file."""
    name: str
    tuning_name: str
    num_strings: int
    tuning_pitches: list[int]  # MIDI note numbers
    offset: int
    capo: int = 0  # Capo position (0 = no capo)


@dataclass
class TEFChord:
    """Chord definition from TEF file."""
    name: str
    offset: int


@dataclass
class TEFSection:
    """Section marker (e.g., "A Part", "B Part")."""
    name: str
    offset: int


@dataclass
class TEFReadingListEntry:
    """Reading list entry for MIDI playback order.

    The reading list defines which measure ranges to play and in what order.
    This allows TEF to store sections once but play them multiple times
    (like repeats in music notation).

    Structure at offset 0x4a0, 32-byte records:
    - Byte 1: from_measure (1-indexed)
    - Byte 3: to_measure (1-indexed)
    """
    index: int           # Entry number (1-indexed)
    from_measure: int    # Start measure (1-indexed)
    to_measure: int      # End measure (1-indexed, inclusive)
    offset: int          # File offset where entry was found


@dataclass
class TEFNoteEvent:
    """A note event from the TEF file.

    12-byte record structure (large file / event list format):
    - Bytes 0-1: Position (tick count, little-endian). Multiply by ~40 for MIDI ticks.
    - Byte 2: Always 0
    - Byte 3: Track/voice ID (1=melody, 3=bass?, 4=accompaniment?)
    - Byte 4: Marker type (0x49='I', 0x46='F', 0x4C='L', 0x00='S')
    - Byte 5: Articulation (0=normal, 1=hammer-on, 2=pull-off, 3=slide)
    - Bytes 6-8: Always 0
    - Byte 9: Module/voice (0=accompaniment, 6/12/18=melody voices)
    - Byte 10: Always 0
    - Byte 11: Combined string+fret encoding for melody notes
    """
    position: int          # Tick position (multiply by ~40 for MIDI ticks)
    track: int             # Track/module ID
    marker: str            # 'I'=Initial, 'F'=Fret, 'L'=Legato, 'S'=Special
    extra: int             # Articulation: 0=normal, 1=hammer-on, 2=pull-off, 3=slide
    pitch_byte: int        # Byte 9 - module/voice (0, 6, 12, or 18)
    raw_data: bytes        # Full 12-byte record for analysis

    @property
    def articulation(self) -> str:
        """Human-readable articulation type."""
        return {0: 'normal', 1: 'hammer-on', 2: 'pull-off', 3: 'slide'}.get(self.extra, 'unknown')

    @property
    def b6(self) -> int:
        """Byte 6 - contains string encoding in lower bits."""
        return self.raw_data[6] if len(self.raw_data) > 6 else 0

    @property
    def b9(self) -> int:
        """Byte 9 - module/voice indicator (0=accompaniment, 6/12/18=melody)."""
        return self.pitch_byte

    @property
    def b10(self) -> int:
        """Byte 10 - fret encoding (fret + 1)."""
        return self.raw_data[10] if len(self.raw_data) > 10 else 0

    @property
    def b11(self) -> int:
        """Byte 11 value - used in large file format."""
        return self.raw_data[11] if len(self.raw_data) > 11 else 0

    @property
    def is_melody(self) -> bool:
        """True if this is a melody note that should be exported.

        With TuxGuitar format, notes are identified by component type.
        String is stored in self.extra (1-indexed).
        Fret is stored in self.pitch_byte.

        Note: We include ALL note types (I, F, L) in melody export.
        The L (Legato) notes that shouldn't be separate MIDI events
        have specific byte patterns that need further analysis.
        """
        # Check if extra (string) and pitch_byte (fret) are valid
        return 1 <= self.extra <= 15 and 0 <= self.pitch_byte <= 24

    def decode_string_fret(self) -> tuple[int, int] | None:
        """Decode string and fret from note record.

        Returns (string, fret) tuple where string is 1-indexed and fret is 0+.
        Returns None if decoding fails.

        With TuxGuitar format:
        - self.extra contains local string (1-indexed within track)
        - self.pitch_byte contains fret (0-indexed)
        """
        # Validate string and fret ranges
        if not (1 <= self.extra <= 15) or not (0 <= self.pitch_byte <= 24):
            return None

        return (self.extra, self.pitch_byte)

    def get_pitch(self, tuning: list[int] | None = None) -> int | None:
        """Calculate MIDI pitch from string/fret.

        Args:
            tuning: List of MIDI pitches for each string (default: Open G banjo)
                    [D4=62, B3=59, G3=55, D3=50, g4=67]
        """
        if tuning is None:
            tuning = [62, 59, 55, 50, 67]  # Open G banjo: D4, B3, G3, D3, g4

        result = self.decode_string_fret()
        if result is None:
            return None

        string, fret = result
        if string < 1 or string > len(tuning):
            return None

        return tuning[string - 1] + fret


@dataclass
class TEFFile:
    """Parsed TEF file contents."""
    path: Path
    header: TEFHeader
    title: str = ""
    strings: list[TEFString] = field(default_factory=list)
    instruments: list[TEFInstrument] = field(default_factory=list)
    chords: list[TEFChord] = field(default_factory=list)
    sections: list[TEFSection] = field(default_factory=list)
    note_events: list[TEFNoteEvent] = field(default_factory=list)
    reading_list: list[TEFReadingListEntry] = field(default_factory=list)

    def dump(self) -> str:
        """Return a human-readable dump of the file contents."""
        lines = [
            f"TEF File: {self.path.name}",
            f"Version:  {self.header.version}",
            f"Title:    {self.title}",
            "",
            "Instruments:",
        ]
        for inst in self.instruments:
            pitches = ", ".join(str(p) for p in inst.tuning_pitches)
            lines.append(f"  - {inst.name} ({inst.num_strings} strings): [{pitches}]")

        if self.sections:
            lines.append("")
            lines.append("Sections:")
            for sec in self.sections:
                lines.append(f"  - {sec.name}")

        if self.chords:
            lines.append("")
            lines.append("Chords:")
            chord_names = [c.name for c in self.chords]
            lines.append(f"  {', '.join(chord_names)}")

        if self.reading_list:
            lines.append("")
            lines.append("Reading List (MIDI playback order):")
            for entry in self.reading_list:
                lines.append(f"  [{entry.index:02d}] measures {entry.from_measure}-{entry.to_measure}")

        if self.note_events:
            lines.append("")
            lines.append(f"Note Events: {len(self.note_events)} events")

            # Count melody vs accompaniment
            melody_events = [e for e in self.note_events if e.is_melody]
            accomp_events = [e for e in self.note_events if not e.is_melody]
            lines.append(f"  Melody: {len(melody_events)}, Accompaniment: {len(accomp_events)}")

            # Decode stats
            decoded = [e for e in melody_events if e.decode_string_fret() is not None]
            lines.append(f"  Successfully decoded: {len(decoded)}/{len(melody_events)} melody notes")

            # Group by position to show structure
            positions = {}
            for evt in self.note_events:
                positions.setdefault(evt.position, []).append(evt)
            lines.append(f"  Unique positions: {len(positions)}")

            # Show first few with decoded info
            lines.append("  First 15 melody notes:")
            shown = 0
            for evt in self.note_events:
                if not evt.is_melody:
                    continue
                result = evt.decode_string_fret()
                if result:
                    string, fret = result
                    pitch = evt.get_pitch()
                    art = f" ({evt.articulation})" if evt.extra != 0 else ""
                    lines.append(f"    tick {evt.position:4d}: s{string} f{fret} = MIDI {pitch}{art}")
                else:
                    lines.append(f"    tick {evt.position:4d}: [decode failed] b9={evt.b9} b11={evt.b11}")
                shown += 1
                if shown >= 15:
                    break

        return "\n".join(lines)


class TEFReader:
    """Reader for TablEdit .tef files."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.data = self.path.read_bytes()
        self.pos = 0

    def read_header(self) -> TEFHeader:
        """Parse the TEF header.

        V3 files start with binary header: format_id (0x0010), version bytes.
        V2 files start with plain ASCII text (title, composer, etc.).
        """
        raw = self.data[:64]

        # Detect v2 files: they start with printable ASCII text, not binary header
        # V3 format_id is 0x0010 (16) - first two bytes should be 0x10 0x00
        first_two = raw[0:2]
        if first_two[0] >= 0x20 and first_two[0] < 0x7F:
            # First byte is printable ASCII - this is a v2 file
            # Parse null-terminated strings at the start
            return self._read_v2_header()

        format_id = struct.unpack("<H", raw[0:2])[0]
        version_minor = raw[2]
        version_major = raw[3]

        return TEFHeader(
            format_id=format_id,
            version_major=version_major,
            version_minor=version_minor,
            raw_header=raw,
        )

    def _read_v2_header(self) -> TEFHeader:
        """Parse V2 file header following TuxGuitar format.

        V2 header structure:
        - Bytes 0-199: Info section (null-terminated strings: title, composer, comments)
        - Byte 200-201: measures count (little-endian short)
        - Byte 202: time signature numerator
        - Byte 203: skip
        - Byte 204: time signature denominator
        - Bytes 205-219: skip(15)
        - Bytes 220-221: tempo (little-endian short)
        - Byte 222: repeats count
        - Bytes 223-227: skip(5)
        - Byte 228: texts count
        - Bytes 229-233: skip(5)
        - Byte 234: percussions count
        - Byte 235: rhythms count
        - Byte 236: chords count
        - Byte 237: skip(1)
        - Byte 238: notes flag
        - Byte 239: skip(1)
        - Byte 240: strings count (total across all tracks)
        - Byte 241: tracks count (add 1 to get actual count)
        - Bytes 242-255: skip(14)
        - Byte 256-257: component count (little-endian short)
        - Byte 258+: components (6 bytes each)
        """
        # Parse info section (first 200 bytes contain null-terminated strings)
        info = self.data[0:200]
        strings = []
        pos = 0
        for _ in range(3):  # title, composer, comments
            end = info.find(b'\x00', pos)
            if end < 0:
                break
            s = info[pos:end].decode('latin-1', errors='replace')
            strings.append(s)
            pos = end + 1

        title = strings[0] if len(strings) > 0 else ""
        composer = strings[1] if len(strings) > 1 else ""
        comments = strings[2] if len(strings) > 2 else ""

        # Parse structured header fields (starting at offset 200)
        measures = struct.unpack('<H', self.data[200:202])[0]
        time_num = self.data[202]
        time_denom = self.data[204]
        tempo = struct.unpack('<H', self.data[220:222])[0]
        repeats_count = self.data[222]  # Reading list entry count
        num_strings = self.data[240]
        num_tracks = self.data[241] + 1

        # Component count at offset 256
        component_count = struct.unpack('<H', self.data[256:258])[0]
        component_offset = 258  # Components start right after count

        return TEFHeader(
            format_id=0,
            version_major=2,
            version_minor=0,
            raw_header=self.data[:64],
            v2_title=title,
            v2_composer=composer,
            v2_comments=comments,
            v2_header_end=258,  # Components start at 258
            v2_measures=measures,
            v2_time_num=time_num,
            v2_time_denom=time_denom,
            v2_tempo=tempo,
            v2_strings=num_strings,
            v2_tracks=num_tracks,
            v2_component_offset=component_offset,
            v2_component_count=component_count,
            v2_repeats_count=repeats_count,
        )

    def find_strings(self) -> list[TEFString]:
        """Find all readable strings in the file.

        TEF uses 2-byte little-endian length prefix followed by string data.
        Some strings are null-terminated, some are not.
        """
        strings = []
        i = 0
        while i < len(self.data) - 2:
            # Try 2-byte length prefix (little-endian)
            length = struct.unpack("<H", self.data[i:i+2])[0]
            if 3 <= length <= 100 and i + 2 + length <= len(self.data):
                candidate = self.data[i + 2:i + 2 + length]
                # Strip trailing null if present
                if candidate and candidate[-1] == 0:
                    candidate = candidate[:-1]
                # Check if it's printable ASCII (including common punctuation)
                if candidate and all(32 <= b < 127 or b in (0,) for b in candidate):
                    try:
                        value = candidate.decode('ascii').rstrip('\x00')
                        # Filter: require at least one letter, not all digits
                        if value and any(c.isalpha() for c in value):
                            strings.append(TEFString(offset=i, value=value, length=length))
                            i += 2 + length
                            continue
                    except UnicodeDecodeError:
                        pass
            i += 1
        return strings

    def find_section_marker(self, marker: bytes = b"debtG") -> int:
        """Find the section marker offset."""
        idx = self.data.find(marker)
        return idx if idx >= 0 else -1

    def _parse_tuning_note_names(self, text: str, num_strings: int = 5) -> list[int]:
        """Parse note names from tuning text and convert to MIDI pitches.

        E.g., "F# D F# A D" -> [66, 50, 54, 57, 62] (strings 5,4,3,2,1)
        Returns pitches in OTF order: [1st, 2nd, 3rd, 4th, 5th]
        """
        note_to_semitone = {
            'C': 0, 'C#': 1, 'Db': 1,
            'D': 2, 'D#': 3, 'Eb': 3,
            'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
            'G': 7, 'G#': 8, 'Ab': 8,
            'A': 9, 'A#': 10, 'Bb': 10,
            'B': 11
        }

        # Extract note names (skip words like "Tuning", "Open", etc.)
        parts = text.split()
        notes = [p for p in parts if p in note_to_semitone or
                 (len(p) == 2 and p[0] in 'ABCDEFG' and p[1] in '#b')]

        if len(notes) != num_strings:
            return []

        # Assign octaves based on typical banjo string pitches
        # 5-string banjo: 5th string is high drone (octave 4),
        # 4th-2nd are octave 3, 1st is octave 4
        if num_strings == 5:
            octaves = [4, 3, 3, 3, 4]  # For strings 5,4,3,2,1
        else:
            octaves = [3] * num_strings  # Default

        midi_pitches = []
        for i, note in enumerate(notes):
            semitone = note_to_semitone.get(note)
            if semitone is not None:
                octave = octaves[i]
                midi = semitone + (octave + 1) * 12
                midi_pitches.append(midi)

        # Return in OTF order: [1st, 2nd, 3rd, 4th, 5th] (reverse of how they appear)
        return midi_pitches[::-1] if len(midi_pitches) == num_strings else []

    def parse_instruments(self) -> list[TEFInstrument]:
        """Parse instrument definitions from the file.

        Instrument records in TEF v3 follow a structured format:
        - Instrument name (null-terminated string)
        - Tuning name (null-terminated string, e.g., "GDAE", "Standard")
        - These appear AFTER tuning byte data in the structured section

        To distinguish real instruments from text mentions, we require:
        1. Instrument name followed by null byte
        2. Then a valid tuning name (short, no spaces)
        """
        instruments = []

        # Known instrument patterns with typical string counts
        # Format: (name_pattern, default_strings)
        # Include both capitalized and lowercase versions
        # Note: Some TEF files embed tuning in the name (e.g., "Mandolin GDAE")
        # so we need patterns for these combined forms
        instrument_patterns = [
            (b"Mandolin GDAE", 4),
            (b"Mandolin Standard", 4),
            (b"Mandolin", 4),
            (b"mandolin", 4),
            (b"Clawhammer Banjo", 5),
            (b"clawhammer Banjo", 5),
            (b"Scruggs Banjo", 5),
            (b"Melodic Banjo", 5),
            (b"Banjo open G", 5),
            (b"banjo open G", 5),
            (b"Banjo open C", 5),
            (b"banjo open C", 5),
            (b"Banjo Double C", 5),
            # Tenor banjo (4-string) - must come before generic "Banjo" patterns
            (b"tenor banjo", 4),
            (b"Tenor banjo", 4),
            (b"Tenor Banjo", 4),
            (b"TENOR BANJO", 4),
            (b"CGdg", 4),  # Common tenor banjo tuning
            (b"CGDA", 4),  # Irish tenor banjo tuning
            (b"Banjo", 5),
            (b"banjo", 5),
            # Tuning-only patterns (no instrument name, just tuning)
            (b"D Tuning", 5),  # Open D / Graveyard tuning for banjo
            (b"G Tuning", 5),  # Open G tuning for banjo
            (b"C Tuning", 5),  # Open C tuning for banjo
            (b"Guitar Standard", 6),
            (b"guitar standard", 6),
            (b"Guitar", 6),
            (b"guitar", 6),
            (b"Bass", 4),
            (b"bass", 4),
            (b"Ukulele", 4),
            (b"ukulele", 4),
        ]

        found_offsets = set()  # Avoid duplicates

        for name_pattern, default_strings in instrument_patterns:
            # Search for all occurrences
            idx = 0
            while True:
                idx = self.data.find(name_pattern, idx)
                if idx < 0:
                    break

                # Skip if too close to a previously found instrument
                if any(abs(idx - off) < 50 for off in found_offsets):
                    idx += 1
                    continue

                # Read the full string from pattern start until null terminator
                # This handles cases like "D Tuning  F# D F# A D\x00" where the
                # pattern is just the beginning of a longer tuning description
                full_string_end = idx
                while full_string_end < len(self.data) and self.data[full_string_end] != 0:
                    full_string_end += 1

                # Validate we found a null terminator within reasonable distance
                if full_string_end - idx > 50:
                    idx += 1
                    continue

                try:
                    full_string = self.data[idx:full_string_end].decode('ascii')
                except UnicodeDecodeError:
                    idx += 1
                    continue

                # Get the instrument/tuning name
                name = name_pattern.decode('ascii')

                # The tuning description may include note names after the pattern
                # e.g., "D Tuning  F# D F# A D" -> tuning_name = "F# D F# A D"
                tuning_name = full_string[len(name):].strip() if len(full_string) > len(name) else ""

                # Now find the tuning bytes by looking backwards
                # The format has tuning bytes (one per string) before the name
                # First, look for the num_strings indicator

                # Look back to find tuning bytes
                # Tuning bytes are typically in range 0x14-0x60 (valid MIDI: 96-byte = 36-82)
                pos = idx - 1

                # Skip nulls and padding
                while pos > 0 and self.data[pos] == 0:
                    pos -= 1

                # Skip uniform bytes (velocity field - typically 6 bytes all same value)
                if pos >= 3:
                    uniform_val = self.data[pos]
                    if 0 < uniform_val < 128:
                        uniform_count = 0
                        check_pos = pos
                        while check_pos > 0 and self.data[check_pos] == uniform_val:
                            uniform_count += 1
                            check_pos -= 1
                        if uniform_count >= 4:
                            pos -= uniform_count

                # After velocity, check if there's a null separator before tuning
                # Pattern 1: [tuning bytes][velocity bytes] - no separator
                # Pattern 2: [tuning bytes][null][extra bytes][velocity bytes] - has separator
                #
                # Look for null within a small window; if found, tuning is before it
                num_strings = default_strings
                tuning_pitches = []

                # Check if there's a null within next few bytes (separator pattern)
                null_pos = -1
                for check in range(pos, max(pos - 3, 0), -1):
                    if self.data[check] == 0:
                        null_pos = check
                        break

                if null_pos >= 0:
                    # Found null separator - tuning is immediately before it
                    tuning_end = null_pos
                else:
                    # No separator - tuning ends at current position
                    tuning_end = pos + 1

                tuning_start = tuning_end - num_strings

                if tuning_start >= 0:
                    tuning_bytes = list(self.data[tuning_start:tuning_end])
                    # Validate tuning bytes are in reasonable range (MIDI 36-82)
                    valid = all(0x10 <= b <= 0x60 for b in tuning_bytes)
                    if valid:
                        tuning_pitches = [96 - b for b in tuning_bytes]

                # Fallback: if binary parsing failed and we have note names in tuning_name,
                # parse them (e.g., "F# D F# A D" -> MIDI pitches)
                if not tuning_pitches and tuning_name:
                    tuning_pitches = self._parse_tuning_note_names(tuning_name, num_strings)

                # Extract capo position (typically at offset -20 from instrument name)
                capo = 0
                capo_offset = idx - 20
                if capo_offset >= 0:
                    capo_byte = self.data[capo_offset]
                    # Capo values are typically 0-12 (no capo to 12th fret)
                    if 0 <= capo_byte <= 12:
                        capo = capo_byte

                found_offsets.add(idx)
                instruments.append(TEFInstrument(
                    name=name,
                    tuning_name=tuning_name,
                    num_strings=num_strings,
                    tuning_pitches=tuning_pitches,
                    offset=idx,
                    capo=capo,
                ))
                idx += 1

        # Sort by offset to maintain order
        instruments.sort(key=lambda x: x.offset)

        return instruments

    def parse_chords(self) -> list[TEFChord]:
        """Parse chord symbols from the file."""
        chords = []

        # Look for common chord patterns
        # Chords appear as length-prefixed strings in a specific region
        strings = self.find_strings()

        chord_patterns = {'C', 'D', 'E', 'F', 'G', 'A', 'B'}
        for s in strings:
            # Chord names: start with note letter, may have modifiers
            if s.value and s.value[0] in chord_patterns:
                # Filter: short, no spaces (not a title)
                if len(s.value) <= 10 and ' ' not in s.value:
                    # Additional filter: common chord suffixes
                    if len(s.value) == 1 or any(
                        s.value[1:].startswith(suf)
                        for suf in ['m', '7', 'maj', 'min', 'dim', 'aug', '#', 'b', 'sus']
                    ):
                        chords.append(TEFChord(name=s.value, offset=s.offset))

        return chords

    def parse_sections(self) -> list[TEFSection]:
        """Parse section markers (A Part, B Part, etc.)."""
        sections = []
        strings = self.find_strings()

        for s in strings:
            if 'Part' in s.value or s.value.startswith('(') and s.value.endswith(')'):
                sections.append(TEFSection(name=s.value, offset=s.offset))

        return sections

    def find_reading_list_offset(self) -> int:
        """Find the reading list offset from header.

        TuxGuitar format: Header offset 128 contains a 4-byte pointer to
        the reading list. If zero, file has no reading list.

        Returns the offset where reading list data starts, or -1 if none.
        """
        if len(self.data) < 132:
            return -1

        # Read 4-byte little-endian offset from header position 128
        pos_of_reading_list = struct.unpack('<I', self.data[128:132])[0]

        if pos_of_reading_list == 0:
            return -1  # No reading list

        if pos_of_reading_list >= len(self.data):
            return -1  # Invalid offset

        return pos_of_reading_list

    def parse_reading_list(self) -> list[TEFReadingListEntry]:
        """Parse the reading list for MIDI playback order.

        TuxGuitar format (from TEInputStream.java):
        - 2 bytes: entry size (typically 32)
        - 2 bytes: entry count
        - For each entry:
          - 2 bytes: start measure (little-endian short)
          - 2 bytes: end measure (little-endian short)
          - (entry_size - 4) bytes: name + padding

        The reading list tells MIDI playback which measure ranges to play and
        in what order, effectively "unfolding" repeats and D.S. sections.
        """
        entries = []

        reading_list_offset = self.find_reading_list_offset()
        if reading_list_offset < 0:
            return entries

        # Read header: 2-byte entry size + 2-byte count
        if reading_list_offset + 4 > len(self.data):
            return entries

        entry_size = struct.unpack('<H', self.data[reading_list_offset:reading_list_offset + 2])[0]
        entry_count = struct.unpack('<H', self.data[reading_list_offset + 2:reading_list_offset + 4])[0]

        # Sanity checks
        if entry_size < 4 or entry_size > 256 or entry_count > 100:
            return entries

        # Parse each entry
        data_start = reading_list_offset + 4
        for i in range(entry_count):
            entry_offset = data_start + i * entry_size
            if entry_offset + 4 > len(self.data):
                break

            # Read 2-byte measures (little-endian shorts)
            from_measure = struct.unpack('<H', self.data[entry_offset:entry_offset + 2])[0]
            to_measure = struct.unpack('<H', self.data[entry_offset + 2:entry_offset + 4])[0]

            # Skip invalid entries
            if from_measure == 0 and to_measure == 0:
                continue

            entries.append(TEFReadingListEntry(
                index=i + 1,
                from_measure=from_measure,
                to_measure=to_measure,
                offset=entry_offset,
            ))

        return entries

    def find_component_offset(self) -> int:
        """Find the component (note) region start using the 'debt' header marker.

        The 'debt' marker at offset 56 is followed by a 4-byte pointer to the
        component section. Components use TuxGuitar format:
        - Bytes 0-3: location (encodes measure + position + cumulative string)
        - Byte 4: component type (notes have fret in bits 0-4)
        - Bytes 5-11: component-specific data

        Returns the component region start offset, or -1 if not found.
        """
        debt_pos = self.data.find(b'debt')
        if debt_pos < 0:
            return -1

        # Read the 4-byte pointer value after 'debt' - this points directly to components
        debt_val = struct.unpack('<I', self.data[debt_pos + 4:debt_pos + 8])[0]

        if debt_val >= len(self.data) or debt_val < 100:
            return -1

        return debt_val

    def find_debt_offset(self) -> int:
        """Legacy method - calls find_component_offset for compatibility."""
        return self.find_component_offset()

    def find_note_region(self) -> tuple[int, str]:
        """Find the start offset of the note event region and format type.

        Uses the unified format discovered via the 'debt' header:
        - All files use 12-byte records with marker at byte 11
        - String encoded in bits 3-5 of position low byte (byte 6)
        - Fret in byte 10 (value - 1)
        - Position in bytes 6-7 (low bytes) or extended with 0-5 for larger positions

        Returns (offset, 'unified') or (-1, '') if not found.
        """
        # Try the debt header approach first
        offset = self.find_debt_offset()
        if offset >= 0:
            return (offset, 'unified')

        # Fallback: search for marker pattern at byte 11
        for start in range(0x400, len(self.data) - 24, 4):
            rec1 = self.data[start:start+12]
            rec2 = self.data[start+12:start+24]

            if len(rec1) < 12 or len(rec2) < 12:
                continue

            # Check for valid markers at byte 11
            if (rec1[11] in (0x49, 0x46, 0x4c) and
                rec2[11] in (0x49, 0x46, 0x4c)):
                return (start, 'unified')

        return (-1, '')

    def parse_note_events(self, start_offset: int = -1) -> list[TEFNoteEvent]:
        """Parse note events using TuxGuitar component format.

        Component records are 12 bytes:
        - Bytes 0-3: Location (encodes measure, position, cumulative string)
        - Byte 4: Component type (notes have fret in bits 0-4)
        - Bytes 5-11: Component-specific parameters

        For notes: fret = (componentType & 0x1f) - 1
        String and track are calculated from location using cumulative string counts.
        """
        events = []

        # Get component start offset
        if start_offset < 0:
            start_offset = self.find_component_offset()
            if start_offset < 0:
                return events

        # Calculate total strings across all instruments for location decoding
        total_strings = sum(inst.num_strings for inst in self.parse_instruments())
        if total_strings == 0:
            total_strings = 5  # Default to single 5-string instrument

        VALUE_PER_STRING = 8
        VALUE_PER_POSITION = 32 * total_strings

        # Get track string counts for track identification
        instruments = self.parse_instruments()
        track_string_counts = [inst.num_strings for inst in instruments]
        if not track_string_counts:
            track_string_counts = [5]  # Default banjo

        # Non-note component types (from TuxGuitar TEInputStream.java)
        NON_NOTE_TYPES = {0x33, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3D,
                         0x75, 0x78, 0x7D, 0x7E, 0xB6, 0xB7, 0xBD, 0xBE, 0xFD, 0xFE}

        offset = start_offset
        consecutive_invalid = 0
        max_invalid = 20

        while offset + 12 <= len(self.data):
            record = self.data[offset:offset + 12]

            # TuxGuitar format: bytes 0-3 = location, byte 4 = component type
            location = struct.unpack('<I', record[0:4])[0]
            component_type = record[4]

            # Skip known non-note component types
            if component_type in NON_NOTE_TYPES:
                offset += 12
                continue

            # Check if it's a note: bits 0-4 should be in range 1-25 (fret 0-24)
            lower_bits = component_type & 0x1f
            if lower_bits < 0x01 or lower_bits > 0x19:
                # Not a valid note - might be end of components or unknown type
                offset += 12
                consecutive_invalid += 1
                if consecutive_invalid >= max_invalid:
                    break
                continue

            consecutive_invalid = 0

            # Decode note properties
            fret = lower_bits - 1

            # Calculate cumulative string from location
            cumulative_string = (location % VALUE_PER_POSITION) // VALUE_PER_STRING

            # Find which track owns this string
            track_idx = 0
            local_string = cumulative_string
            for idx, num_strings in enumerate(track_string_counts):
                if local_string < num_strings:
                    track_idx = idx
                    break
                local_string -= num_strings

            # Calculate position (in 16th note grid)
            position = location // VALUE_PER_POSITION

            # Read actual marker from record[5] (I=Initial, F=Fret, L=Legato, etc.)
            marker_byte = record[5]
            if marker_byte == 0x49:  # 'I'
                marker = 'I'
            elif marker_byte == 0x46:  # 'F'
                marker = 'F'
            elif marker_byte == 0x4c:  # 'L'
                marker = 'L'
            elif marker_byte == 0x43:  # 'C'
                marker = 'C'
            elif marker_byte == 0x40:  # '@'
                marker = '@'
            elif marker_byte == 0x41:  # 'A'
                marker = 'A'
            else:
                marker = chr(marker_byte) if 32 <= marker_byte <= 126 else 'F'

            # Check for grace note flag in component type
            is_grace_note = bool(component_type & 0x40)

            # Store track index, local string (1-indexed), and fret
            # Use pitch_byte field to store track index for filtering
            events.append(TEFNoteEvent(
                position=position,
                track=track_idx,
                marker=marker,
                extra=local_string + 1,  # Store 1-indexed local string
                pitch_byte=fret,          # Store fret directly
                raw_data=record,
            ))

            offset += 12

        return events

    def parse_note_events_v2(self, header: TEFHeader) -> list[TEFNoteEvent]:
        """Parse note events from V2 format (6-byte records).

        V2 record format (per TuxGuitar TEInputStream.java):
        - Bytes 0-1: location (combined position/string/measure encoding)
        - Byte 2: type+fret (bits 0-4 = fret+1, where 0x01-0x19 are notes)
        - Byte 3: duration (bits 0-4) + dynamic (bits 5-7)
        - Byte 4: effect1
        - Byte 5: effect2

        Location decoding:
        - tsSize = (256 * numerator) / denominator
        - position = location % tsSize
        - string = (location / tsSize) % numStrings
        - measure = location / (tsSize * numStrings)
        """
        events = []

        # Use header values for decoding
        ts_size = header.v2_ts_size
        num_strings = header.v2_strings
        component_offset = header.v2_component_offset
        component_count = header.v2_component_count

        if ts_size == 0 or num_strings == 0:
            return events

        # Get track string counts to map cumulative string to track
        instruments = self.parse_instruments_v2(header)
        track_string_counts = [inst.num_strings for inst in instruments]
        if not track_string_counts:
            track_string_counts = [num_strings]  # Single track fallback

        # TuxGuitar uses mData to handle measure overflow (when location wraps)
        m_data = 0
        m_index = 0

        offset = component_offset
        for _ in range(component_count):
            if offset + 6 > len(self.data):
                break

            rec = self.data[offset:offset + 6]

            # Decode location with overflow handling (per TuxGuitar)
            location = (rec[0] & 0xff) + (256 * (m_data + (rec[1] & 0xff)))

            # Check for measure overflow
            if (location // (ts_size * num_strings)) < m_index:
                m_data += 256
                location = (rec[0] & 0xff) + (256 * (m_data + (rec[1] & 0xff)))

            # Decode position/string/measure
            position_in_measure = location % ts_size
            cumulative_string = (location // ts_size) % num_strings
            measure = location // (ts_size * num_strings)

            m_index = measure  # Track current measure for overflow detection

            fret_byte = rec[2]
            fret_raw = fret_byte & 0x1f

            # Check for note vs special component
            if fret_raw >= 0x01 and fret_raw <= 0x19:
                # This is a note
                fret = fret_raw - 1

                # Handle high frets (bit 5 set means add effect2 to fret)
                # But NOT when effect2 is a special marker:
                # 0x06=text annotation, 0x07=chord overlay, 0x0c/0x12=fingering annotations
                # These annotation codes appear to be multiples of 6 (6, 12, 18)
                effect2_val = rec[5] if len(rec) > 5 else 0
                annotation_codes = {0x06, 0x07, 0x0c, 0x12}
                if (fret_byte >> 5) & 0x01 and effect2_val not in annotation_codes and effect2_val > 0:
                    fret += effect2_val

                # Extract marker from byte 3 (duration byte contains marker in upper bits)
                # Common markers: 'I'=0x49 (Initial), 'F'=0x46 (Fret), 'C'=0x43 (Chord)
                duration_byte = rec[3]
                marker_char = chr(duration_byte) if 0x40 <= duration_byte <= 0x5A else 'F'

                # Note filtering happens in post-processing after all notes are collected
                # to handle cases where 'C' markers are real notes vs chord diagrams
                effect2 = rec[5] if len(rec) > 5 else 0

                # Map cumulative string to track and local string
                track_idx = 0
                local_string = cumulative_string
                for idx, num_track_strings in enumerate(track_string_counts):
                    if local_string < num_track_strings:
                        track_idx = idx
                        break
                    local_string -= num_track_strings

                # Convert to 16th-note position for consistency with v3 format
                # (MIDI exporter expects positions in 16th note units)
                POSITIONS_PER_MEASURE = 16  # 16th notes in 4/4
                abs_position = measure * POSITIONS_PER_MEASURE + (position_in_measure * POSITIONS_PER_MEASURE // ts_size)

                # Create note event
                events.append(TEFNoteEvent(
                    position=abs_position,
                    track=track_idx,
                    marker=marker_char,
                    extra=local_string + 1,  # 1-indexed local string within track
                    pitch_byte=fret,
                    raw_data=rec,
                ))

            offset += 6

        return events

    def parse_instruments_v2(self, header: TEFHeader) -> list[TEFInstrument]:
        """Parse instruments from V2 format.

        V2 stores instrument info at the end of the file, similar to v3.
        """
        # Use same logic as v3 - instrument names appear in the file
        # Just call the existing parser
        return self.parse_instruments()

    def parse_reading_list_v2(self, header: TEFHeader) -> list[TEFReadingListEntry]:
        """Parse reading list (repeat structure) from V2 format.

        V2 reading list format:
        - Count is at byte 222 of header (v2_repeats_count)
        - Data starts right after components (offset 258 + component_count * 6)
        - Each entry is 2 bytes: (from_measure, to_measure)
        """
        entries = []
        count = header.v2_repeats_count

        if count == 0:
            return entries

        # Reading list starts after components
        reading_list_offset = header.v2_component_offset + header.v2_component_count * 6

        for i in range(count):
            offset = reading_list_offset + i * 2
            if offset + 1 >= len(self.data):
                break

            from_measure = self.data[offset]
            to_measure = self.data[offset + 1]
            entries.append(TEFReadingListEntry(
                index=i,
                from_measure=from_measure,
                to_measure=to_measure,
                offset=offset,
            ))

        return entries

    def parse(self) -> TEFFile:
        """Parse the entire TEF file.

        Supports both V2 and V3 formats:
        - V2: Older format with 6-byte note records
        - V3: Current format with 12-byte note records
        """
        header = self.read_header()

        # Dispatch based on version
        if header.is_v2:
            return self._parse_v2(header)
        else:
            return self._parse_v3(header)

    def _filter_chord_diagrams(self, events: list[TEFNoteEvent]) -> list[TEFNoteEvent]:
        """Filter out chord diagram notes that accompany melody notes.

        Rules:
        1. Notes with markers 'I', 'F', 'L', 'K' are always melody notes
        2. Notes with other markers ('C', 'D', '@', etc.) at positions that
           ALSO have 'I', 'F', 'L', 'K' markers are chord diagrams (filter out)
        3. Notes with 'C' marker at positions with NO melody markers are
           real melody notes (keep them)
        4. Always filter notes with effect2=0x07 (chord overlay indicator)
        """
        from collections import defaultdict

        # Group notes by (track, position)
        notes_by_pos: dict[tuple[int, int], list[TEFNoteEvent]] = defaultdict(list)
        for evt in events:
            notes_by_pos[(evt.track, evt.position)].append(evt)

        MELODY_MARKERS = {'I', 'F', 'L', 'K', 'O'}  # O = legato out (slide/hammer source)
        # Markers that can serve as melody when no MELODY_MARKERS present
        FALLBACK_MELODY_MARKERS = {'C'}  # 'C' = chord, but sometimes used for melody
        # Markers to always skip
        SKIP_MARKERS = {'D'}  # 'D' = diagram overlay
        filtered = []

        for (track, pos), pos_events in notes_by_pos.items():
            # Check if this position has any melody markers
            has_melody_marker = any(e.marker in MELODY_MARKERS for e in pos_events)

            for evt in pos_events:
                # Always skip effect2=0x07 (chord overlay)
                effect2 = evt.raw_data[5] if len(evt.raw_data) > 5 else 0
                if effect2 == 0x07:
                    continue

                # Always skip D markers
                if evt.marker in SKIP_MARKERS:
                    continue

                # Keep melody markers always
                if evt.marker in MELODY_MARKERS:
                    filtered.append(evt)
                # Keep fallback melody markers only if no primary melody marker exists
                elif evt.marker in FALLBACK_MELODY_MARKERS and not has_melody_marker:
                    filtered.append(evt)
                # For '@' markers: only keep if no melody marker AND highest fret at position
                elif evt.marker == '@' and not has_melody_marker:
                    # Get all @ notes at this position and keep only highest fret
                    at_notes = [e for e in pos_events if e.marker == '@']
                    if at_notes:
                        frets = []
                        for e in at_notes:
                            r = e.decode_string_fret()
                            frets.append((r[1] if r else -1, e))
                        max_fret = max(f for f, _ in frets)
                        # Only add this event if it has the max fret
                        evt_fret = evt.decode_string_fret()
                        if evt_fret and evt_fret[1] == max_fret:
                            filtered.append(evt)
                # else: skip (chord diagram accompanying melody note)

        return filtered

    def _parse_v2(self, header: TEFHeader) -> TEFFile:
        """Parse V2 format TEF file."""
        # Title comes from header for v2
        title = header.v2_title

        # Parse instruments (same format as v3, at end of file)
        instruments = self.parse_instruments_v2(header)

        # Parse notes using v2 format
        note_events = self.parse_note_events_v2(header)

        # Filter chord diagram notes that accompany melody notes
        note_events = self._filter_chord_diagrams(note_events)

        # Parse reading list (repeat structure)
        reading_list = self.parse_reading_list_v2(header)

        # V2 chords stored differently - not yet implemented
        chords = []
        sections = []
        strings = []

        return TEFFile(
            path=self.path,
            header=header,
            title=title,
            strings=strings,
            instruments=instruments,
            chords=chords,
            sections=sections,
            note_events=note_events,
            reading_list=reading_list,
        )

    def _parse_v3(self, header: TEFHeader) -> TEFFile:
        """Parse V3 format TEF file."""
        strings = self.find_strings()

        # Find title (usually the longest string early in the file)
        title = ""
        for s in strings:
            if s.offset < 0x200 and len(s.value) > len(title):
                # Skip common non-title strings
                if 'Part' not in s.value and not s.value.startswith('('):
                    title = s.value

        instruments = self.parse_instruments()
        chords = self.parse_chords()
        sections = self.parse_sections()
        note_events = self.parse_note_events()
        reading_list = self.parse_reading_list()

        return TEFFile(
            path=self.path,
            header=header,
            title=title,
            strings=strings,
            instruments=instruments,
            chords=chords,
            sections=sections,
            note_events=note_events,
            reading_list=reading_list,
        )
