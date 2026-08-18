// Tab submission client — the instant pipeline, finally including tabs.
//
// Tabs used to travel as a GitHub pull request: `create-tab-pr` committed the
// OTF file to a branch and merge meant approve. That function is gone, and
// with it the last content type that was review-gated while everything else
// was additive-instant (contribution-pipeline.md:193-210 deferred this
// deliberately; the rebuild it asked for is what this file now targets).
//
// A tab takes exactly the two steps a song submission takes
// (editor.js `submitSong` — read it, this mirrors it):
//
//   1. write the `pending_songs` row  → live in the overlay in seconds
//   2. POST {id} to `auto-commit-song` → durable in works/ in minutes
//
// What makes the row a TAB rather than a song is three columns:
//   part_type  'tablature' (vs the 'lead-sheet' default)
//   instrument the corpus part name ('banjo', not '5-string-banjo')
//   part_file  the works/ filename a CORRECTION targets; null for a new tab
// and `content`, which for a tablature row holds the serialized OTF JSON
// string instead of ChordPro.
//
// The client never claims what the write IS. "New work", "another take on
// this instrument", "a fix to that take" are all the server's call — it has
// the repo and we have a guess. Step 2's response reports what it decided.

const SUPABASE_URL = 'https://ofmqlrnyldlmvggihogt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mbXFscm55bGRsbXZnZ2lob2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTY3OTksImV4cCI6MjA4MjI5Mjc5OX0.Fm7j7Sk-gThA7inYeZecFBY52776lkJeXbpR7UKYoPE';

// Sanity cap only — the row carries the whole document, and the corpus max
// is ~180KB. This exists to catch a runaway serializer, not to ration.
export const MAX_OTF_CHARS = 2_000_000;

/**
 * Compact-serialize an OTF for submission: strips view-cache fields
 * (like _partFile).
 */
export function serializeForSubmission(otf) {
    const clean = JSON.parse(JSON.stringify(otf));
    for (const k of Object.keys(clean)) {
        if (k.startsWith('_')) delete clean[k];
    }
    const compact = JSON.stringify(clean);
    if (compact.length > MAX_OTF_CHARS) {
        throw new Error(
            `This tab is implausibly large `
            + `(${Math.round(compact.length / 1024)}KB) — refusing to submit.`);
    }
    return compact;
}

/**
 * The signed-in caller's access token, or null.
 *
 * Tab submissions are content the submitter will look for later, so they
 * require login (Phase 2a). The token IS the attribution: the edge function
 * derives the submitter from it and ignores anything the client claims —
 * there is no `submittedBy` field any more.
 */
export async function accessToken() {
    const supabase = globalThis.window?.SupabaseAuth?.supabase;
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
}

/** The booted Supabase client, or null when auth hasn't loaded. */
function defaultSupabase() {
    return globalThis.window?.SupabaseAuth?.supabase || null;
}

/** The signed-in user's uuid (RLS defaults it too; explicit is clearer). */
function currentUserId() {
    return globalThis.window?.SupabaseAuth?.getUser?.()?.id || null;
}

/**
 * Row ids handed out this page-session, keyed by the take being submitted.
 *
 * Not persisted on purpose. Its whole job is to make a *repeat* of one
 * submission — a double-click, or a retry after "saved but not synced" —
 * reuse its id instead of minting a second take. A genuine later submission
 * (new page, or after clearDraft) SHOULD get a fresh id: that's a new take,
 * which is exactly what `add` mode is for.
 */
const issuedRowIds = new Map();

/**
 * The `pending_songs.id` for a tablature row: `tab:<slug>:<rand>`.
 *
 * The shape is enforced in the database
 * (`pending_songs_tab_id_namespace`: `^tab:[a-z0-9-]*:[a-z0-9]{6,}$`), so
 * this is not cosmetic — a malformed id is a rejected INSERT, not a tidier
 * table. The slug half is human-scannable only; nothing downstream derives
 * meaning from it, and `process_pending.tab_work_slug()` re-derives the real
 * target from the row's title rather than trusting anything parsed out of
 * here.
 *
 * 8 random chars where the constraint asks for 6 — the margin is free, and
 * the id has to be unique across every submitter tabbing the same song.
 */
