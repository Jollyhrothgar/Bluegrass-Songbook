// Unit tests for lists.js - List management, undo/redo, folders, metadata
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock all DOM-dependent and external dependencies
vi.mock('../state.js', () => {
    let _userLists = [];
    let _viewingListId = null;
    let _viewingPublicList = null;
    let _focusedListId = null;
    return {
        userLists: _userLists,
        setUserLists: vi.fn((lists) => { _userLists.length = 0; _userLists.push(...lists); }),
        allSongs: [],
        currentSong: null,
        isCloudSyncEnabled: false,
        setCloudSyncEnabled: vi.fn(),
        setListContext: vi.fn(),
        viewingListId: null,
        setViewingListId: vi.fn((id) => { }),
        viewingPublicList: null,
        setViewingPublicList: vi.fn(),
        FAVORITES_LIST_ID: 'favorites',
        clearSelectedSongs: vi.fn(),
        setCurrentView: vi.fn(),
        subscribe: vi.fn(),
        currentView: 'search',
        focusedListId: null,
        setFocusedListId: vi.fn()
    };
});

vi.mock('../song-view.js', () => ({
    openSong: vi.fn()
}));

vi.mock('../utils.js', () => ({
    escapeHtml: vi.fn((text) => text),
    generateLocalId: vi.fn(() => 'local_' + Math.random().toString(36).slice(2)),
    requireLogin: vi.fn(() => true),
    parseItemRef: vi.fn((ref) => {
        const parts = ref.split('/');
        return { workId: parts[0], partId: parts[1] || null };
    })
}));

vi.mock('../add-song-picker.js', () => ({
    openAddSongPicker: vi.fn()
}));

vi.mock('../search-core.js', () => ({
    showRandomSongs: vi.fn(),
    hideBatchOperationsBar: vi.fn()
}));

vi.mock('../analytics.js', () => ({
    trackListAction: vi.fn()
}));

vi.mock('../list-picker.js', () => ({
    showListPicker: vi.fn(),
    closeListPicker: vi.fn(),
    updateTriggerButton: vi.fn()
}));

// Mock DOM APIs
const mockLocalStorage = (() => {
    let store = {};
    return {
        getItem: vi.fn((key) => store[key] || null),
        setItem: vi.fn((key, value) => { store[key] = value; }),
        removeItem: vi.fn((key) => { delete store[key]; }),
        clear: () => { store = {}; }
    };
})();
vi.stubGlobal('localStorage', mockLocalStorage);

// Mock document for DOM operations
vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
        className: '',
        innerHTML: '',
        classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => false) },
        querySelector: vi.fn(() => ({
            textContent: '',
            addEventListener: vi.fn(),
            style: {}
        })),
        querySelectorAll: vi.fn(() => []),
        appendChild: vi.fn(),
        addEventListener: vi.fn(),
        style: {}
    })),
    getElementById: vi.fn(() => null),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    body: { appendChild: vi.fn() },
    addEventListener: vi.fn()
});

vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => cb()));
vi.stubGlobal('SupabaseAuth', undefined);

import {
    createList,
    renameList,
    deleteList,
    addSongToList,
    removeSongFromList,
    reorderSongInList,
    reorderSongInListByRef,
    isFavorite,
    toggleFavorite,
    isSongInList,
    isSongInAnyList,
    getSongMetadata,
    updateSongMetadata,
    clearSongMetadata,
    getOrCreateFavoritesList,
    getFavoritesList,
    reorderList,
    canUndo,
    canRedo,
    undo,
    redo,
    createFolder,
    getFolders,
    getFoldersAtLevel,
    renameFolder,
    deleteFolder,
    moveFolder,
    getListFolder,
    setListFolder,
    getListsInFolder,
    getListsAtRoot,
    saveLists,
    loadLists
} from '../lists.js';

import { userLists, FAVORITES_LIST_ID } from '../state.js';

