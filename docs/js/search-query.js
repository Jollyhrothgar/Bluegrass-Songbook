// Query-string surgery for the search box.
//
// The facet chips, the Key pill, the Chords popover, and the Tags dropdown all
// need to add/replace/remove ONE field term while leaving the rest of what the
// user typed alone. These helpers are pure string functions (no DOM, no state)
// so both search-core.js and tags.js can share them without an import cycle.
//
// Field values run until the next field prefix, matching parseSearchQuery():
//   "tag:Gospel Waltz artist:monroe"  →  tag term is "tag:Gospel Waltz"
//
// Negated terms are never touched: `-tag:Instrumental` is the only negation the
// parser supports and it stays exactly where the user typed it.

// Aliases per field; the FIRST entry is the canonical form we write.
export const FIELD_ALIASES = {
    artist: ['artist', 'a'],
    title: ['title'],
    lyrics: ['lyrics', 'l'],
    composer: ['composer', 'writer'],
    key: ['key', 'k'],
    chord: ['chord', 'c'],
    prog: ['prog', 'p'],
    tag: ['tag', 't']
};

// Any token that starts a new (possibly negated) field ends the current value.
const NEXT_PREFIX = `-?(?:${Object.values(FIELD_ALIASES).flat().join('|')}):`;

function termRegex(aliases) {
    // (start|space) alias ":" then every following token that isn't a prefix
    return new RegExp(
        `(?:^|\\s)(?:${aliases.join('|')}):(?:\\s*(?!${NEXT_PREFIX})\\S+)*`,
        'gi'
    );
}

/**
 * Remove every positive `field:value` term from a query.
 * @param {string} query
 * @param {string} field - key of FIELD_ALIASES
 * @returns {string} query with that field's terms removed
 */
export function stripFieldTerms(query, field) {
    const aliases = FIELD_ALIASES[field];
    if (!aliases) return query;
    return (query || '').replace(termRegex(aliases), ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Replace (or clear, when value is empty) a field's term in a query.
 * The new term is appended at the end using the canonical prefix.
 */
export function setFieldTerm(query, field, value) {
    const stripped = stripFieldTerms(query, field);
    const val = (value || '').trim();
    if (!val) return stripped;
    const prefix = FIELD_ALIASES[field][0];
    return stripped ? `${stripped} ${prefix}:${val}` : `${prefix}:${val}`;
}

/**
 * Write a tag set as a single comma-separated `tag:` term (empty clears it).
 * @param {string} query
 * @param {string[]} tags
 */
export function setTagTerms(query, tags) {
    return setFieldTerm(query, 'tag', (tags || []).join(','));
}

/**
 * Toggle one tag in a query, given the tags already parsed out of it.
 * Comparison is case-insensitive; the caller's casing wins when adding.
 * @param {string} query
 * @param {string[]} currentTags - positive tags already in the query
 * @param {string} tag
 */
export function toggleTagTerm(query, currentTags, tag) {
    const lower = tag.toLowerCase();
    const has = (currentTags || []).some(t => t.toLowerCase() === lower);
    const next = has
        ? currentTags.filter(t => t.toLowerCase() !== lower)
        : [...(currentTags || []), tag];
    return setTagTerms(query, next);
}
