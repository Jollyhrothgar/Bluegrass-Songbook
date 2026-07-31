"""Tests for the web-chords parser (sources/web-chords/src/parser.py).

Loaded by path because ``sources/classic-country/src/parser.py`` already owns
the top-level module name ``parser`` on the test path.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    'web_chords_parser',
    REPO_ROOT / 'sources' / 'web-chords' / 'src' / 'parser.py')
wc = importlib.util.module_from_spec(_SPEC)
sys.modules['web_chords_parser'] = wc
_SPEC.loader.exec_module(wc)


def raw(body: str, title: str = 'Movie Star',
        url: str = 'https://tabs.ultimate-guitar.com/tab/test-artist/'
                   'movie-star-chords-1') -> str:
    """Build a raw file with the fetcher's metadata header."""
    return (f'# title: {title}\n'
            f'# source_url: {url}\n'
            f'# fetched_at: 2026-02-01 00:00:00\n\n' + body)


# ---------------------------------------------------------------------------
# Chord token recognition
# ---------------------------------------------------------------------------

class TestChordTokens:
    @pytest.mark.parametrize('tok', [
        'G', 'C', 'Am', 'D7', 'F#', 'Bb', 'Gmaj7', 'Cmin', 'Asus4', 'Emadd9',
        'G/B', 'C#m7', 'Ddim', 'Aaug', 'Am7', 'E7', 'Bbmaj7', 'F#m9',
    ])
    def test_chords(self, tok):
        assert wc.is_chord_token(tok)

    @pytest.mark.parametrize('tok', [
        'Age', 'Bad', 'Amen', 'Ache', 'Dad', 'Fine', 'the', 'Chorus', 'Part',
        'x2', 'N.C.', 'Bell', 'Cabin', 'Dear', 'Gone', 'Every',
    ])
    def test_not_chords(self, tok):
        assert not wc.is_chord_token(tok)

    def test_grid_decoration_is_trimmed(self):
        assert wc.is_chord_token('|Am')
        assert wc.is_chord_token('(D)')
        assert wc.is_chord_token('G,')


class TestChordLineDetection:
    def test_plain_chord_line(self):
        assert wc.is_chord_line('G          C            D')

    def test_bar_grid_is_a_chord_line(self):
        # Pipes and repeat markers are furniture, not failed chords.
        assert wc.is_chord_line('|Am     |C     |Am  D7   |G     | x2')
        assert wc.is_chord_line('|A / / / |D / / / |A / / / |D / E A|')

    def test_lyric_line_is_not(self):
        assert not wc.is_chord_line('Come all ye fair and tender ladies')

    def test_all_caps_lyrics_are_not_chord_lines(self):
        assert not wc.is_chord_line('I CANT THINK OF ONE')
        assert not wc.is_chord_line("THERE'S A LOT OF PLACES THAT I NEED TO BE")

    def test_title_case_line_with_apostrophe_is_not(self):
        assert not wc.is_chord_line("Christmas Time's A-Comin'")

    def test_tab_line_is_not(self):
        assert not wc.is_chord_line('E-------------------0-0-2-3-0---2-0---------|')

    def test_tab_line_detection_anywhere_on_the_line(self):
        assert wc.is_tab_line('B|-----(Guitar)------------------0--1--3--1--0-----|')
        assert wc.is_tab_line('e|----------------------|  Strum D Chord')

    def test_horizontal_rule_is_not_tab(self):
        assert not wc.is_tab_line('-' * 40)


# ---------------------------------------------------------------------------
# Column mapping — the drift bug
# ---------------------------------------------------------------------------