describe('List CRUD operations', () => {
    beforeEach(() => {
        userLists.length = 0;
        mockLocalStorage.clear();
    });

    describe('createList', () => {
        it('creates a new list with a unique ID', () => {
            const list = createList('My Jam Session', true);
            expect(list).not.toBeNull();
            expect(list.name).toBe('My Jam Session');
            expect(list.songs).toEqual([]);
            expect(list.songMetadata).toEqual({});
            expect(list.cloudId).toBeNull();
            expect(userLists).toContain(list);
        });

        it('trims whitespace from list name', () => {
            const list = createList('  Padded Name  ', true);
            expect(list.name).toBe('Padded Name');
        });

        it('rejects empty name', () => {
            expect(createList('', true)).toBeNull();
            expect(createList('   ', true)).toBeNull();
        });

        it('rejects duplicate names (case-insensitive)', () => {
            createList('My List', true);
            expect(createList('my list', true)).toBeNull();
            expect(createList('MY LIST', true)).toBeNull();
        });

        it('allows creating multiple lists with different names', () => {
            createList('List A', true);
            createList('List B', true);
            expect(userLists.length).toBe(2);
        });
    });

    describe('renameList', () => {
        it('renames an existing list', () => {
            const list = createList('Original', true);
            const result = renameList(list.id, 'Renamed', true);
            expect(result).toBe(true);
            expect(list.name).toBe('Renamed');
        });

        it('rejects empty name', () => {
            const list = createList('Original', true);
            expect(renameList(list.id, '', true)).toBe(false);
            expect(list.name).toBe('Original');
        });

        it('rejects rename to duplicate name', () => {
            const list1 = createList('List A', true);
            createList('List B', true);
            expect(renameList(list1.id, 'List B', true)).toBe(false);
            expect(list1.name).toBe('List A');
        });

        it('allows renaming to same name with different case', () => {
            const list = createList('my list', true);
            // This should fail because case-insensitive check includes self
            // Actually looking at the code: l.id !== listId check excludes self
            const result = renameList(list.id, 'MY LIST', true);
            expect(result).toBe(true);
            expect(list.name).toBe('MY LIST');
        });

        it('returns false for non-existent list', () => {
            expect(renameList('nonexistent', 'New Name', true)).toBe(false);
        });
    });

    describe('deleteList', () => {
        it('deletes an existing list', async () => {
            const list = createList('To Delete', true);
            const listId = list.id;
            const result = await deleteList(listId, true);
            expect(result).toBe(true);
            expect(userLists.find(l => l.id === listId)).toBeUndefined();
        });

        it('returns false for non-existent list', async () => {
            expect(await deleteList('nonexistent', true)).toBe(false);
        });

        it('tracks deleted list IDs to prevent resurrection', async () => {
            const list = createList('Deleted List', true);
            await deleteList(list.id, true);
            // The deleted list tracking is internal, but we can verify
            // by checking localStorage was written
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
                'songbook-deleted-lists',
                expect.any(String)
            );
        });
    });

    describe('reorderList', () => {
        it('moves a list up', () => {
            createList('First', true);
            const second = createList('Second', true);
            expect(reorderList(second.id, 'up', true)).toBe(true);
            expect(userLists[0].name).toBe('Second');
            expect(userLists[1].name).toBe('First');
        });

        it('moves a list down', () => {
            const first = createList('First', true);
            createList('Second', true);
            expect(reorderList(first.id, 'down', true)).toBe(true);
            expect(userLists[0].name).toBe('Second');
            expect(userLists[1].name).toBe('First');
        });

        it('returns false when moving first item up', () => {
            const first = createList('First', true);
            createList('Second', true);
            expect(reorderList(first.id, 'up', true)).toBe(false);
        });

        it('returns false when moving last item down', () => {
            createList('First', true);
            const second = createList('Second', true);
            expect(reorderList(second.id, 'down', true)).toBe(false);
        });
    });
});

