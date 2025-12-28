// Tag system for Bluegrass Songbook

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
};

// Tag categories for dropdown display
export const TAG_DISPLAY_CATEGORIES = {
    'Genre': ['Bluegrass', 'ClassicCountry', 'OldTime', 'Gospel', 'Folk', 'HonkyTonk', 'Outlaw', 'Rockabilly', 'WesternSwing'],
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
 * Check if song has all required tags (case-insensitive prefix match)
 */
export function songHasTags(song, requiredTags) {
    if (!requiredTags.length) return true;

    const songTags = song.tags || {};
    const songTagKeys = Object.keys(songTags).map(t => t.toLowerCase());

    return requiredTags.every(searchTag => {
        const searchLower = searchTag.toLowerCase();
        // Match if any tag starts with the search term
        return songTagKeys.some(tag => tag.startsWith(searchLower));
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
let searchFn = null;
let parseSearchQueryFn = null;

/**
 * Update search from tag checkboxes
 */
export function updateSearchFromTagCheckboxes() {
    if (!tagDropdownContentEl || !searchInputEl) return;

    const checkedTags = [];
    tagDropdownContentEl.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        checkedTags.push(cb.dataset.tag);
    });

    // Get current search without tag filters
    let currentSearch = searchInputEl.value;
    // Remove existing tag: filters
    currentSearch = currentSearch.replace(/\s*(tag|t):[^\s]+/g, '').trim();

    // Add new tag filters
    if (checkedTags.length > 0) {
        const tagFilter = `tag:${checkedTags.join(',')}`;
        currentSearch = currentSearch ? `${currentSearch} ${tagFilter}` : tagFilter;
    }

    searchInputEl.value = currentSearch;
    if (searchFn) searchFn(currentSearch);
}

/**
 * Sync tag checkboxes with search input
 */
export function syncTagCheckboxes() {
    if (!tagDropdownContentEl || !searchInputEl || !parseSearchQueryFn) return;

    const { tagFilters } = parseSearchQueryFn(searchInputEl.value);
    const tagFiltersLower = tagFilters.map(t => t.toLowerCase());

    tagDropdownContentEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const tag = cb.dataset.tag.toLowerCase();
        // Check if this tag (or prefix) is in the filters
        cb.checked = tagFiltersLower.some(f => tag.startsWith(f) || f.startsWith(tag));
    });
}

/**
 * Initialize tag dropdown with DOM elements and callbacks
 */
export function initTagDropdown(options) {
    const {
        searchInput,
        tagDropdownBtn,
        tagDropdownContent,
        search,
        parseSearchQuery
    } = options;

    searchInputEl = searchInput;
    tagDropdownBtnEl = tagDropdownBtn;
    tagDropdownContentEl = tagDropdownContent;
    searchFn = search;
    parseSearchQueryFn = parseSearchQuery;

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

    // Sync checkboxes with search input
    if (searchInputEl) {
        searchInputEl.addEventListener('input', syncTagCheckboxes);
    }
}
