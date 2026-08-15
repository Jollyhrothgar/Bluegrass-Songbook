"""Tests for the canonical bluegrass catalogue builder."""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT / 'sources' / 'bounty-hunt' / 'src'))

import build_catalogue as bc  # noqa: E402


class TestNormalize:
    def test_folds_case_accents_and_punctuation(self):
        assert bc.normalize('Señor!') == 'senor'
        assert bc.normalize('St. James Infirmary') == 'st james infirmary'

    @pytest.mark.parametrize('a,b', [
        ("Reuben's Train", 'Reuben’s Train'),      # ASCII vs curly
        ("Baby's Arms", 'Babys Arms'),                  # possessive vs plain
        ('Rockʼn Roll', "Rock'n Roll"),            # modifier letter apostrophe
    ])
    def test_apostrophe_forms_collapse_together(self, a, b):
        # Treating these differently once split one song two ways and made the
        # subtraction report songs we hold as missing.
        assert bc.normalize(a) == bc.normalize(b)

    def test_normalizes_articles_at_both_ends(self):
        assert bc.normalize('The Last Song') == bc.normalize('Last Song, The')

    def test_drops_parentheticals(self):
        assert bc.normalize('Little Maggie (Slow)') == 'little maggie'


class TestDespace:
    @pytest.mark.parametrize('a,b', [
        ('Muleskinner Blues', 'Mule Skinner Blues'),
        ('Hometown', 'Home Town'),
    ])
    def test_merges_compound_word_variants(self, a, b):
        assert bc.despace(a) == bc.despace(b)

    def test_does_not_merge_different_songs(self):
        # Removing spaces can only merge titles sharing every letter in order,
        # which is why it is safe to apply without a human.
        assert bc.despace('500 Miles') != bc.despace('900 Miles')
        assert bc.despace('Foggy Mountain Top') != bc.despace('Foggy Mountain Rock')


class TestNonSongFilter:
    @pytest.mark.parametrize('title', [
        'Intro', 'Introduction', 'Band Introductions', 'Talk', 'Tuning',
        '[unknown]', 'Untitled', 'Track 3', 'Applause',
    ])
    def test_filters_catalog_artifacts(self, title):
        assert bc.NON_SONG_RE.match(bc.normalize(title))

    @pytest.mark.parametrize('title', [
        'Blue Moon of Kentucky', 'Introduction to the Blues', 'Jam on It',
    ])
    def test_keeps_real_songs(self, title):
        assert not bc.NON_SONG_RE.match(bc.normalize(title))


class TestArtistEra:
    def test_curated_code_wins_over_year(self):
        # Bill Monroe is era 1 whatever his begin_year says.
        assert bc.artist_era('Bill Monroe', 2005, {'Bill Monroe': 4}) == 1

    @pytest.mark.parametrize('year,era', [(1938, 1), (1969, 2), (2001, 3)])
    def test_bands_by_begin_year_when_uncurated(self, year, era):
        assert bc.artist_era('Nobody', year, {}) == era

    def test_unknown_artist_defaults_to_modern(self):
        # Conservative: can only add spread to a song founding artists already
        # recorded, never invent a founding credit.
        assert bc.artist_era('Nobody', None, {}) == 3


class TestCatalogueOutput:
    """Asserted against the committed catalogue — these are the fidelity gates."""

    @pytest.fixture(scope='class')
    def songs(self):
        path = REPO_ROOT / 'docs' / 'data' / 'bluegrass_catalogue.json'
        if not path.exists():
            pytest.skip('catalogue not built')
        return json.loads(path.read_text())['songs']

    def test_reproduces_the_findings_core_count(self, songs):
        # FINDINGS.md reports Core = 637. Anything far from that means the
        # scoring drifted from the method it claims to implement.
        core = sum(1 for r in songs if r['core'])
        assert 600 <= core <= 675, f"core={core}, FINDINGS.md says 637"

    def test_contains_the_canon_findings_verified_as_absent(self, songs):
        # FINDINGS.md § 4.1 hand-checked these as canonical jam repertoire.
        by_id = {r['catalogue_id'] for r in songs}
        expected = {'cumberland-gap', 'katy-hill', 'cotton-eyed-joe',
                    'muleskinner-blues', 'jesse-james', 'bill-cheatham',
                    'rawhide', 'lee-highway-blues', 'dusty-miller',
                    'chicken-reel', 'billy-in-the-low-ground',
                    'under-the-double-eagle', 'sweet-georgia-brown'}
        assert expected <= by_id, f"missing canon: {expected - by_id}"

    def test_title_folding_reunites_split_standards(self, songs):
        # MusicBrainz splits standards across work entries; folding by title is
        # what recovers true coverage. Little Maggie was the worked example.
        maggie = next(r for r in songs if r['catalogue_id'] == 'little-maggie')
        assert maggie['coverage'] > 40
        assert maggie['title_variants']

    def test_ids_are_unique(self, songs):
        ids = [r['catalogue_id'] for r in songs]
        assert len(ids) == len(set(ids))

    def test_rows_are_sorted_by_id(self, songs):
        ids = [r['catalogue_id'] for r in songs]
        assert ids == sorted(ids), 'unsorted output is not byte-stable'

    def test_instrumentals_carry_jam_instruments(self, songs):
        for r in songs:
            if r['type'] in ('Instrumental', 'Fiddle Tune'):
                assert r['instruments'] == bc.JAM_INSTRUMENTS
            else:
                assert r['instruments'] == []

    def test_no_catalog_artifacts_survived(self, songs):
        assert not [r for r in songs if bc.NON_SONG_RE.match(bc.normalize(r['title']))]