describe('Song operations within lists', () => {
    let testList;

    beforeEach(() => {
        userLists.length = 0;
        mockLocalStorage.clear();
        testList = createList('Test List', true);
    });

    describe('addSongToList', () => {
        it('adds a song to a list', () => {
            const result = addSongToList(testList.id, 'cripple-creek', true);
            expect(result).toBe(true);
            expect(testList.songs).toContain('cripple-creek');
        });

        it('does not add duplicate songs', () => {
            addSongToList(testList.id, 'cripple-creek', true);
            addSongToList(testList.id, 'cripple-creek', true);
            expect(testList.songs.filter(s => s === 'cripple-creek').length).toBe(1);
        });

        it('adds metadata when provided', () => {
            addSongToList(testList.id, 'salt-creek', true, { key: 'G', tempo: 120 });
            expect(testList.songMetadata['salt-creek']).toEqual({ key: 'G', tempo: 120 });
        });

        it('returns false for non-existent list', () => {
            expect(addSongToList('nonexistent', 'cripple-creek', true)).toBe(false);
        });
    });

    describe('removeSongFromList', () => {
        it('removes a song from a list', () => {
            addSongToList(testList.id, 'cripple-creek', true);
            const result = removeSongFromList(testList.id, 'cripple-creek', true);
            expect(result).toBe(true);
            expect(testList.songs).not.toContain('cripple-creek');
        });

        it('also removes associated metadata', () => {
            addSongToList(testList.id, 'salt-creek', true, { key: 'G' });
            removeSongFromList(testList.id, 'salt-creek', true);
            expect(testList.songMetadata['salt-creek']).toBeUndefined();
        });

        it('returns true even if song not in list (no-op)', () => {
            const result = removeSongFromList(testList.id, 'nonexistent', true);
            expect(result).toBe(true);
        });
    });

    describe('reorderSongInList', () => {
        beforeEach(() => {
            addSongToList(testList.id, 'song-a', true);
            addSongToList(testList.id, 'song-b', true);
            addSongToList(testList.id, 'song-c', true);
        });

        it('moves a song forward', () => {
            reorderSongInList(testList.id, 0, 2, true);
            expect(testList.songs).toEqual(['song-b', 'song-c', 'song-a']);
        });

        it('moves a song backward', () => {
            reorderSongInList(testList.id, 2, 0, true);
            expect(testList.songs).toEqual(['song-c', 'song-a', 'song-b']);
        });

        it('returns false for same from/to index', () => {
            expect(reorderSongInList(testList.id, 1, 1, true)).toBe(false);
        });

        it('returns false for out-of-bounds indices', () => {
            expect(reorderSongInList(testList.id, -1, 2, true)).toBe(false);
            expect(reorderSongInList(testList.id, 0, 5, true)).toBe(false);
        });

        it('returns false for non-existent list', () => {
            expect(reorderSongInList('nonexistent', 0, 1, true)).toBe(false);
        });
    });

    describe('reorderSongInListByRef', () => {
        beforeEach(() => {
            addSongToList(testList.id, 'song-a', true);
            addSongToList(testList.id, 'song-b', true);
            addSongToList(testList.id, 'song-c', true);
        });

        it('inserts before target', () => {
            reorderSongInListByRef(testList.id, 'song-c', 'song-a', true);
            expect(testList.songs).toEqual(['song-c', 'song-a', 'song-b']);
        });

        it('inserts after target', () => {
            reorderSongInListByRef(testList.id, 'song-a', 'song-c', false);
            expect(testList.songs).toEqual(['song-b', 'song-c', 'song-a']);
        });

        it('returns false for non-existent source ref', () => {
            expect(reorderSongInListByRef(testList.id, 'nonexistent', 'song-a', true)).toBe(false);
        });
    });

    describe('isSongInList / isSongInAnyList', () => {
        it('checks if song is in specific list', () => {
            addSongToList(testList.id, 'cripple-creek', true);
            expect(isSongInList(testList.id, 'cripple-creek')).toBe(true);
            expect(isSongInList(testList.id, 'nonexistent')).toBe(false);
        });

        it('checks if song is in any list', () => {
            addSongToList(testList.id, 'cripple-creek', true);
            expect(isSongInAnyList('cripple-creek')).toBe(true);
            expect(isSongInAnyList('nonexistent')).toBe(false);
        });

        it('returns false for non-existent list', () => {
            expect(isSongInList('nonexistent', 'cripple-creek')).toBe(false);
        });
    });
});

