// Core search functionality for Bluegrass Songbook

import { allSongs, songGroups, userLists, selectedSongIds, toggleSongSelection, clearSelectedSongs, selectAllSongs } from './state.js';
import { highlightMatch, escapeHtml, isTabOnlyWork, isPlaceholder } from './utils.js';
import { songHasTags, getTagCategory, formatTagName } from './tags.js';
import {
    isFavorite, reorderFavoriteItem, showFavorites,
    isSongInAnyList, showResultListPicker, getViewingListId, reorderSongInList, isViewingOwnList,
    removeSongFromList, showListView, FAVORITES_LIST_ID, toggleFavorite,
    addSongToList, clearListView, getSongMetadata, openNotesSheet
} from './lists.js';
import { openSong, showVersionPicker } from './song-view.js';
import { openWork } from './work-view.js';
import { trackSearch as analyticsTrackSearch, trackSearchResultClick } from './analytics.js';

// DOM element references (set by init)
let searchInputEl = null;
let searchStatsEl = null;
let resultsDivEl = null;
let navFavoritesEl = null;
let navSearchEl = null;

// Analytics debounce (only track final query, not every keystroke)
let analyticsDebounceTimer = null;
let pendingSearchData = null;
let lastRecordedQuery = null;
const ANALYTICS_DEBOUNCE_MS = 1000;  // Wait 1s after typing stops

// Drag and drop state for list reordering
let draggedItem = null;
let draggedIndex = null;
let currentDropTarget = null;
let currentDropPosition = null;

// Track which containers have been initialized (WeakMap for proper GC if element is removed)
const initializedContainers = new WeakMap();

// Context menu state
let activeContextMenu = null;

/**
 * Show context menu for a song in list view
 * @param {number} x - Mouse X position
 * @param {number} y - Mouse Y position
 * @param {string} songId - The song ID
 * @param {string} currentListId - The current list being viewed
 */
function showSongContextMenu(x, y, songId, currentListId) {
    // Close any existing context menu
    closeSongContextMenu();

    // Get available lists (exclude current list and favorites)
    const availableLists = userLists.filter(list =>
        list.id !== currentListId &&
        list.id !== FAVORITES_LIST_ID &&
        list.id !== 'favorites'
    );

    // Build menu HTML
    const menu = document.createElement('div');
    menu.className = 'song-context-menu';

    // Copy to submenu
    let copyHtml = '<div class="context-menu-item context-menu-submenu" data-action="copy">';
    copyHtml += '<span>Copy to...</span><span class="submenu-arrow">▶</span>';
    copyHtml += '<div class="context-submenu">';
    if (availableLists.length === 0) {
        copyHtml += '<div class="context-menu-empty">No other lists</div>';
    } else {
        availableLists.forEach(list => {
            copyHtml += `<div class="context-menu-item" data-action="copy-to" data-list-id="${list.id}">${escapeHtml(list.name)}</div>`;
        });
    }
    copyHtml += '</div></div>';

    // Move to submenu (only if owner)
    let moveHtml = '';
    if (isViewingOwnList()) {
        moveHtml = '<div class="context-menu-item context-menu-submenu" data-action="move">';
        moveHtml += '<span>Move to...</span><span class="submenu-arrow">▶</span>';
        moveHtml += '<div class="context-submenu">';
        if (availableLists.length === 0) {
            moveHtml += '<div class="context-menu-empty">No other lists</div>';
        } else {
            availableLists.forEach(list => {
                moveHtml += `<div class="context-menu-item" data-action="move-to" data-list-id="${list.id}">${escapeHtml(list.name)}</div>`;
            });
        }
        moveHtml += '</div></div>';
    }

    menu.innerHTML = copyHtml + moveHtml;

    // Position the menu
    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();

    // Adjust if would go off screen
    let finalX = x;
    let finalY = y;
    if (x + menuRect.width > window.innerWidth) {
        finalX = window.innerWidth - menuRect.width - 10;
    }
    if (y + menuRect.height > window.innerHeight) {
        finalY = window.innerHeight - menuRect.height - 10;
    }

    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;

    // Handle menu item clicks
    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item[data-action]');
        if (!item) return;

        const action = item.dataset.action;
        const targetListId = item.dataset.listId;

        if (action === 'copy-to' && targetListId) {
            // Get metadata from source list and copy it
            const metadata = getSongMetadata(currentListId, songId);
            addSongToList(targetListId, songId, false, metadata);
            closeSongContextMenu();
        } else if (action === 'move-to' && targetListId) {
            // Get metadata from source list and copy it
            const metadata = getSongMetadata(currentListId, songId);
            addSongToList(targetListId, songId, false, metadata);
            if (currentListId === FAVORITES_LIST_ID || currentListId === 'favorites') {
                toggleFavorite(songId);
                showFavorites();
            } else {
                removeSongFromList(currentListId, songId);
                showListView(currentListId);
            }
            closeSongContextMenu();
        }
    });

    activeContextMenu = menu;

    // Close menu on click outside
    setTimeout(() => {
        document.addEventListener('click', handleContextMenuOutsideClick);
        document.addEventListener('contextmenu', handleContextMenuOutsideClick);
    }, 0);
}

/**
 * Close the active context menu
 */
function closeSongContextMenu() {
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
    document.removeEventListener('click', handleContextMenuOutsideClick);
    document.removeEventListener('contextmenu', handleContextMenuOutsideClick);
}

/**
 * Handle clicks outside the context menu
 */
function handleContextMenuOutsideClick(e) {
    if (activeContextMenu && !activeContextMenu.contains(e.target)) {
        closeSongContextMenu();
    }
}

// Batch operations bar element reference
let batchOperationsBar = null;

/**
 * Update the batch operations bar based on selection state
 */
