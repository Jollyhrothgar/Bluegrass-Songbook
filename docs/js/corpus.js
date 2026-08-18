// Corpus assembly: how the three row sources become `allSongs`.
//
// - data/index.jsonl   — the searchable canon; fetched at startup, blocking
// - data/archive.jsonl — everything the prune left off the shelf; fetched in
//                        the background so deep links, lists and redirects to
//                        archived works still resolve
// - pending_songs      — Supabase overlay: every logged-in user's submission,
//                        live in seconds while the git commit catches up.
//                        A row is a SONG or a PART (`part_type`); see
//                        transformPendingRow / applyPendingTabs below
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
 * The two takes a pending FORK puts on one work, or null when the pending
 * row isn't a fork.
 *
 * Editing a chart you don't own doesn't overwrite it: the server lands your
 * text as an extra lead-sheet part on the same work
 * (`works_writer.fork_to_arrangement`), and the next index build publishes it
 * in the row's `arrangements`. Until that build lands, the pending overlay is
 * all the browser has — and an overlay that only carried the new text would
 * make the published chart vanish from the page for the minutes in between,
 * and make the submit toast's promise ("it's in the versions list") false.
 * So the merged row advertises both takes right away.
 *
 * Ownership mirrors `process_pending.owns_content`: the work is yours only if
 * a part there records you as its submitter. Nobody's submitter ⇒ not yours
 * ⇒ a fork, which is why most edits of imported charts land here.
 */
export function pendingForkArrangements(base, pending) {
    if (typeof pending?.content !== 'string' || !pending.content) return null;
    if (base.submitted_by && base.submitted_by === pending.created_by) {
        return null;   // your own chart — this is an update, not a fork
    }

    const published = base.arrangements?.length ? base.arrangements : [{
        slug: 'default',
        label: 'Original',
        default: true,
        file: `data/songs/${base.id}.pro`,
        ...(base.key ? { key: base.key } : {}),
        ...(base.chord_count ? { chord_count: base.chord_count } : {}),
    }];

    return [...published, {
        slug: 'pending',
        label: 'Your arrangement',
        pending: true,
        content: pending.content,
        ...(pending.key ? { key: pending.key } : {}),
        ...(pending.created_by ? { submitted_by: pending.created_by } : {}),
    }];
}

// ============================================================
// The pending overlay is PARTS-AWARE
// ============================================================
//
// `pending_songs` was one row per SONG: `content` held ChordPro and the row
// stood in for a work. Tabs joining the instant pipeline added `part_type`
// ('lead-sheet' | 'tablature'), `instrument` and `part_file`, and a
// tablature row's `content` is a serialized OTF document.
//
// A tablature row must NOT become a row in the corpus of its own when it
// names a work that already exists — it would be a song with OTF JSON where
// its lyrics go, competing with the real work in every search. It is a PART:
// it attaches to the work it targets. Only a tab for a work nothing has
// published yet becomes a row, and then it is shaped like the tab-only works
// the index build already emits (no `has_content`, `tablature_parts` only).

/** Is this pending row a part hanging off a work, rather than a whole song? */
export function isPendingTablature(row) {
    return row?.part_type === 'tablature';
}

/** First lyric line of a ChordPro body (chord brackets stripped). */
function extractFirstLine(content) {
    for (const line of String(content || '').split('\n')) {
        if (line.startsWith('{') || !line.trim()) continue;
        const lyricsOnly = line.replace(/\[[^\]]+\]/g, '').trim();
        if (lyricsOnly) return lyricsOnly;
    }
    return '';
}

/** All lyrics of a ChordPro body, flattened for search. */
function extractLyrics(content) {
    if (!content) return '';
    return String(content)
        .split('\n')
        .filter(line => !line.startsWith('{') && line.trim())
        .map(line => line.replace(/\[[^\]]+\]/g, ''))
        .join(' ')
        .trim();
}

/**
 * A pending SONG row in index-row shape.
 *
 * `content` stays inline (getSongContent resolves an inline string with no
 * request), and `created_by` rides along so the editor can tell "your song"
 * from "someone else's" before submitting — the server decides
 * authoritatively.
 */
function transformPendingSongRow(pending) {
    return {
        id: pending.id,
        title: pending.title,
        artist: pending.artist || '',
        composer: pending.composer || '',
        content: pending.content,
        key: pending.key || '',
        mode: pending.mode || '',
        tags: pending.tags || {},
        notes: pending.notes || '',
        status: pending.status || (pending.content ? undefined : 'placeholder'),
        source: 'pending',
        replaces_id: pending.replaces_id,
        created_by: pending.created_by || null,
        first_line: extractFirstLine(pending.content),
        lyrics: extractLyrics(pending.content),
    };
}

/**
 * A pending TABLATURE row as a part waiting for a home.
 *
 * Nothing here is an index row — `pending_part` is one entry for a work's
 * `tablature_parts`, and applyPendingTabs decides which work it lands on.
 * The OTF is carried as the string it was stored as: parsing it here would
 * cost a JSON.parse of every pending tab on every corpus rebuild, and only
 * the renderer ever needs the object.
 */
