// Song content on demand.
//
// The search index (data/index.jsonl) carries only what search and the
// result cards need — no ChordPro. The full lead sheet for each work lives
// in its own file, data/songs/{id}.pro, and is fetched the first time a
// song page (or an export/print/edit flow) actually needs it.
//
// LEGACY FALLBACK: everything here also works against the old fat index,
// where every row carried a `content` string. If a row has `content`
// (even ''), that string IS the answer and nothing is fetched. Rows from
// the lean index advertise `has_content: true` / `has_abc: true` instead;
// rows with neither a string nor the flag genuinely have no lead sheet, so
// they resolve to '' without a request (no 404 storms on tab-only works).

/** id -> resolved ChordPro text */
const contentCache = new Map();
/** id -> in-flight promise (dedupes concurrent asks for the same work) */
const inFlight = new Map();

/** Where a work's ChordPro lives. */
export function songContentUrl(id) {
    return `data/songs/${encodeURIComponent(id)}.pro`;
}

/** True when the row itself carries its ChordPro (fat index, pending rows). */
function hasInlineContent(song) {
    return typeof song?.content === 'string';
}

/**
 * Does this work have a lead sheet at all? Cheap, synchronous, and safe on
 * either index generation — use this instead of truthiness on `.content`.
 */
export function songHasContent(song) {
    if (!song) return false;
    if (hasInlineContent(song)) return song.content.length > 0;
    if (contentCache.has(song.id)) return contentCache.get(song.id).length > 0;
    return song.has_content === true;
}

/**
 * Does this work have ABC notation? The lean index flags it (`has_abc`);
 * older rows either carry an `abc_content` field or an inline
 * `{start_of_abc}` block in their ChordPro.
 */
export function songHasAbc(song) {
    if (!song) return false;
    if (song.has_abc === true) return true;
    if (typeof song.abc_content === 'string' && song.abc_content.length > 0) return true;
    const inline = peekSongContent(song);
    return typeof inline === 'string' && inline.includes('{start_of_abc}');
}

/**
 * Content we already have in hand: the row's own string, or a cached
 * fetch. null means "would need a network round trip" — callers that
 * cannot await (renderers, badge builders) treat null as "not yet".
 */
export function peekSongContent(song) {
    if (!song) return null;
    if (hasInlineContent(song)) return song.content;
    if (song.id && contentCache.has(song.id)) return contentCache.get(song.id);
    return null;
}

/**
 * Fetch (or return cached) ChordPro for a work.
 *
 * Resolves to '' for works that have no lead sheet. Rejects when the fetch
 * fails so callers can show a retry affordance instead of a blank page —
 * a failed fetch is NOT cached, so retrying actually retries.
 */
export function getSongContent(song) {
    if (!song) return Promise.resolve('');
    if (hasInlineContent(song)) return Promise.resolve(song.content);

    const id = song.id;
    if (!id) return Promise.resolve('');
    if (contentCache.has(id)) return Promise.resolve(contentCache.get(id));
    if (inFlight.has(id)) return inFlight.get(id);
    if (song.has_content !== true) return Promise.resolve('');

    const promise = fetch(songContentUrl(id))
        .then(response => {
            if (!response.ok) {
                throw new Error(`Could not load song content (HTTP ${response.status})`);
            }
            return response.text();
        })
        .then(text => {
            contentCache.set(id, text);
            inFlight.delete(id);
            return text;
        })
        .catch(error => {
            inFlight.delete(id);
            throw error;
        });

    inFlight.set(id, promise);
    return promise;
}

/**
 * Fetch content for several works at once (print-a-list, exports).
 * Failures degrade to '' — one unreachable song must not kill the batch.
 */
export function getSongContents(songs) {
    return Promise.all((songs || []).map(
        song => getSongContent(song).catch(() => '')
    ));
}

/**
 * Seed the cache — used after an edit is saved so the page renders the
 * user's own text instead of re-fetching the published file.
 */
export function primeSongContent(id, content) {
    if (!id || typeof content !== 'string') return;
    contentCache.set(id, content);
}

/** Drop cached content (tests, and after a destructive edit). */
export function clearSongContentCache(id = null) {
    if (id === null) {
        contentCache.clear();
        inFlight.clear();
        return;
    }
    contentCache.delete(id);
    inFlight.delete(id);
}