class TestChordPlacement:
    def test_chord_over_whitespace_snaps_forward(self):
        lyric = 'I am a poor wayfaring stranger'
        assert wc.snap_to_word(lyric, 11) == 12          # space before 'wayfaring'

    def test_chord_inside_word_snaps_to_nearer_boundary(self):
        lyric = 'Far away in sunny mountains, where the merry sunbeams play,'
        # Column 26 is the final 's' of "mountains," — nearer to "where".
        assert wc.snap_to_word(lyric, 26) == 29
        # Column 19 is early in "mountains" — that word is the target.
        assert wc.snap_to_word(lyric, 19) == 18

    def test_chord_past_end_of_lyric_lands_at_end(self):
        lyric = 'Watch your step'
        assert wc.snap_to_word(lyric, 40) == len(lyric)

    def test_no_column_drift_when_chord_line_is_padded(self):
        """Chord columns map straight across, never proportionally.

        The classic-country parser scales ``col / len(chord_line)`` onto the
        lyric line; with the chord line padded well past the lyrics (the normal
        case) that drifts left. Here it would put C on "a" and D on
        "wayfaring" instead of "wayfaring" and "stranger".
        """
        chords = 'G          C            D' + ' ' * 35
        lyric = 'I am a poor wayfaring stranger'
        out = wc.render_with_chords(lyric, wc.place_chords(chords, lyric))
        assert out == '[G]I am a poor [C]wayfaring [D]stranger'

    def test_right_to_left_insertion_keeps_later_offsets_valid(self):
        chords = 'G       C       D       E'
        lyric = 'one two three four five six seven'
        out = wc.render_with_chords(lyric, wc.place_chords(chords, lyric))
        # Every chord present exactly once, and in source order.
        assert out.count('[G]') == 1 and out.count('[E]') == 1
        assert [c for c in ('G', 'C', 'D', 'E')] == \
               [t.strip('[]') for t in
                __import__('re').findall(r'\[[^\]]+\]', out)]

    def test_two_chords_on_one_word_stay_in_order(self):
        chords = 'G F#'
        lyric = 'Go'
        out = wc.render_with_chords(lyric, wc.place_chords(chords, lyric))
        assert out == '[G]Go[F#]' or out == '[G][F#]Go'

    def test_chord_only_line_renders_as_brackets(self):
        assert wc.render_chord_only('D7 G   D7 G') == '[D7] [G] [D7] [G]'

    def test_en_dash_separated_chord_run_is_a_chord_line(self):
        assert wc.is_chord_line('E – A – C#m – F#m')
        assert wc.render_chord_only('E – A – C#m – F#m') == '[E] [A] [C#m] [F#m]'


# ---------------------------------------------------------------------------
# Section markers
# ---------------------------------------------------------------------------

class TestSectionMarkers:
    @pytest.mark.parametrize('line,kind,label', [
        ('[Verse 1]', 'verse', 'Verse 1'),
        ('[Chorus]', 'chorus', 'Chorus'),
        ('[Bridge]', 'bridge', 'Bridge'),
        ('[Instrumental]', 'verse', 'Instrumental'),
        ('[Guitar Solo]', 'verse', 'Guitar Solo'),
        ('[Middle]', 'verse', 'Middle'),          # open-ended UG label
        ('(Chorus)', 'chorus', 'Chorus'),
        ('* * *  CHORUS  * * *', 'chorus', 'Chorus'),
        ('Refrain:', 'verse', 'Refrain'),
        ('#1.', 'verse', 'Verse 1'),
        ('A Part', 'verse', 'A Part'),
    ])
    def test_recognised(self, line, kind, label):
        marker = wc.detect_section_marker(line)
        assert marker is not None, line
        assert marker.kind == kind
        assert marker.label == label

    def test_marker_carrying_content(self):
        marker = wc.detect_section_marker('Intro:D G D A D G A D')
        assert marker.kind == 'verse'
        assert marker.label == 'Intro'
        assert marker.trailing == 'D G D A D G A D'

    @pytest.mark.parametrize('line', [
        'Come all ye fair and tender ladies',
        'Part of me will always love you',
        'I am weary, let me rest',
        'G          C            D',
    ])
    def test_not_a_marker(self, line):
        assert wc.detect_section_marker(line) is None

    def test_typo_tolerance(self):
        assert wc.detect_section_marker('[Intstrumental]').kind == 'verse'


