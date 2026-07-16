"""
Merge UG chords with BL lyrics.

Takes:
- BL parsed JSON (authoritative lyrics)
- UG extracted content (chord source)

Outputs:
- ChordPro with BL lyrics + UG chords
"""

import re
import json
from pathlib import Path
from dataclasses import dataclass
from difflib import SequenceMatcher


@dataclass
class ChordedLine:
    """A line with chord positions extracted from UG."""
    lyrics: str
    chords: list[tuple[int, str]]  # (position, chord)

    def to_chordpro(self) -> str:
        """Convert to ChordPro inline format."""
        if not self.chords:
            return self.lyrics

        # Find word boundaries for snapping
        word_starts = [0]
        for i, ch in enumerate(self.lyrics):
            if ch == ' ' and i + 1 < len(self.lyrics):
                word_starts.append(i + 1)

        def snap_to_word_start(pos: int) -> int:
            """Snap position to nearest word start (prefer earlier)."""
            # Find the word start that's <= pos
            for ws in reversed(word_starts):
                if ws <= pos:
                    return ws
            return 0

        result = []
        last_pos = 0
        for pos, chord in sorted(self.chords):
            # Clamp position to line length
            pos = min(pos, len(self.lyrics))
            # Snap to word boundary
            pos = snap_to_word_start(pos)
            # If this position is at or before last_pos, advance to next word boundary
            if pos <= last_pos:
                # Find next word start after last_pos
                next_word = None
                for ws in word_starts:
                    if ws > last_pos:
                        next_word = ws
                        break
                pos = next_word if next_word else len(self.lyrics)
            result.append(self.lyrics[last_pos:pos])
            result.append(f'[{chord}]')
            last_pos = pos
        result.append(self.lyrics[last_pos:])
        return ''.join(result)


def normalize_text(text: str) -> str:
    """Normalize text for fuzzy matching."""
    # Lowercase, remove punctuation, collapse whitespace
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def fuzzy_match_score(a: str, b: str) -> float:
    """Return similarity ratio between two strings."""
    return SequenceMatcher(None, normalize_text(a), normalize_text(b)).ratio()


# Embedding matcher (lazy loaded)
_embedding_matcher = None

def get_embedding_matcher():
    """Lazy load the embedding matcher."""
    global _embedding_matcher
    if _embedding_matcher is None:
        try:
            from embedding_match import embedding_match_score
            _embedding_matcher = embedding_match_score
        except ImportError:
            _embedding_matcher = lambda a, b: 0  # Fallback
    return _embedding_matcher


def hybrid_match_score(a: str, b: str, use_embeddings: bool = False) -> float:
    """
    Hybrid matching: string similarity + optional embedding similarity.

    Strategy: Use embedding score only if it's significantly higher than string score
    AND the string score shows SOME baseline similarity (>0.3).
    This prevents matching completely unrelated lines on common words alone.
    """
    string_score = fuzzy_match_score(a, b)

    if not use_embeddings:
        return string_score

    embedding_fn = get_embedding_matcher()
    embedding_score = embedding_fn(a, b)

    # Require minimum string similarity to trust embedding boost
    # This filters out false positives from common word overlap
    if string_score < 0.3:
        # Lines are too different textually - don't trust embedding
        return string_score

    # Embedding must beat string by significant margin to be used
    if embedding_score > string_score + 0.15:
        return embedding_score

    return string_score


