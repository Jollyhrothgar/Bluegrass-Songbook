#!/usr/bin/env python3
"""
Build search index from works/ directory.

This replaces build_index.py as the primary index builder.
Reads work.yaml + lead-sheet.pro from each work directory and outputs index.jsonl.

Usage:
    uv run python scripts/lib/build_works_index.py
    uv run python scripts/lib/build_works_index.py --no-tags
    uv run python scripts/lib/build_works_index.py --workers 8
"""

import argparse
import hashlib
import json
import multiprocessing
import os
import re
import shutil
from pathlib import Path
from urllib.parse import quote

import yaml

# Canonical ranks cache (loaded once per process)
_canonical_ranks = None
_worker_initialized = False

def load_canonical_ranks(quiet=False):
    """Load canonical ranking from cache file."""
    global _canonical_ranks
    if _canonical_ranks is None:
        cache_file = Path(__file__).parent.parent.parent / 'docs' / 'data' / 'canonical_ranks.json'
        if cache_file.exists():
            with open(cache_file) as f:
                _canonical_ranks = json.load(f)
            if not quiet:
                print(f"Loaded {len(_canonical_ranks)} canonical ranks")
        else:
            if not quiet:
                print(f"Warning: canonical_ranks.json not found at {cache_file}")
            _canonical_ranks = {}
    return _canonical_ranks


def _init_worker():
    """Initialize worker process with required data."""
    global _worker_initialized
    if not _worker_initialized:
        load_canonical_ranks(quiet=True)
        _worker_initialized = True

def get_canonical_rank(title: str) -> int:
    """Get canonical rank for a song title. Higher = more popular."""
    ranks = load_canonical_ranks()
    normalized = title.lower().strip()
    return ranks.get(normalized, 0)

# Import key detection and Nashville conversion from existing build_index
from build_index import (
    detect_key,
    to_nashville,
    KEYS,
)


def parse_chordpro_content(content: str) -> dict:
    """Extract lyrics, chords, and ABC content from ChordPro content."""
    lines = content.split('\n')
    lyrics_lines = []
    chords = []
    abc_lines = []
    in_abc = False
    is_tune = False

    for line in lines:
        # Check for ABC notation start
        if line.strip().startswith('{start_of_abc'):
            in_abc = True
            continue
        if line.strip().startswith('{end_of_abc'):
            in_abc = False
            continue
        if in_abc:
            abc_lines.append(line)
            continue

        # Skip directives
        if line.strip().startswith('{'):
            continue

        # Extract chords
        for match in re.finditer(r'\[([^\]]+)\]', line):
            chord = match.group(1)
            # Skip non-chords (timing, etc.)
            if re.match(r'^[A-G]', chord):
                chords.append(chord)

        # Extract lyrics (remove chord markers)
        clean_line = re.sub(r'\[[^\]]+\]', '', line).strip()
        if clean_line:
            lyrics_lines.append(clean_line)

    lyrics = '\n'.join(lyrics_lines)
    abc_content = '\n'.join(abc_lines) if abc_lines else None

    # Detect if it's an instrumental (has ABC but minimal lyrics)
    if abc_content and len(lyrics) < 100:
        is_tune = True

    return {
        'lyrics': lyrics,
        'chords': chords,
        'abc_content': abc_content,
        'is_tune': is_tune,
    }


def extract_first_line(lyrics: str) -> str:
    """Get first non-empty line of lyrics."""
    for line in lyrics.split('\n'):
        line = line.strip()
        if line:
            return line[:100]
    return ''