# ---------------------------------------------------------------------------
# Format families, end to end
# ---------------------------------------------------------------------------

UG_BODY = """The Test Band
Movie Star

By SomeUploader


[Intro]

D7 G


[Verse 1]

G                            C
They're gonna put me in the movies
G                                     D7
they're gonna make a big star out of me


[Chorus]

       G       C
Sing it out loud
    D7       G
sing it out strong


[Verse 2]

G                                C
Well I hope you come and see me there
    D7                           G
and all I gotta do is act naturally
"""


class TestUltimateGuitarFormat:
    def setup_method(self):
        self.res = wc.parse_text(raw(UG_BODY), 'test-song.txt')

    def test_accepted(self):
        assert self.res.ok, self.res.reject_reason

    def test_preamble_dropped(self):
        text = wc.to_chordpro(self.res)
        assert 'SomeUploader' not in text
        assert 'The Test Band' not in text

    def test_sections(self):
        labels = [(s.kind, s.label) for s in self.res.sections]
        assert labels == [
            ('verse', 'Intro'),
            ('verse', 'Verse 1'),
            ('chorus', None),
            ('verse', 'Verse 2'),
        ]

    def test_chord_alignment(self):
        verse = self.res.sections[1]
        assert verse.lines[0] == "[G]They're gonna put me in the [C]movies"

    def test_metadata_block(self):
        text = wc.to_chordpro(self.res)
        assert '{meta: title Movie Star}' in text
        assert '{meta: artist Test Artist}' in text
        assert '{meta: x_source web-chords}' in text
        assert '{meta: x_source_file test-song.txt}' in text
        assert '{meta: x_source_url https://tabs.ultimate-guitar.com/' in text


ECHORDS_BODY = """Intro:D G D A D G A D

D                         G           D                                        A
Far away in sunny mountains, where the merry sunbeams play,
D                             G        A                     D
there I wandered thru the clover, singing to a village maid.

( D G D A D G A D )

D                             G       D                              A
Fate decreed that we be parted, ere the leaves of autumn fell,
D                             G       A                              D
then two hearts were separated that had loved each other well.
"""


class TestEChordsFormat:
    def setup_method(self):
        self.res = wc.parse_text(
            raw(ECHORDS_BODY, title='Amber Tresses Tied in Blue Flatt & Scruggs',
                url='https://www.e-chords.com/chords/the-carter-family/'
                    'amber-tresses-tied-in-blue'),
            'amber.txt')

    def test_accepted(self):
        assert self.res.ok, self.res.reject_reason

    def test_blank_lines_separate_stanzas_when_labels_are_incidental(self):
        """One "Intro:" label must not swallow the whole song."""
        labels = [(s.kind, s.label) for s in self.res.sections]
        assert labels == [
            ('verse', 'Intro'),
            ('verse', 'Verse 1'),
            ('verse', 'Instrumental'),   # the ( D G D A D ) turnaround
            ('verse', 'Verse 2'),
        ]

    def test_catalogue_attribution_stripped_from_title(self):
        assert self.res.title == 'Amber Tresses Tied in Blue'
        assert self.res.artist == 'The Carter Family'

    def test_alignment_across_a_wide_chord_line(self):
        assert self.res.sections[1].lines[0] == (
            '[D]Far away in sunny mountains, [G]where the '
            '[D]merry sunbeams play,[A]')


ALLCAPS_BODY = """I CAN'T THINK OF ONE
SONNY BURGESS

E
THERE MUST BE A HUNDRED MILLION DIFFERENT REASONS WHY
                                         A
STAYIN HERE LOVIN YOU CANT BE RIGHT, BUT TONIGHT
       E
I CANT THINK OF ONE

      C#m                     A
I CAN COME UP WITH A MILLION, FEELINS THAT IM FEELIN
  E
I WANNA DO WITH YOU TONIGHT
"""