def convert_bbcode_to_inline(content: str) -> str:
    """
    Convert UG mobile API BBCode format to standard inline chord format.

    Input format:
    [tab][ch]G[/ch]
    Each day I'll do[/tab]
    [tab]    [ch]D[/ch]    [ch]A[/ch]
    A golden deed[/tab]

    Output format:
    [G]Each day I'll do
        [D]    [A]A golden deed
    """
    # If no BBCode markers, return as-is
    if '[ch]' not in content:
        return content

    result_lines = []

    # Process [tab]...[/tab] blocks
    # Each block may have chords on first line and lyrics on second
    tab_pattern = re.compile(r'\[tab\](.*?)\[/tab\]', re.DOTALL)

    # Split content into tab blocks and non-tab content
    last_end = 0
    for match in tab_pattern.finditer(content):
        # Add any content before this tab block
        before = content[last_end:match.start()]
        if before.strip():
            # Clean up section markers
            for line in before.split('\n'):
                line = line.strip()
                if line and not line.startswith('[tab]'):
                    result_lines.append(line)

        # Process the tab block content
        block = match.group(1)

        # Extract chords and their positions
        chords = []
        chord_pattern = re.compile(r'\[ch\]([^[]+)\[/ch\]')

        # Build the line by tracking positions
        clean_block = ''
        pos = 0
        for chord_match in chord_pattern.finditer(block):
            # Add text before this chord (preserving spaces for positioning)
            before_text = block[pos:chord_match.start()]
            clean_block += before_text
            chords.append((len(clean_block), chord_match.group(1)))
            pos = chord_match.end()
        clean_block += block[pos:]

        # Clean up the text - remove extra whitespace but preserve structure
        clean_block = clean_block.replace('\r', '').strip()

        # Remove any remaining newlines within the block (chord line + lyric line)
        clean_block = re.sub(r'\n+', ' ', clean_block).strip()

        if clean_block:
            # Rebuild with inline chords
            if chords:
                # Sort chords by position and insert
                final_line = ''
                last_pos = 0
                for chord_pos, chord in sorted(chords):
                    # Clamp position to line length
                    chord_pos = min(chord_pos, len(clean_block))
                    final_line += clean_block[last_pos:chord_pos]
                    final_line += f'[{chord}]'
                    last_pos = chord_pos
                final_line += clean_block[last_pos:]
                result_lines.append(final_line)
            else:
                result_lines.append(clean_block)

        last_end = match.end()

    # Add any remaining content after last tab block
    after = content[last_end:]
    for line in after.split('\n'):
        line = line.strip()
        if line:
            result_lines.append(line)

    return '\n'.join(result_lines)


def parse_ug_content(content: str) -> list[ChordedLine]:
    """
    Parse UG content into chorded lines.

    Handles three formats:
    - Chord-above-lyrics (chord line, then lyric line)
    - Inline chords [G]like this
    - BBCode format [ch]G[/ch] (from mobile API)
    """
    # First, convert BBCode format to inline format
    # [tab][ch]G[/ch]\nEach day I'll do[/tab] -> [G]Each day I'll do
    content = convert_bbcode_to_inline(content)

    lines = content.split('\n')
    result = []

    i = 0
    while i < len(lines):
        line = lines[i].rstrip('\r')

        # Skip section markers and empty lines
        if not line.strip() or re.match(r'^\[(Verse|Chorus|Intro|Bridge|Outro|Break|Instrumental)', line, re.I):
            i += 1
            continue

        # Check if this line has inline chords already
        if re.search(r'\[[A-G][#b]?[^]]*\]', line):
            # Inline chord format - extract chords and positions
            chords = []
            clean_line = ''
            pos = 0
            for match in re.finditer(r'\[([A-G][#b]?[^\]]*)\]', line):
                # Add text before this chord
                before = line[pos:match.start()]
                clean_line += before
                chords.append((len(clean_line), match.group(1)))
                pos = match.end()
            clean_line += line[pos:]

            if clean_line.strip():
                result.append(ChordedLine(lyrics=clean_line.strip(), chords=chords))
            i += 1
            continue

        # Check if this is a chord-only line
        if is_chord_line(line):
            chord_line = line
            # Next non-empty line should be lyrics
            i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1

            if i < len(lines):
                lyric_line = lines[i].rstrip('\r')
                # Skip if next line is also chords or section marker
                if not is_chord_line(lyric_line) and not re.match(r'^\[', lyric_line.strip()):
                    chords = extract_chord_positions(chord_line)
                    if lyric_line.strip():
                        result.append(ChordedLine(lyrics=lyric_line.strip(), chords=chords))
            i += 1
            continue

        # Plain lyric line with no chords
        if line.strip():
            result.append(ChordedLine(lyrics=line.strip(), chords=[]))
        i += 1

    return result


