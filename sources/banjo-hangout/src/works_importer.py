"""Works integration for Hangout Network tabs.

Matches tabs to existing works and creates new works as needed.
"""

import json
import re
import shutil
import sys
import unicodedata
from datetime import date
from pathlib import Path
from typing import Optional

import yaml

from catalog import TabCatalog, TabEntry
from site_config import (
    DEFAULT_SITE,
    SiteConfig,
    resolve_instrument,
    strip_title_decorations,
)


# Paths relative to repo root
REPO_ROOT = Path(__file__).parent.parent.parent.parent
WORKS_DIR = REPO_ROOT / 'works'

# Sibling sites: the TEF must actually hold the site's own instrument (or a
# full ensemble). A mismatch means the TEF carried no/foreign instrument
# metadata — reso dobros are written as 6-string-guitar, and an
# instrument-less TEF defaults to 5-string banjo in the parser — so
# importing it would file a dobro arrangement as guitar.otf.json on a live
# song page. Banjo Hangout is exempt: it genuinely hosts tenor-banjo,
# guitar and ensemble arrangements.
STRICT_INSTRUMENT_SITES = {'mandolin-hangout', 'flatpicker-hangout',
                           'fiddle-hangout', 'reso-hangout'}

# Curation registry guard (scripts/lib/curation.py)
_SCRIPTS_LIB = REPO_ROOT / 'scripts' / 'lib'
if str(_SCRIPTS_LIB) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_LIB))
from curation import is_suppressed, load_deleted_songs, load_registry


def slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    # Normalize unicode
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')

    # Lowercase and replace spaces/special chars
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = text.strip('-')

    # Collapse multiple dashes
    text = re.sub(r'-+', '-', text)

    return text


def normalize_title(title: str, site: SiteConfig = DEFAULT_SITE) -> str:
    """Normalize title for matching."""
    # Remove common suffixes (the instrument words are per-site)
    title = strip_title_decorations(title, site.instrument_words)

    # Normalize case and whitespace
    title = ' '.join(title.lower().split())

    return title


_TITLE_INDEX: dict[tuple[str, ...], dict] = {}


def _title_index(site: SiteConfig = DEFAULT_SITE) -> dict:
    """Normalized-title -> work dir, built ONCE per site (scanning ~18k
    work dirs with a yaml parse per unmatched title made batch imports
    quadratic). Keyed by the site's instrument words, since those decide
    how titles normalize."""
    cache_key = site.instrument_words
    index = _TITLE_INDEX.get(cache_key)
    if index is None:
        index = {}
        for work_dir in WORKS_DIR.iterdir():
            if not work_dir.is_dir():
                continue
            work_yaml = work_dir / 'work.yaml'
            if not work_yaml.exists():
                continue
            try:
                data = yaml.safe_load(work_yaml.read_text())
                key = normalize_title(data.get('title', ''), site)
                index.setdefault(key, work_dir)
            except Exception:
                continue
        _TITLE_INDEX[cache_key] = index
    return index


def find_matching_work(title: str, site: SiteConfig = DEFAULT_SITE) -> Optional[Path]:
    """Find an existing work that matches this title.

    Returns the work directory path if found, None otherwise.
    """
    normalized = normalize_title(title, site)
    slug = slugify(normalized)

    # Try exact slug match first
    exact_path = WORKS_DIR / slug
    if exact_path.exists() and (exact_path / 'work.yaml').exists():
        return exact_path

    # Normalized title match via the cached index
    return _title_index(site).get(normalized)


def load_work(work_dir: Path) -> dict:
    """Load work.yaml from a work directory."""
    work_yaml = work_dir / 'work.yaml'
    return yaml.safe_load(work_yaml.read_text())


def save_work(work_dir: Path, work_data: dict):
    """Save work.yaml to a work directory."""
    work_yaml = work_dir / 'work.yaml'
    work_yaml.write_text(yaml.dump(
        work_data,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False
    ))


def part_instrument(otf_path: Path, site: SiteConfig = DEFAULT_SITE) -> str:
    """Instrument id for this OTF's work.yaml part and filename.

    Read from the converted OTF's tracks (the TEF knows what it holds),
    falling back to the site's instrument only when detection fails — a
    mandolin tab must not land as banjo.otf.json.
    """
    try:
        otf = json.loads(otf_path.read_text())
    except (OSError, json.JSONDecodeError):
        return site.fallback_instrument
    return resolve_instrument(otf.get('tracks', []), site.fallback_instrument)


def instrument_mismatch(otf_path: Path, site: SiteConfig = DEFAULT_SITE) -> Optional[str]:
    """Reason string when a sibling-site TEF doesn't hold its own instrument."""
    if site.name not in STRICT_INSTRUMENT_SITES:
        return None
    instrument = part_instrument(otf_path, site)
    if instrument in (site.fallback_instrument, 'ensemble'):
        return None
    return (f"instrument-mismatch (detected {instrument}, "
            f"{site.name} is {site.fallback_instrument})")