class TestAllCapsFormat:
    def setup_method(self):
        self.res = wc.parse_text(
            raw(ALLCAPS_BODY, title="I Can't Think of One",
                url='https://www.cowboylyrics.com/tabs/burgess-sonny/'
                    'i-cant-think-of-one-27672.html'),
            'i-can-t-think-of-one.txt')

    def test_accepted(self):
        assert self.res.ok, self.res.reject_reason

    def test_shouted_lyrics_are_not_mistaken_for_chords(self):
        line = self.res.sections[0].lines[0]
        assert line.startswith('[E]THERE MUST BE')

    def test_uppercase_lyrics_do_not_trip_the_validity_gate(self):
        assert self.res.stats['chord_token_validity'] >= 0.9

    def test_no_artist_guessed_from_lastname_first_slug(self):
        # cowboylyrics uses "burgess-sonny"; reversing it is not safe, so we
        # decline to name an artist rather than inventing "Burgess Sonny".
        assert self.res.artist is None


INLINE_BODY = """(No Capo)

Intro.:  |(A) |(A) |(D) |(D) |

I'm (A)dreaming now of (D)Halley, sweet (A)Halley, my sweet (D)Halley
She's (A)sleeping now in the (D)valley, in the (A)valley, my sweet (D)Hally

(Chorus)
Listen to the (A)mockingbird, listen to the (D)mockingbird
Still (G)singing where the (A)weeping willow (D)waves
"""


class TestInlineChordFormat:
    def setup_method(self):
        self.res = wc.parse_text(
            raw(INLINE_BODY, title='Listen to the Mockingbird',
                url='https://www.cowboylyrics.com/tabs/parton-dolly/'
                    'listen-to-the-mockingbird-30336.html'),
            'listen.txt')

    def test_accepted(self):
        assert self.res.ok, self.res.reject_reason

    def test_parenthesised_chords_become_chordpro(self):
        assert self.res.sections[-1].lines[0] == (
            'Listen to the [A]mockingbird, listen to the [D]mockingbird')

    def test_chorus_detected(self):
        assert self.res.sections[-1].kind == 'chorus'

    def test_space_after_an_inline_chord_is_closed_up(self):
        res = wc.parse_text(raw(DOUBLE_SPACED_BODY, title='Forty Miles',
                                url='https://www.cowboylyrics.com/tabs/x/'
                                    'forty-miles-968.html'), 'forty.txt')
        assert res.ok, res.reject_reason
        assert res.sections[0].lines[0].startswith('[G]I NEVER HAD')

    def test_chord_only_run_keeps_its_spacing(self):
        assert wc._normalize_inline('|(A) |(A) |(D) |(D) |') == '[A] [A] [D] [D]'


# A page that puts a blank line between every lyric line (cowboylyrics does
# this) must not turn each line into its own one-line verse.
DOUBLE_SPACED_BODY = """(G) I NEVER HAD A PAIR OF SHOES, THAT WERN'T OLD HAND ME (C) DOWNS,

AND DADDY'S MORNIN' (G) COFFEE, CAME FROM OLD LEFT OVER (D7)GROUNDS,

MY (G) MAMA WORE NO JEWELRY, OR ANY STORE BOUGHT (C) STUFF,

'CAUSE HOME WAS JUST A (D7) HILLSIDE, FORTY MILES FROM POPLAR (G) BLUFF.


* * *  CHORUS  * * *

FORTY (D7) MILES BACK IN MISSOURI,

THERE'S A (C) DIFFERENT WAY OF (G) LIFE,

WHERE A (D7) MAN THINKS OF HIS NEIGHBOR,

AND (C) NOT HIS NEIGHBOR'S (D7) WIFE,
"""


