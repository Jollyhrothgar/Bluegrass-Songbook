// Core search functionality for Bluegrass Songbook

import {
    allSongs, songGroups,
    showingFavorites, setShowingFavorites
} from './state.js';
import { highlightMatch } from './utils.js';
import { songHasTags, getTagCategory, formatTagName } from './tags.js';
import { isFavorite } from './favorites.js';
import { isSongInAnyList, showResultListPicker } from './lists.js';
import { openSong, showVersionPicker } from './song-view.js';

// DOM element references (set by init)
let searchInputEl = null;
let searchStatsEl = null;
let resultsDivEl = null;
let navFavoritesEl = null;
let navSearchEl = null;

/**
 * Parse search query for special modifiers
 */
export function parseSearchQuery(query) {
    const result = {
        textTerms: [],
        chordFilters: [],      // e.g., ['VII', 'II']
        progressionFilter: null, // e.g., ['ii', 'V', 'I']
        tagFilters: []         // e.g., ['Bluegrass', 'JamFriendly']
    };

    const tokens = query.split(/\s+/);

    for (const token of tokens) {
        if (token.startsWith('chord:') || token.startsWith('c:')) {
            const chords = token.replace(/^(chord:|c:)/, '').split(',');
            result.chordFilters.push(...chords.filter(c => c));
        } else if (token.startsWith('prog:') || token.startsWith('p:')) {
            const prog = token.replace(/^(prog:|p:)/, '').split('-');
            result.progressionFilter = prog.filter(c => c);
        } else if (token.startsWith('tag:') || token.startsWith('t:')) {
            const tags = token.replace(/^(tag:|t:)/, '').split(',');
            result.tagFilters.push(...tags.filter(t => t));
        } else if (token) {
            result.textTerms.push(token.toLowerCase());
        }
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
    setShowingFavorites(false);
    if (navFavoritesEl) navFavoritesEl.classList.remove('active');
    if (navSearchEl) navSearchEl.classList.add('active');

    if (!query.trim()) {
        showRandomSongs();
        return;
    }

    const { textTerms, chordFilters, progressionFilter, tagFilters } = parseSearchQuery(query);

    const results = allSongs.filter(song => {
        // Text search
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

        // Chord search
        if (chordFilters.length > 0) {
            if (!songHasChords(song, chordFilters)) return false;
        }

        // Progression search
        if (progressionFilter && progressionFilter.length > 0) {
            if (!songHasProgression(song, progressionFilter)) return false;
        }

        // Tag search
        if (tagFilters.length > 0) {
            if (!songHasTags(song, tagFilters)) return false;
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
    if (chordFilters.length > 0) {
        statsText += ` with ${chordFilters.join(', ')}`;
    }
    if (progressionFilter && progressionFilter.length > 0) {
        statsText += ` with ${progressionFilter.join('-')} progression`;
    }
    if (tagFilters.length > 0) {
        statsText += ` tagged ${tagFilters.map(formatTagName).join(', ')}`;
    }
    if (searchStatsEl) {
        searchStatsEl.textContent = statsText;
    }

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

    // Group songs and dedupe by group_id (show one representative per group)
    const seenGroups = new Set();
    const dedupedSongs = [];

    for (const song of songs) {
        const groupId = song.group_id;
        if (groupId && seenGroups.has(groupId)) {
            continue;  // Skip, we already have a song from this group
        }
        if (groupId) {
            seenGroups.add(groupId);
        }
        dedupedSongs.push(song);
    }

    resultsDivEl.innerHTML = dedupedSongs.map(song => {
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

        return `
            <div class="result-item ${favClass}" data-id="${song.id}" data-group-id="${groupId || ''}">
                <div class="result-main">
                    <div class="result-title">${highlightMatch(song.title || 'Unknown', query)}${versionBadge}</div>
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
 * Setup event listeners for search results
 */
function setupResultEventListeners(resultsDiv) {
    // Click on result item opens song (or version picker if multiple versions)
    resultsDiv.querySelectorAll('.result-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't open song if clicking the list button or tag badge
            if (e.target.classList.contains('result-list-btn')) return;
            if (e.target.classList.contains('tag-badge')) return;

            const groupId = item.dataset.groupId;
            const versions = groupId ? (songGroups[groupId] || []) : [];

            if (versions.length > 1) {
                showVersionPicker(groupId);
            } else {
                openSong(item.dataset.id);
            }
        });
    });

    // Click on list button shows picker
    resultsDiv.querySelectorAll('.result-list-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showResultListPicker(btn, btn.dataset.songId);
        });
    });

    // Click on tag badge filters by that tag
    resultsDiv.querySelectorAll('.tag-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const tag = badge.dataset.tag;
            if (tag) {
                if (searchInputEl) {
                    searchInputEl.value = `tag:${tag}`;
                }
                search(`tag:${tag}`);
            }
        });
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