def is_chord_line(line: str) -> bool:
    """Check if a line contains only chord symbols."""
    tokens = line.split()
    if not tokens:
        return False

    chord_pattern = r'^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13|6|\d)*(?:/[A-G][#b]?)?$'
    chord_count = sum(1 for t in tokens if re.match(chord_pattern, t, re.I))

    return chord_count >= len(tokens) * 0.8


def extract_chord_positions(chord_line: str) -> list[tuple[int, str]]:
    """Extract chord positions from a chord-above-lyrics line."""
    chords = []
    chord_pattern = r'[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|7|9|11|13|6|\d)*(?:/[A-G][#b]?)?'

    for match in re.finditer(chord_pattern, chord_line):
        chords.append((match.start(), match.group()))

    return chords


def merge_chords_to_bl(bl_sections: list[dict], ug_lines: list[ChordedLine],
                       threshold: float = 0.7, use_embeddings: bool = False) -> list[dict]:
    """
    Merge UG chords into BL section structure.

    For each BL line, find best matching UG line and transfer chords.
    Uses one-to-one matching: each UG line can only match one BL line.

    Args:
        use_embeddings: If True, use word embeddings for semantic matching
                       (catches synonyms like "farewell" ≈ "goodbye")
    """
    result_sections = []
    used_ug_indices = set()  # Track which UG lines have been matched

    for section in bl_sections:
        result_lines = []

        for bl_line in section.get('lines', []):
            # Find best matching UG line (that hasn't been used)
            best_match = None
            best_score = 0
            best_idx = -1

            for idx, ug_line in enumerate(ug_lines):
                if idx in used_ug_indices:
                    continue  # Skip already-used lines
                score = hybrid_match_score(bl_line, ug_line.lyrics, use_embeddings)
                if score > best_score:
                    best_score = score
                    best_match = ug_line
                    best_idx = idx

            if best_match and best_score >= threshold:
                used_ug_indices.add(best_idx)  # Mark as used
                # Transfer chords to BL line
                # Scale positions based on line length ratio
                if best_match.chords:
                    ratio = len(bl_line) / max(len(best_match.lyrics), 1)
                    scaled_chords = [(int(pos * ratio), chord) for pos, chord in best_match.chords]
                    chorded = ChordedLine(lyrics=bl_line, chords=scaled_chords)
                    result_lines.append({
                        'text': chorded.to_chordpro(),
                        'match_score': best_score,
                        'matched_from': best_match.lyrics[:40]
                    })
                else:
                    result_lines.append({
                        'text': bl_line,
                        'match_score': best_score,
                        'matched_from': best_match.lyrics[:40],
                        'note': 'matched but no chords'
                    })
            else:
                result_lines.append({
                    'text': bl_line,
                    'match_score': best_score,
                    'note': 'no match found'
                })

        result_sections.append({
            'type': section.get('type', 'verse'),
            'lines': result_lines
        })

    return result_sections


def generate_chordpro(title: str, artist: str, sections: list[dict],
                      bl_url: str = None, ug_url: str = None) -> str:
    """Generate final ChordPro output."""
    lines = []

    # Metadata
    lines.append(f'{{meta: title {title}}}')
    if artist:
        lines.append(f'{{meta: artist {artist}}}')
    lines.append('{meta: x_lyrics_source bluegrass-lyrics}')
    if bl_url:
        lines.append(f'{{meta: x_lyrics_url {bl_url}}}')
    lines.append('{meta: x_chords_source ultimate-guitar}')
    if ug_url:
        lines.append(f'{{meta: x_chords_url {ug_url}}}')
    lines.append('')

    # Sections
    verse_num = 0
    for section in sections:
        section_type = section.get('type', 'verse')

        if section_type == 'chorus':
            lines.append('{start_of_chorus}')
        else:
            verse_num += 1
            lines.append(f'{{start_of_verse: Verse {verse_num}}}')

        for line_data in section.get('lines', []):
            text = line_data.get('text', '') if isinstance(line_data, dict) else line_data
            lines.append(text)

        if section_type == 'chorus':
            lines.append('{end_of_chorus}')
        else:
            lines.append('{end_of_verse}')
        lines.append('')

    return '\n'.join(lines)


