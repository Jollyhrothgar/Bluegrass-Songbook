#!/usr/bin/env python3
"""
Build search index from works/ directory.

This replaces build_index.py as the primary index builder.
Reads work.yaml + lead-sheet.pro from each work directory and emits a
THREE-PART output (see `write_outputs` and scripts/lib/CLAUDE.md):

    docs/data/index.jsonl   canon rows only (indexed is not False), no content
    docs/data/archive.jsonl indexed:false rows, no content, lyrics clipped
    docs/data/songs/{id}.pro   full ChordPro per work, fetched on page open
    docs/data/songs/{id}--{slug}.pro   a forked lead sheet (see `arrangements`)

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
import sys
from pathlib import Path
from urllib.parse import quote

import yaml

# Attribution link bases for Hangout Network tab sources (matches the
# SITES registry in sources/banjo-hangout/src/site_config.py)
HANGOUT_SITE_URLS = {
    'banjo-hangout': 'https://www.banjohangout.org',
    'mandolin-hangout': 'https://www.mandohangout.com',
    'flatpicker-hangout': 'https://www.flatpickerhangout.com',
    'fiddle-hangout': 'https://www.fiddlehangout.com',
    'reso-hangout': 'https://www.resohangout.com',
}

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

from curation import (apply_curation, apply_tab_defaults, filter_suppressed,
                      load_registry, load_prune_list, apply_index_prune,
                      apply_tag_exclusions, load_promoted_songs)


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


def simplify_chord(chord: str) -> str:
    """Simplify chord to root + quality only.

    D7->D, Am7->Am, Cmaj7->C, Gsus4->G, G/B->G, Amin->Am
    """
    m = re.match(r'^([A-G][#b]?)(m(?!aj)(?:in)?|dim|aug)?', chord)
    if not m:
        return chord
    return m.group(1) + (m.group(2) or '').replace('min', 'm')


def extract_first_line(lyrics: str) -> str:
    """Get first non-empty line of lyrics."""
    for line in lyrics.split('\n'):
        line = line.strip()
        if line:
            return line[:100]
    return ''


def compute_group_id(title: str, artist: str, lyrics: str) -> str:
    """Compute group ID for version grouping.

    Title-only base hash (artist excluded — same song, different attributions
    should group together). Lyrics hash distinguishes genuinely different songs
    that share a title.
    """
    import unicodedata

    def normalize_title(text: str) -> str:
        """Normalize title, removing articles for better grouping."""
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', text)
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower()
        # Remove parenthetical suffixes like (Live), (C), (D)
        text = re.sub(r'\s*\([^)]*\)\s*$', '', text)
        # Remove common articles
        text = re.sub(r'\bthe\b', '', text)
        text = re.sub(r'\ba\b', '', text)
        text = re.sub(r'\ban\b', '', text)
        text = re.sub(r'[^a-z0-9]', '', text)
        return text

    def normalize_lyrics(text: str) -> str:
        """Aggressively normalize lyrics for grouping comparison."""
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', text)
        text = text.encode('ascii', 'ignore').decode('ascii')
        text = text.lower()
        # Normalize contractions
        text = text.replace("'", '').replace('\u2019', '')
        # Strip filler words common in folk/country variations
        for filler in ['well ', 'oh ', 'now ', 'hey ', 'say ']:
            text = text.replace(filler, '')
        # Normalize "gonna" -> "going to", "ain't" -> "not"
        text = text.replace('gonna', 'going to')
        text = text.replace('aint', 'not')
        text = re.sub(r'[^a-z0-9]', '', text)
        return text

    # Title-only base hash (no artist)
    base = normalize_title(title)
    base_hash = hashlib.md5(base.encode()).hexdigest()[:12]

    # Lyrics hash to distinguish different songs with same title.
    # Normalize BEFORE truncating: a raw [:200] window shifts with stray
    # whitespace/punctuation, splitting true duplicates into different
    # groups (e.g. two "Misty" covers differing by one double-space).
    lyrics_norm = normalize_lyrics(lyrics or '')[:200]
    lyrics_hash = hashlib.md5(lyrics_norm.encode()).hexdigest()[:8]

    return f"{base_hash}_{lyrics_hash}"


# ── Forked lead sheets ───────────────────────────────────────────────────
# A work can hold more than one lead sheet: `works_writer.fork_to_arrangement`
# lands somebody else's take on a song as an ADDITIONAL lead-sheet part
# (`lead-sheet-<label>.pro`, `default: false`, `x_version_*` populated)
# instead of overwriting the chart that was already there.
#
# The primary lead sheet keeps the shape it always had — `content` on the row,
# published to `docs/data/songs/{id}.pro` — so single-lead-sheet works (every
# work in the corpus as of 2026-08-15) build byte-for-byte as before. Only a
# work with a SECOND lead sheet grows an `arrangements` list, one entry per
# lead sheet including the primary, which is what the Arrangement pill lists.

#: Metadata a forked part carries in the ChordPro itself
#: (`works_writer.apply_version_metadata`), read as a fallback when work.yaml
#: doesn't spell it out — a hand-added part may only have the directives.
_VERSION_META_FIELDS = {
    'x_version_label': 'label',
    'x_version_type': 'version_type',
    'x_arrangement_by': 'arrangement_by',
    'x_version_notes': 'notes',
}

#: Where the primary lead sheet lives inside a work directory.
PRIMARY_LEAD_SHEET = 'lead-sheet.pro'


def lead_sheet_parts(work: dict) -> list:
    """The work's lead-sheet parts, in work.yaml order."""
    return [p for p in (work.get('parts') or [])
            if p.get('type') == 'lead-sheet' and p.get('file')]


