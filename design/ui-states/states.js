// The UI state inventory: every screen worth workshopping, as data.
//
// A state is a URL plus whatever has to be true before that URL shows the
// thing (seeded localStorage, a mocked backend answer, a click or two).
// `capture.js` turns each one into four screenshots (phone / desktop, light /
// dark) and can also open one in a real window (`--open <id>`).
//
// Existing states drive the real app. Proposed states (`proposed: true`) are
// static mockups in ./proposed/, for features that do not exist yet (fix-it
// list tier D); they are drawn with the app's own stylesheet tokens.
//
// Fields:
//   id        stable name; also the screenshot file stem
//   group     section in the README and gallery
//   title     what the state is
//   url       hash route (existing) or file under ./proposed/ (proposed)
//   seed      localStorage entries to set before the first load
//   mock      options for e2e/helpers/supabase-mock.js (default: signed out)
//   ready     selector that means "the state has rendered"
//   setup     async (page, { phone }) => {}: clicks needed after `ready`
//   workshop  fix-it list items this state is the evidence for

// ── seed data ──────────────────────────────────────────────────────────

const JAM_LIST_ID = 'local_ui_state_jam';
const PRACTICE_LIST_ID = 'local_ui_state_practice';
const GOSPEL_LIST_ID = 'local_ui_state_gospel';
const SHARED_LIST_ID = '11111111-1111-4111-8111-111111111111';

const LISTS = [
    {
        id: 'favorites',
        name: 'Favorites',
        songs: ['old-home-place', 'wagon-wheel', 'foggy-mountain-breakdown'],
        songMetadata: {},
        cloudId: null,
    },
    {
        id: JAM_LIST_ID,
        name: 'Friday Jam, Oct 3',
        songs: [
            'old-home-place',
            'foggy-mountain-breakdown',
            'wagon-wheel',
            'arkansas-traveler-1',
            'angeline-baker',
        ],
        songMetadata: {
            'old-home-place': {
                key: 'B',
                tempo: 128,
                notes: 'Kick off with the banjo. Split the last break: mando, then fiddle.\nTag the last line twice.',
            },
            'foggy-mountain-breakdown': {
                tempo: 150,
                notes: 'Em, not E, in bar 5. Everyone takes one break.',
            },
            'wagon-wheel': { key: 'A', notes: 'Capo 2. Sarah sings lead.' },
        },
        cloudId: null,
    },
    {
        id: PRACTICE_LIST_ID,
        name: 'Practice: fiddle tunes',
        songs: ['arkansas-traveler-1', 'angeline-baker'],
        songMetadata: {
            'arkansas-traveler-1': { tempo: 90, notes: 'B part still falls apart above 100.' },
        },
        cloudId: null,
    },
    {
        id: GOSPEL_LIST_ID,
        name: 'Sunday gospel set',
        songs: [],
        songMetadata: {},
        cloudId: null,
    },
];

const FOLDERS = {
    folders: [
        { id: 'folder_band', name: 'Band', parentId: null, position: 0 },
        { id: 'folder_practice', name: 'Practice', parentId: null, position: 1 },
    ],
    listPlacements: {
        [JAM_LIST_ID]: 'folder_band',
        [GOSPEL_LIST_ID]: 'folder_band',
        [PRACTICE_LIST_ID]: 'folder_practice',
    },
};

const WITH_LISTS = {
    'songbook-lists': JSON.stringify(LISTS),
    'songbook-folders': JSON.stringify(FOLDERS),
    'songbook-legacy-cleanup-v2': '1',
};

const NO_LISTS = { 'songbook-legacy-cleanup-v2': '1' };

// Byte-for-byte the shape of supabase/migrations/20260109224000 get_public_list.
const PUBLIC_LIST = {
    list: {
        id: SHARED_LIST_ID,
        name: 'Sunday Jam',
        user_id: '22222222-2222-4222-8222-222222222222',
        position: 0,
        owners: ['22222222-2222-4222-8222-222222222222'],
        orphaned_at: null,
    },
    songs: ['wagon-wheel', 'old-home-place', 'foggy-mountain-breakdown'],
    is_owner: false,
    is_follower: false,
    is_orphaned: false,
    can_claim: false,
};

