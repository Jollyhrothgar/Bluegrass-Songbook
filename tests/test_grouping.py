"""
Tests for song grouping logic in build_works_index.py.

Covers:
- simplify_chord() helper
- compute_group_id() title-only hashing
- fuzzy_group_songs() merging and separation
"""

import pytest
from build_works_index import simplify_chord, compute_group_id, fuzzy_group_songs


class TestSimplifyChord:
    """Test the simplify_chord() helper."""

    def test_seventh_chords(self):
        assert simplify_chord('D7') == 'D'
        assert simplify_chord('Am7') == 'Am'
        assert simplify_chord('Cmaj7') == 'C'
        assert simplify_chord('Em7') == 'Em'

    def test_slash_chords(self):
        assert simplify_chord('G/B') == 'G'
        assert simplify_chord('C/E') == 'C'

    def test_sus_chords(self):
        assert simplify_chord('Gsus4') == 'G'
        assert simplify_chord('Dsus2') == 'D'

    def test_simple_chords_unchanged(self):
        assert simplify_chord('G') == 'G'
        assert simplify_chord('Am') == 'Am'
        assert simplify_chord('C') == 'C'
        assert simplify_chord('D') == 'D'

    def test_sharp_flat(self):
        assert simplify_chord('Bb7') == 'Bb'
        assert simplify_chord('F#m') == 'F#m'
        assert simplify_chord('C#dim') == 'C#dim'

    def test_dim_aug(self):
        assert simplify_chord('Bdim') == 'Bdim'
        assert simplify_chord('Caug') == 'Caug'

    def test_min_variant(self):
        assert simplify_chord('Amin') == 'Am'
        assert simplify_chord('Amin7') == 'Am'

    def test_non_chord(self):
        assert simplify_chord('N.C.') == 'N.C.'
        assert simplify_chord('') == ''


class TestComputeGroupId:
    """Test compute_group_id() produces correct groupings."""

    def test_same_title_different_artist_same_group(self):
        """Same song title by different artists should get the same base hash."""
        gid1 = compute_group_id('Roll In My Sweet Babys Arms', 'Flatt & Scruggs', 'I aint gonna work on the railroad')
        gid2 = compute_group_id('Roll In My Sweet Babys Arms', 'Various Artists', 'I aint gonna work on the railroad')
        # Same title + same lyrics -> same group_id
        assert gid1 == gid2

    def test_same_title_different_lyrics_different_group(self):
        """Same title but completely different lyrics should have different group_ids."""
        gid1 = compute_group_id('She', 'Green Day', 'She screams in silence')
        gid2 = compute_group_id('She', 'Chatham County Line', 'She walks in beauty like the night')
        assert gid1 != gid2

    def test_articles_normalized(self):
        """Articles like 'the' should not affect grouping."""
        gid1 = compute_group_id('The Girl I Left Behind Me', '', 'Same lyrics here')
        gid2 = compute_group_id('Girl I Left Behind Me', '', 'Same lyrics here')
        assert gid1 == gid2

    def test_parenthetical_suffixes_removed(self):
        """Parenthetical suffixes like (C), (D) should not affect grouping."""
        gid1 = compute_group_id('Angeline Baker (C)', '', 'Same lyrics')
        gid2 = compute_group_id('Angeline Baker (D)', '', 'Same lyrics')
        assert gid1 == gid2

    def test_filler_words_normalized_in_lyrics(self):
        """Filler words like 'well', 'oh' should not cause different lyrics hashes."""
        gid1 = compute_group_id('Test Song', '', 'Well I aint gonna work on the railroad')
        gid2 = compute_group_id('Test Song', '', 'I aint gonna work on the railroad')
        assert gid1 == gid2

    def test_contractions_normalized(self):
        """Contractions like ain't vs aint should not matter."""
        gid1 = compute_group_id('Test Song', '', "I ain't gonna work")
        gid2 = compute_group_id('Test Song', '', "I aint gonna work")
        assert gid1 == gid2


class TestFuzzyGroupSongs:
    """Test fuzzy_group_songs() merging logic."""

    def _make_song(self, title, artist='', lyrics='', first_line='', group_id=None, nashville=None):
        song = {
            'id': title.lower().replace(' ', '-'),
            'title': title,
            'artist': artist,
            'lyrics': lyrics,
            'first_line': first_line or (lyrics[:80] if lyrics else ''),
            'nashville': nashville or [],
        }
        if group_id:
            song['group_id'] = group_id
        else:
            song['group_id'] = compute_group_id(title, artist, lyrics)
        return song

    def test_same_title_different_group_ids_merged(self):
        """Songs with same normalized title but different group_ids should merge
        when lyrics are similar enough."""
        song1 = self._make_song(
            'Roll In My Sweet Babys Arms', 'Flatt & Scruggs',
            "I aint gonna work on the railroad",
        )
        song2 = self._make_song(
            'Roll In My Sweet Babys Arms', 'Various Artists',
            "Well I aint gonna work on the railroad",
        )
        # Force different group_ids to simulate the pre-fix scenario
        song2['group_id'] = 'different_' + song2['group_id']

        result = fuzzy_group_songs([song1, song2])
        assert result[0]['group_id'] == result[1]['group_id']

    def test_different_songs_same_title_not_merged(self):
        """Songs with same title but completely different lyrics should not merge."""
        song1 = self._make_song(
            'She', 'Green Day',
            'She screams in silence a sullen riot penetrating through her mind',
        )
        song2 = self._make_song(
            'She', 'Chatham County Line',
            'She walks in beauty like the night of cloudless climes',
        )

        # Start with different group_ids
        original_gid1 = song1['group_id']
        original_gid2 = song2['group_id']
        assert original_gid1 != original_gid2

        result = fuzzy_group_songs([song1, song2])
        assert result[0]['group_id'] != result[1]['group_id']

    def test_fuzzy_title_spelling_variation_merged(self):
        """Similar title spellings with similar lyrics should merge."""
        song1 = self._make_song(
            'Angelene Baker', '',
            'Angelene Baker sweet little dear how I love your company',
        )
        song2 = self._make_song(
            'Angeline Baker', '',
            'Angeline Baker sweet little dear how I love your company',
        )

        result = fuzzy_group_songs([song1, song2])
        assert result[0]['group_id'] == result[1]['group_id']

    def test_chord_overlap_lowers_lyrics_threshold(self):
        """When chords overlap significantly, lyrics threshold should be lower."""
        # Same chords but moderately different lyrics
        song1 = self._make_song(
            'My Song Title', 'Artist A',
            'These are some lyrics that tell a story about love',
            nashville=['I', 'IV', 'V'],
        )
        song2 = self._make_song(
            'My Song Title', 'Artist B',
            'Well now these are the lyrics telling about love and more',
            nashville=['I', 'IV', 'V'],
        )
        # Force different group_ids
        song2['group_id'] = 'different_' + song2['group_id']

        result = fuzzy_group_songs([song1, song2])
        assert result[0]['group_id'] == result[1]['group_id']
