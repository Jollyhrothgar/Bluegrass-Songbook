// showListView / fetchListData for a list that is not in the viewer's own
// library: a share link, or a followed list whose owners have all left.
//
// The data comes from the REAL path: the real supabase-auth.js (fetchPublicList
// + its normalization) fed the real get_public_list response shape. A mock that
// already had the camelCase shape would have passed while production rendered
// "0 songs".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

vi.mock('../state.js', () => {
    const s = { viewingListId: null, viewingPublicList: null };
    return {
        userLists: [],
        setUserLists: vi.fn(),
        allSongs: [
            { id: 'man-of-constant-sorrow', title: 'Man of Constant Sorrow' },
            { id: 'blue-moon-of-kentucky', title: 'Blue Moon of Kentucky' },
            { id: 'not-in-the-list', title: 'Not In The List' }
        ],
        isCloudSyncEnabled: false,
        setCloudSyncEnabled: vi.fn(),
        setListContext: vi.fn(),
        get viewingListId() { return s.viewingListId; },
        setViewingListId: vi.fn((id) => { s.viewingListId = id; }),
        get viewingPublicList() { return s.viewingPublicList; },
        setViewingPublicList: vi.fn((d) => { s.viewingPublicList = d; }),
        FAVORITES_LIST_ID: 'favorites',
        clearSelectedSongs: vi.fn(),
        setCurrentView: vi.fn(),
        subscribe: vi.fn(),
        currentView: 'search',
        focusedListId: null,
        setFocusedListId: vi.fn()
    };
});
vi.mock('../song-view.js', () => ({ openSong: vi.fn() }));
vi.mock('../utils.js', async (importOriginal) => ({
    ...await importOriginal(),
    requireLogin: vi.fn(() => true)
}));
vi.mock('../add-song-picker.js', () => ({ openAddSongPicker: vi.fn() }));
vi.mock('../search-core.js', () => ({ showRandomSongs: vi.fn(), hideBatchOperationsBar: vi.fn() }));
vi.mock('../analytics.js', () => ({ trackListAction: vi.fn() }));
vi.mock('../list-picker.js', () => ({
    showListPicker: vi.fn(), closeListPicker: vi.fn(), updateTriggerButton: vi.fn()
}));

import { initLists, showListView, fetchListData, loadFollowedLists } from '../lists.js';
import { setViewingPublicList, setViewingListId } from '../state.js';

const AUTH_SRC = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../supabase-auth.js'), 'utf-8');

const LIST_ID = '11111111-1111-1111-1111-111111111111';
const USER = { id: '00000000-0000-0000-0000-00000000000f' };

// What get_public_list returns, byte for byte.
function rpcShape(overrides = {}) {
    return {
        list: { id: LIST_ID, name: 'Sunday Jam', user_id: 'someone-else', position: 0,
                owners: ['someone-else'], orphaned_at: null },
        songs: ['man-of-constant-sorrow', 'blue-moon-of-kentucky'],
        is_owner: false, is_follower: false, is_orphaned: false, can_claim: false,
        ...overrides
    };
}

async function signInWithRpc(rpcPayload) {
    const client = {
        rpc: vi.fn().mockResolvedValue({ data: rpcPayload, error: null }),
        from: vi.fn(),
        auth: {
            onAuthStateChange: vi.fn(),
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: USER } } })
        }
    };
    new Function('supabase', AUTH_SRC)({ createClient: () => client });
    window.SupabaseAuth.init();
    await Promise.resolve();
    await Promise.resolve();
    globalThis.SupabaseAuth = window.SupabaseAuth;
    return client;
}

const hidden = (id) => document.getElementById(id).classList.contains('hidden');
let renderResults;

