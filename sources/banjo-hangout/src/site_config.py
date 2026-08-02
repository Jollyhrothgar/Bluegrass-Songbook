"""Per-site configuration for the Hangout Network tab importers.

Banjo Hangout, Mandolin Hangout and Flatpicker Hangout are the same site
on different domains, so the pipeline (scraper -> catalog -> converter ->
works importer) is shared and only the site-specific bits live here.

Each site gets its own ``data_dir`` — its own ``tab_catalog.json``,
``raw/``, ``downloads/`` and ``parsed/`` — so catalogs never share a
keyspace (tab ids collide across sites).

Sibling-site storage filenames differ from Banjo Hangout's
(``tab-{slug}-{id}-{timestamp}.{ext}`` vs ``{slug}-{id}.tef``), so download
URLs must always be scraped from the detail page's href, never templated.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


REPO_ROOT = Path(__file__).parent.parent.parent.parent
SOURCES_DIR = REPO_ROOT / 'sources'

# Genre/style -> songbook tag. The Hangout sites share one vocabulary, so
# these are defaults; a site can override them in its SITES entry.
DEFAULT_GENRE_TAG_MAP = {
    'bluegrass': 'Bluegrass',
    'old-time': 'OldTime',
    'old time': 'OldTime',
    'oldtime': 'OldTime',
    'folk': 'Folk',
    'gospel': 'Gospel',
    'blues': 'Blues',
    'country': 'ClassicCountry',
}

DEFAULT_STYLE_TAG_MAP = {
    'scruggs': 'Scruggs',
    'melodic': 'Melodic',
    'clawhammer': 'Clawhammer',
}

# OTF track instrument type -> the short instrument id used for work.yaml
# `instrument:` and the `<instrument>.otf.json` filename. Anything not
# listed here (e.g. a bare "4-string") is unrecognized and falls back to
# the site's instrument.
INSTRUMENT_ALIASES = {
    '5-string-banjo': 'banjo',
    'banjo': 'banjo',
    'tenor-banjo': 'tenor-banjo',
    '6-string-guitar': 'guitar',
    'guitar': 'guitar',
    'mandolin': 'mandolin',
    'upright-bass': 'bass',
    'bass': 'bass',
    'dobro': 'dobro',
    'resonator-guitar': 'dobro',
    'fiddle': 'fiddle',
    'violin': 'fiddle',
    'ukulele': 'ukulele',
    'piano': 'piano',
}

# Tracks that aren't a playable instrument part (click/metronome tracks
# are emitted with a real instrument type, so match on the track id).
#
# Percussion is NO LONGER handled here: TEF's structural percussion flag
# (reader.py _PERCUSSION_FLAG) types drum tracks as `instrument: percussion`,
# which normalize_instrument() drops on its own. Don't add drum names to this
# list — TablEdit names lie (mandolin-hangout 2613's drum track is called
# "Guitar Standard"), which is exactly why the flag exists. This list now only
# covers unflagged sources.
UTILITY_TRACK_IDS = ('clicks', 'click', 'metronome')

# Backup-only instruments: their presence doesn't make a file an ensemble.
ACCOMPANIMENT_INSTRUMENTS = ('bass',)

ENSEMBLE_INSTRUMENT = 'ensemble'


@dataclass(frozen=True)
class SiteConfig:
    """One Hangout Network site."""

    name: str                       # registry key, e.g. 'banjo-hangout'
    source: str                     # provenance `source:` value
    fallback_instrument: str        # used when track detection fails
    data_dir: Path                  # sources/<site>/
    base_url: Optional[str] = None  # None = domain not confirmed yet
    storage_host: str = 'hangoutstorage.com'  # where the tab files live

    # Instrument words stripped from titles when matching (see
    # strip_title_decorations); longest first so "mandolin" wins over "mando".
    instrument_words: tuple[str, ...] = ('banjo',)

    genre_tag_map: dict = field(default_factory=lambda: dict(DEFAULT_GENRE_TAG_MAP))
    style_tag_map: dict = field(default_factory=lambda: dict(DEFAULT_STYLE_TAG_MAP))

    # --- derived paths ---

    @property
    def catalog_path(self) -> Path:
        return self.data_dir / 'tab_catalog.json'

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / 'raw'

    @property
    def downloads_dir(self) -> Path:
        return self.data_dir / 'downloads'

    @property
    def parsed_dir(self) -> Path:
        return self.data_dir / 'parsed'

    @property
    def conversion_log_path(self) -> Path:
        return self.data_dir / 'conversion_log.json'

    # --- derived URLs (require a confirmed domain) ---

    def require_base_url(self) -> str:
        """Return base_url, or raise if the domain isn't known yet."""
        if not self.base_url:
            raise ValueError(
                f"{self.name}: base_url is not configured (domain pending web "
                f"recon) — scanning/scraping this site is not possible yet. "
                f"Set base_url in sources/banjo-hangout/src/site_config.py."
            )
        return self.base_url

    @property
    def tab_browse_url(self) -> str:
        return f"{self.require_base_url()}/w/tab/browse/m/byletter/v/"

    @property
    def tab_detail_url(self) -> str:
        return f"{self.require_base_url()}/tab/browse.asp"

    def tab_page_url(self, source_id: str) -> str:
        """Public detail page for a tab id (used for attribution)."""
        return f"{self.tab_detail_url}?m=detail&v={source_id}"