def create_new_work(tab: TabEntry, otf_path: Path, site: SiteConfig = DEFAULT_SITE) -> Path:
    """Create a new work from a tab entry.

    Returns the work directory path.
    """
    normalized = normalize_title(tab.title, site)
    slug = slugify(normalized)

    # Handle slug conflicts (never claim a suppressed suffix slug)
    registry = load_registry(REPO_ROOT)
    deleted_songs = load_deleted_songs(REPO_ROOT)
    work_dir = WORKS_DIR / slug
    suffix = 1
    while work_dir.exists() or is_suppressed(work_dir.name, registry, deleted_songs):
        work_dir = WORKS_DIR / f"{slug}-{suffix}"
        suffix += 1

    work_dir.mkdir(parents=True, exist_ok=True)

    # Copy OTF file, named for the instrument it actually holds
    instrument = part_instrument(otf_path, site)
    otf_filename = f'{instrument}.otf.json'
    shutil.copy2(otf_path, work_dir / otf_filename)

    # Create work.yaml. NB: the tabber is the ARRANGER, not the composer
    # — attribution lives in provenance (work-view renders "Tabbed by").
    work_data = {
        'id': work_dir.name,
        'title': tab.title,
        'artist': None,  # Traditional/unknown for tabs
        'composers': [],
        'default_key': tab.key,
        'tags': build_tags(tab, site),
        'parts': [
            {
                'type': 'tablature',
                'instrument': instrument,
                'format': 'otf',
                'file': otf_filename,
                'default': True,
                'provenance': _provenance(tab, site),
            }
        ],
    }

    save_work(work_dir, work_data)
    return work_dir


def tab_source_ids(work_data: dict) -> set:
    """source_ids of every tablature part already on this work."""
    ids = set()
    for part in work_data.get('parts') or []:
        if part.get('type') != 'tablature':
            continue
        source_id = (part.get('provenance') or {}).get('source_id')
        if source_id is not None:
            ids.add(str(source_id))
    return ids


def part_filename(work_data: dict, instrument: str, source_id) -> str:
    """Filename for a new tablature part inside the work directory.

    The FIRST arrangement of an instrument keeps the historical bare
    ``{instrument}.otf.json``; additional arrangements land alongside it as
    ``{instrument}-{source_id}.otf.json``. Keeping the first name stable
    means promoting alternates doesn't rewrite the wave-1 corpus.
    """
    taken = {p.get('file') for p in (work_data.get('parts') or [])}
    bare = f'{instrument}.otf.json'
    if bare not in taken:
        return bare
    suffixed = f'{instrument}-{source_id}.otf.json' if source_id else None
    if suffixed and suffixed not in taken:
        return suffixed
    # No source_id (or a freak collision): fall back to a numbered name.
    n = 2
    while f'{instrument}-{n}.otf.json' in taken:
        n += 1
    return f'{instrument}-{n}.otf.json'


def add_part_to_work(work_dir: Path, tab: TabEntry, otf_path: Path,
                     site: SiteConfig = DEFAULT_SITE) -> bool:
    """Add a tablature part to an existing work.

    Returns True if the part was added, False if this exact arrangement is
    already on the work.

    A work may hold several arrangements of the same instrument (the
    frontend groups instrument -> arrangement), so the duplicate check is
    on the arrangement's identity — its source_id — not on the instrument.
    """
    work_data = load_work(work_dir)
    instrument = part_instrument(otf_path, site)
    source_id = tab.id.split('_')[0]

    # Same tab already imported? (any instrument — a re-detected instrument
    # must not clone the same upstream arrangement onto the work twice)
    if source_id and source_id in tab_source_ids(work_data):
        return False

    # Copy OTF file
    otf_filename = part_filename(work_data, instrument, source_id)
    shutil.copy2(otf_path, work_dir / otf_filename)

    # Add part
    new_part = {
        'type': 'tablature',
        'instrument': instrument,
        'format': 'otf',
        'file': otf_filename,
        'provenance': _provenance(tab, site),
    }

    # Add tags if work doesn't have them
    existing_tags = set(work_data.get('tags', []))
    for tag in build_tags(tab, site):
        if tag not in existing_tags:
            if 'tags' not in work_data:
                work_data['tags'] = []
            work_data['tags'].append(tag)

    if 'parts' not in work_data:
        work_data['parts'] = []
    work_data['parts'].append(new_part)

    save_work(work_dir, work_data)
    return True


