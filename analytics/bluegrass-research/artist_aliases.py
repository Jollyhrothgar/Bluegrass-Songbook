"""
Artist name normalization and alias mapping for bluegrass tagging.

This module provides:
1. ARTIST_ALIASES - Maps variant names to canonical names
2. CANONICAL_BLUEGRASS_ARTISTS - Authoritative bluegrass artists
3. BLUEGRASS_ALBUMS - Album-specific bluegrass tagging for edge cases
4. normalize_artist() - Normalizes artist names for matching
"""

# =============================================================================
# Artist Aliases: Map variant spellings to canonical names
# =============================================================================

ARTIST_ALIASES = {
    # Flatt & Scruggs variants
    'Earl Scruggs and Lester Flatt': 'Flatt & Scruggs',
    'Lester Flatt and Earl Scruggs': 'Flatt & Scruggs',
    'Lester Flatt and Earl Scuggs': 'Flatt & Scruggs',  # typo
    'Flatt and Scruggs': 'Flatt & Scruggs',
    'Lester Flatt, Earl Scruggs, Everett Lilly': 'Flatt & Scruggs',

    # Stanley Brothers variants
    'Stanley Brothers': 'The Stanley Brothers',
    'the Stanley Brothers': 'The Stanley Brothers',

    # J.D. Crowe variants
    'J.D. Crowe and the New South': 'J.D. Crowe & the New South',
    'J.D. Crowe, Doyle Lawson, Paul Williams': 'J.D. Crowe',

    # Reno & Smiley variants
    'Don Reno and Red Smiley': 'Reno & Smiley',
    'Reno and Smiley': 'Reno & Smiley',

    # Osborne Brothers variants
    'The Osborne Brothers': 'Osborne Brothers',
    'Mac Wiseman and The Osborne Brothers': 'Osborne Brothers',

    # Del McCoury variants
    'Del McCoury': 'The Del McCoury Band',
    'The McCoury Brothers': 'The Del McCoury Band',

    # Seldom Scene variants
    'The Seldom Scene': 'Seldom Scene',
    'Seldom Scene': 'Seldom Scene',

    # Lonesome River Band variants
    'The Lonesome River Band': 'Lonesome River Band',

    # Louvin Brothers variants
    'the Louvin Brothers': 'The Louvin Brothers',
    'Louvin Brothers': 'The Louvin Brothers',

    # Reno Brothers variants
    'The Reno Brothers': 'Reno Brothers',

    # Nitty Gritty Dirt Band variants
    'the Nitty Gritty Dirt Band': 'Nitty Gritty Dirt Band',

    # Bill Monroe variants
    'Bill Monroe and the Bluegrass Boys': 'Bill Monroe',
    'Bill Monroe & His Blue Grass Boys': 'Bill Monroe',

    # Doc Watson variants (none found but adding for completeness)
    'Doc Watson': 'Doc Watson',

    # Typos and case issues
    'JImmy Rodgers': 'Jimmy Rodgers',
    'KItty Wells': 'Kitty Wells',
}


# =============================================================================
# Canonical Bluegrass Artists: Always tag as Bluegrass
# =============================================================================

CANONICAL_BLUEGRASS_ARTISTS = {
    # First Generation (1945-1960) - The Founding Fathers
    'Bill Monroe',
    'Flatt & Scruggs',
    'Lester Flatt',
    'Earl Scruggs',
    'The Stanley Brothers',
    'Ralph Stanley',
    'Carter Stanley',
    'Jimmy Martin',
    'Jim & Jesse',
    'Jim and Jesse',
    'Don Reno',
    'Reno & Smiley',
    'Osborne Brothers',
    'The Louvin Brothers',
    'Charlie Monroe',

    # Folk Revival (1960s)
    'Doc Watson',
    'The Country Gentlemen',
    'Country Gentlemen',
    'The Kentucky Colonels',
    'Bill Keith',
    'Clarence White',

    # Festival/Newgrass (1970s)
    'Tony Rice',
    'J.D. Crowe',
    'J.D. Crowe & the New South',
    'Seldom Scene',
    'New Grass Revival',
    'Sam Bush',
    'John Hartford',
    'Norman Blake',
    'Vassar Clements',

    # New Traditionalists (1980s)
    'Ricky Skaggs',
    'The Del McCoury Band',
    'Keith Whitley',
    'Doyle Lawson',
    'Doyle Lawson & Quicksilver',
    'Hot Rize',
    'IIIrd Tyme Out',

    # Modern Era
    'Alison Krauss',
    'Alison Krauss & Union Station',
    'Billy Strings',
    'Molly Tuttle',
    'Chris Thile',
    'Punch Brothers',
    'Nickel Creek',
    'Béla Fleck',
    'Bela Fleck',
    'Noam Pikelny',
    'Michael Cleveland',
    'Tony Trischka',
    'Blue Highway',
    'The Infamous Stringdusters',
    'Greensky Bluegrass',
    'Trampled by Turtles',
    'The Steeldrivers',
    'Sierra Hull',
    'Lonesome River Band',
    'The Grascals',
    'The Gibson Brothers',
    'Dailey & Vincent',
    'Mountain Heart',
    'Authentic Unlimited',
    'Reno Brothers',

    # Also from index analysis
    'Don Reno and Bill Harrell',
    'Flatt Lonesome',
    'Ralph Stanley II',
    'Ronnie Reno',
    'Josh Turner and Ralph Stanley',
    'George Jones and Ricky Skaggs',
}


# =============================================================================
# Bluegrass Albums: For artists who aren't 100% bluegrass
# =============================================================================

