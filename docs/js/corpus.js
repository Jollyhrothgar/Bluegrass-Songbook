// Corpus assembly: how the three row sources become `allSongs`.
//
// - data/index.jsonl   — the searchable canon; fetched at startup, blocking
// - data/archive.jsonl — everything the prune left off the shelf; fetched in
//                        the background so deep links, lists and redirects to
//                        archived works still resolve
// - pending_songs      — Supabase overlay: every logged-in user's submission,
//                        live in seconds while the git commit catches up
// - deleted/promoted   — Supabase curation overlays: the same suppression and
//                        prune-rescue the index build applies, but instant
//
// Kept separate from main.js so the merge is unit-testable without booting
// the whole app.

import { buildStemSet } from './stem.js';

/** Parse a JSONL payload into rows (blank lines tolerated). */
export function parseJsonl(text) {
    if (!text) return [];
    const rows = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        rows.push(JSON.parse(trimmed));
    }
    return rows;
}

/**
 * Fetch a JSONL file and parse it. No `cache` override — HTTP caching plus
 * ETag revalidation is the contract with the CDN now that the index is
 * small; a `no-cache` request re-downloaded it on every page load.
 */
export async function fetchJsonl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return parseJsonl(await response.text());
}

/**
 * Archive rows are off the shelf: they resolve by URL but never appear in
 * search, collection counts, or the songbook total. The build marks them
 * `indexed: false`; belt-and-braces here so a row that arrives without the
 * flag can't leak into the searchable corpus.
 */
export function markArchived(rows) {
    for (const row of rows || []) {
        if (row.indexed !== false) row.indexed = false;
    }
    return rows || [];
}

/** Pre-compute the stemmed word set search uses for fuzzy matching. */
export function ensureStems(songs) {
    for (const song of songs) {
        if (song._stems) continue;
        song._stems = buildStemSet([
            song.title || '',
            song.artist || '',
            song.composer || '',
            song.first_line || ''
        ].join(' '));
    }
    return songs;
}

/** Accept a Set, an array of ids, or Supabase rows ({song_id}) as an id set. */
function asIdSet(value) {
    if (!value) return new Set();
    if (value instanceof Set) return value;
    return new Set(value.map(v => (typeof v === 'string' ? v : v?.song_id)));
}

/**
 * Merge the row sources into the corpus the app runs on.
 *
 * Pending rows overlay static rows: a pending row with `replaces_id`
 * inherits the static row's fields (tablature_parts, tags, …) and hides
 * the row it replaces.
 *
 * `deleted` and `promoted` are the client-side halves of the curation
 * tables the index build applies from `docs/data/{deleted,promoted}_songs.json`
 * — mirrored here so an admin delete or a trusted-user promote is live in the
 * browser without waiting for the hourly sync and rebuild. Order matches the
 * build: deletion (curation.filter_suppressed) runs before promotion
 * (curation.apply_index_prune), so a deleted id stays gone even if promoted.
 *
 * Promoted rows are copied rather than mutated, so un-promoting restores
 * `indexed: false` from the untouched source row on the next merge.
 *
 * @returns {{ songs: Array, groups: Object }}
 */
export function mergeCorpus({
    canon = [], archive = [], pending = [], deleted = null, promoted = null,
} = {}) {
    const deletedIds = asIdSet(deleted);
    const promotedIds = asIdSet(promoted);

    let staticRows = [...canon, ...archive];
    let pendingRows = pending;
    if (deletedIds.size) {
        staticRows = staticRows.filter(row => !deletedIds.has(row.id));
        pendingRows = pendingRows.filter(p => !deletedIds.has(p.id));
    }
    if (promotedIds.size) {
        staticRows = staticRows.map(row => (
            row.indexed === false && promotedIds.has(row.id)
                ? { ...row, indexed: true }
                : row
        ));
    }

    const staticMap = {};
    for (const row of staticRows) staticMap[row.id] = row;

    const mergedPending = pendingRows.map(p => {
        const base = p.replaces_id ? staticMap[p.replaces_id] : null;
        return base ? { ...base, ...p, source: 'pending' } : p;
    });

    const replacedIds = new Set(
        pendingRows.filter(p => p.replaces_id).map(p => p.replaces_id)
    );

    const songs = [
        ...staticRows.filter(row => !replacedIds.has(row.id)),
        ...mergedPending,
    ];

    ensureStems(songs);

    const groups = {};
    for (const song of songs) {
        if (!song.group_id) continue;
        if (!groups[song.group_id]) groups[song.group_id] = [];
        groups[song.group_id].push(song);
    }

    return { songs, groups };
}

/** Distinct searchable titles — "the book" count, archive excluded. */
export function countDistinctTitles(songs) {
    return new Set(
        (songs || []).filter(s => s.indexed !== false)
            .map(s => s.title?.toLowerCase())
    ).size;
}

/**
 * Run `fn` when the browser is idle, or after `delayMs` where
 * requestIdleCallback isn't available (Safari). Returns a cancel function.
 */
export function whenIdle(fn, delayMs = 2000) {
    if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(() => fn(), { timeout: delayMs * 2 });
        return () => cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(fn, delayMs);
    return () => clearTimeout(timer);
}