function transformPendingTabRow(pending) {
    return {
        id: pending.id,
        replaces_id: pending.replaces_id || null,
        title: pending.title,
        artist: pending.artist || '',
        composer: pending.composer || '',
        part_type: 'tablature',
        created_by: pending.created_by || null,
        pending_part: {
            instrument: pending.instrument || '',
            ...(pending.part_file ? { src_file: pending.part_file } : {}),
            content: pending.content || '',
            pending: true,
            pending_id: pending.id,
        },
    };
}

/** Transform a raw `pending_songs` row into what the merge expects. */
export function transformPendingRow(pending) {
    return isPendingTablature(pending)
        ? transformPendingTabRow(pending)
        : transformPendingSongRow(pending);
}

/**
 * Fold pending tablature parts into a work's published `tablature_parts`.
 *
 * A row that names the file it targets (`part_file` → `src_file`) is a
 * CORRECTION of that take: it replaces that entry in place, keeping the
 * take's identity (label, author, source, and the `file` its URL and the
 * "improve this one" intent are keyed on) and swapping only the bytes. A row
 * with no target is a new take and is appended — same-instrument siblings are
 * normal here (foggy-mountain-breakdown carries eight banjo tabs), so an
 * addition never displaces anyone.
 *
 * `file: null` on an appended part is what tells the loader there is nothing
 * to fetch yet; `content` is what it renders instead.
 */
export function overlayPendingTabParts(published = [], rows = []) {
    const parts = [...(published || [])];
    for (const row of rows || []) {
        const part = row?.pending_part;
        if (!part?.content) continue;
        const at = part.src_file
            ? parts.findIndex(p => p.src_file === part.src_file)
            : -1;
        if (at >= 0) parts[at] = { ...parts[at], ...part };
        else parts.push({ file: null, ...part });
    }
    return parts;
}

/**
 * A tab for a work nobody has published: the tab-only row shape the index
 * build already emits for such works (`tablature_parts`, no `has_content`),
 * so work-view builds exactly the page it would build after the commit lands.
 */
function pendingTabOnlyRow(rows) {
    const first = rows[0];
    return {
        id: first.id,
        title: first.title,
        artist: first.artist || '',
        composer: first.composer || '',
        first_line: '',
        lyrics: '',
        tags: {},
        source: 'pending',
        created_by: first.created_by || null,
        tablature_parts: overlayPendingTabParts([], rows),
    };
}

/**
 * Attach every pending tablature row to the work it targets.
 *
 * Deliberately NOT `source: 'pending'` on a work that merely gained a pending
 * part: the work itself is as durable as it was a second ago, and flagging
 * the whole row as overlay would make My Submissions report every OTHER
 * contribution to that work as no-longer-in-the-songbook. The part carries
 * the pending flag; the work does not.
 */
export function applyPendingTabs(songs, tabRows) {
    if (!tabRows?.length) return songs;

    const byTarget = new Map();
    for (const row of tabRows) {
        const target = row.replaces_id || row.id;
        if (!byTarget.has(target)) byTarget.set(target, []);
        byTarget.get(target).push(row);
    }

    const merged = songs.map(song => {
        const rows = byTarget.get(song.id);
        if (!rows) return song;
        byTarget.delete(song.id);
        return {
            ...song,
            tablature_parts: overlayPendingTabParts(song.tablature_parts, rows),
        };
    });

    // Whatever is left targets nothing published — a brand-new tab-only work.
    for (const rows of byTarget.values()) merged.push(pendingTabOnlyRow(rows));
    return merged;
}

/**
 * Merge the row sources into the corpus the app runs on.
 *
 * Pending rows overlay static rows: a pending SONG row with `replaces_id`
 * inherits the static row's fields (tablature_parts, tags, …) and hides
 * the row it replaces; a pending TABLATURE row attaches as a part instead
 * (applyPendingTabs).
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

    // Two kinds of pending row, two different jobs. Split before either
    // rule runs so a tablature row can never be mistaken for a song that
    // replaces a work.
    const tabRows = pendingRows.filter(isPendingTablature);
    const songRows = pendingRows.filter(p => !isPendingTablature(p));

    const staticMap = {};
    for (const row of staticRows) staticMap[row.id] = row;

    const mergedPending = songRows.map(p => {
        const base = p.replaces_id ? staticMap[p.replaces_id] : null;
        if (!base) return p;
        const merged = { ...base, ...p, source: 'pending' };
        const forked = pendingForkArrangements(base, p);
        if (forked) merged.arrangements = forked;
        return merged;
    });

    const replacedIds = new Set(
        songRows.filter(p => p.replaces_id).map(p => p.replaces_id)
    );

    // Tabs go on last, so a pending part lands on the pending SONG row when a
    // work has both (an edited chart and a new tab arrive as one work page).
    const songs = applyPendingTabs([
        ...staticRows.filter(row => !replacedIds.has(row.id)),
        ...mergedPending,
    ], tabRows);

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
