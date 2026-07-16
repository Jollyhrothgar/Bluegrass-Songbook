"""
Ultimate Guitar chord sheet parser.

Converts UG's text format (chord lines above lyrics) to structured sections
with chord positions suitable for ChordPro generation.
"""

import re
from dataclasses import dataclass, field


@dataclass
class ChordLine:
    """A line with chords and lyrics."""
    chords: str  # Raw chord line with spacing
    lyrics: str  # Corresponding lyric line

    def to_chordpro(self) -> str:
        """Convert to ChordPro format with inline chords."""
        if not self.chords.strip():
            return self.lyrics

        # Parse chord positions from the chord line
        chord_positions = []
        i = 0
        while i < len(self.chords):
            if self.chords[i] != ' ':
                # Found a chord - extract it
                chord_start = i
                while i < len(self.chords) and self.chords[i] != ' ':
                    i += 1
                chord = self.chords[chord_start:i]
                chord_positions.append((chord_start, chord))
            else:
                i += 1

        if not chord_positions:
            return self.lyrics

        # Insert chords into lyrics at their positions
        result = []
        last_pos = 0

        for pos, chord in chord_positions:
            # Add lyrics up to this position
            if pos > len(self.lyrics):
                pos = len(self.lyrics)
            result.append(self.lyrics[last_pos:pos])
            result.append(f'[{chord}]')
            last_pos = pos

        # Add remaining lyrics
        result.append(self.lyrics[last_pos:])

        return ''.join(result)


@dataclass
class Section:
    """A song section (verse, chorus, etc)."""
    section_type: str  # "verse", "chorus", "bridge", etc
    label: str | None = None  # "Verse 1", "Chorus", etc
    lines: list[ChordLine] = field(default_factory=list)

    def to_chordpro(self) -> str:
        """Convert section to ChordPro format."""
        lines = []

        # Section header
        if self.section_type == 'chorus':
            lines.append('{start_of_chorus}')
        else:
            label = self.label or self.section_type.title()
            lines.append(f'{{start_of_verse: {label}}}')

        # Content lines
        for chord_line in self.lines:
            lines.append(chord_line.to_chordpro())

        # Section footer
        if self.section_type == 'chorus':
            lines.append('{end_of_chorus}')
        else:
            lines.append('{end_of_verse}')

        return '\n'.join(lines)


@dataclass
class UGSong:
    """Parsed Ultimate Guitar song data."""
    title: str
    artist: str
    url: str
    tuning: str | None = None
    capo: str | None = None
    rating: float | None = None
    sections: list[Section] = field(default_factory=list)

    def to_chordpro(self) -> str:
        """Convert entire song to ChordPro format."""
        lines = []

        # Metadata
        lines.append(f'{{meta: title {self.title}}}')
        lines.append(f'{{meta: artist {self.artist}}}')
        lines.append('{meta: x_chords_source ultimate-guitar}')
        lines.append(f'{{meta: x_chords_url {self.url}}}')

        if self.tuning and self.tuning != 'E A D G B E':
            lines.append(f'{{meta: x_tuning {self.tuning}}}')
        if self.capo and self.capo.lower() != 'no capo':
            lines.append(f'{{capo: {self.capo}}}')

        lines.append('')

        # Sections
        for section in self.sections:
            lines.append(section.to_chordpro())
            lines.append('')

        return '\n'.join(lines)


