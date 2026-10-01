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
    'all-songs': [],  // No pinned songs for "search all"
    'bluegrass-dungeon': []  // The dungeon has no pins — it's an archive browse
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
        description: 'Browse the full jam collection',
        query: '',
        image: 'images/collections/jam.svg',
        color: '#d97706',
        isSearchLink: true
    },
    {
        id: 'bluegrass-dungeon',
        title: 'The Bluegrass Dungeon',
        description: "16,000+ songs that didn't make the book",
        query: '',
        image: 'images/bluegrass_dungeon.png',
        color: '#7f1d1d',
        isDungeonLink: true
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

/**
 * 160px-wide WebP thumbnails (2x of the 80px card slot) for the landing-page
 * cards. Originals stay in images/ for larger uses. w/h are the thumbnail's
 * intrinsic size so the browser can reserve layout space.
 */
export const COLLECTION_THUMBNAILS = {
    'bluegrass-standards': { src: 'images/Scruggs-160.webp', w: 160, h: 205 },
    'all-bluegrass': { src: 'images/billy-160.webp', w: 160, h: 163 },
    'gospel': { src: 'images/jimmy_martin_gospel-160.webp', w: 160, h: 160 },
    'fiddle-tunes': { src: 'images/fiddle_tunes-160.webp', w: 160, h: 143 },
    'all-songs': { src: 'images/jam_friendly-160.webp', w: 160, h: 162 },
    'bluegrass-dungeon': { src: 'images/bluegrass_dungeon-160.webp', w: 160, h: 160 }
};

/**
 * Build the <img> markup for a collection card thumbnail, or '' if none.
 * @param {string} id - Collection id
 * @param {string} alt - Already-escaped alt text
 */
export function collectionThumbnailHtml(id, alt) {
    const t = COLLECTION_THUMBNAILS[id];
    if (!t) return '';
    return `<img src="${t.src}" alt="${alt}" width="${t.w}" height="${t.h}" loading="lazy" decoding="async">`;
}