export function tabRowId(slug, instrument, file = null) {
    const key = `${slug || ''}|${instrument || ''}|${file || ''}`;
    const seen = issuedRowIds.get(key);
    if (seen) return seen;

    // The slug is decorative, but it still has to satisfy the CHECK, so it
    // is sanitized rather than trusted: a work id from the index is already
    // a slug, but nothing here should depend on that staying true.
    const safeSlug = String(slug || '').toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

    const bytes = new Uint8Array(8);
    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        // Hosts without Web Crypto (old test runners). Collision risk here is
        // not a security property — the id only has to be unique.
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    const rand = Array.from(bytes, b => (b % 36).toString(36)).join('');

    const id = `tab:${safeSlug}:${rand}`;
    issuedRowIds.set(key, id);
    return id;
}

/**
 * A work slug for a tab that names no existing work.
 *
 * Deliberately a local copy of `utils.generateSlug` rather than an import:
 * utils.js reaches into song-content.js and the DOM, and this module is
 * loaded by the standalone create.html, which boots none of that. The two
 * must stay identical — a divergence would mint a different id for the same
 * title depending on which page you submitted from.
 */
export function tabWorkSlug(title, artist = null) {
    const base = artist ? `${title}-${artist}` : String(title || '');
    return base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}

/**
 * Step 2: ask for the durable write.
 *
 * Same contract as editor.js `triggerAutoCommit` — reject when the durable
 * write was NOT accepted, so the caller can say so, and resolve with the
 * function's body (`{success, mode, workId, reason}`) when it was. The body
 * is where the client finds out what the server decided the write was.
 */