class TestDoubleSpacedLyrics:
    def setup_method(self):
        self.res = wc.parse_text(
            raw(DOUBLE_SPACED_BODY, title='Forty Miles',
                url='https://www.cowboylyrics.com/tabs/x/forty-miles-968.html'),
            'forty.txt')

    def test_accepted(self):
        assert self.res.ok, self.res.reject_reason

    def test_single_blanks_do_not_split_every_line_into_a_verse(self):
        labels = [(s.kind, s.label) for s in self.res.sections]
        assert labels == [('verse', 'Verse 1'), ('chorus', None)]
        assert len(self.res.sections[0].lines) == 4
        assert len(self.res.sections[1].lines) == 4


class TestPreambleProse:
    def test_leading_prose_and_credits_dropped(self):
        body = ("Here's one that Porter and Dolly got a lot of \"Miles\" out "
                'of. This is the\nwork of Tim Ausburn.\n\n'
                'FORTY MILES FROM POPLAR BLUFF   Writers, Frank Dycus\n\n'
                'Key of G\n\n' + DOUBLE_SPACED_BODY)
        res = wc.parse_text(
            raw(body, title='Forty Miles',
                url='https://www.cowboylyrics.com/tabs/x/forty-miles-968.html'),
            'forty.txt')
        text = wc.to_chordpro(res)
        assert 'Tim Ausburn' not in text
        assert 'Writers' not in text
        assert '{key: G}' in text
        assert res.sections[0].lines[0].startswith('[G]I NEVER HAD')


AZCHORDS_BODY = """Candy Girl:Four Seasons.

INTRO:
F                              Dm                    Gm7
I've been a-searchin' all this whole wide world..now finally

#1.
F Am    Gm7 C7         F      Am    Gm7  C7
I.yi.yi.yi, found me a girl..(Candy Girl.)
F   Am    Gm7 C7              F       Am    Gm7  C7
She-ee-ee-ee, sets my heart a-whirl..(Candy Girl.)

CHORUS:
Gm7        C7    F     Dm  Gm7      C7               F   Dm
When we're out together....everyone knows the way we feel.
"""


class TestAzChordsFormat:
    def setup_method(self):
        self.res = wc.parse_text(
            raw(AZCHORDS_BODY, title='Candy Girl',
                url='https://www.azchords.com/f/fourseasons-tabs-5113/'
                    'candygirl-tabs-397054.html'),
            'candy-girl.txt')

    def test_accepted(self):
        assert self.res.ok, self.res.reject_reason

    def test_hash_numbered_verse_and_colon_chorus(self):
        labels = [(s.kind, s.label) for s in self.res.sections]
        assert ('verse', 'Intro') in labels
        assert ('verse', 'Verse 1') in labels
        assert ('chorus', None) in labels


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------

