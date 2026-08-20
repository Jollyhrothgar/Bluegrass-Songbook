// Drafts — the personal bucket for tabs you have started but not submitted
// (§9.3 of docs/plans/tab-editor-input-parity.md; the "personal bucket" of
// docs/plans/tab-authoring.md Step 2, in its local-only first form).
//
// A draft is `{ id, title, instrument, workId?, takeRef?, otf, updatedAt }`
// kept in IndexedDB (`bgb-drafts` / `drafts`), because an OTF document is far
// too big for the localStorage budget the old single-draft slot lived in —
// and because there is now more than one of them.
//
// STORAGE IS INJECTED. Everything here is written against a tiny `backend`
// interface (`get/put/delete/getAll`) rather than IndexedDB directly, so the
// logic — id minting, metadata derivation, ordering, pruning, debounced
// autosave, migration — is unit-testable in jsdom with `memoryBackend()`.
// `idbBackend()` is the thin real implementation.
//
// Sync (Supabase) is deliberately absent: Step 2 of tab-authoring.md says to
// design the cloud shape after a week of real use. Local drafts work offline
// today and nothing here forecloses a later `pending_tabs` mirror.

export const DB_NAME = 'bgb-drafts';
export const STORE_NAME = 'drafts';
export const DB_VERSION = 1;

/** Keep the bucket from growing without bound; oldest go first. */
export const MAX_DRAFTS = 50;

/**
 * The pre-IndexedDB single-draft slot (otf-editor/create-tab.js `DRAFT_KEY`).
 * Spelled out rather than imported so this module stays dependency-free — it
 * is loaded by the drafts route, the editor autosave AND the PWA file
 * handler, and none of them should drag the create-page module graph in.
 */
export const LEGACY_DRAFT_KEY = 'otf-editor-draft';
export const MIGRATION_FLAG_KEY = 'bgb-drafts-migrated';
/** Stable id for the migrated legacy draft, so re-running is idempotent. */
export const LEGACY_DRAFT_ID = 'legacy-local-draft';

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

/**
 * In-memory backend: the test double, and the graceful degradation path when
 * IndexedDB is missing (private-mode Firefox, jsdom, a locked-down webview).
 * Drafts then live for the session only, which beats throwing.
 */
export function memoryBackend(initial = []) {
    const rows = new Map(initial.map(r => [r.id, r]));
    return {
        async get(id) { return rows.get(id) || null; },
        async put(record) { rows.set(record.id, record); return record; },
        async delete(id) { rows.delete(id); },
        async getAll() { return [...rows.values()]; },
    };
}

function idbRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** The real store. Opens lazily so a page that never drafts never opens a DB. */
export function idbBackend({
    indexedDB = globalThis.indexedDB,
    dbName = DB_NAME,
    storeName = STORE_NAME,
    version = DB_VERSION,
} = {}) {
    if (!indexedDB) return null;
    let dbPromise = null;

    const open = () => {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName, version);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    };

    const tx = async (mode, fn) => {
        const db = await open();
        const transaction = db.transaction(storeName, mode);
        const result = await fn(transaction.objectStore(storeName));
        return result;
    };

    return {
        get: (id) => tx('readonly', store => idbRequest(store.get(id))).then(r => r || null),
        put: (record) => tx('readwrite', store => idbRequest(store.put(record))).then(() => record),
        delete: (id) => tx('readwrite', store => idbRequest(store.delete(id))).then(() => undefined),
        getAll: () => tx('readonly', store => idbRequest(store.getAll())).then(r => r || []),
    };
}

// ---------------------------------------------------------------------------
// Record shaping
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Sortable, collision-resistant, and readable in a URL. */
export function newDraftId(now = Date.now()) {
    idCounter = (idCounter + 1) % 1e6;
    const rand = Math.random().toString(36).slice(2, 6);
    return `d-${now.toString(36)}-${idCounter.toString(36)}${rand}`;
}