def parse_ug_content(raw_lines: list[str]) -> list[Section]:
    """
    Parse UG raw content lines into structured sections.

    UG format:
    - Section headers: [Verse], [Chorus], [Intro], etc
    - Chord lines: Just chords with spacing
    - Lyric lines: Text below chord lines
    """
    sections = []
    current_section = None
    pending_chord_line = None
    verse_counter = 0

    # Clean and normalize lines
    lines = [l.rstrip('\r\n') for l in raw_lines]

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip empty lines and junk
        if not stripped or stripped in ['X', ' ']:
            i += 1
            continue

        # Section header
        section_match = re.match(r'^\[(Verse|Chorus|Intro|Bridge|Outro|Pre-Chorus|Interlude)(?:\s*(\d+))?\]$', stripped, re.I)
        if section_match:
            # Save previous section
            if current_section and current_section.lines:
                sections.append(current_section)

            section_type = section_match.group(1).lower()
            section_num = section_match.group(2)

            if section_type == 'verse':
                verse_counter += 1
                label = f'Verse {section_num or verse_counter}'
            elif section_type == 'chorus':
                label = None  # Chorus doesn't need a label
            else:
                label = section_type.title()
                if section_num:
                    label += f' {section_num}'

            current_section = Section(section_type=section_type, label=label)
            pending_chord_line = None
            i += 1
            continue

        # Check if this line is a chord line (mostly chord symbols)
        if is_chord_line(stripped):
            pending_chord_line = line  # Preserve spacing
            i += 1
            continue

        # This is a lyric line
        if current_section is None:
            # No section yet - create implicit verse
            verse_counter += 1
            current_section = Section(section_type='verse', label=f'Verse {verse_counter}')

        chord_line = ChordLine(
            chords=pending_chord_line or '',
            lyrics=stripped
        )
        current_section.lines.append(chord_line)
        pending_chord_line = None
        i += 1

    # Don't forget the last section
    if current_section and current_section.lines:
        sections.append(current_section)

    return sections


def is_chord_line(line: str) -> bool:
    """
    Determine if a line is a chord line vs lyrics.

    Chord lines:
    - Contain chord symbols (A-G with optional #/b and modifiers)
    - Are mostly whitespace with chords
    - Don't look like lyrics
    """
    # Common chord pattern
    chord_pattern = r'^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13|6|\d)*(?:/[A-G][#b]?)?$'

    # Split on whitespace and check if most tokens are chords
    tokens = line.split()
    if not tokens:
        return False

    chord_count = sum(1 for t in tokens if re.match(chord_pattern, t, re.I))

    # If more than half are chords and it's short, it's a chord line
    if chord_count >= len(tokens) * 0.7 and len(tokens) <= 12:
        return True

    # If it's all chords (even just 1-2), it's a chord line
    if chord_count == len(tokens) and chord_count >= 1:
        return True

    return False


def parse_ug_response(data: dict) -> UGSong:
    """
    Parse the JSON response from our JavaScript extraction.

    Expected format:
    {
        "title": "Darling Corey",
        "artist": "Misc Traditional",
        "tuning": "E A D G B E",
        "capo": "No capo",
        "url": "https://...",
        "rawLines": ["[Verse]", "G", "Wake up...", ...]
    }
    """
    # Clean up capo (sometimes has junk appended)
    capo = data.get('capo', '')
    if '[' in capo:
        capo = capo.split('[')[0].strip()

    sections = parse_ug_content(data.get('rawLines', []))

    return UGSong(
        title=data.get('title', 'Unknown'),
        artist=data.get('artist', 'Unknown'),
        url=data.get('url', ''),
        tuning=data.get('tuning'),
        capo=capo if capo.lower() != 'no capo' else None,
        sections=sections
    )


if __name__ == '__main__':
    # Test with sample data
    test_data = {
        "title": "Darling Corey",
        "artist": "Misc Traditional",
        "tuning": "E A D G B E",
        "capo": "No capo",
        "url": "https://tabs.ultimate-guitar.com/tab/misc-traditional/darling-corey-chords-3110864",
        "rawLines": [
            "[Verse]",
            "G",
            "Wake up, wake up darlin Corey",
            "G",
            "Tell me what makes you sleep so sound",
            "G                F        G",
            "The revenue officers are comin",
            "        G        D           G",
            "Gonna tear your still house down",
            "[Chorus]",
            "G",
            "Dig a hole, dig a hole in the meadow",
            "G",
            "Dig a hole in the cold, cold ground",
        ]
    }

    song = parse_ug_response(test_data)
    print(song.to_chordpro())
