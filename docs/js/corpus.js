// Corpus assembly: how the three row sources become `allSongs`.
//
// - data/index.jsonl   — the searchable canon; fetched at startup, blocking
// - data/archive.jsonl — everything the prune left off the shelf; fetched ON
//                        DEMAND (a deep link, a list, the Dungeon, a pending
//                        or promoted row that names an archived work) — never
//                        speculatively; see overlaysNeedArchive
// - pending_songs      — Supabase overlay: every logged-in user's submission,
//                        live in seconds while the git commit catches up.
//                        A row is a SONG, a PART, or a METADATA edit
//                        (`part_type`); see transformPendingRow /
//                        applyPendingTabs / applyPendingMetadata below
// - deleted/promoted   — Supabase curation overlays: the same suppression and
//                        prune-rescue the index build applies, but instant
//
// Kept separate from main.js so the merge is unit-testable without booting
// the whole app.

import { buildStemSet } from './stem.js';
import { generateSlug } from './utils.js';

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
 * Does a RAW `pending_songs` row have a body (ChordPro, or an OTF for a tab)?
 *
 * The overlay fetch leaves `content` out of its column list — a chart is up to
 * 200 KB and a tab 2 MB, and every visitor would pay for every pending row —
 * and learns which rows have one from a second, id-only query, which it
 * records as `has_content`. A row that still carries `content` inline
 * (my-submissions, tests, an older caller) answers for itself; a row that
 * carries neither signal is assumed to have text unless its kind says it
 * can't (a metadata edit, a placeholder request).
 */
export function rowHasContent(row) {
    if (typeof row?.content === 'string') return row.content.length > 0;
    if (typeof row?.has_content === 'boolean') return row.has_content;
    return row?.part_type !== 'metadata' && row?.status !== 'placeholder';
}

/**
 * Does a TRANSFORMED pending row (what mergeCorpus sees) have text, whether
 * it is inline or still to be fetched when the song is opened?
 */
function pendingHasText(row) {
    if (typeof row?.content === 'string') return row.content.length > 0;
    return row?.deferred_content === true;
}

/**
 * Pending rows are fetched WITHOUT `content` (see rowHasContent): just the
 * columns the merge reads. Keep this list in step with
 * transformPendingSongRow / TabRow / MetadataRow below.
 */
export const PENDING_OVERLAY_COLUMNS = [
    'id', 'title', 'artist', 'composer', 'key', 'mode', 'tags', 'notes',
    'status', 'replaces_id', 'created_by', 'created_at', 'part_type',
    'instrument', 'part_file',
].join(',');

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
    if (!pendingHasText(pending)) return null;
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
        // The text rides along when the row carried it; otherwise the row id
        // is the address song-content fetches it from when the take is opened.
        ...(typeof pending.content === 'string'
            ? { content: pending.content }
            : { pending_id: pending.id }),
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

/**
 * Is this pending row a METADATA edit — the work's title / artist / key /
 * notes, and nothing else?
 *
 * The third kind of row, and the one that owns no bytes at all: `content` is
 * null and `replaces_id` names the work being edited (required — a metadata
 * row with no target has nothing to say). It is not a song and not a part, so
 * it neither becomes a row nor attaches one; applyPendingMetadata overlays the
 * fields onto the work already in the corpus.
 */