function updateBatchOperationsBar() {
    const count = selectedSongIds.size;
    const viewingListId = getViewingListId();

    if (count === 0 || !viewingListId) {
        hideBatchOperationsBar();
        return;
    }

    showBatchOperationsBar(count, viewingListId);
}

/**
 * Show the batch operations bar with current selection count
 */
function showBatchOperationsBar(count, currentListId) {
    if (!batchOperationsBar) {
        batchOperationsBar = document.createElement('div');
        batchOperationsBar.className = 'batch-operations-bar';
        document.body.appendChild(batchOperationsBar);
    }

    // Get available lists for copy/move (exclude current list and favorites)
    const availableLists = userLists.filter(list =>
        list.id !== currentListId &&
        list.id !== FAVORITES_LIST_ID &&
        list.id !== 'favorites'
    );

    // Build copy/move dropdown options
    const listOptions = availableLists.length === 0
        ? '<option disabled>No other lists</option>'
        : availableLists.map(list => `<option value="${list.id}">${escapeHtml(list.name)}</option>`).join('');

    batchOperationsBar.innerHTML = `
        <div class="batch-bar-content">
            <span class="batch-count">${count} selected</span>
            <div class="batch-actions">
                <button class="batch-select-all" title="Select all songs in list">Select All</button>
                <button class="batch-clear" title="Clear selection">Clear</button>
                <div class="batch-dropdown">
                    <select class="batch-copy-select">
                        <option value="">Copy to...</option>
                        ${listOptions}
                    </select>
                </div>
                <div class="batch-dropdown">
                    <select class="batch-move-select">
                        <option value="">Move to...</option>
                        ${listOptions}
                    </select>
                </div>
                <button class="batch-remove" title="Remove selected from list">Remove</button>
            </div>
        </div>
    `;

    // Event handlers
    batchOperationsBar.querySelector('.batch-select-all')?.addEventListener('click', handleBatchSelectAll);
    batchOperationsBar.querySelector('.batch-clear')?.addEventListener('click', handleBatchClear);
    batchOperationsBar.querySelector('.batch-copy-select')?.addEventListener('change', handleBatchCopy);
    batchOperationsBar.querySelector('.batch-move-select')?.addEventListener('change', handleBatchMove);
    batchOperationsBar.querySelector('.batch-remove')?.addEventListener('click', handleBatchRemove);

    batchOperationsBar.classList.add('visible');
}

/**
 * Hide the batch operations bar
 */
export function hideBatchOperationsBar() {
    if (batchOperationsBar) {
        batchOperationsBar.classList.remove('visible');
    }
}

/**
 * Handle "Select All" button click
 */
function handleBatchSelectAll() {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;

    const songIds = Array.from(resultsDiv.querySelectorAll('.result-item'))
        .map(item => item.dataset.id)
        .filter(Boolean);

    selectAllSongs(songIds);

    // Update select buttons visually
    resultsDiv.querySelectorAll('.result-select-btn').forEach(btn => {
        btn.classList.add('selected');
        btn.closest('.result-item')?.classList.add('selected');
    });

    updateBatchOperationsBar();
}

/**
 * Handle "Clear" button click
 */
function handleBatchClear() {
    clearSelectedSongs();

    // Update select buttons visually
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) {
        resultsDiv.querySelectorAll('.result-select-btn').forEach(btn => {
            btn.classList.remove('selected');
            btn.closest('.result-item')?.classList.remove('selected');
        });
    }

    updateBatchOperationsBar();
}

/**
 * Handle batch copy dropdown change
 */
function handleBatchCopy(e) {
    const targetListId = e.target.value;
    if (!targetListId) return;

    const currentListId = getViewingListId();
    const songIds = Array.from(selectedSongIds);
    songIds.forEach(songId => {
        // Copy metadata along with the song
        const metadata = getSongMetadata(currentListId, songId);
        addSongToList(targetListId, songId, false, metadata);
    });

    // Reset dropdown
    e.target.value = '';

}

/**
 * Handle batch move dropdown change
 */
function handleBatchMove(e) {
    const targetListId = e.target.value;
    if (!targetListId) return;

    const currentListId = getViewingListId();
    const songIds = Array.from(selectedSongIds);

    songIds.forEach(songId => {
        // Copy metadata along with the song
        const metadata = getSongMetadata(currentListId, songId);
        addSongToList(targetListId, songId, false, metadata);
        if (currentListId === FAVORITES_LIST_ID || currentListId === 'favorites') {
            toggleFavorite(songId);
        } else {
            removeSongFromList(currentListId, songId);
        }
    });

    // Clear selection and refresh view
    clearSelectedSongs();
    hideBatchOperationsBar();

    // Refresh the list view
    if (currentListId === FAVORITES_LIST_ID || currentListId === 'favorites') {
        showFavorites();
    } else {
        showListView(currentListId);
    }
}

/**
 * Handle batch remove button click
 */
function handleBatchRemove() {
    const currentListId = getViewingListId();
    const songIds = Array.from(selectedSongIds);

    songIds.forEach(songId => {
        if (currentListId === FAVORITES_LIST_ID || currentListId === 'favorites') {
            toggleFavorite(songId);
        } else {
            removeSongFromList(currentListId, songId);
        }
    });

    // Clear selection and refresh view
    clearSelectedSongs();
    hideBatchOperationsBar();

    // Refresh the list view
    if (currentListId === FAVORITES_LIST_ID || currentListId === 'favorites') {
        showFavorites();
    } else {
        showListView(currentListId);
    }
}

/**
 * Clear all drag indicator classes from result items
 */
function clearDragClasses(container) {
    container.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
        el.classList.remove('drag-over-above', 'drag-over-below');
    });
    currentDropTarget = null;
    currentDropPosition = null;
}

/**
 * Flush pending search analytics (call on result click or navigation)
 */