class TestCleaning:
    def test_ug_please_note_banner_removed(self):
        body = ('#---------------PLEASE NOTE------------------#\n'
                "#This file is the author's own work.        #\n"
                '#-------------------------------------------#\n'
                'From: Glenn Estes\n'
                ' \n'
                ' G   F#   F      E\n'
                'You ought to see Deacon Jones\n')
        cleaned = wc.clean_body(body)
        assert not any('PLEASE NOTE' in ln for ln in cleaned.lines)
        assert not any('Glenn Estes' in ln for ln in cleaned.lines)
        assert any('Deacon Jones' in ln for ln in cleaned.lines)

    def test_hide_ad_debris_removed(self):
        cleaned = wc.clean_body('G\nBlue railroad train\n\n    hide ad ⨯\n\nG\nmore\n')
        assert not any('hide ad' in ln for ln in cleaned.lines)

    def test_tablature_block_removed_and_counted(self):
        body = ('G\nBlue railroad train\n'
                '-9------9-----9-----9-----9-------12-12-14-15-14-12-11-10-9--\n'
                '-8---11------------------------------------------------------\n')
        cleaned = wc.clean_body(body)
        assert cleaned.tab_lines == 2
        assert any('railroad' in ln for ln in cleaned.lines)

    def test_chord_diagram_lines_removed(self):
        cleaned = wc.clean_body('A/E:  020001\nE5:   000203\nG\nsing along\n')
        assert not any('020001' in ln for ln in cleaned.lines)

    def test_key_and_capo_harvested(self):
        cleaned = wc.clean_body('Key of G\n*Capo 3rd fret\nG\nsing along\n')
        assert cleaned.key == 'G'
        assert cleaned.capo == '3rd fret'
        assert not any('Capo' in ln for ln in cleaned.lines)

    def test_footer_after_a_long_rule_dropped(self):
        body = ('G\nsing along now\n' + 'x\n' * 3 +
                '-' * 40 + '\n                Glenn Estes\n'
                'My opinions do not reflect those of my employer.\n')
        cleaned = wc.clean_body(body)
        assert not any('Glenn Estes' in ln for ln in cleaned.lines)

    def test_chart_commentary_is_not_lyrics(self):
        assert wc.is_chart_prose('These Are The Guitar Chords For:')
        assert wc.is_chart_prose('| / / / | = 1 Measure')
        assert wc.is_chart_prose('G  = A')
        assert wc.is_chart_prose('4beats 4beats')
        assert not wc.is_chart_prose('Blue moon of Kentucky keep on shining')


# ---------------------------------------------------------------------------
# Title / artist derivation
# ---------------------------------------------------------------------------