export function isPendingMetadata(row) {
    return row?.part_type === 'metadata';
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
    const inline = typeof pending.content === 'string';
    const hasContent = rowHasContent(pending);
    return {
        id: pending.id,
        title: pending.title,
        artist: pending.artist || '',
        composer: pending.composer || '',
        // Inline when the row carried its text. Otherwise the row is a lean
        // one: `has_content` makes it a lead sheet on the work page and
        // `deferred_content` tells song-content to fetch the text from
        // pending_songs when the song is opened. (No `content` key at all —
        // an explicit undefined would overwrite a published row's field when
        // the merge spreads this over it.) Search previews and the lyrics
        // index are empty for such a row until the build publishes it.
        ...(inline || !hasContent
            ? { content: inline ? pending.content : '' }
            : { has_content: true, deferred_content: true }),
        key: pending.key || '',
        mode: pending.mode || '',
        tags: pending.tags || {},
        notes: pending.notes || '',
        status: pending.status || (hasContent ? undefined : 'placeholder'),
        source: 'pending',
        replaces_id: pending.replaces_id,
        created_by: pending.created_by || null,
        // Same rule as `content` above: a lean row omits these keys rather
        // than setting them to '', because the merge spreads this row over a
        // published work it edits, and '' would wipe that work's first line
        // and lyrics out of search until the commit lands.
        ...(inline
            ? { first_line: extractFirstLine(pending.content), lyrics: extractLyrics(pending.content) }
            : {}),
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
            // The submitter, in the same field name the published parts use
            // (`build_works_index` reads `provenance.submitted_by`). It is
            // what lets the work page know you own a part of this work in the
            // seconds after you submit a tab — which is precisely when a
            // tab-minted work still has no artist and wants one.
            ...(pending.created_by ? { submitted_by: pending.created_by } : {}),
            // The OTF rides along when the row carried it; a lean row flags
            // it instead and loadPartOtf fetches it when the take is opened.
            ...(typeof pending.content === 'string'
                ? { content: pending.content }
                : rowHasContent(pending) ? { content_deferred: true } : { content: '' }),
            pending: true,
            pending_id: pending.id,
        },
    };
}

/**
 * A pending METADATA row: the four editable fields plus the work it targets.
 *
 * Nothing here is an index row either. `part_type` rides along so the merge's
 * discriminator keeps working after the transform, and only fields the editor
 * actually submitted are carried — an absent field means "unchanged", which is
 * what lets a metadata edit leave `key` alone instead of blanking it.
 */
function transformPendingMetadataRow(pending) {
    const fields = {};
    for (const field of ['title', 'artist', 'key', 'notes']) {
        if (typeof pending[field] === 'string') fields[field] = pending[field];
    }
    return {
        id: pending.id,
        part_type: 'metadata',
        replaces_id: pending.replaces_id || null,
        created_by: pending.created_by || null,
        // Two people can hold an unlanded edit of the same work at once (the
        // id namespace exists so they don't collide on the PK), so the overlay
        // has to pick one — and `select('*')` promises no order.
        created_at: pending.created_at || null,
        pending_metadata: fields,
    };
}