def version_meta_from_content(content: str) -> dict:
    """`x_version_*` directives lifted out of a ChordPro chart."""
    meta = {}
    for directive, field in _VERSION_META_FIELDS.items():
        m = re.search(r'\{meta:\s*' + directive + r'\s+([^}]+)\}', content or '')
        if m:
            meta[field] = m.group(1).strip()
    return meta


def arrangement_slug(part_file: str, position: int, taken: set) -> str:
    """Stable, unique-per-work slug for a forked lead sheet.

    Derived from the part's filename (`lead-sheet-simplified.pro` ->
    `simplified`), which `works_writer.unique_filename` already guarantees is
    unique inside the work — so the slug is stable across builds and across
    label edits.
    """
    stem = Path(part_file).name.split('.')[0]
    stem = re.sub(r'^lead-sheet-?', '', stem)
    slug = re.sub(r'[^a-z0-9]+', '-', stem.lower()).strip('-') or f'p{position}'
    candidate, n = slug, 2
    while candidate in taken:
        candidate = f'{slug}-{n}'
        n += 1
    taken.add(candidate)
    return candidate


def published_arrangement_name(work_id: str, slug: str) -> str:
    """Filename for a forked lead sheet inside docs/data/songs/.

    ``{work}--{slug}.pro``. The double hyphen cannot collide with another
    work's ``{id}.pro``: `work_schema.slugify` collapses runs of dashes, so no
    minted work id contains ``--`` (verified against all 19,229 works).
    """
    return f'{work_id}--{slug}.pro'


def published_tab_name(work_id: str, part: dict, position: int = 0) -> str:
    """Filename for a tablature part inside docs/data/tabs/.

    ``{work}-{instrument}-{source_id}.otf.json``. Since a work can carry
    several arrangements per instrument, the source_id is always part of the
    name — instrument alone is no longer unique. Parts without a source_id
    (hand-uploaded TEFs) fall back to their position in work.yaml so they
    still get a stable, collision-free name.
    """
    instrument = part.get('instrument') or 'tab'
    source_id = (part.get('provenance') or {}).get('source_id')
    suffix = str(source_id) if source_id else f"p{position}"
    # Keep the name filesystem/URL-safe: ids are numeric upstream, but a
    # hand-written provenance could carry anything.
    suffix = re.sub(r'[^A-Za-z0-9]+', '-', suffix).strip('-') or f"p{position}"
    return f"{work_id}-{instrument}-{suffix}.otf.json"


def _tab_provenance_mismatch(otf_path: Path, prov_source_id):
    """Detect an OTF built from the wrong upstream tab.

    Returns ``(prov_id, {otf_id})`` when the OTF's ``x_source.source_id``
    disagrees with ``prov_source_id`` (from work.yaml), else None.

    The comparison is between two RECORDED ids: the converter stamps the tab
    detail id it converted (``converter.TEFConverter.convert``) and the
    importer stamps the same id into the part's provenance. An earlier version
    of this gate re-derived the id with a regex over the storage filename
    instead — but on the older Hangout scheme (``{slug}-{n}.tef``) that number
    is a per-file ATTACHMENT id from a disjoint namespace (tab 10545 ships
    ``arkansas_traveller-426.tef``), so the check could only ever produce
    false positives there, never detect a real swap. Filenames are not ids.

    Conservative by design: an OTF with no recorded ``x_source.source_id``
    (pre-2026-07 conversions, hand-built or editor-authored tabs) yields no
    verdict rather than a failure.
    """
    if not prov_source_id:
        return None
    try:
        data = json.loads(otf_path.read_text())
    except Exception:
        return None
    otf_id = (data.get('x_source') or {}).get('source_id')
    if not otf_id or str(otf_id) == str(prov_source_id):
        return None
    return (str(prov_source_id), {str(otf_id)})


