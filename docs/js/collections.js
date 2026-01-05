// Collection definitions for the landing page
// Each collection maps to a search query

// Pinned songs per collection - ordered by MusicBrainz recording count (popularity)
export const COLLECTION_PINS = {
    'bluegrass-standards': [
        "blue-moon-of-kentucky", "rocky-top", "foggy-mountain-breakdown",
        "roll-in-my-sweet-babys-arms", "orange-blossom-special", "uncle-pen",
        "nine-pound-hammer", "blue-ridge-cabin-home", "old-home-place"
    ],
    'all-bluegrass': [
        "blue-moon-of-kentucky", "rocky-top", "foggy-mountain-breakdown",
        "man-of-constant-sorrow", "will-the-circle-be-unbroken", "i-ll-fly-away",
        "wayfaring-stranger", "shady-grove", "cripple-creek"
    ],
    'gospel': [
        "angel-band", "i-ll-fly-away", "wayfaring-stranger",
        "i-m-working-on-a-building", "will-the-circle-be-unbroken", "amazing-grace",
        "keep-on-the-sunny-side", "in-the-sweet-by-and-by", "swing-low-sweet-chariot"
    ],
    'fiddle-tunes': [
        "salt-creek", "blackberry-blossom", "red-haired-boy",
        "old-joe-clark", "soldier-s-joy", "cripple-creek",
        "arkansas-traveler", "turkey-in-the-straw", "fire-on-the-mountain"
    ],
    'waltz': [
        "kentucky-waltz", "tennessee-waltz", "lonesome-moonlight-waltz",
        "the-alabama-waltz", "waltz-across-texas", "blue-eyes-crying-in-the-rain"
    ],
    'all-songs': []  // No pinned songs for "search all"
};

export const COLLECTIONS = [
    {
        id: 'bluegrass-standards',
        title: 'Bluegrass Standards',
        description: 'The essential songs every picker should know',
        query: 'tag:BluegrassStandard',
        image: 'images/monroe.jpg',
        color: '#2563eb'
    },
    {
        id: 'all-bluegrass',
        title: 'All Bluegrass',
        description: 'Every bluegrass song in the collection',
        query: 'tag:Bluegrass',
        image: 'images/billy.png',
        color: '#7c3aed'
    },
    {
        id: 'gospel',
        title: 'Gospel Standards',
        description: 'Timeless hymns and spirituals',
        query: 'tag:Gospel',
        image: 'images/collections/gospel.svg',
        color: '#059669'
    },
    {
        id: 'fiddle-tunes',
        title: 'Fiddle Tunes',
        description: 'Instrumentals for jams and breakdowns',
        query: 'tag:Instrumental',
        image: 'images/collections/fiddle.svg',
        color: '#dc2626'
    },
    {
        id: 'all-songs',
        title: 'Search All Songs',
        description: 'Browse the full collection of 17,000+ songs',
        query: '',
        image: 'images/collections/jam.svg',
        color: '#d97706',
        isSearchLink: true
    },
    {
        id: 'waltz',
        title: 'Waltzes',
        description: 'Songs in 3/4 time',
        query: 'tag:Waltz',
        image: 'images/collections/waltz.svg',
        color: '#0891b2'
    }
];

// Collection for the "more" section - country/old-time content
export const RELATED_COLLECTIONS = [
    {
        id: 'classic-country',
        title: 'Classic Country',
        description: 'Honky tonk, outlaw, and Nashville sound',
        query: 'tag:ClassicCountry',
        image: 'images/collections/country.svg',
        color: '#b45309'
    },
    {
        id: 'old-time',
        title: 'Old Time',
        description: 'Pre-bluegrass mountain music',
        query: 'tag:OldTime',
        image: 'images/collections/oldtime.svg',
        color: '#65a30d'
    }
];

/**
 * Get count of songs matching a collection query
 * @param {Array} allSongs - Array of all songs
 * @param {string} query - Search query
 * @param {Function} searchFn - Search function to use
 * @returns {number} Count of matching songs
 */
export function getCollectionCount(allSongs, query, searchFn) {
    if (!allSongs || !searchFn) return 0;
    const results = searchFn(query, allSongs);
    return results?.length || 0;
}
