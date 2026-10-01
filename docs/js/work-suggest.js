// work-suggest.js — recover from a work URL that no longer resolves.
//
// Work URLs are promised to be permanent, but a work deleted as a duplicate
// leaves no pointer to the survivor (data/deleted_songs.json has only
// deleted_at/reason). Until the pipeline records one, recover from the id:
//   - redirect ONLY under the strict rule (deleted id, exactly one surviving
//     work with the same id stem and the same normalized title);
//   - otherwise suggest survivors with a matching normalized title.
// Title matching reuses title-match.js (a narrowing tool, never a decision).

import { normalizeTitle, buildTitleIndex } from './title-match.js';

/** Work id minus a trailing "-N" disambiguator: "blue-moon-1" -> "blue-moon". */
export function idStem(id) {
    return String(id || '').replace(/-\d+$/, '');
}

/** Best-effort title from a slug, for normalizing against real titles. */
export function slugToTitle(id) {
    return idStem(id).replace(/-+/g, ' ').trim();
}

/**
 * @param {string} missingId  id that failed to resolve
 * @param {Array} songs       surviving works ({id, title, ...})
 * @param {Set|Object} deleted  ids known to be deleted (Set, or id -> info map)
 * @returns {{redirect: object|null, suggestions: object[]}}
 */
export function findSurvivors(missingId, songs, deleted) {
    const isDeleted = deleted instanceof Set
        ? deleted.has(missingId)
        : !!(deleted && Object.prototype.hasOwnProperty.call(deleted, missingId));
    const stem = idStem(missingId);
    const titleKey = normalizeTitle(slugToTitle(missingId));
    if (!titleKey) return { redirect: null, suggestions: [] };

    const byTitle = (buildTitleIndex(songs).get(titleKey) || [])
        .filter(s => s.id !== missingId);
    const sameStem = byTitle.filter(s => idStem(s.id) === stem);

    const redirect = isDeleted && sameStem.length === 1 ? sameStem[0] : null;
    const suggestions = byTitle.slice(0, 5);
    return { redirect, suggestions };
}

let deletedCache = null;

/** Fetch data/deleted_songs.json once; resolves to {} on any failure. */
export async function loadDeletedSongs() {
    if (!deletedCache) {
        deletedCache = fetch('data/deleted_songs.json')
            .then(r => (r.ok ? r.json() : {}))
            .catch(() => ({}));
    }
    return deletedCache;
}