// ── small helpers for `setup` ──────────────────────────────────────────

const tabReady = '.tablature-container';

/** Open a pill's popover on the song page. */
const openPill = (id) => async (page) => {
    await page.locator(`#${id} .pill-btn`).click();
    await page.locator(`#${id} .pill-popover`).waitFor();
};

/** Press Edit on a tab page. On a phone the button lives in the gear sheet. */
async function enterTabEditor(page, { phone }) {
    const band = page.locator('#app-bottomband');
    if (phone) {
        await band.locator('.tab-more-btn').click();
        await band.locator('.tab-settings-sheet').waitFor();
    }
    await band.locator('.tab-edit-btn').first().click();
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
}

// ── the inventory ──────────────────────────────────────────────────────

export const STATES = [
    // Browse
    {
        id: 'home',
        group: 'Browse',
        title: 'Home (collections)',
        url: '/',
        ready: '#landing-page .collection-card, #landing-page',
        workshop: ['F3'],
    },
    {
        id: 'search-results',
        group: 'Browse',
        title: 'Search results',
        url: '/#search/mountain',
        ready: '.result-item',
        workshop: ['F2', 'F3'],
    },
    {
        id: 'search-browse-all',
        group: 'Browse',
        title: 'Search with no query (the whole canon)',
        url: '/#search',
        ready: '.result-item',
        workshop: ['F2'],
    },
    {
        id: 'search-no-results',
        group: 'Browse',
        title: 'Search with no results',
        url: '/#search/zzqqxxyy',
        ready: '#search-stats',
        workshop: ['F2'],
    },
    {
        id: 'dungeon',
        group: 'Browse',
        title: 'Bluegrass Dungeon (the archive)',
        url: '/#dungeon/hank',
        ready: '.result-item',
        workshop: ['F3'],
    },
    {
        id: 'bounty',
        group: 'Browse',
        title: 'Bounty board (wanted songs)',
        url: '/#bounty',
        ready: '#bounty-view, .bounty-view',
        workshop: ['F3'],
    },

    // Song page: lead sheet
    {
        id: 'song-lead-sheet',
        group: 'Song page',
        title: 'Lead sheet',
        url: '/#work/old-home-place',
        ready: '#song-view .song-body',
        workshop: ['F3', 'F5'],
    },
    {
        id: 'song-key-pill',
        group: 'Song page',
        title: 'Lead sheet, Key pill open',
        url: '/#work/old-home-place',
        ready: '#song-view .song-body',
        setup: openPill('key-pill'),
        workshop: ['F2', 'F4'],
    },
    {
        id: 'song-display-pill',
        group: 'Song page',
        title: 'Lead sheet, Display pill open',
        url: '/#work/old-home-place',
        ready: '#song-view .song-body',
        setup: openPill('display-pill'),
        workshop: ['F2', 'F4'],
    },
    {
        id: 'song-info-pill',
        group: 'Song page',
        title: 'Lead sheet, Info pill open',
        url: '/#work/old-home-place',
        ready: '#song-view .song-body',
        setup: openPill('info-pill'),
        workshop: ['F2', 'F4'],
    },
    {
        id: 'song-abc',
        group: 'Song page',
        title: 'Fiddle tune with ABC notation',
        url: '/#work/arkansas-traveler-1',
        ready: '#song-view .abc-notation svg',
        workshop: ['F5'],
    },
    {
        id: 'song-add-to-list',
        group: 'Song page',
        title: 'Add-to-list picker open',
        url: '/#work/old-home-place',
        seed: WITH_LISTS,
        ready: '#song-view .song-body',
        setup: async (page) => {
            await page.locator('#list-picker-btn').click();
            await page.locator('.list-picker-popup').waitFor();
        },
        workshop: ['F2', 'D1'],
    },
    {
        id: 'song-not-found',
        group: 'Song page',
        title: 'Song not found',
        url: '/#work/this-song-does-not-exist',
        ready: '#song-view',
        workshop: ['F3'],
    },

    // Song page: tablature
    {
        id: 'tab-single-track',
        group: 'Tab page',
        title: 'Tab, single track (no repeats: the toggle does nothing)',
        url: '/#work/foggy-mountain-breakdown/banjo-tab',
        ready: tabReady,
        workshop: ['F7', 'F4'],
    },
    {
        id: 'tab-with-repeats',
        group: 'Tab page',
        title: 'Tab with real repeats',
        url: '/#work/arkansas-traveler-1/banjo-tab',
        ready: tabReady,
        workshop: ['F7'],
    },
    {
        id: 'tab-multi-track',
        group: 'Tab page',
        title: 'Tab, multi-track ensemble',
        url: '/#work/foggy-mountain-breakdown/ensemble',
        ready: tabReady,
        workshop: ['F7', 'F4'],
    },
    {
        id: 'tab-default-part',
        group: 'Tab page',
        title: 'Tab work at its default part (opens on a mandolin break)',
        url: '/#work/foggy-mountain-breakdown',
        ready: tabReady,
        workshop: ['F7'],
    },
    {
        id: 'tab-settings-sheet',
        group: 'Tab page',
        title: 'Tab settings sheet (phone); the full band (desktop)',
        url: '/#work/foggy-mountain-breakdown/banjo-tab',
        ready: tabReady,
        setup: async (page, { phone }) => {
            if (!phone) return;
            await page.locator('#app-bottomband .tab-more-btn').click();
            await page.locator('#app-bottomband .tab-settings-sheet').waitFor();
        },
        workshop: ['F7', 'F4'],
    },

    // Editors
    {
        id: 'tab-editor',
        group: 'Editors',
        title: 'Tab editor',
        url: '/#work/foggy-mountain-breakdown/banjo-tab',
        ready: tabReady,
        setup: enterTabEditor,
        workshop: ['E4', 'E5'],
    },
    {
        id: 'editor-new-song',
        group: 'Editors',
        title: 'Lead-sheet editor, new song',
        url: '/#add',
        ready: '#editor-panel',
        workshop: ['E3'],
    },
    {
        id: 'editor-existing-song',
        group: 'Editors',
        title: 'Lead-sheet editor, existing song',
        url: '/#edit/old-home-place',
        ready: '#editor-panel',
        workshop: ['E3'],
    },
    {
        id: 'add-song-picker',
        group: 'Editors',
        title: 'Add Song picker',
        url: '/#search',
        ready: '.result-item',
        setup: async (page) => {
            await page.locator('.topbar-nav-link[data-nav="add"]').click();
            await page.locator('#add-song-picker').waitFor();
        },
        workshop: ['F2'],
    },

    // Lists
    {
        id: 'lists-library',
        group: 'Lists',
        title: 'Lists library, with folders',
        url: '/#lists',
        seed: WITH_LISTS,
        ready: '#song-lists-view',
        workshop: ['F8', 'D1'],
    },
    {
        id: 'lists-library-empty',
        group: 'Lists',
        title: 'Lists library, nothing yet',
        url: '/#lists',
        seed: NO_LISTS,
        ready: '#song-lists-view',
        workshop: ['F8', 'D1'],
    },
    {
        id: 'list-view',
        group: 'Lists',
        title: 'List view (a setlist with keys, tempos and notes)',
        url: `/#list/${JAM_LIST_ID}`,
        seed: WITH_LISTS,
        ready: '.result-item',
        workshop: ['F8', 'D2', 'D3', 'D4'],
    },
    {
        id: 'list-view-empty',
        group: 'Lists',
        title: 'List view, empty list',
        url: `/#list/${GOSPEL_LIST_ID}`,
        seed: WITH_LISTS,
        ready: '#list-header',
        workshop: ['F8'],
    },
    {
        id: 'list-notes-sheet',
        group: 'Lists',
        title: 'List item notes sheet (the only place notes appear today)',
        url: `/#list/${JAM_LIST_ID}`,
        seed: WITH_LISTS,
        ready: '.result-item',
        setup: async (page) => {
            await page.locator('.result-item .list-notes-btn').first().click();
            await page.locator('#notes-sheet').waitFor();
        },
        workshop: ['F8', 'D3', 'D4'],
    },
    {
        id: 'list-song',
        group: 'Lists',
        title: 'Song opened from a list (notes are not shown)',
        url: `/#list/${JAM_LIST_ID}/old-home-place`,
        seed: WITH_LISTS,
        ready: '#song-view .song-body',
        workshop: ['F8', 'D3', 'D4', 'D6'],
    },
    {
        id: 'favorites',
        group: 'Lists',
        title: 'Favorites',
        url: '/#list/favorites',
        seed: WITH_LISTS,
        ready: '.result-item',
        workshop: ['F8'],
    },
    {
        id: 'favorites-empty',
        group: 'Lists',
        title: 'Favorites, empty',
        url: '/#list/favorites',
        seed: NO_LISTS,
        ready: '#results',
        workshop: ['F8'],
    },
    {
        id: 'list-shared',
        group: 'Lists',
        title: "Someone else's list, signed out (a share link)",
        url: `/#list/${SHARED_LIST_ID}`,
        mock: { signedIn: false, rpc: { get_public_list: PUBLIC_LIST } },
        ready: '.result-item',
        workshop: ['F8', 'D5'],
    },
    {
        id: 'list-not-found',
        group: 'Lists',
        title: 'Share link to a list that does not exist',
        url: `/#list/${SHARED_LIST_ID}`,
        mock: { signedIn: false, rpc: { get_public_list: { error: 'List not found' } } },
        ready: '#results',
        workshop: ['F8'],
    },

    // Proposed (fix-it list tier D). Static mockups, not the app.
    {
        id: 'proposed-d1-folders',
        group: 'Proposed: library',
        title: 'D1 Folders: the library as nested folders',
        url: 'proposed/d1-folders.html',
        proposed: true,
        workshop: ['D1', 'D5'],
    },
    {
        id: 'proposed-d2-items',
        group: 'Proposed: library',
        title: 'D2 Items: dividers, and the same song twice',
        url: 'proposed/d2-items.html',
        proposed: true,
        workshop: ['D2', 'D4', 'F8'],
    },
    {
        id: 'proposed-d3-notes',
        group: 'Proposed: library',
        title: 'D3 Notes: a note beside the chart',
        url: 'proposed/d3-notes.html',
        proposed: true,
        workshop: ['D3', 'F8'],
    },
    {
        id: 'proposed-d4-overrides',
        group: 'Proposed: library',
        title: 'D4 Overrides: setlist key, capo and tempo applied',
        url: 'proposed/d4-overrides.html',
        proposed: true,
        workshop: ['D4'],
    },
    {
        id: 'proposed-d5-sharing',
        group: 'Proposed: library',
        title: 'D5 Sharing: Shared with me, Following, Leave',
        url: 'proposed/d5-sharing.html',
        proposed: true,
        workshop: ['D5'],
    },
    {
        id: 'proposed-d6-play-through',
        group: 'Proposed: library',
        title: 'D6 Play-through: a list played song to song',
        url: 'proposed/d6-play-through.html',
        proposed: true,
        workshop: ['D6'],
    },
    {
        id: 'proposed-d7-songbook',
        group: 'Proposed: library',
        title: 'D7 Printable songbook: contents, keys and notes applied',
        url: 'proposed/d7-songbook.html',
        proposed: true,
        workshop: ['D7'],
    },
];

export const VIEWPORTS = {
    phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

export const THEMES = ['light', 'dark'];