describe('Song metadata', () => {
    let testList;

    beforeEach(() => {
        userLists.length = 0;
        mockLocalStorage.clear();
        testList = createList('Test List', true);
        addSongToList(testList.id, 'cripple-creek', true);
    });

    describe('getSongMetadata', () => {
        it('returns null when no metadata set', () => {
            expect(getSongMetadata(testList.id, 'cripple-creek')).toBeNull();
        });

        it('returns metadata after setting it', () => {
            updateSongMetadata(testList.id, 'cripple-creek', { key: 'G', tempo: 120 });
            expect(getSongMetadata(testList.id, 'cripple-creek')).toEqual({ key: 'G', tempo: 120 });
        });

        it('looks up by cloudId as well', () => {
            testList.cloudId = 'cloud-uuid-123';
            updateSongMetadata('cloud-uuid-123', 'cripple-creek', { key: 'A' });
            expect(getSongMetadata('cloud-uuid-123', 'cripple-creek')).toEqual({ key: 'A' });
        });
    });

    describe('updateSongMetadata', () => {
        it('merges metadata without overwriting existing fields', () => {
            updateSongMetadata(testList.id, 'cripple-creek', { key: 'G' });
            updateSongMetadata(testList.id, 'cripple-creek', { tempo: 120 });
            expect(getSongMetadata(testList.id, 'cripple-creek')).toEqual({ key: 'G', tempo: 120 });
        });

        it('removes empty/null fields on merge', () => {
            updateSongMetadata(testList.id, 'cripple-creek', { key: 'G', tempo: 120 });
            updateSongMetadata(testList.id, 'cripple-creek', { key: null });
            expect(getSongMetadata(testList.id, 'cripple-creek')).toEqual({ tempo: 120 });
        });

        it('removes metadata entirely when all fields cleared', () => {
            updateSongMetadata(testList.id, 'cripple-creek', { key: 'G' });
            updateSongMetadata(testList.id, 'cripple-creek', { key: '' });
            expect(getSongMetadata(testList.id, 'cripple-creek')).toBeNull();
        });

        it('returns false for non-existent list', () => {
            expect(updateSongMetadata('nonexistent', 'cripple-creek', { key: 'G' })).toBe(false);
        });
    });

    describe('clearSongMetadata', () => {
        it('clears all metadata for a song', () => {
            updateSongMetadata(testList.id, 'cripple-creek', { key: 'G', tempo: 120 });
            clearSongMetadata(testList.id, 'cripple-creek');
            expect(getSongMetadata(testList.id, 'cripple-creek')).toBeNull();
        });
    });
});

describe('Favorites', () => {
    beforeEach(() => {
        userLists.length = 0;
        mockLocalStorage.clear();
    });

    describe('getOrCreateFavoritesList', () => {
        it('creates favorites list if it does not exist', () => {
            const favList = getOrCreateFavoritesList();
            expect(favList).not.toBeNull();
            expect(favList.id).toBe(FAVORITES_LIST_ID);
            expect(favList.name).toBe('Favorites');
            expect(favList.songs).toEqual([]);
        });

        it('returns existing favorites list', () => {
            const first = getOrCreateFavoritesList();
            const second = getOrCreateFavoritesList();
            expect(first).toBe(second);
        });

        it('inserts favorites at the beginning of userLists', () => {
            createList('Existing List', true);
            getOrCreateFavoritesList();
            expect(userLists[0].id).toBe(FAVORITES_LIST_ID);
        });

        it('migrates missing songMetadata field', () => {
            userLists.push({ id: FAVORITES_LIST_ID, name: 'Favorites', songs: ['song-a'] });
            const favList = getOrCreateFavoritesList();
            expect(favList.songMetadata).toEqual({});
        });
    });

    describe('isFavorite', () => {
        it('returns false when no favorites exist', () => {
            expect(isFavorite('cripple-creek')).toBe(false);
        });

        it('returns true after adding to favorites', () => {
            toggleFavorite('cripple-creek', true);
            expect(isFavorite('cripple-creek')).toBe(true);
        });
    });

    describe('toggleFavorite', () => {
        it('adds song to favorites (returns true)', () => {
            const result = toggleFavorite('cripple-creek', true);
            expect(result).toBe(true);
            expect(isFavorite('cripple-creek')).toBe(true);
        });

        it('removes song from favorites (returns false)', () => {
            toggleFavorite('cripple-creek', true);
            const result = toggleFavorite('cripple-creek', true);
            expect(result).toBe(false);
            expect(isFavorite('cripple-creek')).toBe(false);
        });

        it('creates favorites list if needed', () => {
            expect(getFavoritesList()).toBeNull();
            toggleFavorite('cripple-creek', true);
            expect(getFavoritesList()).not.toBeNull();
        });
    });
});