async function requestDurableWrite(id, token, fetchImpl) {
    const response = await fetchImpl(`${SUPABASE_URL}/functions/v1/auto-commit-song`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ id }),
    });

    if (!response.ok) {
        let detail = '';
        try {
            detail = (await response.json())?.error || '';
        } catch {
            // non-JSON error body; the status is enough
        }
        throw new Error(
            `auto-commit-song returned ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    try {
        return await response.json();
    } catch {
        // A 200 with an unreadable body still means the dispatch was
        // accepted; the caller just learns nothing about the mode.
        return null;
    }
}

/**
 * Submit a new tab or a tab correction.
 *
 * Resolves as soon as the tab is LIVE. Step 2 failing does not fail the
 * submission and must not be reported as one: the row is in `pending_songs`,
 * every reader sees the tab, and the hourly reconciler retries the commit.
 * `synced: false` is the caller's cue to say "live, syncing shortly" — never
 * "failed".
 *
 * @param {Object} p
 * @param {'tab-correction'|'tab-submission'} [p.type] - the caller's intent.
 *   Used for local validation only; it is NOT sent as a claim about what the
 *   server should do.
 * @param {Object} p.otf - the document (serialized internally)
 * @param {string} p.title - the work's title (the row needs one)
 * @param {string} [p.artist] - only meaningful when minting a new work
 * @param {string} p.instrument - corpus part instrument, e.g. 'banjo'
 * @param {string} [p.file] - for a CORRECTION, the works/ filename it fixes
 *   (a work can carry several arrangements per instrument, so the instrument
 *   alone names the wrong take for all but the first)
 * @param {string} [p.workId] - the work this tab belongs to; omit to mint one
 * @param {string} [p.comment] - what changed (corrections)
 * @param {Object} [deps] - injectable for tests
 * @param {Function} [deps.fetchImpl]
 * @param {Object} [deps.supabase]
 * @returns {Promise<{id: string, workId: string, instrument: string,
 *   partFile: string|null, live: true, synced: boolean, mode: string|null,
 *   syncError: string|null}>}
 */
export async function submitTab(p, deps = {}) {
    const {
        otf, title, instrument, file = null, workId = null,
        comment = null, artist = null,
    } = p || {};
    const {
        // Not `globalThis.fetch` bare: an unbound reference is a foot-gun in
        // any host that brand-checks the receiver.
        fetchImpl = (...args) => globalThis.fetch(...args),
        supabase = defaultSupabase(),
    } = deps;

    const token = await accessToken();
    if (!token) {
        throw new Error('Sign in to submit tabs — your account is the attribution.');
    }
    if (!supabase) {
        throw new Error('Not connected to the songbook — reload and try again.');
    }

    // Required by the contract for a tablature row, and by the corpus: the
    // instrument is what names the published file and what the overlay hangs
    // the part off. A row without one has nowhere to land.
    const partInstrument = String(instrument || '').trim();
    if (!partInstrument) {
        throw new Error('This tab needs an instrument before it can be submitted.');
    }

    const cleanTitle = String(title || '').trim() || 'Untitled';
    // A tab row is NOT keyed by the work it targets. pending_songs.id is the
    // primary key, so keying a tab by its work meant two people tabbing the
    // same song collided on it — and because RLS gates writes on created_by,
    // the loser got a permissions error that said nothing about the real
    // problem. A pending chart and a pending tab for one work couldn't
    // coexist either. So tabs live in their own `tab:` namespace, which a
    // work slug can never enter (slugs hold no colon), and the work they
    // target rides in replaces_id instead.
    const targetSlug = workId || tabWorkSlug(cleanTitle, artist);
    if (!targetSlug) {
        throw new Error('This tab needs a title before it can be submitted.');
    }
    const id = tabRowId(targetSlug, partInstrument, file);

    const row = {
        id,
        // Points the overlay at the work this part belongs to. For a tab it
        // does NOT mean "hide that row and show this one" (a tab is not a
        // song) — corpus.js reads part_type first and attaches instead.
        replaces_id: workId || null,
        title: cleanTitle,
        artist: artist || null,
        content: serializeForSubmission(otf),
        part_type: 'tablature',
        instrument: partInstrument,
        // Null means "a new take"; a filename means "this take, corrected".
        part_file: file || null,
        notes: comment || null,
        created_by: currentUserId(),
        tags: {},
    };

    // Upsert, not insert: tabRowId hands back the SAME id for a repeated
    // submission of the same take, so a double-click or a retry after a sync
    // warning updates one row instead of minting a second take. (The
    // idempotence marker downstream is keyed by row id, so two ids really
    // would mean two banjo parts.) RLS still refuses someone else's row.
    const { error } = await supabase
        .from('pending_songs')
        .upsert(row, { onConflict: 'id' });
    if (error) {
        throw new Error(error.message || 'Could not save this tab.');
    }

    let mode = null;
    let synced = false;
    let syncError = null;
    // Best guess until the server answers. For an existing work it IS the
    // answer; for a new one the writer resolves the real slug against the
    // checkout (`salt-creek-1` when `salt-creek` is taken), so the server's
    // value wins when we get one. Callers link to this.
    let resolvedWorkId = targetSlug;
    try {
        const result = await requestDurableWrite(id, token, fetchImpl);
        mode = result?.mode || null;
        if (result?.workId) resolvedWorkId = result.workId;
        synced = true;
    } catch (e) {
        // Live but not yet durable. Loud in the console, soft in the return
        // value — the reconciler owns the retry from here.
        console.warn('Tab is live but not yet synced to the songbook:', e);
        syncError = e.message;
    }

    return {
        id,
        workId: resolvedWorkId,
        instrument: partInstrument,
        partFile: row.part_file,
        live: true,
        synced,
        mode,
        syncError,
    };
}