def otf_track_count(otf_path: Path):
    """Number of PLAYABLE tracks in an OTF file, or None if it can't be read.

    Published on each `tablature_parts` entry as `tracks` so the frontend can
    tell a one-track tab from a multi-instrument arrangement (whether to show
    the track mixer) without downloading the OTF first.

    Percussion tracks don't count: they are neither rendered nor played (see
    docs/js/renderers/otf-tracks.js), so counting them would show a mixer
    with one entry and stamp `tag:multipart` on single-instrument tabs.
    """
    try:
        data = json.loads(otf_path.read_text())
    except Exception:
        return None
    tracks = data.get('tracks')
    if isinstance(tracks, list):
        return sum(
            1 for t in tracks
            if not (isinstance(t, dict)
                    and (t.get('percussion') is True
                         or t.get('instrument') == 'percussion'))
        )
    return None


# ── Slim-output shape ────────────────────────────────────────────────────
# Fields that used to ride along on every index row and now live in
# docs/data/songs/{id}.pro instead (fetched when a song page opens).
SPLIT_OUT_FIELDS = ('content', 'abc_content')

# Archive rows only feed the work-page header fallback, never search, so
# their lyrics are clipped harder than the canon rows'.
ARCHIVE_LYRICS_CHARS = 200


def write_outputs(songs: list, index_file: Path):
    """Split the built rows into the three published artifacts.

    - ``index_file`` (docs/data/index.jsonl): canon rows only — this is the
      startup payload, so `content`/`abc_content` are stripped and replaced
      by the booleans `has_content` / `has_abc`.
    - ``archive.jsonl`` beside it: the ``indexed: false`` rows in the same
      slim shape, with `lyrics` clipped to ARCHIVE_LYRICS_CHARS. Loaded
      lazily (deep links, lists, arrangement groups), never for search.
    - ``songs/{id}.pro``: the FULL ChordPro exactly as the old `content`
      field — for canon AND archive works.

    `songs` must already be sorted by id; both jsonl files inherit that
    order, keeping the build byte-stable.
    """
    data_dir = index_file.parent
    archive_file = data_dir / 'archive.jsonl'
    songs_dir = data_dir / 'songs'
    songs_dir.mkdir(parents=True, exist_ok=True)

    canon_rows = []
    archive_rows = []
    published_songs = set()
    written = 0

    def publish(name: str, text: str):
        """Write one .pro, only when its text actually changed."""
        nonlocal written
        published_songs.add(name)
        dest = songs_dir / name
        # Only rewrite when the text actually changed: keeps mtimes (and
        # therefore incremental rebuilds / git status) quiet.
        try:
            unchanged = dest.read_text(encoding='utf-8') == text
        except OSError:
            unchanged = False
        if not unchanged:
            dest.write_text(text, encoding='utf-8')
            written += 1

    for song in songs:
        content = song.pop('content', '') or ''
        abc_content = song.pop('abc_content', None)

        if content:
            publish(f"{song['id']}.pro", content)
            song['has_content'] = True
        if abc_content:
            song['has_abc'] = True

        # Forked lead sheets ride along in their own files, same directory,
        # same orphan prune — the row keeps only the pointer.
        for arrangement in song.get('arrangements') or []:
            text = arrangement.pop('_content', None)
            if text is None:
                continue
            publish(Path(arrangement['file']).name, text)

        if song.get('indexed') is False:
            song['lyrics'] = (song.get('lyrics') or '')[:ARCHIVE_LYRICS_CHARS]
            archive_rows.append(song)
        else:
            canon_rows.append(song)

    # Prune orphans: .pro files whose work was renamed, deleted, suppressed or
    # lost its lead sheet. Nothing but this step writes to docs/data/songs/,
    # so every unexpected *.pro there is an orphan.
    orphans = [p for p in songs_dir.glob('*.pro')
               if p.name not in published_songs]
    for path in orphans:
        path.unlink()

    def _write(path: Path, rows: list):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
        return path.stat().st_size

    index_size = _write(index_file, canon_rows)
    archive_size = _write(archive_file, archive_rows)

    print(f"Written to {index_file}")
    print(f"  {len(canon_rows)} canon rows, "
          f"{index_size / 1024 / 1024:.1f} MB")
    print(f"Written to {archive_file}")
    print(f"  {len(archive_rows)} archive (indexed:false) rows, "
          f"{archive_size / 1024 / 1024:.1f} MB")
    print(f"Song content: {len(published_songs)} files in {songs_dir} "
          f"({written} written this build, {len(orphans)} orphans removed)")
    forked_works = [s for s in songs if s.get('arrangements')]
    if forked_works:
        forked = sum(len(s['arrangements']) - 1 for s in forked_works)
        print(f"  {forked} forked lead sheet(s) across "
              f"{len(forked_works)} work(s)")


