// Corpus assembly: how the three row sources become `allSongs`.
//
// - data/index.jsonl   — the searchable canon; fetched at startup, blocking
// - data/archive.jsonl — everything the prune left off the shelf; fetched in
//                        the background so deep links, lists and redirects to
//                        archived works still resolve
// - pending_songs      — Supabase overlay (trusted-user edits, submissions)
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

/**
 * Merge the row sources into the corpus the app runs on.
 *
 * Pending rows overlay static rows: a pending row with `replaces_id`
 * inherits the static row's fields (tablature_parts, tags, …) and hides
 * the row it replaces.
 *
 * @returns {{ songs: Array, groups: Object }}
 */
export function mergeCorpus({ canon = [], archive = [], pending = [] } = {}) {
    const staticRows = [...canon, ...archive];

    const staticMap = {};
    for (const row of staticRows) staticMap[row.id] = row;

    const mergedPending = pending.map(p => {
        const base = p.replaces_id ? staticMap[p.replaces_id] : null;
        return base ? { ...base, ...p, source: 'pending' } : p;
    });

    const replacedIds = new Set(
        pending.filter(p => p.replaces_id).map(p => p.replaces_id)
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
