// Core search functionality for Bluegrass Songbook

import { allSongs, songGroups } from './state.js';
import { highlightMatch } from './utils.js';
import { songHasTags, getTagCategory, formatTagName } from './tags.js';
import {
    isFavorite, reorderFavoriteItem, showFavorites,
    isSongInAnyList, showResultListPicker, getViewingListId, reorderSongInList, isViewingOwnList
} from './lists.js';
import { openSong, showVersionPicker } from './song-view.js';
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

// Event delegation flag - ensures we only set up container listeners once
let delegationInitialized = false;

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
        excludeChords: []
    };

    // Define recognized prefixes (with short aliases)
    const prefixMap = {
        'artist:': 'artist', 'a:': 'artist',
        'title:': 'title',
        'lyrics:': 'lyrics', 'l:': 'lyrics',
        'composer:': 'composer', 'writer:': 'composer',
        'key:': 'key', 'k:': 'key',
        'chord:': 'chord', 'c:': 'chord',
        'prog:': 'prog', 'p:': 'prog',
        'tag:': 'tag', 't:': 'tag'
    };

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
                case 'tag':
                    result.excludeTags.push(...value.split(',').map(t => t.trim()).filter(t => t));
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
                case 'tag':
                    result.tagFilters.push(...value.split(',').map(t => t.trim()).filter(t => t));
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
 * Check if song contains progression
 */
export function songHasProgression(song, progression) {
    if (!progression || !progression.length) return true;

    // Use precomputed progression array from index
    const sequence = song.progression || [];
    if (!sequence.length) return false;

    // Look for exact progression anywhere in sequence
    for (let i = 0; i <= sequence.length - progression.length; i++) {
        let match = true;
        for (let j = 0; j < progression.length; j++) {
            if (sequence[i + j] !== progression[j]) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }

    return false;
}

/**
 * Show random songs on initial load
 */
export function showRandomSongs() {
    const shuffled = [...allSongs].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, 20);
    // Use distinct title count to match subtitle
    const distinctCount = new Set(allSongs.map(s => s.title?.toLowerCase())).size;
    if (searchStatsEl) {
        searchStatsEl.textContent = `${distinctCount.toLocaleString()} songs`;
    }
    renderResults(sample, '');
}

/**
 * Search songs
 */
export function search(query) {
    // Clear any list view state when searching
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navSearchEl) navSearchEl.classList.add('active');

    if (!query.trim()) {
        // Reset analytics state so future searches get tracked
        if (analyticsDebounceTimer) clearTimeout(analyticsDebounceTimer);
        pendingSearchData = null;
        lastRecordedQuery = null;
        showRandomSongs();
        return;
    }

    const {
        textTerms, chordFilters, progressionFilter, tagFilters,
        artistFilter, titleFilter, lyricsFilter, composerFilter, keyFilter,
        excludeArtist, excludeTitle, excludeLyrics, excludeComposer, excludeKey,
        excludeTags, excludeChords
    } = parseSearchQuery(query);

    const results = allSongs.filter(song => {
        // General text search (searches all fields)
        if (textTerms.length > 0) {
            const searchText = [
                song.title || '',
                song.artist || '',
                song.composer || '',
                song.lyrics || '',
                song.first_line || ''
            ].join(' ').toLowerCase();

            if (!textTerms.every(term => searchText.includes(term))) {
                return false;
            }
        }

        // Field-specific filters (inclusion)
        if (artistFilter && !(song.artist || '').toLowerCase().includes(artistFilter)) {
            return false;
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

        return true;
    });

    // Sort by relevance (for text searches)
    const textQuery = textTerms.join(' ');
    results.sort((a, b) => {
        const aTitle = (a.title || '').toLowerCase();
        const bTitle = (b.title || '').toLowerCase();
        const aArtist = (a.artist || '').toLowerCase();
        const bArtist = (b.artist || '').toLowerCase();

        if (textQuery) {
            if (aTitle === textQuery && bTitle !== textQuery) return -1;
            if (bTitle === textQuery && aTitle !== textQuery) return 1;
            if (aTitle.startsWith(textQuery) && !bTitle.startsWith(textQuery)) return -1;
            if (bTitle.startsWith(textQuery) && !aTitle.startsWith(textQuery)) return 1;
            if (aTitle.includes(textQuery) && !bTitle.includes(textQuery)) return -1;
            if (bTitle.includes(textQuery) && !aTitle.includes(textQuery)) return 1;
            if (aArtist.includes(textQuery) && !bArtist.includes(textQuery)) return -1;
            if (bArtist.includes(textQuery) && !aArtist.includes(textQuery)) return 1;
        }

        return 0;
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
    // Exclusion filters
    if (excludeArtist) filters.push(`-artist: "${excludeArtist}"`);
    if (excludeTitle) filters.push(`-title: "${excludeTitle}"`);
    if (excludeComposer) filters.push(`-by: "${excludeComposer}"`);
    if (excludeKey) filters.push(`-key: ${excludeKey}`);
    if (excludeChords.length > 0) filters.push(`-chords: ${excludeChords.join(', ')}`);
    if (excludeTags.length > 0) filters.push(`-tags: ${excludeTags.map(formatTagName).join(', ')}`);
    if (excludeLyrics) filters.push(`-lyrics: "${excludeLyrics}"`);
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

    renderResults(dedupedResults.slice(0, 50), textQuery);
}

/**
 * Render search results
 */
export function renderResults(songs, query) {
    if (!resultsDivEl) return;

    if (songs.length === 0) {
        resultsDivEl.innerHTML = '<div class="loading">No songs found</div>';
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

        // Add drag handle and draggable for list view
        const dragHandle = isDraggable ? '<span class="drag-handle" title="Drag to reorder">⋮⋮</span>' : '';
        const draggableAttr = isDraggable ? `draggable="true" data-index="${index}"` : '';

        return `
            <div class="result-item ${favClass}" data-id="${song.id}" data-group-id="${groupId || ''}" ${draggableAttr}>
                ${dragHandle}
                <div class="result-main">
                    <div class="result-title">${highlightMatch(song.title || 'Unknown', query)}${versionBadge}${instrumentBadges}</div>
                    <div class="result-artist">${highlightMatch(song.artist || 'Unknown artist', query)}</div>
                    ${tagBadges ? `<div class="result-tags">${tagBadges}</div>` : ''}
                    <div class="result-preview">${song.first_line || ''}</div>
                </div>
                <button class="result-list-btn ${btnClass}" data-song-id="${song.id}" title="Add to list">+</button>
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
    // Only set up delegation once per container
    if (delegationInitialized) return;
    delegationInitialized = true;

    // === CLICK DELEGATION ===
    // Single click handler for all result items, buttons, and badges
    resultsDiv.addEventListener('click', (e) => {
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
                openSong(resultItem.dataset.id, { fromList });
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
export function initSearch(options) {
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
