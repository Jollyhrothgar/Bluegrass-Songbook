#!/usr/bin/env python3
"""
Build search index from parsed .pro files

Generates docs/data/index.json with song metadata and lyrics for search.
Precomputes key detection and Nashville numbers for fast chord search.
"""

import json
import re
from pathlib import Path
from typing import Optional


# Key detection data - same as search.js
# Major keys: I, ii, iii, IV, V, vi, vii°
# Minor keys (natural): i, ii°, III, iv, v, VI, VII
KEYS = {
    # Major keys
    'C':  {'scale': ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'], 'tonic': 'C', 'mode': 'major'},
    'G':  {'scale': ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'], 'tonic': 'G', 'mode': 'major'},
    'D':  {'scale': ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'], 'tonic': 'D', 'mode': 'major'},
    'A':  {'scale': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'], 'tonic': 'A', 'mode': 'major'},
    'E':  {'scale': ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'], 'tonic': 'E', 'mode': 'major'},
    'B':  {'scale': ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'], 'tonic': 'B', 'mode': 'major'},
    'F#': {'scale': ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m', 'E#dim'], 'tonic': 'F#', 'mode': 'major'},
    'F':  {'scale': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'], 'tonic': 'F', 'mode': 'major'},
    'Bb': {'scale': ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'], 'tonic': 'Bb', 'mode': 'major'},
    'Eb': {'scale': ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'], 'tonic': 'Eb', 'mode': 'major'},
    'Ab': {'scale': ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm', 'Gdim'], 'tonic': 'Ab', 'mode': 'major'},
    'Db': {'scale': ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim'], 'tonic': 'Db', 'mode': 'major'},
    # Minor keys (natural minor)
    'Am':  {'scale': ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G'], 'tonic': 'Am', 'mode': 'minor'},
    'Em':  {'scale': ['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D'], 'tonic': 'Em', 'mode': 'minor'},
    'Bm':  {'scale': ['Bm', 'C#dim', 'D', 'Em', 'F#m', 'G', 'A'], 'tonic': 'Bm', 'mode': 'minor'},
    'F#m': {'scale': ['F#m', 'G#dim', 'A', 'Bm', 'C#m', 'D', 'E'], 'tonic': 'F#m', 'mode': 'minor'},
    'C#m': {'scale': ['C#m', 'D#dim', 'E', 'F#m', 'G#m', 'A', 'B'], 'tonic': 'C#m', 'mode': 'minor'},
    'G#m': {'scale': ['G#m', 'A#dim', 'B', 'C#m', 'D#m', 'E', 'F#'], 'tonic': 'G#m', 'mode': 'minor'},
    'D#m': {'scale': ['D#m', 'E#dim', 'F#', 'G#m', 'A#m', 'B', 'C#'], 'tonic': 'D#m', 'mode': 'minor'},
    'Dm':  {'scale': ['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C'], 'tonic': 'Dm', 'mode': 'minor'},
    'Gm':  {'scale': ['Gm', 'Adim', 'Bb', 'Cm', 'Dm', 'Eb', 'F'], 'tonic': 'Gm', 'mode': 'minor'},
    'Cm':  {'scale': ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb'], 'tonic': 'Cm', 'mode': 'minor'},
    'Fm':  {'scale': ['Fm', 'Gdim', 'Ab', 'Bbm', 'Cm', 'Db', 'Eb'], 'tonic': 'Fm', 'mode': 'minor'},
    'Bbm': {'scale': ['Bbm', 'Cdim', 'Db', 'Ebm', 'Fm', 'Gb', 'Ab'], 'tonic': 'Bbm', 'mode': 'minor'},
}

CHROMATIC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
ENHARMONIC = {
    'C#': 'Db', 'D#': 'Eb', 'E#': 'F', 'Fb': 'E',
    'G#': 'Ab', 'A#': 'Bb', 'B#': 'C', 'Cb': 'B',
    'F#': 'Gb',
}

NASHVILLE_MAJOR = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
NASHVILLE_MINOR = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']

# Preferred key order for tie-breaking
PREFERRED_KEYS = ['G', 'C', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'F', 'Bm', 'Bb', 'Eb']


def normalize_chord(chord: str) -> Optional[str]:
    """Normalize a chord to root + basic quality (major, minor, dim)."""
    if not chord:
        return None

    match = re.match(r'^([A-G][#b]?)', chord)
    if not match:
        return None

    root = match.group(1)
    rest = chord[len(root):].lower()

    # Normalize enharmonics (except F# which we keep for key names)
    if root in ENHARMONIC and root != 'F#':
        root = ENHARMONIC[root]

    quality = ''
    if rest.startswith('m') and not rest.startswith('maj'):
        quality = 'm'
    elif 'dim' in rest or rest == 'o' or rest.startswith('o7'):
        quality = 'dim'

    return root + quality


def get_chord_root(chord: str) -> Optional[str]:
    """Get just the root of a chord."""
    if not chord:
        return None
    match = re.match(r'^([A-G][#b]?)', chord)
    if not match:
        return None
    root = match.group(1)
    if root in ENHARMONIC and root != 'F#':
        root = ENHARMONIC[root]
    return root


def get_chord_quality(chord: str) -> str:
    """Get chord quality (major, minor, dim)."""
    if not chord:
        return 'major'
    match = re.match(r'^[A-G][#b]?', chord)
    if not match:
        return 'major'
    rest = chord[len(match.group(0)):]
    if rest == 'm' or rest.startswith('m'):
        return 'minor'
    if rest == 'dim' or 'dim' in rest:
        return 'dim'
    return 'major'


def extract_chords(content: str) -> list[str]:
    """Extract all chords from chordpro content."""
    return re.findall(r'\[([^\]]+)\]', content)


def detect_key(chords: list[str]) -> tuple[Optional[str], Optional[str]]:
    """Detect key from chord list. Returns (key, mode)."""
    if not chords:
        return None, None

    # Normalize and count chords
    chord_counts = {}
    for chord in chords:
        normalized = normalize_chord(chord)
        if normalized:
            chord_counts[normalized] = chord_counts.get(normalized, 0) + 1

    total_chords = len(chords)

    # Score each possible key
    scores = {}
    for key_name, key_info in KEYS.items():
        normalized_scale = set(normalize_chord(c) for c in key_info['scale'])
        normalized_tonic = normalize_chord(key_info['tonic'])

        match_weight = 0
        tonic_weight = 0

        for chord, count in chord_counts.items():
            if chord in normalized_scale:
                match_weight += count
                if chord == normalized_tonic:
                    tonic_weight += count * 0.5

        scores[key_name] = (match_weight + tonic_weight) / total_chords

    # Find best key
    best_key = None
    best_score = 0

    for key, score in scores.items():
        if score > best_score:
            best_score = score
            best_key = key

    # Prefer common keys when scores are very close
    for key in PREFERRED_KEYS:
        if key in scores and scores[key] >= best_score - 0.03:
            best_key = key
            best_score = scores[key]
            break

    if best_key:
        return best_key, KEYS[best_key]['mode']
    return None, None


def to_nashville(chord: str, key_name: str) -> str:
    """Convert a chord to Nashville number given a key."""
    if not chord or not key_name or key_name not in KEYS:
        return chord

    key_info = KEYS[key_name]
    chord_root = get_chord_root(chord)
    chord_quality = get_chord_quality(chord)

    if not chord_root:
        return chord

    # Get the key's tonic root
    tonic_root = get_chord_root(key_info['tonic'])
    if not tonic_root:
        return chord

    # Find interval (semitones from tonic)
    tonic_index = CHROMATIC.index(tonic_root) if tonic_root in CHROMATIC else -1
    chord_index = CHROMATIC.index(chord_root) if chord_root in CHROMATIC else -1

    # Handle F#/Gb specially
    if tonic_root in ('F#', 'Gb'):
        tonic_index = 6
    if chord_root in ('F#', 'Gb'):
        chord_index = 6

    if tonic_index == -1 or chord_index == -1:
        return chord

    interval = (chord_index - tonic_index + 12) % 12

    # Map interval to scale degree
    interval_to_degree = {
        0: 0, 2: 1, 3: 2, 4: 2, 5: 3, 7: 4, 8: 5, 9: 5, 10: 6, 11: 6,
    }

    scale_degree = interval_to_degree.get(interval)
    if scale_degree is None:
        # Non-diatonic
        symbols = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII']
        num = symbols[interval]
        if chord_quality == 'minor':
            num = num.lower()
        if chord_quality == 'dim':
            num = num.lower() + '°'
        return num

    # Get Nashville number based on key mode
    nashville = NASHVILLE_MINOR if key_info['mode'] == 'minor' else NASHVILLE_MAJOR
    num = nashville[scale_degree]

    # Adjust for actual chord quality vs expected
    expected_quality = 'minor' if num == num.lower() else 'major'
    if '°' in num:
        if chord_quality == 'major':
            num = num.replace('°', '').upper()
        elif chord_quality == 'minor':
            num = num.replace('°', '')
    elif chord_quality == 'dim':
        num = num.lower() + '°'
    elif chord_quality == 'minor' and expected_quality == 'major':
        num = num.lower()
    elif chord_quality == 'major' and expected_quality == 'minor':
        num = num.upper()

    return num


def compute_nashville_data(content: str) -> dict:
    """Compute key, unique Nashville chords, and progression for a song."""
    chords = extract_chords(content)
    if not chords:
        return {'key': None, 'mode': None, 'nashville': [], 'progression': []}

    key, mode = detect_key(chords)
    if not key:
        return {'key': None, 'mode': None, 'nashville': [], 'progression': []}

    # Convert all chords to Nashville
    progression = [to_nashville(c, key) for c in chords]
    # Get unique Nashville chords (case-sensitive - ii != II)
    unique_nashville = list(set(progression))

    return {
        'key': key,
        'mode': mode,
        'nashville': unique_nashville,  # Unique Nashville chords (case-sensitive)
        'progression': progression,      # Full sequence for progression search
    }


def parse_chordpro_metadata(content: str) -> dict:
    """Extract metadata from ChordPro content."""
    metadata = {
        'title': None,
        'artist': None,
        'composer': None,
    }

    # Match {meta: key value} directives (our format)
    for match in re.finditer(r'\{meta:\s*(\w+)\s+([^}]+)\}', content):
        key = match.group(1).lower()
        value = match.group(2).strip()
        if key in metadata:
            metadata[key] = value

    # Also match standard {key: value} directives
    for match in re.finditer(r'\{(title|artist|composer):\s*([^}]+)\}', content):
        key = match.group(1).lower()
        value = match.group(2).strip()
        if key in metadata and metadata[key] is None:
            metadata[key] = value

    return metadata


def extract_lyrics(content: str) -> str:
    """Extract plain lyrics (without chords) from ChordPro content."""
    lines = []
    in_verse = False

    for line in content.split('\n'):
        line = line.strip()

        # Skip directives
        if line.startswith('{') and line.endswith('}'):
            if line == '{sov}':
                in_verse = True
            elif line == '{eov}':
                in_verse = False
            continue

        # Skip empty lines
        if not line:
            continue

        # Remove chord markers [G], [Am7], etc.
        clean_line = re.sub(r'\[[^\]]+\]', '', line)
        clean_line = clean_line.strip()

        if clean_line:
            lines.append(clean_line)

    return '\n'.join(lines)


def get_first_line(lyrics: str) -> str:
    """Get first non-empty line of lyrics."""
    for line in lyrics.split('\n'):
        line = line.strip()
        if line and len(line) > 10:
            return line[:100]
    return ''


def build_index(parsed_dir: Path, output_file: Path):
    """Build search index from all .pro files."""
    songs = []

    pro_files = sorted(parsed_dir.glob('*.pro'))
    print(f"Processing {len(pro_files)} files...")

    for i, pro_file in enumerate(pro_files):
        if i % 1000 == 0:
            print(f"  {i}/{len(pro_files)}...")

        try:
            content = pro_file.read_text(encoding='utf-8')
        except Exception as e:
            print(f"  Error reading {pro_file.name}: {e}")
            continue

        metadata = parse_chordpro_metadata(content)
        lyrics = extract_lyrics(content)
        first_line = get_first_line(lyrics)

        # Skip songs without title
        if not metadata['title']:
            continue

        # Compute Nashville data for chord search
        nashville_data = compute_nashville_data(content)

        songs.append({
            'id': pro_file.stem,
            'title': metadata['title'],
            'artist': metadata['artist'],
            'composer': metadata['composer'],
            'first_line': first_line,
            'lyrics': lyrics[:500],  # First 500 chars for search
            'content': content,  # Full ChordPro content for display
            'key': nashville_data['key'],
            'mode': nashville_data['mode'],
            'nashville': nashville_data['nashville'],  # Unique Nashville chords
            'progression': nashville_data['progression'],  # Full chord sequence
        })

    print(f"Indexed {len(songs)} songs")

    # Write index
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump({'songs': songs}, f, ensure_ascii=False)

    print(f"Written to {output_file}")
    print(f"Size: {output_file.stat().st_size / 1024 / 1024:.1f} MB")


def main():
    parsed_dir = Path('songs/classic-country/parsed')
    output_file = Path('docs/data/index.json')

    build_index(parsed_dir, output_file)


if __name__ == '__main__':
    main()