/** A draft id is only ever echoed into a hash route — keep it URL-safe. */
export function isDraftId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * Derive the list-view metadata from the document, so a draft is recognisable
 * without opening it. Explicit values (the caller knows the target work, or
 * the instrument a bounty asked for) always win over the document's guess.
 */
export function draftMetaFrom(otf, meta = {}) {
    const track = otf?.tracks?.[0] || {};
    const title = String(meta.title || otf?.metadata?.title || '').trim()
        || 'Untitled';
    const instrument = String(meta.instrument || track.instrument || track.id || '')
        .trim() || 'unknown';
    return { title: title.slice(0, 200), instrument: instrument.slice(0, 40) };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * @param {Object} [options]
 * @param {Object} [options.backend] - injected storage (see memoryBackend)
 * @param {Function} [options.now] - clock, for deterministic tests
 */
export function createDraftStore({
    backend = idbBackend() || memoryBackend(),
    now = () => Date.now(),
} = {}) {
    /**
     * Write (or overwrite) a draft. Returns the stored record.
     * A missing id mints one, which is how "start typing" becomes a draft.
     */
    async function save({ id = null, otf, title, instrument, workId = null, takeRef = null }) {
        const derived = draftMetaFrom(otf, { title, instrument });
        const record = {
            id: isDraftId(id) ? id : newDraftId(now()),
            title: derived.title,
            instrument: derived.instrument,
            otf,
            updatedAt: new Date(now()).toISOString(),
            ...(workId ? { workId } : {}),
            ...(takeRef ? { takeRef } : {}),
        };
        await backend.put(record);
        await prune();
        return record;
    }

    async function get(id) {
        if (!isDraftId(id)) return null;
        return (await backend.get(id)) || null;
    }

    /** Newest first — the list view's only ordering. */
    async function list() {
        const rows = await backend.getAll();
        return rows.slice().sort((a, b) =>
            String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    async function remove(id) {
        if (!isDraftId(id)) return;
        await backend.delete(id);
    }

    async function prune(limit = MAX_DRAFTS) {
        const rows = await list();
        if (rows.length <= limit) return 0;
        const doomed = rows.slice(limit);
        for (const row of doomed) await backend.delete(row.id);
        return doomed.length;
    }

    return { save, get, list, remove, prune, backend };
}

// ---------------------------------------------------------------------------
// Migration from the single localStorage draft
// ---------------------------------------------------------------------------

/**
 * Move the old one-slot localStorage draft into the store, once.
 *
 * The localStorage copy is left where it is on purpose: create.html's
 * "You have an unsaved draft — Resume / Discard" banner still reads it, so
 * migrating destructively would break resume for anyone mid-tab at deploy
 * time. The fixed id makes a second run a no-op overwrite rather than a
 * duplicate.
 *
 * @returns {Promise<Object|null>} the migrated record, or null if there was
 *          nothing to migrate (or it had already run).
 */
export async function migrateLegacyDraft({
    store,
    storage = globalThis.localStorage,
} = {}) {
    if (!store || !storage) return null;
    try {
        if (storage.getItem(MIGRATION_FLAG_KEY)) return null;
        const raw = storage.getItem(LEGACY_DRAFT_KEY);
        storage.setItem(MIGRATION_FLAG_KEY, new Date().toISOString());
        if (!raw) return null;
        const legacy = JSON.parse(raw);
        if (!legacy?.otf?.tracks?.length) return null;
        return await store.save({
            id: LEGACY_DRAFT_ID,
            otf: legacy.otf,
            workId: legacy.target?.workId || null,
            title: legacy.target?.title || null,
            instrument: legacy.target?.instrument || null,
        });
    } catch {
        // Quota, private mode, corrupt JSON — a failed migration must never
        // block the app from starting.
        return null;
    }
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/**
 * Debounced autosave for an editor session.
 *
 * The editor fires `onChange` on every single document mutation (every note),
 * so writes are coalesced onto a ~1s trailing edge. `flush()` forces the
 * pending write out (used before navigating away); `clear()` deletes the
 * draft entirely (used when the tab is submitted).
 *
 * The first save mints the id and every later one reuses it, so a session is
 * one draft rather than one draft per keystroke.
 */
export function createAutosaver({
    store,
    id = null,
    meta = {},
    delay = 1000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onSaved = null,
    onError = null,
} = {}) {
    let timer = null;
    let pending = null;
    let currentId = isDraftId(id) ? id : null;

    async function write() {
        if (!pending) return null;
        const otf = pending;
        pending = null;
        try {
            const record = await store.save({ ...meta, id: currentId, otf });
            currentId = record.id;
            onSaved?.(record);
            return record;
        } catch (err) {
            onError?.(err);
            return null;
        }
    }

    return {
        get draftId() { return currentId; },

        /** Queue a save of this document. Safe to call on every change. */
        save(otf) {
            if (!otf) return;
            pending = otf;
            if (timer !== null) clearTimeoutFn(timer);
            timer = setTimeoutFn(() => { timer = null; write(); }, delay);
        },

        /** Write any queued document now. */
        async flush() {
            if (timer !== null) { clearTimeoutFn(timer); timer = null; }
            return write();
        },

        /** Drop the queued write without saving it. */
        cancel() {
            if (timer !== null) { clearTimeoutFn(timer); timer = null; }
            pending = null;
        },

        /** Submitted (or discarded): the draft has served its purpose. */
        async clear() {
            this.cancel();
            if (currentId) await store.remove(currentId);
            currentId = null;
        },
    };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The canonical hash route that reopens a draft.
 *
 * These are the §9.1 routes ("the work page is the only frame"):
 *   correction in progress → `#work/{slug}/edit/{take}?draft={id}`
 *   new take on a known work → `#work/{slug}/add-tab?draft={id}`
 *   brand-new work → `#new-tab?draft={id}`
 *
 * Pure and total: an unusable workId degrades to the new-tab route rather
 * than minting a link into a work that may not exist.
 */
export function draftOpenHash(draft) {
    if (!draft || !isDraftId(draft.id)) return '#new-tab';
    const id = encodeURIComponent(draft.id);
    const work = typeof draft.workId === 'string' && SLUG_RE.test(draft.workId)
        ? draft.workId : null;
    if (!work) return `#new-tab?draft=${id}`;
    const take = typeof draft.takeRef === 'string' && draft.takeRef
        ? draft.takeRef : null;
    return take
        ? `#work/${work}/edit/${encodeURIComponent(take)}?draft=${id}`
        : `#work/${work}/add-tab?draft=${id}`;
}

/**
 * Read `?draft=…` (and friends) off a hash route.
 * `#new-tab?draft=d-1&file=1` → `{ draft: 'd-1', file: true }`.
 */
export function parseHashParams(hash) {
    const q = String(hash || '').indexOf('?');
    if (q < 0) return { draft: null, file: false, params: new URLSearchParams() };
    const params = new URLSearchParams(String(hash).slice(q + 1));
    const draft = params.get('draft');
    return {
        draft: isDraftId(draft) ? draft : null,
        file: params.get('file') === '1',
        params,
    };
}

/** Everything before the `?` of a hash route. */
export function hashPath(hash) {
    const raw = String(hash || '');
    const q = raw.indexOf('?');
    return q < 0 ? raw : raw.slice(0, q);
}

// ---------------------------------------------------------------------------
// Module-level singleton (the app's one store)
// ---------------------------------------------------------------------------

let sharedStore = null;

/** The app-wide draft store. Tests build their own with createDraftStore. */
export function getDraftStore() {
    if (!sharedStore) sharedStore = createDraftStore();
    return sharedStore;
}

/** Test seam: swap (or reset, with null) the app-wide store. */
export function setDraftStore(store) {
    sharedStore = store;
}
