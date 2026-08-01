// Tag system for Bluegrass Songbook

import { setTagTerms, toggleTagTerm } from './search-query.js';

// Tag category mapping for display
export const TAG_CATEGORIES = {
    // Genre
    'Bluegrass': 'genre', 'OldTime': 'genre', 'Folk': 'genre', 'Gospel': 'genre',
    'ClassicCountry': 'genre', 'HonkyTonk': 'genre', 'Bakersfield': 'genre',
    'Outlaw': 'genre', 'WesternSwing': 'genre', 'NashvilleSound': 'genre',
    'Rockabilly': 'genre', 'Pop': 'genre', 'Jazz': 'genre',
    // Structure
    'Instrumental': 'structure', 'Waltz': 'structure', 'Standard': 'structure', 'Crooked': 'structure',
    // Vibe
    'JamFriendly': 'vibe', 'Modal': 'vibe', 'Ragtime': 'vibe', 'Jazzy': 'vibe', 'Slow': 'vibe',
    // Instrument (for tab/notation availability)
    'banjo': 'instrument', 'mandolin': 'instrument', 'fiddle': 'instrument',
    'guitar': 'instrument', 'dobro': 'instrument', 'bass': 'instrument',
};

// Tag categories for dropdown display — mirrors the checkbox groups in
// index.html. The sub-flavors of country (HonkyTonk, Outlaw, Rockabilly,
// WesternSwing) are no longer offered as checkboxes now that the whole index is
// bluegrass-adjacent; songs keep those tags and `tag:HonkyTonk` still works.
export const TAG_DISPLAY_CATEGORIES = {
    'Genre': ['Bluegrass', 'ClassicCountry', 'OldTime', 'Gospel', 'Folk'],
    'Vibe': ['JamFriendly', 'Modal', 'Jazzy'],
    'Structure': ['Instrumental', 'Waltz']
};

/**
 * Get the category of a tag
 */
export function getTagCategory(tag) {
    return TAG_CATEGORIES[tag] || 'other';
}

/**
 * Format a tag name for display (CamelCase to readable)
 */
export function formatTagName(tag) {
    return tag.replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Normalize a tag for matching (remove spaces, underscores, hyphens; lowercase)
 */
function normalizeTag(tag) {
    return tag.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * Get instrument tags for a song (from tablature_parts and abc_notation)
 */
export function getInstrumentTags(song) {
    const instruments = new Set();
    if (song.tablature_parts) {
        song.tablature_parts.forEach(p => {
            if (p.instrument) instruments.add(p.instrument.toLowerCase());
        });
    }
    // Check for ABC notation in content (uses {start_of_abc} directive)
    if (song.content && song.content.includes('{start_of_abc}')) {
        instruments.add('fiddle'); // ABC assumed to be fiddle
    }
    return Array.from(instruments);
}

/**
 * Check if song has all required tags (case-insensitive prefix match)
 * Normalizes input so "jam friendly", "jam_friendly", "JamFriendly" all match
 * Also checks instrument tags from tablature_parts and abc_notation
 */
export function songHasTags(song, requiredTags) {
    if (!requiredTags.length) return true;

    const songTags = song.tags || {};
    const songTagKeys = Object.keys(songTags).map(normalizeTag);

    // Add instrument tags (from tabs and ABC notation)
    const instrumentTags = getInstrumentTags(song);
    const allTags = [...songTagKeys, ...instrumentTags];

    return requiredTags.every(searchTag => {
        const searchNormalized = normalizeTag(searchTag);
        // Match if any tag starts with the search term
        return allTags.some(tag => tag.startsWith(searchNormalized));
    });
}

/**
 * Render tags as badges for a song
 */
export function renderTagBadges(song, onClick = null) {
    const songTags = song.tags || {};
    const tagEntries = Object.entries(songTags);

    if (tagEntries.length === 0) return '';

    return tagEntries.map(([tag, value]) => {
        const category = getTagCategory(tag);
        const displayName = formatTagName(tag);
        const clickAttr = onClick ? `onclick="${onClick}(event, '${tag}')"` : '';
        const clickClass = onClick ? 'clickable' : '';
        return `<span class="tag-badge tag-${category} ${clickClass}" ${clickAttr}>${displayName}</span>`;
    }).join('');
}

// Module-level references (set by init)
let searchInputEl = null;
let tagDropdownBtnEl = null;
let tagDropdownContentEl = null;
let facetChipEls = [];
let searchFn = null;
let parseSearchQueryFn = null;

/** Positive tags currently in the search box */
function currentQueryTags() {
    if (!searchInputEl || !parseSearchQueryFn) return [];
    return parseSearchQueryFn(searchInputEl.value).tagFilters || [];
}

/** Tags that a control (checkbox or chip) represents, lowercased */
function controlledTags() {
    const tags = new Set();
    tagDropdownContentEl?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.dataset.tag) tags.add(cb.dataset.tag.toLowerCase());
    });
    facetChipEls.forEach(chip => {
        if (chip.dataset.facetTag) tags.add(chip.dataset.facetTag.toLowerCase());
    });
    return tags;
}