function flushPendingSearch() {
    if (analyticsDebounceTimer) {
        clearTimeout(analyticsDebounceTimer);
        analyticsDebounceTimer = null;
    }
    if (pendingSearchData && pendingSearchData.query !== lastRecordedQuery) {
        analyticsTrackSearch(pendingSearchData.query, pendingSearchData.resultCount, pendingSearchData.filters);
        lastRecordedQuery = pendingSearchData.query;
    }
    pendingSearchData = null;
}

// Search syntax prefix map - loaded from shared config or fallback
// Ground truth: docs/data/search-syntax.json
let searchPrefixMap = null;

/**
 * Load prefix map from shared config (lazy, cached)
 */
async function loadPrefixMap() {
    if (searchPrefixMap) return searchPrefixMap;

    try {
        const response = await fetch('data/search-syntax.json');
        if (response.ok) {
            const config = await response.json();
            searchPrefixMap = config.prefixes || {};
            return searchPrefixMap;
        }
    } catch (e) {
        // Fallback silently
    }

    // Fallback if config not found
    searchPrefixMap = {
        'artist:': 'artist', 'a:': 'artist',
        'title:': 'title',
        'lyrics:': 'lyrics', 'l:': 'lyrics',
        'composer:': 'composer', 'writer:': 'composer',
        'key:': 'key', 'k:': 'key',
        'chord:': 'chord', 'c:': 'chord',
        'prog:': 'prog', 'p:': 'prog',
        'tag:': 'tag', 't:': 'tag',
        'status:': 'status', 's:': 'status'
    };
    return searchPrefixMap;
}

// Synchronous version using cached value (call loadPrefixMap first during init)
function getPrefixMap() {
    return searchPrefixMap || {
        'artist:': 'artist', 'a:': 'artist',
        'title:': 'title',
        'lyrics:': 'lyrics', 'l:': 'lyrics',
        'composer:': 'composer', 'writer:': 'composer',
        'key:': 'key', 'k:': 'key',
        'chord:': 'chord', 'c:': 'chord',
        'prog:': 'prog', 'p:': 'prog',
        'tag:': 'tag', 't:': 'tag',
        'status:': 'status', 's:': 'status'
    };
}

/**
 * Parse search query for special modifiers
 * Supports field:value syntax where value continues until next field: or end
 * Supports negative filters with - prefix: -artist:name, -tag:genre
 * Examples:
 *   artist:hank williams lyrics:cheatin
 *   tag:classic -tag:instrumental
 *   george jones -lyrics:drinking
 */