def compute_group_id(title: str, artist: str, lyrics: str) -> str:
    """Compute group ID for version grouping."""
    import unicodedata

    def normalize(text: str) -> str:
        if not text:
            return ''
        # Normalize unicode
        text = unicodedata.normalize('NFKD', text)
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower()
        # Remove common suffixes
        text = re.sub(r'\s*\([^)]*\)\s*$', '', text)  # (Live), etc.
        text = re.sub(r'[^a-z0-9]', '', text)
        return text

    def normalize_title(text: str) -> str:
        """Normalize title, removing articles for better grouping."""
        if not text:
            return ''
        import unicodedata
        # Normalize unicode first
        text = unicodedata.normalize('NFKD', text)
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower()
        # Remove parenthetical suffixes like (Live), (C), (D)
        text = re.sub(r'\s*\([^)]*\)\s*$', '', text)
        # Remove common articles that vary in tune titles (before stripping spaces)
        # "Angeline the Baker" vs "Angeline Baker"
        # "The Girl I Left Behind Me" vs "Girl I Left Behind Me"
        text = re.sub(r'\bthe\b', '', text)
        text = re.sub(r'\ba\b', '', text)
        text = re.sub(r'\ban\b', '', text)
        # Now strip non-alphanumeric
        text = re.sub(r'[^a-z0-9]', '', text)
        return text

    base = normalize_title(title) + '_' + normalize(artist or '')
    base_hash = hashlib.md5(base.encode()).hexdigest()[:12]

    # Lyrics hash to distinguish different songs with same title
    lyrics_norm = normalize(lyrics[:200] if lyrics else '')
    lyrics_hash = hashlib.md5(lyrics_norm.encode()).hexdigest()[:8]

    return f"{base_hash}_{lyrics_hash}"


def build_song_from_work(work_dir: Path) -> dict:
    """Build a song record from a work directory."""
    work_yaml_path = work_dir / 'work.yaml'
    lead_sheet_path = work_dir / 'lead-sheet.pro'

    if not work_yaml_path.exists():
        return None

    # Load work.yaml
    with open(work_yaml_path) as f:
        work = yaml.safe_load(f)

    # Check what parts we have
    has_lead_sheet = lead_sheet_path.exists()
    tablature_parts = []
    if work.get('parts'):
        for part in work['parts']:
            if part.get('type') == 'tablature':
                tablature_parts.append(part)

    # Must have at least a lead sheet or tablature
    if not has_lead_sheet and not tablature_parts:
        return None

    # Initialize defaults
    content = ''
    lyrics = ''
    chords = []
    key = work.get('default_key', 'G')
    mode = 'major'
    source = 'unknown'
    parsed = {'is_tune': False, 'abc_content': None}

    # Load lead sheet if present
    if has_lead_sheet:
        content = lead_sheet_path.read_text(encoding='utf-8')
        parsed = parse_chordpro_content(content)
        lyrics = parsed['lyrics']
        chords = parsed['chords']
        detected_key, mode = detect_key(chords)
        if detected_key:
            key = detected_key

    # Determine source - priority: lead-sheet x_source > lead-sheet part > tablature part
    # First check x_source in lead-sheet content (most authoritative for the work itself)
    if content:
        x_source_match = re.search(r'\{meta:\s*x_source\s+(\S+)\}', content)
        if x_source_match:
            source = x_source_match.group(1)

    # Then check work.yaml parts for provenance
    if source == 'unknown' and work.get('parts'):
        for part in work['parts']:
            if part.get('type') == 'lead-sheet':
                prov = part.get('provenance', {})
                source = prov.get('source', 'unknown')
                break
            elif part.get('type') == 'tablature' and source == 'unknown':
                prov = part.get('provenance', {})
                source = prov.get('source', 'unknown')

    # Convert to Nashville
    nashville_set = set()
    progression = []
    for chord in chords:
        nash = to_nashville(chord, key)
        if nash:
            nashville_set.add(nash)
            progression.append(nash)

    # Build song record
    song = {
        'id': work['id'],
        'title': work.get('title', 'Untitled'),
        'source': source,
        'first_line': extract_first_line(lyrics) if lyrics else '',
        'lyrics': lyrics[:500] if lyrics else '',
        'content': content,
        'key': key,
        'mode': mode,
        'nashville': sorted(list(nashville_set)),
        'progression': progression[:100],
    }

    # Optional fields
    if work.get('artist'):
        song['artist'] = work['artist']
    if work.get('composers') and work['composers']:
        song['composer'] = ', '.join(work['composers'])
    if work.get('tags'):
        song['tags'] = {tag: {'score': 50, 'source': 'work'} for tag in work['tags']}
    if work.get('exclude_tags'):
        song['exclude_tags'] = work['exclude_tags']
    if work.get('external', {}).get('strum_machine'):
        song['strum_machine_url'] = work['external']['strum_machine']

    # Compute group_id
    song['group_id'] = compute_group_id(
        work.get('title', ''),
        work.get('artist', ''),
        lyrics
    )

    # Add chord count
    song['chord_count'] = len(nashville_set)

    # Add canonical rank (based on MusicBrainz recording counts)
    song['canonical_rank'] = get_canonical_rank(work.get('title', ''))

    # Handle instrumentals
    if parsed['is_tune'] or (tablature_parts and not lyrics):
        song['is_instrumental'] = True
    if parsed['abc_content']:
        song['abc_content'] = parsed['abc_content']

    # Add tablature parts info for frontend
    if tablature_parts:
        song['tablature_parts'] = []
        for part in tablature_parts:
            prov = part.get('provenance', {})
            tab_info = {
                'instrument': part.get('instrument'),
                'label': part.get('label', part.get('instrument', 'Tab')),
                'file': f"data/tabs/{work['id']}-{part.get('instrument')}.otf.json",
                # Include provenance for attribution
                'source': prov.get('source'),
                'source_id': prov.get('source_id'),
                'author': prov.get('author'),
            }
            # Build source page URL for banjo-hangout
            if prov.get('source') == 'banjo-hangout' and prov.get('source_id'):
                tab_info['source_page_url'] = f"https://www.banjohangout.org/tab/browse.asp?m=detail&v={prov.get('source_id')}"
                if prov.get('author'):
                    tab_info['author_url'] = f"https://www.banjohangout.org/my/{quote(prov.get('author'))}"
            song['tablature_parts'].append(tab_info)

    return song