def _provenance(tab: TabEntry, site: SiteConfig = DEFAULT_SITE) -> dict:
    """Provenance block for a tablature part.

    source_id is the Hangout tab detail id (numeric prefix of the catalog
    id) — build_works_index needs it to construct the tab page and author
    attribution links.
    """
    source_id = tab.id.split('_')[0]
    prov = {
        'source': site.source,
        'source_id': source_id,
        'source_url': site.tab_page_url(source_id),
        'author': tab.author,
    }
    # Listing detail the arrangement picker shows next to each alternate
    if tab.difficulty:
        prov['difficulty'] = tab.difficulty
    if tab.tuning:
        prov['tuning'] = tab.tuning
    prov['imported_at'] = str(date.today())
    return prov


def build_tags(tab: TabEntry, site: SiteConfig = DEFAULT_SITE) -> list[str]:
    """Build tags from the tab listing's genre/style."""
    tags = ['Instrumental']  # All tabs are instrumentals

    if tab.genre:
        genre_lower = tab.genre.lower()
        for pattern, tag in site.genre_tag_map.items():
            if pattern in genre_lower:
                tags.append(tag)
                break

    if tab.style:
        style_lower = tab.style.lower()
        for pattern, tag in site.style_tag_map.items():
            if pattern in style_lower:
                tags.append(tag)
                break

    return tags


def import_tab(catalog: TabCatalog, tab: TabEntry,
               site: SiteConfig = DEFAULT_SITE,
               create_new_works: bool = True) -> Optional[str]:
    """Import a single converted tab to works/.

    Returns the work slug if successful, None otherwise.

    ``create_new_works=False`` restricts the run to enriching works that
    already exist (used by arrangement-promotion passes, where minting new
    works would need a separate title/curation review).
    """
    # Find the converted OTF file
    otf_path = site.parsed_dir / f"{tab.id}.otf.json"
    if not otf_path.exists():
        print(f"  Error: OTF file not found: {otf_path}")
        return None

    # Curation guard: never re-create or touch suppressed works
    registry = load_registry(REPO_ROOT)
    deleted_songs = load_deleted_songs(REPO_ROOT)
    slug = slugify(normalize_title(tab.title, site))
    if is_suppressed(slug, registry, deleted_songs):
        print(f"  Skipped: '{slug}' is suppressed (curation registry / deleted songs)")
        return None

    # Try to match to existing work
    matching_work = find_matching_work(tab.title, site)
    if matching_work and is_suppressed(matching_work.name, registry, deleted_songs):
        print(f"  Skipped: matched work '{matching_work.name}' is suppressed "
              f"(curation registry / deleted songs)")
        return None

    # Strict-instrument gate for sibling sites (see STRICT_INSTRUMENT_SITES)
    mismatch = instrument_mismatch(otf_path, site)
    if mismatch:
        print(f"  Skipped: {mismatch}")
        return None

    if matching_work:
        # Add to existing work
        if add_part_to_work(matching_work, tab, otf_path, site):
            print(f"  Added to existing work: {matching_work.name}")
            return matching_work.name
        else:
            print(f"  Skipped: work {matching_work.name} already has this "
                  f"arrangement (source_id={tab.id.split('_')[0]})")
            return None
    elif not create_new_works:
        print(f"  Skipped: no existing work matches '{tab.title}' "
              f"(new-work creation disabled)")
        return None
    else:
        # Create new work
        work_dir = create_new_work(tab, otf_path, site)
        print(f"  Created new work: {work_dir.name}")
        return work_dir.name


def batch_import(catalog: TabCatalog, limit: int = None, dry_run: bool = False,
                 site: SiteConfig = DEFAULT_SITE,
                 create_new_works: bool = True) -> int:
    """Import all importable tabs to works/.

    Args:
        catalog: TabCatalog with tab entries
        limit: Maximum number to import
        dry_run: If True, just print what would be done
        site: Hangout site the catalog belongs to
        create_new_works: If False, only add arrangements to existing works

    Returns:
        Number of tabs imported
    """
    importable = catalog.get_importable()
    if limit:
        importable = importable[:limit]

    if dry_run:
        print(f"\n[DRY RUN] Would import {len(importable)} tabs:")
        for tab in importable[:20]:
            matching = find_matching_work(tab.title, site)
            if matching:
                print(f"  {tab.title} -> add to {matching.name}")
            elif create_new_works:
                print(f"  {tab.title} -> create new work")
            else:
                print(f"  {tab.title} -> skip (no matching work)")
        if len(importable) > 20:
            print(f"  ... and {len(importable) - 20} more")
        return 0

    imported_count = 0
    for tab in importable:
        print(f"Importing: {tab.title}")
        work_slug = import_tab(catalog, tab, site,
                               create_new_works=create_new_works)

        if work_slug:
            catalog.update_status(tab.id, 'imported')
            catalog.set_work_slug(tab.id, work_slug)
            imported_count += 1
        else:
            catalog.update_status(tab.id, 'skipped', 'Could not import')

    catalog.save()
    return imported_count