/** Transform a raw `pending_songs` row into what the merge expects. */
export function transformPendingRow(pending) {
    if (isPendingTablature(pending)) return transformPendingTabRow(pending);
    if (isPendingMetadata(pending)) return transformPendingMetadataRow(pending);
    return transformPendingSongRow(pending);
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
        if (!part?.content && !part?.content_deferred) continue;
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
function pendingTabOnlyRow(rows, workId) {
    const first = rows[0];
    return {
        id: workId,
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
        // NOT `row.id`. A tab row's id is `tab:<slug>:<rand>` — its own
        // namespace, because keying a pending tab by the work it targets
        // collided when two people tabbed the same song. The slug inside it is
        // decorative and must never be parsed back out (submit-tab.js says so,
        // and process_pending.tab_work_slug re-derives rather than trusts it).
        //
        // So a tab that targets an existing work says so in `replaces_id`, and
        // a tab MINTING a work has no target to name — we derive the same slug
        // the server will, from the title, with the same rule. Using row.id
        // here filed the new work under `tab:welcome-to-new-york:bciu053d`,
        // which nothing links to: the submit page's "View it" link, search, and
        // any shared URL all point at the real slug, so the work was
        // unreachable at its own address until the deploy landed.
        const target = row.replaces_id || generateSlug(row.title, null);
        if (!target) continue;   // titleless row: the server refuses it too
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
    // It lands under the derived slug, so the moment the real row appears in
    // index.jsonl the overlay row merges ONTO it in the loop above instead of
    // standing beside it as a duplicate title in search.
    for (const [workId, rows] of byTarget) {
        merged.push(pendingTabOnlyRow(rows, workId));
    }
    return merged;
}

/**
 * Overlay every pending metadata edit onto the work it names.
 *
 * Three things this deliberately does NOT do:
 *
 * 1. **Mint a row.** A metadata row whose target isn't in the corpus is
 *    dropped, not turned into a song — unlike a tab, which legitimately mints
 *    the work it is the first part of. There is no work here to mint: the row
 *    carries no content of any kind, so a synthesized row would be a title
 *    with nothing behind it, competing in search with the real work as soon as
 *    the archive finished loading.
 * 2. **Touch the parts.** The copy keeps `tablature_parts`, `arrangements`,
 *    `has_content`, everything — renaming a work must not cost it its tabs.
 * 3. **Flag the work `source: 'pending'`.** Same reasoning as a pending tab
 *    part: the work is exactly as durable as it was, and claiming otherwise
 *    would report every other contribution to it as no-longer-in-the-songbook
 *    in My Submissions. The edit announces itself in `pending_metadata`.
 *
 * `_stems` is dropped from the copy because the title and artist are two of
 * the four strings it is built from — mergeCorpus re-stems right after.
 */
const stamp = (row) => Date.parse(row?.created_at || '') || 0;

export function applyPendingMetadata(songs, metaRows) {
    if (!metaRows?.length) return songs;

    const byTarget = new Map();
    for (const row of metaRows) {
        // `replaces_id` is the whole address. A metadata row's id is
        // `meta:<slug>:<rand>` — its own namespace, for the reason tab rows
        // have one: two people editing one work's details must not collide on
        // the primary key. The slug inside it is decorative and is never
        // parsed back out.
        if (!row?.replaces_id) continue;
        const held = byTarget.get(row.replaces_id);
        if (!held || stamp(row) >= stamp(held)) byTarget.set(row.replaces_id, row);
    }
    if (!byTarget.size) return songs;

    return songs.map(song => {
        const row = byTarget.get(song.id);
        const fields = row?.pending_metadata;
        if (!fields) return song;
        const { _stems, ...rest } = song;
        return {
            ...rest,
            ...fields,
            pending_metadata: { id: row.id, created_by: row.created_by },
        };
    });
}

/**
 * Does this pending row NAME a work (`replaces_id`) that `knownIds` (a Set, or
 * an object keyed by id) does not hold? That is an edit of, or a tab for, a
 * work the row has nothing to merge onto yet.
 *
 * Two kinds of row are deliberately not asked. A tab that names no work mints
 * one under the slug the server derives from its title: it is new by
 * construction, and treating "the slug might be archived" as a reason to
 * download the archive would make every visitor pay for it for as long as
 * someone's brand-new tab is pending. A metadata row with a missing target is
 * dropped by applyPendingMetadata, and the work page that would show it loads
 * the archive on its own.
 */
function pendingTargetsMissing(row, knownIds) {
    if (isPendingMetadata(row) || !row?.replaces_id) return false;
    return !(knownIds instanceof Set ? knownIds.has(row.replaces_id) : knownIds[row.replaces_id]);
}

/**
 * Must the archive be loaded for the overlays to mean what they say?
 *
 * The archive is no longer fetched speculatively, but two overlays are only
 * meaningful with it:
 *
 *  - `promoted_songs` rescues ARCHIVED works into search. Until the next
 *    index build folds a promotion into the canon, the promoted row exists
 *    only in archive.jsonl — so a promoted id the canon doesn't hold means
 *    the archive has to come in, or a fresh promotion would vanish.
 *  - A pending edit or tab targeting a work the canon doesn't hold is an edit
 *    of an archived work (or of nothing); mergeCorpus withholds it until the
 *    archive is there to merge onto.
 *
 * @param {{canon: Array, pending?: Array, promoted?: Iterable|Set}} sources
 *        `pending` rows in transformed (merge) shape
 */
export function overlaysNeedArchive({ canon = [], pending = [], promoted = null, deleted = null } = {}) {
    const promotedIds = asIdSet(promoted);
    if (!promotedIds.size && !(pending || []).length) return false;

    const deletedIds = asIdSet(deleted);
    const canonIds = new Set(canon.map(row => row.id));
    for (const id of promotedIds) {
        // Deletion wins over promotion (mergeCorpus), so a promoted id that is
        // also deleted has nothing to rescue.
        if (id && !canonIds.has(id) && !deletedIds.has(id)) return true;
    }
    const known = withPendingTargets(canonIds, pending, deletedIds);
    return (pending || []).some(row => pendingTargetsMissing(row, known));
}

/**
 * The ids a pending row's `replaces_id` can land on without the archive: the
 * given static ids, the pending SONG rows themselves (a tab attaches to a
 * pending song row — applyPendingTabs), and deleted ids (nothing to wait for:
 * the archive cannot bring a deleted work back).
 */
function withPendingTargets(staticIds, pending, deletedIds) {
    const known = new Set(staticIds);
    for (const id of deletedIds) known.add(id);
    for (const row of pending || []) {
        // (a row that "replaces" its own id is an edit of a work it does not
        // itself supply, so it is not a target either)
        if (row?.id && row.replaces_id !== row.id
            && !isPendingTablature(row) && !isPendingMetadata(row)) known.add(row.id);
    }
    return known;
}

// ============================================================
// Last-known curation sets, so the first paint is already right
// ============================================================

const CURATION_CACHE_PREFIX = 'songbook-curation-';

/**
 * Read the id set a previous visit cached for a curation table
 * ('deleted' | 'promoted'). Never throws: storage can be blocked, absent or
 * hold garbage, and an empty set is exactly what a first visit has.
 */
export function readCachedIdSet(kind, storage) {
    try {
        storage ??= globalThis.localStorage;
        const parsed = JSON.parse(storage?.getItem(CURATION_CACHE_PREFIX + kind) || '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []);
    } catch {
        return new Set();
    }
}

/** Remember an id set for the next visit's first paint. Never throws. */
export function writeCachedIdSet(kind, ids, storage) {
    try {
        storage ??= globalThis.localStorage;
        storage?.setItem(CURATION_CACHE_PREFIX + kind, JSON.stringify([...ids]));
    } catch {
        // Quota or blocked storage: the cache is an optimisation, not state.
    }
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
    archiveLoaded = true,
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

    // The archive is loaded on demand, so a pending row that targets a work
    // it alone holds has nothing to merge onto yet. Applied anyway, an edit
    // would stand in search as a bare row (the archived base is what keeps it
    // off the shelf) and a tab would mint a work that already exists. Hold
    // those rows back; overlaysNeedArchive is what brings the archive in, and
    // the next merge applies them properly.
    if (!archiveLoaded) {
        const known = withPendingTargets(Object.keys(staticMap), pendingRows, deletedIds);
        pendingRows = pendingRows.filter(p => !pendingTargetsMissing(p, known));
    }

    // Three kinds of pending row, three different jobs. Split before any of
    // the rules run so a tablature or metadata row can never be mistaken for a
    // song that replaces a work — both name a work in `replaces_id`, which is
    // exactly the field the song rule reads as "hide that row, show this one".
    const tabRows = pendingRows.filter(isPendingTablature);
    const metaRows = pendingRows.filter(isPendingMetadata);
    const songRows = pendingRows.filter(
        p => !isPendingTablature(p) && !isPendingMetadata(p));

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
    // Then metadata, which is last of all: it is the only row that edits the
    // work's own fields, so whatever else landed on this work, the details the
    // user just typed are what they see.
    const songs = applyPendingMetadata(applyPendingTabs([
        ...staticRows.filter(row => !replacedIds.has(row.id)),
        ...mergedPending,
    ], tabRows), metaRows);

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