# Artists with mixed catalogs - only tag specific songs as bluegrass
BLUEGRASS_ALBUMS = {
    'Dolly Parton': {
        'albums': ['The Grass Is Blue', 'Little Sparrow', 'Halos & Horns'],
        'songs': {
            # The Grass Is Blue (1999)
            'a few old memories', 'cash on the barrelhead', 'endless stream of tears',
            'i am ready', 'silver dagger', 'i still miss someone', 'travelin prayer',
            'i wonder where you are tonight', 'the grass is blue', 'steady as the rain',
            'a tender lie', 'will he be waiting for me',
            # Little Sparrow (2001)
            'little sparrow', 'mountain angel', 'bluer pastures', 'my blue tears',
            'seven bridges road', 'down from dover', 'marry me', 'shine',
            'the beautiful lie', 'i get a kick out of you', 'in the sweet by and by',
            # Halos & Horns (2002)
            'halos and horns', 'halos & horns', 'dagger through the heart',
            'hello god', 'if only', 'im gone', 'john daniel', 'not for me',
            'raven dove', 'shattered image', 'stairway to heaven', 'sugar hill',
            'these old bones', 'what a heartache',
        }
    },
    'Emmylou Harris': {
        'albums': ['Roses in the Snow'],
        'songs': {
            'roses in the snow', 'wayfaring stranger', 'green pastures',
            'the boxer', 'darkest hour is just before dawn', 'i\'ll go stepping too',
            'jordan', 'miss the mississippi', 'you\'re learning', 'gold watch and chain',
        }
    },
    'Vince Gill': {
        # Vince has bluegrass roots but also pop country
        'albums': ['High Lonesome Sound', 'Down to My Last Bad Habit'],
        'songs': {
            'high lonesome sound', 'one more last chance', 'worlds apart',
        }
    },
}


# =============================================================================
# Bluegrass Composers: Songs written by these composers should be flagged
# =============================================================================

BLUEGRASS_COMPOSERS = {
    'Bill Monroe',
    'Earl Scruggs',
    'Lester Flatt',
    'Ralph Stanley',
    'Carter Stanley',
    'Jimmy Martin',
    'Don Reno',
    'Red Smiley',
    'A.P. Carter',
    'Maybelle Carter',
    'Sara Carter',
    'Hazel Dickens',
    'Alice Gerrard',
}


# =============================================================================
# Helper Functions
# =============================================================================

def normalize_artist(artist: str) -> str:
    """Normalize artist name for matching."""
    # Apply alias mapping first
    if artist in ARTIST_ALIASES:
        artist = ARTIST_ALIASES[artist]
    return artist


def is_bluegrass_artist(artist: str) -> bool:
    """Check if artist is a canonical bluegrass artist."""
    normalized = normalize_artist(artist)
    return normalized in CANONICAL_BLUEGRASS_ARTISTS


def is_bluegrass_song_by_album(artist: str, title: str) -> bool:
    """Check if song is from a bluegrass album (for edge-case artists)."""
    if artist not in BLUEGRASS_ALBUMS:
        return False

    album_data = BLUEGRASS_ALBUMS[artist]
    title_lower = title.lower().strip()

    # Check if song title matches known bluegrass songs
    return title_lower in album_data['songs']


def is_bluegrass_composer(composer: str) -> bool:
    """Check if composer is a known bluegrass composer."""
    if not composer:
        return False
    # Check if any bluegrass composer name appears in the composer field
    composer_lower = composer.lower()
    return any(bg.lower() in composer_lower for bg in BLUEGRASS_COMPOSERS)


def get_bluegrass_status(artist: str, title: str, composer: str = None) -> dict:
    """Get comprehensive bluegrass status for a song.

    Returns:
        {
            'is_bluegrass': bool,
            'reason': str,
            'confidence': 'high' | 'medium' | 'low'
        }
    """
    normalized_artist = normalize_artist(artist)

    # Check 1: Canonical bluegrass artist
    if normalized_artist in CANONICAL_BLUEGRASS_ARTISTS:
        return {
            'is_bluegrass': True,
            'reason': 'canonical_artist',
            'confidence': 'high'
        }

    # Check 2: Song from bluegrass album (edge cases like Dolly)
    if is_bluegrass_song_by_album(artist, title):
        return {
            'is_bluegrass': True,
            'reason': 'bluegrass_album',
            'confidence': 'high'
        }

    # Check 3: Bluegrass composer
    if composer and is_bluegrass_composer(composer):
        return {
            'is_bluegrass': True,
            'reason': 'bluegrass_composer',
            'confidence': 'medium'
        }

    return {
        'is_bluegrass': False,
        'reason': None,
        'confidence': None
    }


if __name__ == '__main__':
    # Test examples
    test_cases = [
        ('Bill Monroe', 'Blue Moon of Kentucky', None),
        ('Earl Scruggs and Lester Flatt', 'Foggy Mountain Breakdown', None),
        ('Dolly Parton', 'The Grass Is Blue', None),
        ('Dolly Parton', 'Jolene', None),
        ('Patsy Cline', 'Blue Moon of Kentucky', 'Bill Monroe'),
        ('George Jones', 'White Lightning', None),
    ]

    print('BLUEGRASS STATUS TEST')
    print('=' * 70)
    for artist, title, composer in test_cases:
        status = get_bluegrass_status(artist, title, composer)
        mark = '✓' if status['is_bluegrass'] else '✗'
        print(f"{mark} {artist} - {title}")
        if status['is_bluegrass']:
            print(f"   Reason: {status['reason']}, Confidence: {status['confidence']}")