def build_song_from_work(work_dir: Path) -> dict:
    """Build a song record from a work directory."""
    work_yaml_path = work_dir / 'work.yaml'

    if not work_yaml_path.exists():
        return None

    # Load work.yaml
    with open(work_yaml_path) as f:
        work = yaml.safe_load(f)

    # The primary lead sheet is lead-sheet.pro, exactly as it always was. A
    # work whose lead sheet is named something else (no forks are: a fork
    # never displaces the original) falls back to its default-flagged part,
    # so content isn't silently dropped.
    all_lead_sheets = lead_sheet_parts(work)
    primary_file = PRIMARY_LEAD_SHEET
    if not (work_dir / PRIMARY_LEAD_SHEET).exists() and all_lead_sheets:
        default_part = next((p for p in all_lead_sheets if p.get('default')),
                            all_lead_sheets[0])
        primary_file = Path(default_part['file']).name
    lead_sheet_path = work_dir / primary_file

    # Check what parts we have
    has_lead_sheet = lead_sheet_path.exists()
    tablature_parts = []
    document_parts = []
    if work.get('parts'):
        for part in work['parts']:
            if part.get('type') == 'tablature':
                tablature_parts.append(part)
            elif part.get('type') == 'document':
                document_parts.append(part)

    # Check if this is a placeholder work
    is_placeholder = work.get('status') == 'placeholder'

    # Must have at least a lead sheet, tablature, document, or be a placeholder
    if not has_lead_sheet and not tablature_parts and not document_parts and not is_placeholder:
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

    # For placeholder works with no other source, use 'placeholder'
    if is_placeholder and source == 'unknown':
        source = 'placeholder'

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
    if is_placeholder:
        song['status'] = 'placeholder'
    if work.get('notes'):
        song['notes'] = work['notes']

    # Who submitted the lead sheet, when the pipeline knows. This is the
    # verified auth.uid() stamped by process_pending.py, and it is what lets
    # the editor tell "your chart" from "someone else's" before you submit —
    # the same field auto-commit-song reads to decide update vs fork.
    for part in work.get('parts') or []:
        if part.get('type') == 'lead-sheet':
            submitted_by = (part.get('provenance') or {}).get('submitted_by')
            if submitted_by:
                song['submitted_by'] = submitted_by
            break

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

    # Forked lead sheets: every take of this song that lives IN this work.
    # Emitted only when there is more than one, so a single-lead-sheet work's
    # row is unchanged. `_content` is the chart text; write_outputs publishes
    # it beside the primary and strips the field.
    extra_lead_sheets = [
        p for p in all_lead_sheets
        if Path(p['file']).name != primary_file
        and (work_dir / Path(p['file']).name).exists()
    ]
    if has_lead_sheet and extra_lead_sheets:
        primary_part = next(
            (p for p in all_lead_sheets
             if Path(p['file']).name == primary_file), {})
        primary_meta = version_meta_from_content(content)
        arrangements = [{
            'slug': 'default',
            'label': (primary_part.get('label')
                      or primary_meta.get('label') or 'Original'),
            'default': True,
            'file': f"data/songs/{work['id']}.pro",
            'key': key,
            'chord_count': len(nashville_set),
        }]
        for field in ('version_type', 'arrangement_by', 'notes'):
            value = primary_part.get(
                'version_notes' if field == 'notes' else field
            ) or primary_meta.get(field)
            if value:
                arrangements[0][field] = value
        if song.get('submitted_by'):
            arrangements[0]['submitted_by'] = song['submitted_by']

        taken = {'default'}
        for i, part in enumerate(extra_lead_sheets):
            name = Path(part['file']).name
            text = (work_dir / name).read_text(encoding='utf-8')
            part_meta = version_meta_from_content(text)
            part_parsed = parse_chordpro_content(text)
            part_key, _ = detect_key(part_parsed['chords'])
            part_key = part_key or work.get('default_key', 'G')
            part_nashville = {n for n in (to_nashville(c, part_key)
                                          for c in part_parsed['chords']) if n}
            slug = arrangement_slug(name, i, taken)
            entry = {
                'slug': slug,
                'label': (part.get('label') or part_meta.get('label')
                          or slug.replace('-', ' ').title()),
                'file': f"data/songs/{published_arrangement_name(work['id'], slug)}",
                'key': part_key,
                'chord_count': len(part_nashville),
                '_content': text,
            }
            for field in ('version_type', 'arrangement_by', 'notes'):
                value = part.get(
                    'version_notes' if field == 'notes' else field
                ) or part_meta.get(field)
                if value:
                    entry[field] = value
            submitted_by = (part.get('provenance') or {}).get('submitted_by')
            if submitted_by:
                entry['submitted_by'] = submitted_by
            arrangements.append(entry)

        song['arrangements'] = arrangements

    # Add tablature parts info for frontend.
    # A work can hold several arrangements of the SAME instrument (the
    # frontend groups instrument -> arrangement), so published filenames are
    # suffixed with the arrangement's source_id and `default` is resolved
    # from the curation registry (see apply_tab_defaults) after the build.
    if tablature_parts:
        song['tablature_parts'] = []
        for i, part in enumerate(tablature_parts):
            prov = part.get('provenance', {}) or {}
            tab_info = {
                'instrument': part.get('instrument'),
                # No default label here: pre-filling with the bare instrument
                # made the frontend's "<Instrument> Tab" fallback dead code and
                # collided with the ABC part's label (issue: fiddle vs fiddle-2)
                **({'label': part['label']} if part.get('label') else {}),
                'file': f"data/tabs/{published_tab_name(work['id'], part, i)}",
                # Include provenance for attribution
                'source': prov.get('source'),
                'source_id': prov.get('source_id'),
                'author': prov.get('author'),
                # Where the OTF lives inside works/. Used by the copy step,
                # and PUBLISHED: a tab correction has to name the file it
                # corrects, and the published name (which folds in the
                # source_id) can't be mapped back to it. Without this a
                # correction to any arrangement but the first landed on
                # `{instrument}.otf.json` — a different part.
                'src_file': part.get('file'),
            }
            # Arrangement-picker detail, when the listing had it
            if prov.get('difficulty'):
                tab_info['difficulty'] = prov['difficulty']
            if prov.get('tuning'):
                tab_info['tuning'] = prov['tuning']
            # Build source page URL for Hangout Network sites
            hangout_base = HANGOUT_SITE_URLS.get(prov.get('source'))
            if hangout_base and prov.get('source_id'):
                tab_info['source_page_url'] = f"{hangout_base}/tab/browse.asp?m=detail&v={prov.get('source_id')}"
                if prov.get('author'):
                    tab_info['author_url'] = f"{hangout_base}/my/{quote(prov.get('author'))}"
            song['tablature_parts'].append(tab_info)

    # Add document parts info for frontend
    if document_parts:
        song['document_parts'] = []
        for part in document_parts:
            prov = part.get('provenance', {})
            # Use the original filename from work.yaml for the source path
            source_file = part.get('file', 'document.pdf')
            # Build destination filename from work id and label
            label_slug = re.sub(r'[^a-z0-9]+', '-', (part.get('label', 'doc')).lower()).strip('-')
            doc_info = {
                'format': part.get('format', 'pdf'),
                'label': part.get('label', 'Document'),
                'file': f"data/docs/{work['id']}-{label_slug}.pdf",
                'source_file': source_file,
            }
            if prov.get('submitted_by'):
                doc_info['submitted_by'] = prov['submitted_by']
            song['document_parts'].append(doc_info)

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

    def word_overlap(a: str, b: str) -> float:
        """Calculate word-level Jaccard similarity (order-independent).

        Catches cases where lyrics are the same words in different order
        (e.g., verse-first vs chorus-first arrangements).
        """
        words_a = set(a.split())
        words_b = set(b.split())
        if not words_a or not words_b:
            return 0.0
        intersection = words_a & words_b
        union = words_a | words_b
        return len(intersection) / len(union)

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

    # Build group_id -> simplified chord set (for supplementary matching)
    group_chords = {}
    for song in songs:
        gid = song.get('group_id', '')
        if gid not in group_chords:
            chords = song.get('nashville', [])
            group_chords[gid] = set(chords) if chords else set()

    merge_map = {}  # old_group_id -> new_group_id
    TITLE_SIMILARITY_THRESHOLD = 0.85  # 85% title similarity required
    LYRICS_SIMILARITY_THRESHOLD = 0.70  # 70% lyrics similarity also required
    CHORD_OVERLAP_THRESHOLD = 0.80     # 80% chord overlap
    LYRICS_WITH_CHORDS_THRESHOLD = 0.50  # Lower lyrics threshold when chords match

    def should_merge_groups(g1, g2, title_sim):
        """Check if two groups should be merged based on lyrics and chords."""
        lyrics1 = group_lyrics.get(g1, '')
        lyrics2 = group_lyrics.get(g2, '')

        # If both have lyrics, compare them
        if lyrics1 and lyrics2:
            # Use max of sequential and word-overlap similarity.
            # Word overlap catches rearranged sections (verse-first vs chorus-first).
            lyrics_sim = max(similarity(lyrics1, lyrics2), word_overlap(lyrics1, lyrics2))
            lyrics_threshold = LYRICS_SIMILARITY_THRESHOLD

            # If title similarity is high, use chord overlap to lower threshold
            if title_sim >= TITLE_SIMILARITY_THRESHOLD:
                chords1 = group_chords.get(g1, set())
                chords2 = group_chords.get(g2, set())
                if chords1 and chords2:
                    union = chords1 | chords2
                    intersection = chords1 & chords2
                    chord_overlap = len(intersection) / len(union) if union else 0
                    if chord_overlap >= CHORD_OVERLAP_THRESHOLD:
                        lyrics_threshold = LYRICS_WITH_CHORDS_THRESHOLD

            return lyrics_sim >= lyrics_threshold
        # If one or both lack lyrics, allow merge for high title similarity
        elif title_sim >= 0.95:
            return True
        return False

    # ── Pre-pass: same normalized title, different group_ids ──
    # This catches cases like "Roll In My Sweet Baby's Arms" where both
    # versions have the exact same normalized title but different group_ids
    # (due to lyrics hash differences from filler words, contractions, etc.)
    same_title_merges = 0
    for norm_title, group_ids in title_to_groups.items():
        if len(group_ids) < 2:
            continue
        gid_list = sorted(group_ids)
        # Pick canonical (most songs; group_id as a stable tiebreaker so the
        # choice doesn't depend on set iteration order / PYTHONHASHSEED).
        canonical = max(gid_list, key=lambda g: (len(by_group.get(g, [])), g))
        for gid in gid_list:
            if gid == canonical or gid in merge_map:
                continue
            if should_merge_groups(gid, canonical, 1.0):
                merge_map[gid] = canonical
                same_title_merges += 1

    if same_title_merges:
        print(f"Same-title pre-pass: merged {same_title_merges} groups")

    # ── Fuzzy pass: similar (but not identical) titles ──
    # Group titles by their first 3 characters (prefix buckets)
    prefix_buckets = {}
    for title in title_to_groups.keys():
        prefix = title[:3] if len(title) >= 3 else title
        if prefix not in prefix_buckets:
            prefix_buckets[prefix] = []
        prefix_buckets[prefix].append(title)

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

                # Title is similar enough - now check lyrics/chords
                groups1 = title_to_groups[title1]
                groups2 = title_to_groups[title2]

                should_merge_pair = False
                for g1 in groups1:
                    for g2 in groups2:
                        if should_merge_groups(g1, g2, title_sim):
                            should_merge_pair = True
                            break
                    if should_merge_pair:
                        break

                if should_merge_pair:
                    # Pick the canonical group_id (most songs; group_id as a
                    # stable tiebreaker — see pre-pass note above).
                    all_groups = groups1 | groups2
                    canonical = max(all_groups, key=lambda g: (len(by_group.get(g, [])), g))

                    for gid in sorted(all_groups):
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

    # Filter out suppressed songs (curation registry ∪ soft-deleted list)
    registry = load_registry(Path('.'))
    deleted_songs = {}
    deleted_songs_file = Path('docs/data/deleted_songs.json')
    if deleted_songs_file.exists():
        with open(deleted_songs_file) as f:
            deleted_songs = json.load(f)
    original_count = len(songs)
    songs = filter_suppressed(songs, deleted_songs, registry)
    excluded_count = original_count - len(songs)
    if excluded_count > 0:
        print(f"Excluded {excluded_count} suppressed/soft-deleted songs")

    # Default arrangement per instrument (curation/registry.yaml tab_pins,
    # else the first part listed in work.yaml). Runs before the copy step so
    # the flag is set on every row that gets written.
    songs = apply_tab_defaults(songs, registry)

    # Copy tablature files to docs/data/tabs/
    tabs_dir = Path('docs/data/tabs')
    tabs_dir.mkdir(parents=True, exist_ok=True)
    tabs_copied = 0
    tab_provenance_mismatches = []
    published_tabs = set()
    for song in songs:
        for tab_part in song.get('tablature_parts', []):
            # `src_file` is the part's file inside works/
            # ({instrument}.otf.json for the first arrangement,
            # {instrument}-{source_id}.otf.json for the alternates).
            src_name = tab_part.get('src_file')
            # dest is data/tabs/{work}-{instrument}-{source_id}.otf.json
            dest_path = Path('docs') / tab_part['file']
            work_id = song['id']
            instrument = tab_part.get('instrument', 'banjo')
            source_path = works_dir / work_id / (
                src_name or f"{instrument}.otf.json")
            # Anything the index references is never an orphan, even if the
            # works/ copy is missing this build — deleting it would 404 a
            # live song page.
            published_tabs.add(dest_path.name)
            if not source_path.exists():
                # No works/ copy this build — fall back to the already
                # published OTF so the row keeps its track count.
                tracks = otf_track_count(dest_path) if dest_path.exists() else None
                if tracks is not None:
                    tab_part['tracks'] = tracks
                continue

            # Integrity gate: the OTF must actually come from the TEF named in
            # this part's provenance. A conversion/import that pairs the wrong
            # TEF with a work dir (e.g. a mismatched convert_single call) would
            # otherwise ship a work labelled one tune but carrying another's
            # notes — and pass CI silently. Fail the build instead.
            mismatch = _tab_provenance_mismatch(source_path, tab_part.get('source_id'))
            if mismatch:
                tab_provenance_mismatches.append(
                    (work_id, source_path.name, mismatch))
                continue  # never publish an OTF that fails the provenance gate

            # Track count for the frontend's mixer decision (read here — the
            # OTF is already open for the provenance gate).
            tracks = otf_track_count(source_path)
            if tracks is not None:
                tab_part['tracks'] = tracks

            if (not dest_path.exists() or
                    source_path.stat().st_mtime > dest_path.stat().st_mtime):
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, dest_path)
                tabs_copied += 1
    if tabs_copied:
        print(f"Copied {tabs_copied} tablature files to docs/data/tabs/")

    if tab_provenance_mismatches:
        print("\nERROR: tablature provenance mismatch — an OTF was built from "
              "the wrong TEF (its x_source id disagrees with work.yaml "
              "provenance.source_id). Regenerate from the correct TEF:")
        for work_id, part_file, (prov_id, otf_ids) in tab_provenance_mismatches:
            print(f"  {work_id}/{part_file}: "
                  f"provenance source_id={prov_id!r} but OTF x_source has {sorted(otf_ids)}")
        raise SystemExit(1)

    # Prune orphans: published tabs whose work/part no longer exists (renames,
    # deletions, re-imports). Only files matching the generated
    # {work}-{instrument}-{id}.otf.json shape are touched, so hand-placed
    # fixtures (e.g. 27493_tef.otf.json) survive. Runs after the gate so a
    # failed build never mutates docs/data/tabs/.
    orphan_re = re.compile(
        r'^.+-(?:' + '|'.join(sorted(
            {re.escape(p.get('instrument') or 'tab')
             for s in songs for p in s.get('tablature_parts', [])} | {'banjo'},
            key=len, reverse=True)) + r')(?:-[A-Za-z0-9-]+)?\.otf\.json$')
    orphans = [p for p in tabs_dir.glob('*.otf.json')
               if p.name not in published_tabs and orphan_re.match(p.name)]
    for path in orphans:
        path.unlink()
    if orphans:
        print(f"Removed {len(orphans)} orphaned tablature files from "
              f"docs/data/tabs/")

    # Copy document files to docs/data/docs/
    docs_dir = Path('docs/data/docs')
    docs_dir.mkdir(parents=True, exist_ok=True)
    docs_copied = 0
    for song in songs:
        for doc_part in song.get('document_parts', []):
            dest_path = Path('docs') / doc_part['file']
            work_id = song['id']
            source_filename = doc_part.get('source_file', 'document.pdf')
            source_path = works_dir / work_id / source_filename
            if source_path.exists() and (not dest_path.exists() or
                    source_path.stat().st_mtime > dest_path.stat().st_mtime):
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, dest_path)
                docs_copied += 1
    if docs_copied:
        print(f"Copied {docs_copied} document files to docs/data/docs/")

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

    # Editorial curation (curation/registry.yaml): remap pinned groups to
    # stable grp:<canonical-id> ids and mark canonical/variant rows.
    # Runs unconditionally — even with --skip-fuzzy — so pins always apply.
    songs = apply_curation(songs, registry)

    # Jam-repertoire prune (curation/index_prune.csv): stamp indexed:false
    # on non-bluegrass rows so search/collections skip them. Non-destructive:
    # rows stay in the index (deep links, lists, groups keep working), and
    # user-contributed works are never pruned. Rescues: registry keep: map.
    prune_ids = load_prune_list(Path('.'))
    promoted_ids = frozenset(load_promoted_songs(Path('.')))
    songs = apply_index_prune(songs, prune_ids, registry,
                              promoted_ids=promoted_ids)
    pruned_count = sum(1 for s in songs if s.get('indexed') is False)
    if prune_ids:
        print(f"  Index prune: {pruned_count} works marked indexed:false "
              f"({len(prune_ids)} listed, {len(promoted_ids)} promoted)")
    # Promoted ids that don't exist in the corpus: either a typo or the work
    # was deleted (filter_suppressed runs earlier, so deletion wins). Warn so
    # the conflict is visible rather than silently ignored.
    missing_promoted = promoted_ids - {s.get('id') for s in songs}
    for work_id in sorted(missing_promoted):
        print(f"  WARNING: promoted work not in corpus (deleted?): {work_id}",
              file=sys.stderr)

    # Editorial tag exclusions (registry tag_exclusions): e.g. strip
    # BluegrassStandard from country/pop mis-tags. Runs after all tag
    # enrichment so exclusions always win.
    songs = apply_tag_exclusions(songs, registry)

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

    # Deterministic output order. Several upstream passes reorder `songs`
    # (imap_unordered worker completion, tag enrichment rebuilding the list),
    # so sort by id right before writing to keep index.jsonl byte-stable
    # across builds — avoids whole-file churn in git diffs.
    songs.sort(key=lambda s: str(s.get('id', '')))

    # Split into canon index + archive + per-song ChordPro files. Runs after
    # the provenance gate (which raises), so a failed build never mutates
    # docs/data/.
    write_outputs(songs, output_file)

    # Rebuild the bounty board from the committed catalogue, then lower the
    # adjudication ledger to JSON the browser can read. Both run here rather
    # than as separate commands so the three callers of this script
    # (scripts/bootstrap and both build.yml jobs) can't drift, and both need
    # the index that was just written — build_wanted for the corpus it
    # subtracts, build_bounty_decisions for chord counts.
    #
    # Order matters: the wanted list is an input to the decisions file.
    _bounty_src = Path(__file__).parent.parent.parent / 'sources' / 'bounty-hunt' / 'src'
    if str(_bounty_src) not in sys.path:
        sys.path.insert(0, str(_bounty_src))
    try:
        from build_wanted import build_wanted
        build_wanted()
    except Exception as exc:                       # noqa: BLE001
        # A broken board must not take the whole site build down — the last
        # good wanted_songs.json is still on disk and the frontend filters it
        # at render anyway. Loud, not fatal.
        print(f"WARNING: wanted-list rebuild failed ({exc}); keeping the existing file")

    try:
        from bounty_decisions import build_bounty_decisions
    except ImportError:
        from scripts.lib.bounty_decisions import build_bounty_decisions
    build_bounty_decisions(output_file.parent)

    # Lightweight dedup check: warn about potential duplicates
    _check_duplicates(songs)


def _check_duplicates(songs: list):
    """Quick dedup check on built index. Warns but doesn't fail."""
    import unicodedata
    import re

    def _norm(text):
        if not text:
            return ''
        text = unicodedata.normalize('NFKD', text)
        text = ''.join(c for c in text if not unicodedata.combining(c))
        text = text.lower()
        text = re.sub(r"[''`]", '', text)
        text = re.sub(r'\bthe\b|\ba\b|\ban\b', '', text)
        text = re.sub(r'\bst\b', 'saint', text)
        text = re.sub(r'[^a-z0-9\s]', '', text)
        return re.sub(r'\s+', ' ', text).strip()

    by_title = {}
    for song in songs:
        key = _norm(song.get('title', ''))
        if key:
            by_title.setdefault(key, []).append(song['id'])

    dupes = [(title, ids) for title, ids in by_title.items() if len(ids) > 1]
    if dupes:
        print(f"\nWARNING: {len(dupes)} potential duplicate title groups detected.")
        print("Run 'uv run python scripts/lib/dedup_works.py' to review.")
        for title, ids in dupes[:5]:
            print(f"  {title}: {', '.join(str(i) for i in ids[:3])}")
        if len(dupes) > 5:
            print(f"  ... and {len(dupes) - 5} more")


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