export function parseSearchQuery(query) {
    const result = {
        textTerms: [],
        chordFilters: [],       // e.g., ['VII', 'II']
        progressionFilter: null, // e.g., ['ii', 'V', 'I']
        tagFilters: [],         // e.g., ['Bluegrass', 'JamFriendly']
        artistFilter: null,     // artist name search
        titleFilter: null,      // title search
        lyricsFilter: null,     // lyrics search
        composerFilter: null,   // composer/writer search
        keyFilter: null,        // musical key search
        // Negative filters (exclusions)
        excludeArtist: null,
        excludeTitle: null,
        excludeLyrics: null,
        excludeComposer: null,
        excludeKey: null,
        excludeTags: [],
        excludeChords: [],
        statusFilter: null,
        excludeStatus: null
    };

    // Get prefix map (from shared config or fallback)
    const prefixMap = getPrefixMap();

    const prefixPattern = Object.keys(prefixMap).sort((a, b) => b.length - a.length);
    // Match optional - before prefix
    const prefixRegex = new RegExp(`(-?)(${prefixPattern.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');

    // Find all prefix positions
    const matches = [];
    let match;
    while ((match = prefixRegex.exec(query)) !== null) {
        const isNegative = match[1] === '-';
        const prefix = match[2].toLowerCase();
        matches.push({
            prefix,
            isNegative,
            index: match.index,
            end: match.index + match[0].length
        });
    }

    // Extract values for each prefix
    for (let i = 0; i < matches.length; i++) {
        const { prefix, isNegative, end } = matches[i];
        const nextStart = i + 1 < matches.length ? matches[i + 1].index : query.length;
        const value = query.slice(end, nextStart).trim();
        const fieldType = prefixMap[prefix];

        if (!value) continue;

        if (isNegative) {
            // Negative filters
            switch (fieldType) {
                case 'artist':
                    result.excludeArtist = value.toLowerCase();
                    break;
                case 'title':
                    result.excludeTitle = value.toLowerCase();
                    break;
                case 'lyrics':
                    result.excludeLyrics = value.toLowerCase();
                    break;
                case 'composer':
                    result.excludeComposer = value.toLowerCase();
                    break;
                case 'key':
                    result.excludeKey = value.toUpperCase();
                    break;
                case 'chord':
                    result.excludeChords.push(...value.split(',').map(c => c.trim()).filter(c => c));
                    break;
                case 'tag': {
                    // Tags are single words - split by whitespace first
                    const parts = value.split(/\s+/).filter(p => p);
                    if (parts.length > 0) {
                        const tags = parts[0].split(',').map(t => t.trim()).filter(t => t);
                        result.excludeTags.push(...tags);
                        // Remaining parts are text terms
                        if (parts.length > 1) {
                            result.textTerms.push(...parts.slice(1).map(t => t.toLowerCase()));
                        }
                    }
                    break;
                }
                case 'status':
                    result.excludeStatus = value.toLowerCase();
                    break;
            }
        } else {
            // Positive filters
            switch (fieldType) {
                case 'artist':
                    result.artistFilter = value.toLowerCase();
                    break;
                case 'title':
                    result.titleFilter = value.toLowerCase();
                    break;
                case 'lyrics':
                    result.lyricsFilter = value.toLowerCase();
                    break;
                case 'composer':
                    result.composerFilter = value.toLowerCase();
                    break;
                case 'key':
                    result.keyFilter = value.toUpperCase();
                    break;
                case 'chord':
                    result.chordFilters.push(...value.split(',').map(c => c.trim()).filter(c => c));
                    break;
                case 'prog':
                    result.progressionFilter = value.split('-').map(c => c.trim()).filter(c => c);
                    break;
                case 'tag': {
                    // Tags are single words - split by whitespace first
                    // Only first token(s) are tags (may be comma-separated)
                    // Remaining words become text search terms
                    const parts = value.split(/\s+/).filter(p => p);
                    if (parts.length > 0) {
                        // First part can be comma-separated tags
                        const tags = parts[0].split(',').map(t => t.trim()).filter(t => t);
                        result.tagFilters.push(...tags);
                        // Remaining parts are text terms
                        if (parts.length > 1) {
                            result.textTerms.push(...parts.slice(1).map(t => t.toLowerCase()));
                        }
                    }
                    break;
                }
                case 'status':
                    result.statusFilter = value.toLowerCase();
                    break;
            }
        }
    }

    // Extract text before the first prefix (general search terms)
    const firstPrefixIndex = matches.length > 0 ? matches[0].index : query.length;
    const generalText = query.slice(0, firstPrefixIndex).trim();
    if (generalText) {
        result.textTerms = generalText.toLowerCase().split(/\s+/).filter(t => t);
    }

    return result;
}

/**
 * Check if song contains all required Nashville chords
 */
export function songHasChords(song, requiredChords) {
    if (!requiredChords.length) return true;

    // Use precomputed nashville array from index
    const chords = song.nashville || [];
    if (!chords.length) return false;

    return requiredChords.every(req => chords.includes(req));
}

/**
 * Normalize a Nashville number by stripping extensions (7, maj7, dim, etc.)
 * e.g., "V7" -> "V", "iii7" -> "iii", "IVmaj7" -> "IV", "viidim" -> "vii"
 */
function normalizeNashville(chord) {
    if (!chord) return chord;
    // Strip common extensions: 7, maj7, min7, m7, dim, aug, sus, add, etc.
    // Keep the Roman numeral base (including any leading 'b' or '#')
    // Match pattern: optional flat/sharp, then Roman numeral (I-VII or i-vii)
    const match = chord.match(/^([b#]?)(VII|VII|VI|IV|III|II|I|vii|vi|iv|iii|ii|i|V|v)/);
    return match ? match[1] + match[2] : chord;
}

/**
 * Check if song contains progression
 */
export function songHasProgression(song, progression) {
    if (!progression || !progression.length) return true;

    // Use precomputed progression array from index
    const sequence = song.progression || [];
    if (!sequence.length) return false;

    // Normalize query progression to strip extensions (V7 -> V, iii7 -> iii)
    const normalizedQuery = progression.map(normalizeNashville);

    // Look for progression anywhere in sequence
    for (let i = 0; i <= sequence.length - normalizedQuery.length; i++) {
        let match = true;
        for (let j = 0; j < normalizedQuery.length; j++) {
            if (sequence[i + j] !== normalizedQuery[j]) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }

    return false;
}

/**
 * Format covering artists for display (clickable, shows first 2 + count)
 */
function formatCoveringArtists(artists, primaryArtist) {
    // Filter out the primary artist if they're in the list
    const others = artists.filter(a =>
        a.toLowerCase() !== (primaryArtist || '').toLowerCase()
    );
    if (others.length === 0) return '';

    // Make artists clickable - clicking filters by that artist
    const artistLinks = others.slice(0, 2).map(a =>
        `<span class="covering-artist" data-artist="${escapeHtml(a)}">${escapeHtml(a)}</span>`
    ).join(', ');
    const more = others.length > 2 ? ` <span class="covering-more">+${others.length - 2} more</span>` : '';
    return `<div class="result-covering">Also by: ${artistLinks}${more}</div>`;
}

/**
 * Show popular songs on initial load (sorted by canonical_rank)
 */
export function showPopularSongs() {
    // Sort by canonical_rank (higher = more popular)
    const sorted = [...allSongs].sort((a, b) => {
        const aRank = a.canonical_rank || 0;
        const bRank = b.canonical_rank || 0;
        return bRank - aRank;
    });
    const sample = sorted.slice(0, 50);
    // Use distinct title count to match subtitle
    const distinctCount = new Set(allSongs.map(s => s.title?.toLowerCase())).size;
    if (searchStatsEl) {
        searchStatsEl.textContent = `${distinctCount.toLocaleString()} songs`;
    }
    renderResults(sample, '');
}

// Alias for backwards compatibility
export const showRandomSongs = showPopularSongs;

/**
 * Search songs
 * @param {string} query - Search query
 * @param {Object} options - Options
 * @param {boolean} options.skipRender - If true, skip rendering (caller will handle it)
 * @returns {Array} Filtered and sorted results (deduped)
 */
export function search(query, options = {}) {
    const { skipRender = false } = options;

    // Clear any list view state when searching
    clearListView();
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navSearchEl) navSearchEl.classList.add('active');

    if (!query.trim()) {
        // Reset analytics state so future searches get tracked
        if (analyticsDebounceTimer) clearTimeout(analyticsDebounceTimer);
        pendingSearchData = null;
        lastRecordedQuery = null;
        showPopularSongs();
        return allSongs;
    }

    const {
        textTerms, chordFilters, progressionFilter, tagFilters,
        artistFilter, titleFilter, lyricsFilter, composerFilter, keyFilter,
        excludeArtist, excludeTitle, excludeLyrics, excludeComposer, excludeKey,
        excludeTags, excludeChords,
        statusFilter, excludeStatus
    } = parseSearchQuery(query);

    const results = allSongs.filter(song => {
        // General text search (searches all fields)
        if (textTerms.length > 0) {
            const searchText = [
                song.title || '',
                song.artist || '',
                (song.covering_artists || []).join(' '),
                song.composer || '',
                song.lyrics || '',
                song.first_line || ''
            ].join(' ').toLowerCase();

            if (!textTerms.every(term => searchText.includes(term))) {
                return false;
            }
        }

        // Field-specific filters (inclusion)
        // Artist filter checks both primary artist and covering artists
        if (artistFilter) {
            const primaryMatch = (song.artist || '').toLowerCase().includes(artistFilter);
            const coveringArtists = song.covering_artists || [];
            const coveringMatch = coveringArtists.some(a => a.toLowerCase().includes(artistFilter));
            if (!primaryMatch && !coveringMatch) {
                return false;
            }
        }
        if (titleFilter && !(song.title || '').toLowerCase().includes(titleFilter)) {
            return false;
        }
        if (lyricsFilter && !(song.lyrics || '').toLowerCase().includes(lyricsFilter)) {
            return false;
        }
        if (composerFilter && !(song.composer || '').toLowerCase().includes(composerFilter)) {
            return false;
        }
        if (keyFilter && (song.key || '').toUpperCase() !== keyFilter) {
            return false;
        }

        // Field-specific filters (exclusion)
        if (excludeArtist && (song.artist || '').toLowerCase().includes(excludeArtist)) {
            return false;
        }
        if (excludeTitle && (song.title || '').toLowerCase().includes(excludeTitle)) {
            return false;
        }
        if (excludeLyrics && (song.lyrics || '').toLowerCase().includes(excludeLyrics)) {
            return false;
        }
        if (excludeComposer && (song.composer || '').toLowerCase().includes(excludeComposer)) {
            return false;
        }
        if (excludeKey && (song.key || '').toUpperCase() === excludeKey) {
            return false;
        }

        // Chord search
        if (chordFilters.length > 0) {
            if (!songHasChords(song, chordFilters)) return false;
        }

        // Exclude chords
        if (excludeChords.length > 0) {
            if (songHasChords(song, excludeChords)) return false;
        }

        // Progression search
        if (progressionFilter && progressionFilter.length > 0) {
            if (!songHasProgression(song, progressionFilter)) return false;
        }

        // Tag search
        if (tagFilters.length > 0) {
            if (!songHasTags(song, tagFilters)) return false;
        }

        // Exclude tags
        if (excludeTags.length > 0) {
            if (songHasTags(song, excludeTags)) return false;
        }

        // Status filter
        if (statusFilter) {
            const songStatus = song.status || 'complete';
            if (songStatus !== statusFilter) return false;
        }
        if (excludeStatus) {
            const songStatus = song.status || 'complete';
            if (songStatus === excludeStatus) return false;
        }

        return true;
    });

    // Sort by relevance (for text searches) with canonical_rank as tie-breaker
    const textQuery = textTerms.join(' ');
    results.sort((a, b) => {
        const aTitle = (a.title || '').toLowerCase();
        const bTitle = (b.title || '').toLowerCase();
        const aArtist = (a.artist || '').toLowerCase();
        const bArtist = (b.artist || '').toLowerCase();

        if (textQuery) {
            // Text relevance scoring
            if (aTitle === textQuery && bTitle !== textQuery) return -1;
            if (bTitle === textQuery && aTitle !== textQuery) return 1;
            if (aTitle.startsWith(textQuery) && !bTitle.startsWith(textQuery)) return -1;
            if (bTitle.startsWith(textQuery) && !aTitle.startsWith(textQuery)) return 1;
            if (aTitle.includes(textQuery) && !bTitle.includes(textQuery)) return -1;
            if (bTitle.includes(textQuery) && !aTitle.includes(textQuery)) return 1;
            if (aArtist.includes(textQuery) && !bArtist.includes(textQuery)) return -1;
            if (bArtist.includes(textQuery) && !aArtist.includes(textQuery)) return 1;
        }

        // Tie-breaker: sort by canonical_rank (higher = more popular = first)
        const aRank = a.canonical_rank || 0;
        const bRank = b.canonical_rank || 0;
        return bRank - aRank;
    });

    // Dedupe by group_id for accurate count
    const seenGroups = new Set();
    const dedupedResults = [];
    for (const song of results) {
        const groupId = song.group_id;
        if (groupId && seenGroups.has(groupId)) continue;
        if (groupId) seenGroups.add(groupId);
        dedupedResults.push(song);
    }

    // Update stats with search info
    let statsText = `${dedupedResults.length.toLocaleString()} songs`;
    const filters = [];
    // Inclusion filters
    if (artistFilter) filters.push(`artist: "${artistFilter}"`);
    if (titleFilter) filters.push(`title: "${titleFilter}"`);
    if (composerFilter) filters.push(`by: "${composerFilter}"`);
    if (keyFilter) filters.push(`key: ${keyFilter}`);
    if (chordFilters.length > 0) filters.push(`chords: ${chordFilters.join(', ')}`);
    if (progressionFilter && progressionFilter.length > 0) filters.push(`prog: ${progressionFilter.join('-')}`);
    if (tagFilters.length > 0) filters.push(`tags: ${tagFilters.map(formatTagName).join(', ')}`);
    if (lyricsFilter) filters.push(`lyrics: "${lyricsFilter}"`);
    if (statusFilter) filters.push(`status: ${statusFilter}`);
    // Exclusion filters
    if (excludeArtist) filters.push(`-artist: "${excludeArtist}"`);
    if (excludeTitle) filters.push(`-title: "${excludeTitle}"`);
    if (excludeComposer) filters.push(`-by: "${excludeComposer}"`);
    if (excludeKey) filters.push(`-key: ${excludeKey}`);
    if (excludeChords.length > 0) filters.push(`-chords: ${excludeChords.join(', ')}`);
    if (excludeTags.length > 0) filters.push(`-tags: ${excludeTags.map(formatTagName).join(', ')}`);
    if (excludeLyrics) filters.push(`-lyrics: "${excludeLyrics}"`);
    if (excludeStatus) filters.push(`-status: ${excludeStatus}`);
    if (filters.length > 0) {
        statsText += ` (${filters.join(', ')})`;
    }
    if (searchStatsEl) {
        searchStatsEl.textContent = statsText;
    }

    // Track search in our analytics (debounced to capture final query, not keystrokes)
    if (analyticsDebounceTimer) clearTimeout(analyticsDebounceTimer);
    pendingSearchData = {
        query,
        resultCount: dedupedResults.length,
        filters: {
            has_artist: !!artistFilter,
            has_title: !!titleFilter,
            has_tag: tagFilters.length > 0,
            has_chord: chordFilters.length > 0,
            has_progression: !!progressionFilter,
            has_key: !!keyFilter,
            has_lyrics: !!lyricsFilter
        }
    };
    analyticsDebounceTimer = setTimeout(() => {
        flushPendingSearch();
    }, ANALYTICS_DEBOUNCE_MS);

    if (!skipRender) {
        renderResults(dedupedResults.slice(0, 50), textQuery);
    }

    return dedupedResults;
}

/**
 * Render search results
 */
export function renderResults(songs, query) {
    if (!resultsDivEl) return;

    if (songs.length === 0) {
        const q = searchInputEl?.value?.trim() || '';
        resultsDivEl.innerHTML = `
            <div class="empty-results">
                <p class="empty-results-title">No songs found</p>
                ${q ? `
                    <p class="empty-results-hint">Can't find "${escapeHtml(q)}"?</p>
                    <div class="empty-results-actions">
                        <a href="#request-song" class="empty-results-btn">Request this song</a>
                        <a href="#bounty" class="empty-results-link">Browse the Bounty Board</a>
                    </div>
                ` : ''}
            </div>
        `;
        return;
    }

    // Check if we're viewing a list or favorites (enables drag/drop reordering)
    // Only allow dragging for own lists/favorites, not shared public lists
    const viewingListId = getViewingListId();
    const canReorder = isViewingOwnList();
    const isDraggable = canReorder;

    // Group songs and dedupe by group_id (show one representative per group)
    // Skip deduping for lists - show all songs in order
    const seenGroups = new Set();
    const dedupedSongs = [];

    for (const song of songs) {
        const groupId = song.group_id;
        // Don't dedupe in list view - user may have same song multiple times intentionally
        if (!isDraggable && groupId && seenGroups.has(groupId)) {
            continue;  // Skip, we already have a song from this group
        }
        if (groupId) {
            seenGroups.add(groupId);
        }
        dedupedSongs.push(song);
    }

    resultsDivEl.innerHTML = dedupedSongs.map((song, index) => {
        const favClass = isFavorite(song.id) ? 'is-favorite' : '';
        const inList = isSongInAnyList(song.id);
        const btnClass = (isFavorite(song.id) || inList) ? 'has-lists' : '';

        // Check for multiple versions
        const groupId = song.group_id;
        const versions = groupId ? (songGroups[groupId] || []) : [];
        const versionCount = versions.length;
        const versionBadge = versionCount > 1
            ? `<span class="version-badge" data-group-id="${groupId}">${versionCount} versions</span>`
            : '';

        // Generate tag badges (max 3)
        const tags = song.tags || {};
        const tagBadges = Object.keys(tags).slice(0, 3).map(tag => {
            const category = getTagCategory(tag);
            return `<span class="tag-badge tag-${category}" data-tag="${tag}">${formatTagName(tag)}</span>`;
        }).join('');

        // Tablature/notation instrument tags (shown as tag badges)
        const tabParts = song.tablature_parts || [];
        const hasAbc = song.content && song.content.includes('{start_of_abc}');

        // Collect instrument tags from tabs and ABC
        const instrumentTags = new Set();
        tabParts.forEach(p => {
            if (p.instrument) instrumentTags.add(p.instrument.toLowerCase());
        });
        if (hasAbc) instrumentTags.add('fiddle'); // ABC assumed to be fiddle

        // Create instrument badges
        const instrumentBadges = Array.from(instrumentTags).map(inst => {
            const label = inst.charAt(0).toUpperCase() + inst.slice(1);
            return `<span class="tag-badge tag-instrument" data-tag="${inst}" title="Has ${label} tab/notation">${label}</span>`;
        }).join('');

        // Placeholder badge
        const placeholderBadge = song.status === 'placeholder'
            ? '<span class="placeholder-badge">Placeholder</span>'
            : '';

        // Document parts badge (PDF)
        const docParts = song.document_parts || [];
        const docBadge = docParts.length > 0
            ? '<span class="doc-badge">PDF</span>'
            : '';

        // Grassiness score badge (for songs with score >= 20)
        const grassinessScore = song.grassiness || 0;
        const grassinessBadge = grassinessScore >= 20
            ? `<span class="grassiness-badge" title="Bluegrass score: ${grassinessScore}">🎵 ${grassinessScore}</span>`
            : '';

        // Use first covering artist as primary display (tier-sorted, most notable first)
        const coveringArtists = song.covering_artists || [];
        const primaryArtist = coveringArtists.length > 0
            ? coveringArtists[0]
            : (song.artist || 'Unknown artist');

        // Format remaining covering artists (skip first since it's now primary)
        const coveringDisplay = formatCoveringArtists(
            coveringArtists.slice(1),
            primaryArtist
        );

        // Add drag handle and draggable for list view
        const dragHandle = isDraggable ? '<span class="drag-handle" title="Drag to reorder">⋮⋮</span>' : '';
        const draggableAttr = isDraggable ? `draggable="true" data-index="${index}"` : '';

        // Always show remove button for own lists (visible on hover via CSS)
        const removeBtn = canReorder
            ? `<button class="result-remove-btn" data-song-id="${song.id}" title="Remove from list">×</button>`
            : '';

        // Always show select button for own lists (circular button with checkmark)
        const isSelected = selectedSongIds.has(song.id);
        const selectBtn = canReorder
            ? `<button class="result-select-btn ${isSelected ? 'selected' : ''}" data-song-id="${song.id}" title="Select for batch operation">✓</button>`
            : '';

        const selectedClass = isSelected ? 'selected' : '';

        // List item metadata (only shown when viewing a list)
        let metadataBadges = '';
        let notesBtn = '';
        if (viewingListId) {
            const metadata = getSongMetadata(viewingListId, song.id);
            if (metadata) {
                const keyBadge = metadata.key ? `<span class="list-item-badge key-badge">${escapeHtml(metadata.key)}</span>` : '';
                const tempoBadge = metadata.tempo ? `<span class="list-item-badge tempo-badge">${metadata.tempo}</span>` : '';
                metadataBadges = `<span class="list-item-badges">${keyBadge}${tempoBadge}</span>`;
            }
            const hasNotes = metadata?.notes && metadata.notes.trim();
            const notesClass = hasNotes ? 'has-notes' : '';
            notesBtn = `<button class="list-notes-btn ${notesClass}" data-song-id="${song.id}" data-song-title="${escapeHtml(song.title || 'Song')}" title="${hasNotes ? 'Edit notes' : 'Add notes'}">&#128221;</button>`;
        }

        return `
            <div class="result-item ${favClass} ${selectedClass}" data-id="${song.id}" data-group-id="${groupId || ''}" ${draggableAttr}>
                ${dragHandle}
                <div class="result-main">
                    <div class="result-title-artist">
                        <div class="result-title">${highlightMatch(song.title || 'Unknown', query)}${versionBadge}${placeholderBadge}${docBadge}${instrumentBadges}${grassinessBadge}</div>
                        ${metadataBadges}
                    </div>
                    <div class="result-artist">${highlightMatch(primaryArtist, query)}</div>
                    ${coveringDisplay}
                    ${tagBadges ? `<div class="result-tags">${tagBadges}</div>` : ''}
                    <div class="result-preview">${song.first_line || (song.status === 'placeholder' && song.notes ? song.notes.slice(0, 80) : '')}</div>
                </div>
                ${selectBtn}
                ${notesBtn}
                <button class="result-list-btn ${btnClass}" data-song-id="${song.id}" title="Add to list">+</button>
                ${removeBtn}
            </div>
        `;
    }).join('');

    // Add event listeners
    setupResultEventListeners(resultsDivEl);
}