@dataclass
class MergeResult:
    """Complete merge result with metrics for QA."""
    bl_slug: str
    title: str
    chordpro: str
    ug_url: str | None
    bl_url: str | None

    # Metrics
    total_lines: int
    matched_lines: int  # Lines above threshold that got chords
    matched_no_chords: int  # Lines that matched but UG had no chords
    unmatched_lines: int  # Lines below threshold
    avg_match_score: float
    min_match_score: float

    # Per-section breakdown
    sections: list[dict]

    @property
    def coverage(self) -> float:
        """Percentage of lines that got chords."""
        return self.matched_lines / max(self.total_lines, 1)

    def to_dict(self) -> dict:
        return {
            'bl_slug': self.bl_slug,
            'title': self.title,
            'chordpro': self.chordpro,
            'ug_url': self.ug_url,
            'bl_url': self.bl_url,
            'metrics': {
                'total_lines': self.total_lines,
                'matched_lines': self.matched_lines,
                'matched_no_chords': self.matched_no_chords,
                'unmatched_lines': self.unmatched_lines,
                'coverage': self.coverage,
                'avg_match_score': self.avg_match_score,
                'min_match_score': self.min_match_score,
            },
            'sections': self.sections,
        }


def merge_song(bl_json_path: str, ug_content: str, ug_url: str = None,
               use_embeddings: bool = False) -> MergeResult:
    """
    Full merge pipeline.

    Returns MergeResult with ChordPro output and metrics.

    Args:
        use_embeddings: Use word embeddings for semantic matching
    """
    # Load BL data
    with open(bl_json_path) as f:
        bl_data = json.load(f)

    # Parse UG content
    ug_lines = parse_ug_content(ug_content)

    # Merge
    merged_sections = merge_chords_to_bl(bl_data.get('sections', []), ug_lines,
                                         use_embeddings=use_embeddings)

    # Generate output
    chordpro = generate_chordpro(
        title=bl_data.get('title', 'Unknown'),
        artist=None,  # BL doesn't have artist
        sections=merged_sections,
        bl_url=bl_data.get('source_url'),
        ug_url=ug_url
    )

    # Calculate metrics
    total_lines = 0
    matched_lines = 0
    matched_no_chords = 0
    unmatched_lines = 0
    all_scores = []

    for section in merged_sections:
        for line in section.get('lines', []):
            total_lines += 1
            score = line.get('match_score', 0)
            all_scores.append(score)

            note = line.get('note', '')
            if 'no match' in note:
                unmatched_lines += 1
            elif 'no chords' in note:
                matched_no_chords += 1
            elif score >= 0.7:
                matched_lines += 1
            else:
                unmatched_lines += 1

    return MergeResult(
        bl_slug=bl_data.get('slug', Path(bl_json_path).stem),
        title=bl_data.get('title', 'Unknown'),
        chordpro=chordpro,
        ug_url=ug_url,
        bl_url=bl_data.get('source_url'),
        total_lines=total_lines,
        matched_lines=matched_lines,
        matched_no_chords=matched_no_chords,
        unmatched_lines=unmatched_lines,
        avg_match_score=sum(all_scores) / max(len(all_scores), 1),
        min_match_score=min(all_scores) if all_scores else 0,
        sections=merged_sections,
    )