class TestTitleArtist:
    def test_artist_from_ug_slug(self):
        v = wc.derive_title_artist(
            'Act Naturally',
            'https://tabs.ultimate-guitar.com/tab/the-beatles/'
            'act-naturally-chords-816028')
        assert v.title == 'Act Naturally'
        assert v.artist == 'The Beatles'
        assert v.verified

    def test_generic_artist_slug_yields_no_artist(self):
        v = wc.derive_title_artist(
            'Alabama Jubilee',
            'https://tabs.ultimate-guitar.com/tab/misc-traditional/'
            'alabama-jubilee-chords-7330')
        assert v.artist is None

    def test_artist_suffix_stripped_from_catalogue_title(self):
        v = wc.derive_title_artist(
            'Age Bluegrass Album Band',
            'https://tabs.ultimate-guitar.com/tab/the-bluegrass-album-band/'
            'age-chords-1')
        assert v.title == 'Age'
        assert v.artist == 'The Bluegrass Album Band'
        assert v.verified

    def test_arrangement_modifier_stripped(self):
        v = wc.derive_title_artist(
            'Ida Red with 4 chords',
            'https://tabs.ultimate-guitar.com/tab/bob-wills/ida-red-chords-1')
        assert v.title == 'Ida Red'
        assert v.verified

    def test_apostrophes_do_not_break_verification(self):
        for title, slug in [
            ("Don't Think Twice, It's All Right", 'dont-think-twice-its-all-right'),
            ("I've Endured", 'ive-endured'),
            ('Good Night Irene', 'goodnight-irene'),
            ('Ground Hog modal version', 'groundhog'),
        ]:
            v = wc.derive_title_artist(
                title, f'https://tabs.ultimate-guitar.com/tab/x/{slug}-chords-1')
            assert v.verified, (title, slug, v.detail)

    def test_catalogue_prefix_accepted(self):
        v = wc.derive_title_artist(
            'Going Across the Sea',
            'https://tabs.ultimate-guitar.com/tab/x/across-the-sea-chords-1')
        assert v.verified

    @pytest.mark.parametrize('title,slug', [
        ('Brushy Run', 'run'),                       # search returned "Run"
        ('Lazy Kate', 'the-lazy-song'),
        ('Little Pink', 'pink-houses'),
        ('Jimmy Shank', 'sugar-shack'),
        ('Cheyenne', 'i-can-still-make-cheyenne'),
        ("I Don't Love Nobody", 'love-dont-love-nobody'),
        ('Blue Moon of Kentucky waltz version', 'kentucky-waltz'),
        ('Maytime Swing', 'swing-swing'),
        # Same-title-plus-a-word: the page is a different song, not the
        # catalogue's song with an attribution appended.
        ('Box Elder Beetles', 'box-elder'),          # Pavement's "Box Elder"
        ('Crazy Finger Blues', 'crazy-fingers'),     # Grateful Dead
        ('Make a Little Boat', 'make-a-little'),     # Midland
        ('Going Down to Cairo', 'going-down'),       # Freddie King
        ('Black Velvet Waltz', 'black-velvet'),      # Alannah Myles
        ('Hound Dog Blues', 'hound-dog'),            # Elvis
    ])
    def test_wrong_song_rejected(self, title, slug):
        v = wc.derive_title_artist(
            title, f'https://tabs.ultimate-guitar.com/tab/x/{slug}-chords-1')
        assert not v.verified, f'{title} vs {slug} should not verify'

    def test_split_never_lands_on_a_dangling_function_word(self):
        """"Charlie Brooks" + "and Nellie Adair" is one title, not two."""
        v = wc.derive_title_artist(
            'Charlie Brooks and Nellie Adair',
            'https://tabs.ultimate-guitar.com/tab/the-carter-family/'
            'charlie-brooks-chords-4051819')
        assert v.title == 'Charlie Brooks and Nellie Adair'

    def test_page_truncated_title_does_not_shorten_ours(self):
        v = wc.derive_title_artist(
            'Bring Back My Blue Eyed Boy to Me',
            'https://www.e-chords.com/chords/the-carter-family/'
            'bring-back-my-blue-eyed-boy')
        assert v.verified
        assert v.title == 'Bring Back My Blue Eyed Boy to Me'

    def test_shortening_a_title_to_match_the_slug_is_not_evidence(self):
        """The prefix strip must not manufacture its own corroboration.

        "Big Country Jimmy Martin" shortened to "Big Country" matches the page
        slug "in-a-big-country" perfectly — but the page is the Scottish band
        Big Country, not Jimmy Martin's bluegrass tune.
        """
        v = wc.derive_title_artist(
            'Big Country Jimmy Martin',
            'https://tabs.ultimate-guitar.com/tab/big-country/'
            'in-a-big-country-chords-1711409')
        assert not v.verified

    @pytest.mark.parametrize('title,slug', [
        ('Fox on the Run Bill Emerson', 'fox-on-the-run'),
        ('Black Diamond Don Stover', 'black-diamond'),
        ('Big Sciota C to Em version', 'big-sciota'),
        ('Happy Birthday fast bluegrass version', 'happy-birthday'),
        ('Little Sadie Tony Rice&#39;s version', 'little-sadie'),
    ])
    def test_catalogue_appended_attribution_accepted(self, title, slug):
        """The page title being a prefix of the catalogue's is real evidence."""
        v = wc.derive_title_artist(
            title, f'https://tabs.ultimate-guitar.com/tab/x/{slug}-chords-1')
        assert v.verified, v.detail

    def test_trailing_article_moved_to_the_front(self):
        v = wc.derive_title_artist(
            'Cuckoo, The',
            'https://tabs.ultimate-guitar.com/tab/x/the-cuckoo-chords-1')
        assert v.title == 'The Cuckoo'
        assert v.verified

    def test_url_without_a_title_slug_is_unverifiable_not_rejected(self):
        v = wc.derive_title_artist(
            'El Cumbanchero', 'https://tabs.ultimate-guitar.com/tab/1663593')
        assert v.verified and not v.checkable


# ---------------------------------------------------------------------------
# Quality gate
# ---------------------------------------------------------------------------