SITES: dict[str, SiteConfig] = {
    'banjo-hangout': SiteConfig(
        name='banjo-hangout',
        source='banjo-hangout',
        fallback_instrument='banjo',
        data_dir=SOURCES_DIR / 'banjo-hangout',
        base_url='https://www.banjohangout.org',
        instrument_words=('banjo',),
    ),
    'mandolin-hangout': SiteConfig(
        name='mandolin-hangout',
        source='mandolin-hangout',
        fallback_instrument='mandolin',
        data_dir=SOURCES_DIR / 'mandolin-hangout',
        # mandolinhangout.com 301s here
        base_url='https://www.mandohangout.com',
        instrument_words=('mandolin', 'mando'),
    ),
    'flatpicker-hangout': SiteConfig(
        name='flatpicker-hangout',
        source='flatpicker-hangout',
        fallback_instrument='guitar',
        data_dir=SOURCES_DIR / 'flatpicker-hangout',
        base_url='https://www.flatpickerhangout.com',
        instrument_words=('guitar', 'flatpick'),
    ),
    'fiddle-hangout': SiteConfig(
        name='fiddle-hangout',
        source='fiddle-hangout',
        fallback_instrument='fiddle',
        data_dir=SOURCES_DIR / 'fiddle-hangout',
        base_url='https://www.fiddlehangout.com',
        instrument_words=('fiddle', 'violin'),
    ),
    'reso-hangout': SiteConfig(
        name='reso-hangout',
        source='reso-hangout',
        fallback_instrument='dobro',
        data_dir=SOURCES_DIR / 'reso-hangout',
        base_url='https://www.resohangout.com',
        instrument_words=('dobro', 'reso', 'resonator'),
    ),
}

DEFAULT_SITE_NAME = 'banjo-hangout'


def get_site(name: Optional[str] = None) -> SiteConfig:
    """Look up a site by registry name (default: banjo-hangout)."""
    name = name or DEFAULT_SITE_NAME
    if name not in SITES:
        raise ValueError(
            f"Unknown site '{name}'. Known sites: {', '.join(sorted(SITES))}"
        )
    return SITES[name]


DEFAULT_SITE = SITES[DEFAULT_SITE_NAME]


def strip_title_decorations(title: str, instrument_words: tuple[str, ...]) -> str:
    """Strip tab-listing decorations from a title.

    Hangout tab titles carry the instrument and arrangement in the title
    ("Salt Creek - banjo tab", "Whiskey Before Breakfast (mando)"), which
    has to come off before matching against works. `instrument_words` is
    per-site so a banjo scan doesn't silently strip "Guitar" from a title
    that means it.
    """
    words = '|'.join(re.escape(w) for w in instrument_words)
    title = re.sub(r'\s*\([^)]*\)\s*$', '', title)  # (key), (version)
    title = re.sub(rf'\s*-\s*(tab|{words}|break|solo|arr\.?).*$', '', title, flags=re.I)
    title = re.sub(rf'\s*({words})\s*(tab|break|solo)?$', '', title, flags=re.I)
    return title


def normalize_instrument(instrument: Optional[str]) -> Optional[str]:
    """Map an OTF track instrument type to a short instrument id."""
    if not instrument:
        return None
    return INSTRUMENT_ALIASES.get(instrument.lower())


def resolve_instrument(tracks: list[dict], fallback: str) -> str:
    """Instrument id for a tab's work.yaml part and OTF filename.

    `tracks` is the OTF document's track list (dicts, as serialized).
    The lead is the first melodic track — TablEdit writes the melody
    track first, but some files open with the bass — normalized to a
    short id ('banjo', 'mandolin', ...).

    A file that does NOT lead with this site's instrument and carries
    more than one melodic track is a full arrangement rather than an
    instrument part, so it becomes 'ensemble' (the frontend shows a track
    mixer for it). A banjo-led file with guitar/bass/mandolin backup is
    still a banjo tab.
    """
    playable = []
    for track in tracks or []:
        track_id = (track.get('id') or '').lower()
        if any(track_id.startswith(u) for u in UTILITY_TRACK_IDS):
            continue
        normalized = normalize_instrument(track.get('instrument'))
        if normalized:
            playable.append(normalized)

    if not playable:
        return fallback

    melodic = [i for i in playable if i not in ACCOMPANIMENT_INSTRUMENTS]
    lead = melodic[0] if melodic else playable[0]
    if len(melodic) > 1 and lead != fallback:
        return ENSEMBLE_INSTRUMENT

    return lead