/**
 * Setup event delegation for search results (called once per container)
 * Uses event delegation to avoid per-item listener attachment
 */
function setupResultEventListeners(resultsDiv) {
    // Only set up delegation once per container instance
    if (initializedContainers.has(resultsDiv)) return;
    initializedContainers.set(resultsDiv, true);

    // === CLICK DELEGATION ===
    // Single click handler for all result items, buttons, and badges
    resultsDiv.addEventListener('click', (e) => {
        // Handle select button click (multi-select mode)
        const selectBtn = e.target.closest('.result-select-btn');
        if (selectBtn) {
            e.stopPropagation();
            const songId = selectBtn.dataset.songId;
            toggleSongSelection(songId);
            // Update visual state - toggle selected class on button and result item
            const isNowSelected = selectedSongIds.has(songId);
            selectBtn.classList.toggle('selected', isNowSelected);
            const resultItem = selectBtn.closest('.result-item');
            if (resultItem) {
                resultItem.classList.toggle('selected', isNowSelected);
            }
            // Update batch operations bar
            updateBatchOperationsBar();
            return;
        }

        // Handle notes button click (list view only)
        const notesBtn = e.target.closest('.list-notes-btn');
        if (notesBtn) {
            e.stopPropagation();
            const songId = notesBtn.dataset.songId;
            const songTitle = notesBtn.dataset.songTitle || 'Song';
            const currentListId = getViewingListId();
            if (currentListId && songId) {
                openNotesSheet(currentListId, songId, songTitle);
            }
            return;
        }

        // Handle remove button click (edit mode)
        const removeBtn = e.target.closest('.result-remove-btn');
        if (removeBtn) {
            e.stopPropagation();
            const songId = removeBtn.dataset.songId;
            const currentListId = getViewingListId();
            if (currentListId && songId) {
                if (currentListId === FAVORITES_LIST_ID || currentListId === 'favorites') {
                    toggleFavorite(songId);
                    showFavorites();
                } else {
                    removeSongFromList(currentListId, songId);
                    showListView(currentListId);
                }
            }
            return;
        }

        // Handle list button click
        const listBtn = e.target.closest('.result-list-btn');
        if (listBtn) {
            e.stopPropagation();
            showResultListPicker(listBtn, listBtn.dataset.songId);
            return;
        }

        // Handle tag badge click
        const tagBadge = e.target.closest('.tag-badge');
        if (tagBadge) {
            e.stopPropagation();
            const tag = tagBadge.dataset.tag;
            if (tag && searchInputEl) {
                searchInputEl.value = `tag:${tag}`;
                search(`tag:${tag}`);
            }
            return;
        }

        // Handle covering artist click
        const coveringArtist = e.target.closest('.covering-artist');
        if (coveringArtist) {
            e.stopPropagation();
            const artistName = coveringArtist.dataset.artist;
            if (artistName && searchInputEl) {
                searchInputEl.value = `artist:${artistName}`;
                search(`artist:${artistName}`);
            }
            return;
        }

        // Handle drag handle - ignore clicks
        if (e.target.classList.contains('drag-handle')) return;

        // Handle result item click (open song)
        const resultItem = e.target.closest('.result-item');
        if (resultItem) {
            const groupId = resultItem.dataset.groupId;
            const versions = groupId ? (songGroups[groupId] || []) : [];
            const index = parseInt(resultItem.dataset.index, 10);

            // Flush pending search before recording click
            flushPendingSearch();
            trackSearchResultClick(resultItem.dataset.id, index, searchInputEl?.value || '');

            // Open song - auto-fullscreen if coming from a list/favorites view
            const fromList = !!getViewingListId();
            if (versions.length > 1) {
                showVersionPicker(groupId, { fromList });
            } else {
                const songId = resultItem.dataset.id;
                const song = allSongs.find(s => s.id === songId);
                // Placeholders and tab-only works route through work view
                if (isPlaceholder(song) || isTabOnlyWork(song)) {
                    openWork(songId);
                } else {
                    openSong(songId, { fromList });
                }
            }
        }
    });

    // === DRAG START DELEGATION ===
    resultsDiv.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.result-item');
        if (!item || !isViewingOwnList()) return;

        draggedItem = item;
        draggedIndex = parseInt(item.dataset.index, 10);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.id);
    });

    // === DRAG END DELEGATION ===
    resultsDiv.addEventListener('dragend', (e) => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
        }
        draggedItem = null;
        draggedIndex = null;
        clearDragClasses(resultsDiv);
    });

    // === DRAGOVER (container level) ===
    resultsDiv.addEventListener('dragover', (e) => {
        if (!draggedItem) return;
        e.preventDefault();

        const items = Array.from(resultsDiv.querySelectorAll('.result-item:not(.dragging)'));
        if (items.length === 0) return;

        // Find the closest item edge to the cursor
        let closestItem = null;
        let closestPosition = null;
        let closestDistance = Infinity;

        for (const item of items) {
            const rect = item.getBoundingClientRect();
            const topDist = Math.abs(e.clientY - rect.top);
            const bottomDist = Math.abs(e.clientY - rect.bottom);

            if (topDist < closestDistance) {
                closestDistance = topDist;
                closestItem = item;
                closestPosition = 'above';
            }
            if (bottomDist < closestDistance) {
                closestDistance = bottomDist;
                closestItem = item;
                closestPosition = 'below';
            }
        }

        // Only update if changed
        if (closestItem && (currentDropTarget !== closestItem || currentDropPosition !== closestPosition)) {
            clearDragClasses(resultsDiv);
            currentDropTarget = closestItem;
            currentDropPosition = closestPosition;
            closestItem.classList.add(closestPosition === 'above' ? 'drag-over-above' : 'drag-over-below');
        }
    });

    // === DRAGLEAVE ===
    resultsDiv.addEventListener('dragleave', (e) => {
        // Only clear if leaving the container entirely
        if (!resultsDiv.contains(e.relatedTarget)) {
            clearDragClasses(resultsDiv);
        }
    });

    // === DROP ===
    resultsDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedItem || !currentDropTarget || draggedIndex === null) {
            clearDragClasses(resultsDiv);
            return;
        }

        const targetIndex = parseInt(currentDropTarget.dataset.index, 10);
        const wasAbove = currentDropPosition === 'above';
        clearDragClasses(resultsDiv);

        // Calculate insertion index
        let toIndex;
        if (draggedIndex < targetIndex) {
            toIndex = wasAbove ? targetIndex - 1 : targetIndex;
        } else {
            toIndex = wasAbove ? targetIndex : targetIndex + 1;
        }
        toIndex = Math.max(0, toIndex);

        if (toIndex === draggedIndex) return;

        const currentListId = getViewingListId();

        if (currentListId === 'favorites') {
            if (reorderFavoriteItem(draggedIndex, toIndex)) {
                showFavorites();
            }
        } else if (currentListId) {
            if (reorderSongInList(currentListId, draggedIndex, toIndex)) {
                import('./lists.js').then(({ showListView }) => {
                    showListView(currentListId);
                });
            }
        }
    });

    // === CONTEXT MENU (right-click) ===
    resultsDiv.addEventListener('contextmenu', (e) => {
        const resultItem = e.target.closest('.result-item');
        if (!resultItem) return;

        // Only show context menu when viewing a list
        const currentListId = getViewingListId();
        if (!currentListId) return;

        e.preventDefault();
        const songId = resultItem.dataset.id;
        showSongContextMenu(e.clientX, e.clientY, songId, currentListId);
    });
}