/** Write a query into the box, re-run the search, and re-sync the controls */
function applyQuery(query) {
    searchInputEl.value = query;
    if (searchFn) searchFn(query);
    syncTagControls();
}

/**
 * Update search from tag checkboxes.
 * Typed tags that no control represents (e.g. `tag:HonkyTonk`) are preserved.
 */
export function updateSearchFromTagCheckboxes() {
    if (!tagDropdownContentEl || !searchInputEl) return;

    const checkedTags = [];
    tagDropdownContentEl.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        checkedTags.push(cb.dataset.tag);
    });

    const controlled = controlledTags();
    const preserved = currentQueryTags().filter(t => !controlled.has(t.toLowerCase()));

    applyQuery(setTagTerms(searchInputEl.value, [...preserved, ...checkedTags]));
}

/**
 * Toggle a single tag from a facet chip. When the dropdown also has a checkbox
 * for that tag, go through the checkbox so the two surfaces stay in step.
 */
function toggleFacetTag(tag) {
    if (!searchInputEl) return;

    const checkbox = Array.from(
        tagDropdownContentEl?.querySelectorAll('input[type="checkbox"]') || []
    ).find(cb => (cb.dataset.tag || '').toLowerCase() === tag.toLowerCase());

    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        updateSearchFromTagCheckboxes();
        return;
    }

    applyQuery(toggleTagTerm(searchInputEl.value, currentQueryTags(), tag));
}

/**
 * Sync tag checkboxes with search input
 */
export function syncTagCheckboxes() {
    if (!tagDropdownContentEl || !searchInputEl || !parseSearchQueryFn) return;

    const tagFiltersLower = currentQueryTags().map(t => t.toLowerCase());

    tagDropdownContentEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const tag = cb.dataset.tag.toLowerCase();
        // Check if this tag (or prefix) is in the filters
        cb.checked = tagFiltersLower.some(f => tag.startsWith(f) || f.startsWith(tag));
    });
}

/**
 * Sync facet chips' active state with the search input
 */
export function syncFacetChips() {
    if (!facetChipEls.length || !searchInputEl || !parseSearchQueryFn) return;

    const tagFiltersLower = currentQueryTags().map(t => t.toLowerCase());
    facetChipEls.forEach(chip => {
        const tag = (chip.dataset.facetTag || '').toLowerCase();
        const active = tagFiltersLower.some(f => tag.startsWith(f) || f.startsWith(tag));
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

/** Sync every tag surface (dropdown + chips) with the query */
export function syncTagControls() {
    syncTagCheckboxes();
    syncFacetChips();
}

/**
 * Initialize tag dropdown with DOM elements and callbacks
 */
export function initTagDropdown(options) {
    const {
        searchInput,
        tagDropdownBtn,
        tagDropdownContent,
        facetChips,
        search,
        parseSearchQuery
    } = options;

    searchInputEl = searchInput;
    tagDropdownBtnEl = tagDropdownBtn;
    tagDropdownContentEl = tagDropdownContent;
    facetChipEls = Array.from(facetChips || document.querySelectorAll('.facet-chip[data-facet-tag]'));
    searchFn = search;
    parseSearchQueryFn = parseSearchQuery;

    // Facet chips work on their own — they don't need the dropdown to exist
    facetChipEls.forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.preventDefault();
            toggleFacetTag(chip.dataset.facetTag);
            searchInputEl?.focus();
        });
    });

    // Keep chips in step with typing
    if (searchInputEl) {
        searchInputEl.addEventListener('input', syncTagControls);
    }

    if (!tagDropdownBtnEl || !tagDropdownContentEl) return;

    // Toggle dropdown
    tagDropdownBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        tagDropdownContentEl.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!tagDropdownContentEl.contains(e.target) && e.target !== tagDropdownBtnEl) {
            tagDropdownContentEl.classList.remove('show');
        }
    });

    // Handle checkbox changes
    tagDropdownContentEl.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateSearchFromTagCheckboxes();
        });
    });
}