def fuzzy_group_songs(songs: list) -> list:
    """
    Merge group_ids for songs with similar titles that should be grouped together.

    Uses fuzzy matching to handle cases like:
    - "Angelene Baker" vs "Angeline Baker" (spelling variations)
    - Minor typos and OCR errors

    IMPORTANT: To avoid false positives (merging different songs with similar titles),
    we require BOTH title similarity AND lyrics similarity before merging.
    Examples of songs that should NOT merge despite similar titles:
    - "I Walk Alone" vs "I Walk The Line" (different lyrics)
    - "Good Hearted Woman" vs "Good Hearted Man" (different songs)
    - "Still Loving You" vs "Still Losing You" (different songs)

    Optimized to avoid O(n²) comparisons by grouping titles by prefix first.
    Uses rapidfuzz for faster matching if available, falls back to difflib.
    """
    import unicodedata
    from difflib import SequenceMatcher

    def similarity(a: str, b: str) -> float:
        """Calculate similarity ratio between two strings."""
        return SequenceMatcher(None, a, b).ratio()

    def normalize_for_fuzzy(text: str) -> str:
        """Normalize title for fuzzy comparison."""
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', text)
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower()
        # Remove parenthetical suffixes
        text = re.sub(r'\s*\([^)]*\)\s*$', '', text)
        # Remove articles
        text = re.sub(r'\bthe\b', '', text)
        text = re.sub(r'\ba\b', '', text)
        text = re.sub(r'\ban\b', '', text)
        # Keep spaces for better fuzzy matching
        text = re.sub(r'[^a-z0-9\s]', '', text)
        text = ' '.join(text.split())  # Normalize whitespace
        return text

    def normalize_lyrics(text: str) -> str:
        """Normalize lyrics for comparison."""
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', text)
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower()
        # Remove punctuation and extra whitespace
        text = re.sub(r'[^a-z0-9\s]', '', text)
        text = ' '.join(text.split())
        return text[:200]  # First 200 chars is enough to distinguish

    # Group songs by their current group_id
    by_group = {}
    for song in songs:
        gid = song.get('group_id', '')
        if gid not in by_group:
            by_group[gid] = []
        by_group[gid].append(song)

    # Build normalized title -> group_ids mapping
    title_to_groups = {}
    for song in songs:
        norm_title = normalize_for_fuzzy(song.get('title', ''))
        if not norm_title:
            continue
        gid = song.get('group_id', '')
        if norm_title not in title_to_groups:
            title_to_groups[norm_title] = set()
        title_to_groups[norm_title].add(gid)

    # Build group_id -> representative lyrics mapping (use first song's lyrics)
    group_lyrics = {}
    for song in songs:
        gid = song.get('group_id', '')
        if gid not in group_lyrics:
            lyrics = song.get('lyrics', '') or song.get('first_line', '')
            group_lyrics[gid] = normalize_lyrics(lyrics)

    # Group titles by their first 3 characters (prefix buckets)
    # This avoids O(n²) by only comparing within buckets
    prefix_buckets = {}
    for title in title_to_groups.keys():
        prefix = title[:3] if len(title) >= 3 else title
        if prefix not in prefix_buckets:
            prefix_buckets[prefix] = []
        prefix_buckets[prefix].append(title)

    merge_map = {}  # old_group_id -> new_group_id
    TITLE_SIMILARITY_THRESHOLD = 0.85  # 85% title similarity required
    LYRICS_SIMILARITY_THRESHOLD = 0.70  # 70% lyrics similarity also required

    # Only compare titles within the same prefix bucket
    for prefix, bucket_titles in prefix_buckets.items():
        if len(bucket_titles) < 2:
            continue

        for i, title1 in enumerate(bucket_titles):
            for title2 in bucket_titles[i+1:]:
                # Quick filter: if lengths differ by more than 20%, skip
                len1, len2 = len(title1), len(title2)
                if abs(len1 - len2) > max(len1, len2) * 0.2:
                    continue

                title_sim = similarity(title1, title2)
                if title_sim < TITLE_SIMILARITY_THRESHOLD:
                    continue

                # Title is similar enough - now check lyrics
                groups1 = title_to_groups[title1]
                groups2 = title_to_groups[title2]

                # Get representative lyrics for each group
                # Check if ANY pair of groups have similar enough lyrics
                should_merge = False
                for g1 in groups1:
                    lyrics1 = group_lyrics.get(g1, '')
                    for g2 in groups2:
                        lyrics2 = group_lyrics.get(g2, '')

                        # If both have lyrics, require they're similar
                        if lyrics1 and lyrics2:
                            lyrics_sim = similarity(lyrics1, lyrics2)
                            if lyrics_sim >= LYRICS_SIMILARITY_THRESHOLD:
                                should_merge = True
                                break
                        # If one or both lack lyrics, allow merge for high title similarity
                        elif title_sim >= 0.95:
                            should_merge = True
                            break
                    if should_merge:
                        break

                if should_merge:
                    # Pick the canonical group_id (prefer the one with more songs)
                    all_groups = groups1 | groups2
                    canonical = max(all_groups, key=lambda g: len(by_group.get(g, [])))

                    for gid in all_groups:
                        if gid != canonical:
                            merge_map[gid] = canonical

    if merge_map:
        # Apply merges
        merged_count = 0
        for song in songs:
            old_gid = song.get('group_id', '')
            if old_gid in merge_map:
                song['group_id'] = merge_map[old_gid]
                merged_count += 1

        print(f"Fuzzy grouping: merged {len(merge_map)} groups ({merged_count} songs affected)")

    return songs