describe('Undo/Redo system', () => {
    beforeEach(() => {
        userLists.length = 0;
        mockLocalStorage.clear();
        // Reset undo/redo state by creating fresh context
    });

    it('records add actions and can undo them', () => {
        const list = createList('Test', true);
        addSongToList(list.id, 'cripple-creek'); // Don't skip undo
        expect(list.songs).toContain('cripple-creek');
        expect(canUndo()).toBe(true);

        undo();
        expect(list.songs).not.toContain('cripple-creek');
    });

    it('records remove actions and can undo them', () => {
        const list = createList('Test', true);
        addSongToList(list.id, 'cripple-creek', true); // Skip undo for setup
        removeSongFromList(list.id, 'cripple-creek'); // Don't skip undo
        expect(list.songs).not.toContain('cripple-creek');

        undo();
        expect(list.songs).toContain('cripple-creek');
    });

    it('can redo after undo', () => {
        const list = createList('Test', true);
        addSongToList(list.id, 'cripple-creek'); // Record undo
        undo();
        expect(list.songs).not.toContain('cripple-creek');
        expect(canRedo()).toBe(true);

        redo();
        expect(list.songs).toContain('cripple-creek');
    });

    it('clears redo stack when new action recorded', () => {
        const list = createList('Test', true);
        addSongToList(list.id, 'song-a');
        undo();
        expect(canRedo()).toBe(true);

        addSongToList(list.id, 'song-b');
        expect(canRedo()).toBe(false);
    });

    it('records create list actions', () => {
        const list = createList('Undoable List'); // Don't skip undo
        expect(userLists.find(l => l.name === 'Undoable List')).toBeTruthy();

        undo();
        expect(userLists.find(l => l.name === 'Undoable List')).toBeFalsy();
    });

    it('records delete list actions', async () => {
        const list = createList('To Delete', true);
        const listId = list.id;
        await deleteList(listId); // Don't skip undo
        expect(userLists.find(l => l.id === listId)).toBeFalsy();

        undo();
        expect(userLists.find(l => l.id === listId)).toBeTruthy();
    });

    it('records rename actions', () => {
        const list = createList('Original', true);
        renameList(list.id, 'Renamed'); // Don't skip undo
        expect(list.name).toBe('Renamed');

        undo();
        expect(list.name).toBe('Original');
    });

    it('records reorder song actions', () => {
        const list = createList('Test', true);
        addSongToList(list.id, 'song-a', true);
        addSongToList(list.id, 'song-b', true);
        addSongToList(list.id, 'song-c', true);

        reorderSongInList(list.id, 0, 2); // Don't skip undo
        expect(list.songs).toEqual(['song-b', 'song-c', 'song-a']);

        undo();
        expect(list.songs).toEqual(['song-a', 'song-b', 'song-c']);
    });

    it('returns false when nothing to undo', () => {
        // Clear any lingering undo state by doing operations and undoing them all
        while (canUndo()) undo();
        expect(undo()).toBe(false);
    });

    it('returns false when nothing to redo', () => {
        expect(redo()).toBe(false);
    });
});

