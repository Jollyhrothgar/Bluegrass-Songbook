// Query-string surgery for the search box.
//
// The facet chips, the Key pill, the Chords popover, and the Tags dropdown all
// need to add/replace/remove ONE field term while leaving the rest of what the
// user typed alone. These helpers are pure string functions (no DOM, no state)
// so both search-core.js and tags.js can share them without an import cycle.
//
// Field values run until the next field prefix, matching parseSearchQuery():
//   "artist:hank williams tag:Gospel"  →  artist term is "artist:hank williams"
// EXCEPT `tag:`, whose value is a comma list ending at the first space:
//   "tag:Instrumental,banjo black"     →  tag term is "tag:Instrumental,banjo"
// These two files encode one contract twice — change them together.
//
// Negated terms are never touched: `-tag:Instrumental` is the only negation the
// parser supports and it stays exactly where the user typed it.

// Aliases per field; the FIRST entry is the canonical form we write.
export const FIELD_ALIASES = {
    artist: ['artist', 'a'],
    title: ['title'],
    lyrics: ['lyrics', 'l'],
    composer: ['composer', 'writer'],
    chord: ['chord', 'c'],
    prog: ['prog', 'p'],
    tag: ['tag', 't']
};

// Any token that starts a new (possibly negated) field ends the current value.
const NEXT_PREFIX = `-?(?:${Object.values(FIELD_ALIASES).flat().join('|')}):`;

function termRegex(aliases, field) {
    // `tag:` takes a COMMA list that ends at the first space — it must match
    // parseSearchQuery's splitTagValue exactly, or stripFieldTerms will eat
    // free text the parser would have kept (the bug where clicking a second
    // facet chip silently deleted what you'd typed).
    if (field === 'tag') {
        return new RegExp(
            `(?:^|\\s)(?:${aliases.join('|')}):[^\\s,]+(?:\\s*,\\s*[^\\s,]+)*`,
            'gi'
        );
    }
    // Every other field's value runs to the next prefix ("artist:hank williams")
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
    return (query || '').replace(termRegex(aliases, field), ' ')
        .replace(/\s+/g, ' ').trim();
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