/**
 * Track search in GA (debounced)
 */
let searchTrackingTimeout = null;
export function trackSearch(query) {
    if (searchTrackingTimeout) clearTimeout(searchTrackingTimeout);
    searchTrackingTimeout = setTimeout(() => {
        if (typeof gtag === 'function' && query.trim()) {
            gtag('event', 'search', { search_term: query.trim() });
        }
    }, 1000);
}

/**
 * Initialize search module with DOM elements
 */
export async function initSearch(options) {
    const {
        searchInput,
        searchStats,
        resultsDiv,
        navFavorites,
        navSearch
    } = options;

    searchInputEl = searchInput;
    searchStatsEl = searchStats;
    resultsDivEl = resultsDiv;
    navFavoritesEl = navFavorites;
    navSearchEl = navSearch;

    // Preload search syntax config (shared with CLI)
    await loadPrefixMap();

    // Setup search input listener
    if (searchInputEl) {
        searchInputEl.addEventListener('input', (e) => {
            search(e.target.value);
            trackSearch(e.target.value);
        });
    }

    // Search hints click to populate
    document.querySelectorAll('.search-hint').forEach(hint => {
        hint.addEventListener('click', () => {
            if (!searchInputEl) return;
            const current = searchInputEl.value.trim();
            const hintText = hint.textContent;
            searchInputEl.value = current ? `${current} ${hintText}` : hintText;
            searchInputEl.focus();
            search(searchInputEl.value);
        });
    });
}