# Test with Katy Daley or Handsome Molly
if __name__ == '__main__':
    import sys

    # Choose test case
    test_case = sys.argv[1] if len(sys.argv) > 1 else 'katy-daley'

    if test_case == 'handsome-molly':
        ug_content = """[Intro]
G D G

[Verse 1]
G
I wish I were in London,
                      D
Or some other seaport town
D
Set my foot in a steamboat
                    G
And sail the ocean `round.

[Verse 2]
G
While sailing on the ocean,
                     D
While sailing on the sea
D
I'd think of handsome Molly
                   G
Wherever she might be.

[Verse 3]
G
Remember Handsome Molly
                            D
When you gave me your right hand?
D
And you said if you were to marry
                G
Then I'd be the man.

[Verse 4]
G
But now you broke your promise
                  D
Go marry whom you please
D
While my poor heart is breaking
                     G
You're going at your ease.

[Verse 5]
G
She goes to church on Sunday
                     D
And she passes me on by
D
I can tell her mind is changin'
                     G
By the roving of her eye.

[Verse 6]
G
Her hair is black as a raven
                        D
Her eyes are black as a crow
D
Her cheeks look like linens
                   G
out in the morning glow"""

        # BL doesn't have Handsome Molly parsed, use manual as reference
        print("=== COMPARING WITH MANUAL SUBMISSION ===")
        manual_path = Path(__file__).parent.parent / 'manual' / 'parsed' / 'handsomemolly.pro'
        if manual_path.exists():
            print(f"Manual version:\n{manual_path.read_text()[:800]}")
        print("\n=== UG PARSED ===")
        ug_lines = parse_ug_content(ug_content)
        for line in ug_lines[:8]:
            print(f"  {line.to_chordpro()}")

        # Done with handsome-molly comparison
        sys.exit(0)

    elif test_case == 'little-rosewood-casket':
        # Little Rosewood Casket - tests curly quote handling and different section counts
        ug_content = """[Verse 1]
     G                        C
There's a little rosewood casket
                              G
Resting on a marble stand
                             D7
With a packet of old love letters
                         G
Written by my true love's hand

[Chorus]
G                         C
Will you go and bring them to me
                              G
Read them o'er for me tonight
                              D7
I have often tried but couldn't
                              G
For the tears that filled my eyes

[Vesre 2]
G                           C
When I'm dead and in my casket
                              G
When I gently fall asleep
                            D7
Fall asleep to wake with Jesus
                         G
Dearest sister do not weep

[Verse 3]
G                             C
Take his letters and his locket
                              G
Place them gently on my heart
                                  D7
But this little ring that he gave me
                         G
From my finger never part"""

        bl_path = Path(__file__).parent.parent / 'bluegrass-lyrics' / 'parsed' / 'little-rosewood-casket.json'

        if bl_path.exists():
            result = merge_song(str(bl_path), ug_content,
                                "https://tabs.ultimate-guitar.com/tab/misc-traditional/little-rosewood-casket-chords")

            print("=== MERGED CHORDPRO ===")
            print(result.chordpro)
            print("\n=== METRICS ===")
            print(f"Coverage: {result.coverage:.0%} ({result.matched_lines}/{result.total_lines} lines)")
            print(f"Avg match score: {result.avg_match_score:.2f}")
            print(f"Matched (no chords in UG): {result.matched_no_chords}")
            print(f"Unmatched: {result.unmatched_lines}")
            print("\n=== DEBUG INFO ===")
            for section in result.sections:
                print(f"\n{section['type']}:")
                for line in section['lines']:
                    score = line.get('match_score', 0)
                    matched = line.get('matched_from', '')
                    print(f"  [{score:.2f}] {line['text'][:60]}")
                    if matched:
                        print(f"         <- {matched}")
        else:
            print(f"BL file not found: {bl_path}")
        sys.exit(0)

    elif test_case == 'bury-me-beneath-the-willow':
        # Classic Carter Family - tests chorus/verse structure
        ug_content = """[Chorus]
  G                     C
Bury me beneath the willow
        G               D
Neath the weeping willow tree
     G                      C
When she hears that I am sleeping
       G        D      G
Maybe then she'll think of me

[Verse 1]
   G                        C
My heart is sad and I am lonely
        G                D
Thinking of the one I love
     G                    C
When will I see her, oh no never
       G           D      G
'til we meet in Heaven above

[Verse 2]
    G                      C
She told me that she truly loved me
         G                D
How could I believe untrue
       G                       C
Until one day some neighbors told me
     G            D         G
She has proven untrue to you

[Verse 3]
     G                       C
Tomorrow was to be our wedding
    G              D
But Lord, where can she be
       G                    C
She's gone, she's gone to find another
     G          D        G
She no longer cares for me"""

        bl_path = Path(__file__).parent.parent / 'bluegrass-lyrics' / 'parsed' / 'bury-me-beneath-the-willow.json'

        if bl_path.exists():
            result = merge_song(str(bl_path), ug_content,
                                "https://tabs.ultimate-guitar.com/tab/the-carter-family/bury-me-beneath-the-willow-chords")

            print("=== MERGED CHORDPRO ===")
            print(result.chordpro)
            print("\n=== METRICS ===")
            print(f"Coverage: {result.coverage:.0%} ({result.matched_lines}/{result.total_lines} lines)")
            print(f"Avg match score: {result.avg_match_score:.2f}")
            print(f"Matched (no chords in UG): {result.matched_no_chords}")
            print(f"Unmatched: {result.unmatched_lines}")
            print("\n=== DEBUG INFO ===")
            for section in result.sections:
                print(f"\n{section['type']}:")
                for line in section['lines']:
                    score = line.get('match_score', 0)
                    matched = line.get('matched_from', '')
                    print(f"  [{score:.2f}] {line['text'][:60]}")
                    if matched:
                        print(f"         <- {matched}")
        else:
            print(f"BL file not found: {bl_path}")
        sys.exit(0)

    elif test_case == 'katy-daley':
        # Katy Daley
        ug_content = """[Chorus]
G
Oh Come on down the mountain Katy Daley
                               D
Come on down the mountain Katy do
                               D7
Can't you hear us calling Katy Daley
                                        G
We want to drink your good old mountain dew
[Verse 1]
G
With her old man she came from Tipperary
                           D
In the pioneering days of '42
                                  D7
Her old man was shot in Tombstone City
                                        G
For the making of his good old mountain dew
[Chorus]
    G
Oh Come on down the mountain Katy Daley
                               D
Come on down the mountain Katy do
                               D7
Can't you hear us calling Katy Daley
                                        G
We want to drink your good old mountain dew
[Verse 2]
G
Wake up and pay attention Katy Daley
                                        D
For I'm the judge that's gonna sentence you
                                      D7
All the boys in court have drunk your whiskey
                                  G
To tell the truth I like a little too
[Verse 3]
G
So to the jail they took poor Katy Daley
                                    D
And pretty soon the gates were open wide
                              D7
Angels came for poor old Katy Daley
                              G
Took her far across the great divide"""

    bl_path = Path(__file__).parent.parent / 'bluegrass-lyrics' / 'parsed' / 'katy-daley.json'

    if bl_path.exists():
        result = merge_song(str(bl_path), ug_content,
                            "https://tabs.ultimate-guitar.com/tab/ralph-stanley/katy-daley-chords-1766705")

        print("=== MERGED CHORDPRO ===")
        print(result.chordpro)
        print("\n=== METRICS ===")
        print(f"Coverage: {result.coverage:.0%} ({result.matched_lines}/{result.total_lines} lines)")
        print(f"Avg match score: {result.avg_match_score:.2f}")
        print(f"Matched (no chords in UG): {result.matched_no_chords}")
        print(f"Unmatched: {result.unmatched_lines}")
        print("\n=== DEBUG INFO ===")
        for section in result.sections:
            print(f"\n{section['type']}:")
            for line in section['lines']:
                score = line.get('match_score', 0)
                matched = line.get('matched_from', '')
                print(f"  [{score:.2f}] {line['text'][:60]}")
                if matched:
                    print(f"         <- {matched}")
    else:
        print(f"BL file not found: {bl_path}")
