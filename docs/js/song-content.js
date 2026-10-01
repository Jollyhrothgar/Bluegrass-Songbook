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
/** url -> resolved text / in-flight promise, for forked arrangements
 *  (data/songs/{id}--{slug}.pro), which are addressed by file not by id */
const urlCache = new Map();
const urlInFlight = new Map();

// PENDING rows are fetched by the boot overlay WITHOUT their text (a chart is
// up to 200 KB and a tab 2 MB, and every visitor would pay for every pending
// row). The text is read from pending_songs when its song is opened:
// `song.deferred_content`, an arrangement's / tab take's `pending_id`.
// `fetcher` is installed by main.js (this module must not know about
// Supabase); it resolves the row's text, or null once the row is gone.
/** pending row id -> its text */
const pendingCache = new Map();
const pendingInFlight = new Map();
let pendingFetcher = null;

/** Install the function that reads one pending row's text (id -> string|null). */
export function setPendingContentFetcher(fetcher) {
    pendingFetcher = fetcher;
}

/**
 * The text of one pending_songs row, cached and deduped. Resolves null when
 * the row no longer exists (committed and cleaned up since the overlay was
 * fetched) so the caller can fall back to the published file; rejects when
 * the read fails, and a failure is not cached.
 */
export function getPendingContent(id) {
    if (!id) return Promise.resolve(null);
    if (pendingCache.has(id)) return Promise.resolve(pendingCache.get(id));
    if (pendingInFlight.has(id)) return pendingInFlight.get(id);
    if (!pendingFetcher) {
        return Promise.reject(new Error('Could not load this submission right now'));
    }

    const promise = Promise.resolve(pendingFetcher(id))
        .then(text => {
            pendingInFlight.delete(id);
            if (typeof text === 'string') pendingCache.set(id, text);
            return typeof text === 'string' ? text : null;
        })
        .catch(error => {
            pendingInFlight.delete(id);
            throw error;
        });
    pendingInFlight.set(id, promise);
    return promise;
}

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
    // A deferred pending row: its text is the pending text, never a published
    // fetch of the same id (the overlay can land after the page did).
    if (song.deferred_content) return pendingCache.has(song.id) ? pendingCache.get(song.id) : null;
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
    if (song.deferred_content) {
        // The published file is the fallback for a row that was committed and
        // cleaned up between the overlay fetch and this click.
        return getPendingContent(id).then(
            text => (text !== null ? text : getSongContent({ id, has_content: true })));
    }
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
 * Warm a work's ChordPro before anyone has asked for it: the page that
 * opens next is one the reader is already pointing at (pointerdown/hover on
 * a result) or about to step to (the next song in a list). Goes through
 * getSongContent, so it shares that function's cache and in-flight dedupe —
 * the real open after a prefetch finds the text in memory and renders
 * synchronously, or joins the request already in the air.
 *
 * Best-effort and silent: a failed prefetch is forgotten (getSongContent does
 * not cache failures), so the real open simply fetches again and surfaces
 * the error itself. Skipped on Save-Data connections, for rows that carry
 * their own text, and for works with no lead sheet.
 *
 * @returns {Promise<void>|null} the in-flight warm-up, or null when nothing
 *          needed fetching (resolves only for tests; callers ignore it)
 */
export function prefetchSongContent(song) {
    if (!song?.id || hasInlineContent(song) || song.has_content !== true) return null;
    if (contentCache.has(song.id) || inFlight.has(song.id)) return null;
    if (globalThis.navigator?.connection?.saveData) return null;
    return getSongContent(song).then(() => {}, () => {});
}

/** Fetch a .pro by URL, cached and deduped like getSongContent. */
function fetchByUrl(url) {
    if (urlCache.has(url)) return Promise.resolve(urlCache.get(url));
    if (urlInFlight.has(url)) return urlInFlight.get(url);

    const promise = fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Could not load song content (HTTP ${response.status})`);
            }
            return response.text();
        })
        .then(text => {
            urlCache.set(url, text);
            urlInFlight.delete(url);
            return text;
        })
        .catch(error => {
            urlInFlight.delete(url);
            throw error;
        });

    urlInFlight.set(url, promise);
    return promise;
}

/**
 * ChordPro for one arrangement of a work — the primary chart or a fork that
 * lives on the same work (`arrangements[]` on the index row).
 *
 * Resolution order, and why: an entry that carries its own text (a pending
 * submission not yet published) IS the answer; otherwise the entry's file is
 * fetched; a shapeless entry falls back to the work's own lead sheet.
 * Fetching the PRIMARY also seeds the id-keyed cache, so peekSongContent and
 * everything else that asks by id keeps working on the fast path.
 */
export function getArrangementContent(song, arrangement) {
    if (!arrangement) return getSongContent(song);
    if (typeof arrangement.content === 'string') {
        return Promise.resolve(arrangement.content);
    }
    if (arrangement.pending && arrangement.pending_id && !arrangement.file) {
        return getPendingContent(arrangement.pending_id).then(
            text => (text !== null ? text : getSongContent(song)));
    }
    if (!arrangement.file) return getSongContent(song);
    return fetchByUrl(arrangement.file).then(text => {
        if (arrangement.default && song?.id && !hasInlineContent(song) && !song.deferred_content) {
            contentCache.set(song.id, text);
        }
        return text;
    });
}

/** Arrangement text already in hand (or null) — the sync sibling. */
export function peekArrangementContent(song, arrangement) {
    if (!arrangement) return peekSongContent(song);
    if (typeof arrangement.content === 'string') return arrangement.content;
    if (arrangement.pending && arrangement.pending_id && !arrangement.file) {
        return pendingCache.has(arrangement.pending_id)
            ? pendingCache.get(arrangement.pending_id) : null;
    }
    // Mirrors getArrangementContent's order exactly: an entry with a file is
    // answered by that file and nothing else. Falling back to the row's own
    // `content` here would hand back a PENDING fork's text when the reader
    // asked for the published original it forked from.
    if (arrangement.file) {
        return urlCache.has(arrangement.file)
            ? urlCache.get(arrangement.file) : null;
    }
    return peekSongContent(song);
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
    pendingCache.set(id, content);
    // Same text, either door: the primary arrangement addresses this work by
    // file, so a primed edit must be visible there too.
    urlCache.set(songContentUrl(id), content);
}

/** Drop cached content (tests, and after a destructive edit). */
export function clearSongContentCache(id = null) {
    if (id === null) {
        contentCache.clear();
        inFlight.clear();
        urlCache.clear();
        urlInFlight.clear();
        pendingCache.clear();
        pendingInFlight.clear();
        return;
    }
    contentCache.delete(id);
    inFlight.delete(id);
    pendingCache.delete(id);
    pendingInFlight.delete(id);
    urlCache.delete(songContentUrl(id));
    urlInFlight.delete(songContentUrl(id));
}
