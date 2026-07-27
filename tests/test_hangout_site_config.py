"""Hangout Network site config + instrument resolution.

Guards the two things generalizing the Banjo Hangout pipeline can break:
banjo-hangout defaults must stay exactly as they were, and a tab's part
instrument must come from the OTF tracks (not from the site).
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / "sources" / "banjo-hangout" / "src"))

from site_config import (  # noqa: E402
    get_site,
    normalize_instrument,
    resolve_instrument,
    strip_title_decorations,
)


def track(instrument, id=None):
    return {'id': id or instrument, 'instrument': instrument}


# --- registry / paths ---

def test_default_site_is_banjo_hangout_with_original_paths():
    site = get_site()
    assert site.name == 'banjo-hangout'
    assert site.base_url == 'https://www.banjohangout.org'
    assert site.fallback_instrument == 'banjo'
    assert site.catalog_path == REPO_ROOT / 'sources/banjo-hangout/tab_catalog.json'
    assert site.downloads_dir == REPO_ROOT / 'sources/banjo-hangout/downloads'
    assert site.parsed_dir == REPO_ROOT / 'sources/banjo-hangout/parsed'
    assert site.tab_page_url('1687') == \
        'https://www.banjohangout.org/tab/browse.asp?m=detail&v=1687'


def test_sibling_sites_have_own_data_dirs_and_no_shared_keyspace():
    banjo, mando, flat = (get_site(n) for n in
                          ('banjo-hangout', 'mandolin-hangout', 'flatpicker-hangout'))
    assert mando.fallback_instrument == 'mandolin'
    assert flat.fallback_instrument == 'guitar'
    assert len({banjo.catalog_path, mando.catalog_path, flat.catalog_path}) == 3
    assert mando.data_dir == REPO_ROOT / 'sources/mandolin-hangout'


def test_site_without_domain_raises_on_urls():
    from site_config import SiteConfig
    site = SiteConfig(name='test-hangout', source='test-hangout',
                      fallback_instrument='banjo',
                      data_dir=REPO_ROOT / 'sources/test-hangout')
    assert site.base_url is None
    with pytest.raises(ValueError, match='base_url is not configured'):
        site.tab_browse_url


def test_all_registered_sites_have_domains():
    for name in ('banjo-hangout', 'mandolin-hangout', 'flatpicker-hangout',
                 'fiddle-hangout', 'reso-hangout'):
        assert get_site(name).base_url, f'{name} missing base_url'


def test_unknown_site_raises():
    with pytest.raises(ValueError, match='Unknown site'):
        get_site('ukulele-hangout')


# --- title normalization ---

def test_instrument_words_are_per_site():
    banjo = get_site('banjo-hangout').instrument_words
    mando = get_site('mandolin-hangout').instrument_words

    # A banjo scan strips "banjo" but leaves a title that means "guitar"
    assert strip_title_decorations('Salt Creek - banjo tab', banjo) == 'Salt Creek'
    assert strip_title_decorations('Cripple Creek banjo', banjo) == 'Cripple Creek'
    assert strip_title_decorations('Wildwood Flower - guitar', banjo) == \
        'Wildwood Flower - guitar'

    # ... and a mandolin scan strips mandolin/mando instead
    assert strip_title_decorations('Big Sciota mandolin tab', mando) == 'Big Sciota'
    assert strip_title_decorations('Big Sciota - mando', mando) == 'Big Sciota'


# --- instrument resolution ---

def test_normalize_instrument_maps_otf_types_to_short_ids():
    assert normalize_instrument('5-string-banjo') == 'banjo'
    assert normalize_instrument('6-string-guitar') == 'guitar'
    assert normalize_instrument('upright-bass') == 'bass'
    assert normalize_instrument('tenor-banjo') == 'tenor-banjo'
    assert normalize_instrument('4-string') is None  # unrecognized
    assert normalize_instrument(None) is None


def test_single_track_uses_the_track_instrument():
    assert resolve_instrument([track('5-string-banjo')], 'banjo') == 'banjo'
    assert resolve_instrument([track('tenor-banjo')], 'banjo') == 'tenor-banjo'
    assert resolve_instrument([track('mandolin')], 'banjo') == 'mandolin'


def test_banjo_lead_with_backup_is_still_a_banjo_tab():
    # The bulk of the Banjo Hangout corpus: melody plus guitar/bass backup
    tracks = [track('5-string-banjo'), track('6-string-guitar'),
              track('mandolin'), track('upright-bass')]
    assert resolve_instrument(tracks, 'banjo') == 'banjo'


def test_full_arrangement_that_does_not_lead_with_the_site_instrument_is_ensemble():
    tracks = [track('6-string-guitar'), track('upright-bass'),
              track('mandolin'), track('5-string-banjo')]
    assert resolve_instrument(tracks, 'banjo') == 'ensemble'
    # ... and the same file on a flatpicking site is a guitar tab
    assert resolve_instrument(tracks, 'guitar') == 'guitar'


def test_bass_only_backup_track_is_not_the_lead():
    tracks = [track('upright-bass'), track('6-string-guitar')]
    assert resolve_instrument(tracks, 'banjo') == 'guitar'
    # a genuinely bass-only file still reports bass
    assert resolve_instrument([track('upright-bass')], 'banjo') == 'bass'


def test_click_tracks_are_ignored():
    tracks = [track('5-string-banjo', id='clicks'), track('mandolin')]
    assert resolve_instrument(tracks, 'banjo') == 'mandolin'


def test_undetectable_falls_back_to_the_site_instrument():
    assert resolve_instrument([], 'mandolin') == 'mandolin'
    assert resolve_instrument([track('4-string')], 'banjo') == 'banjo'