class TestQualityGate:
    def test_title_mismatch_rejected(self):
        res = wc.parse_text(
            raw(UG_BODY, title='Brushy Run',
                url='https://tabs.ultimate-guitar.com/tab/snow-patrol/'
                    'run-chords-106502'),
            'brushy-run.txt')
        assert not res.ok
        assert res.reject_reason == 'title-mismatch'

    def test_lyrics_only_rejected(self):
        body = ('Come all ye fair and tender ladies\n'
                'Take warning how you court young men\n'
                "They're like a star on a summer's morning\n"
                'They first appear and then they are gone\n')
        res = wc.parse_text(raw(body), 'lyrics-only.txt')
        assert not res.ok
        assert res.reject_reason == 'no-chords'

    def test_tab_only_rejected(self):
        body = '\n'.join(
            'E-------------------0-0-2-3-0---2-0----------------------|'
            for _ in range(8))
        res = wc.parse_text(raw(body), 'tab-only.txt')
        assert not res.ok
        assert res.reject_reason == 'tab-only'

    def test_navigation_debris_rejected(self):
        body = ('Search\nMenu\nHome\nSign in\nRegister\n'
                'Privacy Policy\nTerms of Use\nAll Rights Reserved\n')
        res = wc.parse_text(raw(body), 'debris.txt')
        assert not res.ok
        assert res.reject_reason == 'navigation-debris'

    def test_low_chord_validity_rejected(self):
        # Nashville numbers and fretboard letters in the chord slot.
        body = '\n'.join(
            f'I     IV        V       vi     bVII    ii\n'
            f'Line number {i} of the song goes right here now'
            for i in range(6))
        res = wc.parse_text(raw(body.replace('I  ', 'A  ', 1)), 'nashville.txt')
        assert not res.ok
        assert res.reject_reason in ('low-chord-validity', 'no-chords')

    def test_chord_grid_without_lyrics_rejected(self):
        body = ('A Part\n'
                '|A / / / |D / / / |A / / / |D / E A|\n'
                '\nB Part\n'
                '|A D E A |A D A E |A D E A |A D E A|\n')
        res = wc.parse_text(raw(body, title='Bill Cheatham',
                                url='https://tabs.ultimate-guitar.com/tab/'
                                    'misc-traditional/bill-cheatham-chords-1'),
                            'bill-cheatham.txt')
        assert not res.ok
        assert res.reject_reason == 'no-lyrics-instrumental'

    def test_good_file_passes(self):
        res = wc.parse_text(raw(UG_BODY), 'ok.txt')
        assert res.ok
        assert res.chord_count > 0
        assert res.lyric_line_count >= wc.MIN_LYRIC_LINES


# ---------------------------------------------------------------------------
# ChordPro output is consumable by the index builder
# ---------------------------------------------------------------------------

class TestChordProOutput:
    def test_parses_with_the_index_builder(self):
        sys.path.insert(0, str(REPO_ROOT / 'scripts' / 'lib'))
        from build_works_index import parse_chordpro_content

        res = wc.parse_text(raw(UG_BODY), 'ok.txt')
        parsed = parse_chordpro_content(wc.to_chordpro(res))
        assert parsed['chords']
        assert 'gonna put me in the movies' in parsed['lyrics']

    def test_sections_are_balanced(self):
        text = wc.to_chordpro(wc.parse_text(raw(UG_BODY), 'ok.txt'))
        starts = text.count('{start_of_')
        ends = text.count('{end_of_')
        assert starts == ends > 0

    def test_only_renderable_section_types_emitted(self):
        # docs/js/renderers/chordpro.js understands verse|chorus|bridge only.
        text = wc.to_chordpro(wc.parse_text(raw(UG_BODY), 'ok.txt'))
        import re as _re
        for kind in _re.findall(r'\{start_of_(\w+)', text):
            assert kind in ('verse', 'chorus', 'bridge')