describe('Folder operations', () => {
    beforeEach(() => {
        userLists.length = 0;
        mockLocalStorage.clear();
        // Clear all folders via public API (module-level folderData persists between tests)
        // getFolders() returns a reference that may change after deleteFolder, so re-fetch each time
        let folders = getFolders();
        while (folders.length > 0) {
            deleteFolder(folders[0].id);
            folders = getFolders();
        }
    });

    describe('createFolder', () => {
        it('creates a folder at root level', () => {
            const folder = createFolder('Practice');
            expect(folder).not.toBeNull();
            expect(folder.name).toBe('Practice');
            expect(folder.parentId).toBeNull();
            expect(folder.position).toBe(0);
        });

        it('creates nested folders', () => {
            const parent = createFolder('Music');
            const child = createFolder('Bluegrass', parent.id);
            expect(child.parentId).toBe(parent.id);
        });

        it('assigns sequential positions', () => {
            const first = createFolder('First');
            const second = createFolder('Second');
            expect(first.position).toBe(0);
            expect(second.position).toBe(1);
        });
    });

    describe('getFoldersAtLevel', () => {
        it('returns root folders when parentId is null', () => {
            createFolder('Root A');
            createFolder('Root B');
            const rootFolders = getFoldersAtLevel(null);
            expect(rootFolders.length).toBe(2);
        });

        it('returns children of specific parent', () => {
            const parent = createFolder('Parent');
            createFolder('Child A', parent.id);
            createFolder('Child B', parent.id);
            createFolder('Root Sibling');
            const children = getFoldersAtLevel(parent.id);
            expect(children.length).toBe(2);
        });

        it('returns folders sorted by position', () => {
            createFolder('B');
            createFolder('A');
            const folders = getFoldersAtLevel(null);
            expect(folders[0].name).toBe('B'); // Position 0
            expect(folders[1].name).toBe('A'); // Position 1
        });
    });

    describe('renameFolder', () => {
        it('renames a folder', () => {
            const folder = createFolder('Original');
            renameFolder(folder.id, 'Renamed');
            expect(getFolders().find(f => f.id === folder.id).name).toBe('Renamed');
        });
    });

    describe('deleteFolder', () => {
        it('deletes a folder', () => {
            const folder = createFolder('To Delete');
            deleteFolder(folder.id);
            expect(getFolders().find(f => f.id === folder.id)).toBeUndefined();
        });

        it('promotes children to parent on delete', () => {
            const parent = createFolder('Parent');
            const child = createFolder('Child', parent.id);
            const grandchild = createFolder('Grandchild', child.id);
            deleteFolder(child.id);
            const updatedGrandchild = getFolders().find(f => f.id === grandchild.id);
            expect(updatedGrandchild.parentId).toBe(parent.id);
        });
    });

    describe('moveFolder', () => {
        it('moves folder to new parent', () => {
            const parentA = createFolder('Parent A');
            const parentB = createFolder('Parent B');
            const child = createFolder('Child', parentA.id);
            moveFolder(child.id, parentB.id);
            const moved = getFolders().find(f => f.id === child.id);
            expect(moved.parentId).toBe(parentB.id);
        });

        it('moves folder to root', () => {
            const parent = createFolder('Parent');
            const child = createFolder('Child', parent.id);
            moveFolder(child.id, null);
            const moved = getFolders().find(f => f.id === child.id);
            expect(moved.parentId).toBeNull();
        });
    });

    describe('list-folder association', () => {
        it('assigns a list to a folder', () => {
            const folder = createFolder('My Folder');
            const list = createList('My List', true);
            setListFolder(list.id, folder.id);
            expect(getListFolder(list.id)).toBe(folder.id);
        });

        it('gets lists in a specific folder', () => {
            const folder = createFolder('My Folder');
            const list1 = createList('List 1', true);
            const list2 = createList('List 2', true);
            createList('List 3', true); // Not in folder
            setListFolder(list1.id, folder.id);
            setListFolder(list2.id, folder.id);
            const listsInFolder = getListsInFolder(folder.id);
            expect(listsInFolder.length).toBe(2);
        });

        it('gets lists at root (not in any folder)', () => {
            const folder = createFolder('My Folder');
            const list1 = createList('In Folder', true);
            createList('At Root', true);
            setListFolder(list1.id, folder.id);
            const rootLists = getListsAtRoot();
            expect(rootLists.some(l => l.name === 'At Root')).toBe(true);
            expect(rootLists.some(l => l.name === 'In Folder')).toBe(false);
        });
    });
});