beforeEach(() => {
    document.body.innerHTML = `
        <div id="list-header" class="hidden">
            <span id="list-header-name"></span><span id="list-header-count"></span>
            <span id="list-header-badge" class="hidden"></span>
            <button id="list-share-btn"></button><button id="list-duplicate-btn"></button>
            <button id="list-follow-btn" class="hidden"></button>
            <button id="list-claim-btn" class="hidden"></button>
            <button id="list-delete-btn"></button><button id="list-request-btn"></button>
        </div>
        <div class="search-container"></div><div id="results"></div>`;
    renderResults = vi.fn();
    initLists({
        searchStats: document.createElement('div'),
        searchInput: document.createElement('input'),
        resultsDiv: document.getElementById('results'),
        songView: document.createElement('div'),
        listsContainer: document.createElement('div'),
        printListBtn: document.createElement('button'),
        renderResults,
        pushHistoryState: vi.fn()
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    delete window.SupabaseAuth;
    delete globalThis.SupabaseAuth;
    vi.restoreAllMocks();
});

describe('showListView: a shared list', () => {
    it('shows the songs (it used to show 0)', async () => {
        await signInWithRpc(rpcShape());
        await showListView(LIST_ID);

        expect(renderResults).toHaveBeenCalledTimes(1);
        const [songs] = renderResults.mock.calls[0];
        expect(songs.map(s => s.id)).toEqual(['man-of-constant-sorrow', 'blue-moon-of-kentucky']);
        expect(document.getElementById('list-header-count').textContent).toBe('2 songs');
        expect(document.getElementById('list-header-name').textContent).toBe('Sunday Jam');
    });

    it('stores the normalized list as viewingPublicList, so isOwner / isFollower are real', async () => {
        await signInWithRpc(rpcShape({ is_follower: true }));
        await showListView(LIST_ID);

        const stored = setViewingPublicList.mock.calls.at(-1)[0];
        expect(stored.songs).toHaveLength(2);
        expect(stored.isOwner).toBe(false);
        expect(stored.isFollower).toBe(true);
        expect(stored.list.name).toBe('Sunday Jam');
    });

    it('marks an ordinary shared list "Shared List", with Copy and Follow, no Claim', async () => {
        await signInWithRpc(rpcShape());
        await showListView(LIST_ID);

        expect(document.getElementById('list-header-badge').textContent).toBe('Shared List');
        expect(document.getElementById('list-duplicate-btn').innerHTML).toContain('Copy to My Lists');
        expect(hidden('list-claim-btn')).toBe(true);
        expect(hidden('list-delete-btn')).toBe(true);
        expect(hidden('list-share-btn')).toBe(true);
    });

    it('shows the Claim button to a follower of an orphaned list', async () => {
        await signInWithRpc(rpcShape({
            list: { id: LIST_ID, name: 'Abandoned', user_id: 'gone', position: 0, owners: [],
                    orphaned_at: '2026-09-20T00:00:00+00:00' },
            is_follower: true, is_orphaned: true, can_claim: true
        }));
        await showListView(LIST_ID);

        expect(document.getElementById('list-header-badge').textContent).toBe('Needs Owner');
        expect(hidden('list-claim-btn')).toBe(false);
    });

    it('does not show Claim to a non-follower of an orphaned list', async () => {
        await signInWithRpc(rpcShape({ is_orphaned: true, can_claim: false, is_follower: false,
            list: { id: LIST_ID, name: 'Abandoned', owners: [], orphaned_at: '2026-09-20T00:00:00+00:00' } }));
        await showListView(LIST_ID);

        expect(hidden('list-claim-btn')).toBe(true);
    });

    it('an owner viewing through the link gets owner controls', async () => {
        await signInWithRpc(rpcShape({ is_owner: true }));
        await showListView(LIST_ID);

        expect(hidden('list-share-btn')).toBe(false);
        expect(hidden('list-delete-btn')).toBe(false);
        expect(hidden('list-claim-btn')).toBe(true);
    });

    it('says "List not found" for a missing list', async () => {
        await signInWithRpc({ error: 'List not found' });
        await showListView(LIST_ID);

        expect(renderResults).not.toHaveBeenCalled();
        expect(document.getElementById('results').innerHTML).toContain("doesn't exist");
        expect(setViewingListId).toHaveBeenLastCalledWith(null);
    });
});

describe('fetchListData: a shared list', () => {
    it('returns the name, the songs and whether the viewer owns it', async () => {
        await signInWithRpc(rpcShape({ is_owner: true }));
        expect(await fetchListData(LIST_ID)).toEqual({
            name: 'Sunday Jam',
            songs: ['man-of-constant-sorrow', 'blue-moon-of-kentucky'],
            isOwner: true
        });
    });

    it('is not the owner when the RPC says so, even if the viewer created the list', async () => {
        // A co-owner who left: list.user_id is still theirs, is_owner is false.
        await signInWithRpc(rpcShape({
            list: { id: LIST_ID, name: 'Sunday Jam', user_id: USER.id, owners: ['other'], orphaned_at: null },
            is_owner: false
        }));
        expect((await fetchListData(LIST_ID)).isOwner).toBe(false);
    });

    it('returns null for a missing list', async () => {
        await signInWithRpc({ error: 'List not found' });
        expect(await fetchListData(LIST_ID)).toBeNull();
    });
});

describe('showListView: a followed list', () => {
    // fetchFollowedLists() (supabase-auth.js) marks these isFollowed / isOrphaned.
    const followed = (overrides) => ({
        id: LIST_ID, name: 'Followed', position: 0, owners: [], orphaned_at: null,
        songs: ['man-of-constant-sorrow'], songMetadata: {}, isFollowed: true, isOrphaned: false,
        ...overrides
    });

    async function follow(list) {
        globalThis.SupabaseAuth = {
            isLoggedIn: () => true,
            fetchFollowedLists: vi.fn().mockResolvedValue({ data: [list], error: null })
        };
        await loadFollowedLists();
    }

    it('shows the Claim button when its owners have all left', async () => {
        await follow(followed({ orphaned_at: '2026-09-20T00:00:00+00:00', isOrphaned: true }));
        await showListView(LIST_ID);

        expect(document.getElementById('list-header-badge').textContent).toBe('Needs Owner');
        expect(hidden('list-claim-btn')).toBe(false);
    });

    it('shows no Claim button while it still has an owner', async () => {
        await follow(followed({ owners: ['someone'] }));
        await showListView(LIST_ID);

        expect(document.getElementById('list-header-badge').textContent).toBe('Following');
        expect(hidden('list-claim-btn')).toBe(true);
    });
});