def _process_work_dir(work_dir_path: str) -> tuple:
    """Process a single work directory. Used by multiprocessing pool.

    Returns (song_dict, None) on success, (None, (work_id, error_msg)) on error.
    """
    work_dir = Path(work_dir_path)
    if not work_dir.is_dir():
        return (None, None)

    try:
        song = build_song_from_work(work_dir)
        return (song, None)
    except Exception as e:
        return (None, (work_dir.name, str(e)))


def build_works_index(works_dir: Path, output_file: Path, enrich_tags: bool = True,
                      fuzzy_grouping: bool = True, num_workers: int = None):
    """Build index from all works.

    Args:
        works_dir: Path to works/ directory
        output_file: Path to output index.jsonl
        enrich_tags: Whether to run tag enrichment
        fuzzy_grouping: Whether to run fuzzy title grouping (skip for CI)
        num_workers: Number of parallel workers (default: CPU count)
    """
    print(f"Scanning {works_dir}...")

    # Get all work directories
    work_dirs = [str(d) for d in sorted(works_dir.iterdir())]
    total = len(work_dirs)

    # Determine worker count
    # In CI environments (detected via CI env var), use fewer workers
    # since GitHub Actions typically has 2 cores
    if num_workers is None:
        if os.environ.get('CI'):
            num_workers = 2  # CI environment
        else:
            num_workers = os.cpu_count() or 4

    songs = []
    errors = []

    # Use multiprocessing for parallel file reading
    if num_workers > 1:
        print(f"Using {num_workers} workers...")
        with multiprocessing.Pool(num_workers, initializer=_init_worker) as pool:
            processed = 0
            for song, error in pool.imap_unordered(_process_work_dir, work_dirs, chunksize=100):
                processed += 1
                if processed % 2000 == 0:
                    print(f"  Progress: {processed}/{total}")
                if song:
                    songs.append(song)
                if error:
                    errors.append(error)
    else:
        # Sequential fallback
        load_canonical_ranks()
        for i, work_dir_path in enumerate(work_dirs):
            if i % 2000 == 0 and i > 0:
                print(f"  Progress: {i}/{total}")
            song, error = _process_work_dir(work_dir_path)
            if song:
                songs.append(song)
            if error:
                errors.append(error)

    print(f"Processed {len(songs)} works ({len(errors)} errors)")

    if errors and len(errors) <= 10:
        print("Errors:")
        for work_id, error in errors:
            print(f"  {work_id}: {error}")

    # Copy tablature files to docs/data/tabs/
    tabs_dir = Path('docs/data/tabs')
    tabs_dir.mkdir(parents=True, exist_ok=True)
    tabs_copied = 0
    for song in songs:
        for tab_part in song.get('tablature_parts', []):
            # tab_part['file'] is like "data/tabs/arkansas-traveler-banjo.otf.json"
            dest_path = Path('docs') / tab_part['file']
            # Source is works/{id}/{instrument}.otf.json
            work_id = song['id']
            instrument = tab_part.get('instrument', 'banjo')
            source_path = works_dir / work_id / f"{instrument}.otf.json"
            if source_path.exists() and (not dest_path.exists() or
                    source_path.stat().st_mtime > dest_path.stat().st_mtime):
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, dest_path)
                tabs_copied += 1
    if tabs_copied:
        print(f"Copied {tabs_copied} tablature files to docs/data/tabs/")

    # Tag enrichment
    if enrich_tags:
        try:
            from tag_enrichment import enrich_songs_with_tags
            songs = enrich_songs_with_tags(songs, use_musicbrainz=True)

            # Count tag stats
            tag_counts = {}
            songs_with_tags = 0
            for song in songs:
                if song.get('tags'):
                    songs_with_tags += 1
                    for tag in song['tags']:
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1

            print(f"Tagged {songs_with_tags}/{len(songs)} songs")
            if tag_counts:
                print("  Top tags:")
                for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])[:10]:
                    print(f"    {tag}: {count}")
        except ImportError as e:
            print(f"Tag enrichment not available: {e}")
        except Exception as e:
            print(f"Tag enrichment failed: {e}")

    # Strum Machine enrichment (from cache file directly, no httpx dependency)
    strum_cache_path = Path('docs/data/strum_machine_cache.json')
    if strum_cache_path.exists():
        try:
            with open(strum_cache_path) as f:
                strum_cache = json.load(f)

            def normalize_for_strum(title: str) -> str:
                """Normalize title for Strum Machine matching."""
                if not title:
                    return ''
                title = title.lower().strip()
                # Remove parenthetical suffixes like (C), (D), (Banjo Break)
                title = re.sub(r'\s*\([^)]*\)\s*$', '', title)
                return title

            # Pre-compute reverse lookup for "the" variants (avoids O(n*m) nested loop)
            strum_cache_no_the = {}
            for key, val in strum_cache.items():
                if val.get('_no_match'):
                    continue
                key_no_the = re.sub(r'\bthe\b', '', key).strip()
                key_no_the = ' '.join(key_no_the.split())
                if key_no_the not in strum_cache_no_the:
                    strum_cache_no_the[key_no_the] = val

            strum_matches = 0
            for song in songs:
                # Skip if already has SM URL from work.yaml
                if song.get('strum_machine_url'):
                    strum_matches += 1
                    continue

                title = song.get('title', '')
                norm_title = normalize_for_strum(title)

                # Try exact match first
                cached = strum_cache.get(norm_title)

                # Try without articles if no match
                if not cached or cached.get('_no_match'):
                    # Remove common articles
                    alt_title = re.sub(r'\bthe\b', '', norm_title).strip()
                    alt_title = ' '.join(alt_title.split())  # normalize spaces
                    if alt_title != norm_title:
                        cached = strum_cache.get(alt_title)

                # Try with "the" if still no match (e.g., "Angeline Baker" -> "Angeline the Baker")
                if not cached or cached.get('_no_match'):
                    # Use pre-computed reverse lookup
                    cached = strum_cache_no_the.get(norm_title)

                if cached and not cached.get('_no_match') and 'url' in cached:
                    song['strum_machine_url'] = cached['url']
                    strum_matches += 1

            print(f"Strum Machine: {strum_matches}/{len(songs)} songs matched")
        except Exception as e:
            print(f"Strum Machine enrichment failed: {e}")

    # Fuzzy grouping pass - merge similar titles that should be grouped together
    # Skip for CI/lightweight builds (--skip-fuzzy)
    if fuzzy_grouping:
        songs = fuzzy_group_songs(songs)

    # Deduplicate (by content for lead sheets, by id for tablature-only)
    seen_content = {}
    unique_songs = []
    duplicates = 0
    for song in songs:
        content = song.get('content', '')
        # Don't deduplicate tablature-only works (they have empty content)
        if not content:
            unique_songs.append(song)
            continue
        content_hash = hashlib.md5(content.encode()).hexdigest()
        if content_hash in seen_content:
            duplicates += 1
            continue
        seen_content[content_hash] = True
        unique_songs.append(song)

    songs = unique_songs
    print(f"Indexed {len(songs)} songs ({duplicates} duplicates removed)")

    # Write index
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        for song in songs:
            f.write(json.dumps(song, ensure_ascii=False) + '\n')

    print(f"Written to {output_file}")
    print(f"Size: {output_file.stat().st_size / 1024 / 1024:.1f} MB")


def main():
    parser = argparse.ArgumentParser(description='Build index from works/')
    parser.add_argument('--no-tags', action='store_true',
                        help='Skip tag enrichment')
    parser.add_argument('--skip-fuzzy', action='store_true',
                        help='Skip fuzzy grouping (for CI/lightweight builds)')
    parser.add_argument('--workers', type=int, default=None,
                        help='Number of parallel workers (default: CPU count)')
    args = parser.parse_args()

    works_dir = Path('works')
    output_file = Path('docs/data/index.jsonl')

    if not works_dir.exists():
        print(f"Error: works/ directory not found")
        print("Run migrate_to_works.py first")
        return 1

    # Pre-load canonical ranks in main process for the initial print
    load_canonical_ranks()

    build_works_index(works_dir, output_file,
                      enrich_tags=not args.no_tags,
                      fuzzy_grouping=not args.skip_fuzzy,
                      num_workers=args.workers)


if __name__ == '__main__':
    main()
