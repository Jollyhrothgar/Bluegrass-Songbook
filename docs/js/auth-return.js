// Auth return record — getting back to what you were doing after sign-in.
//
// Signing in with Google is a FULL-PAGE redirect: the page unloads, Google and
// Supabase run, and the browser comes back to `origin + pathname` with the
// session in the URL fragment (`#access_token=…`). Everything the page held in
// memory is gone, and so is the route it was on — the fragment is Supabase's,
// so the route cannot ride along in `redirectTo`.
//
// So the page leaves a note for itself first. Just before the redirect it
// writes a RETURN RECORD to localStorage: the route (`hash`) to go back to and,
// from whichever editor is open, the state that would otherwise be lost. After
// the sign-in lands, main.js takes the record, routes back and lets the editor
// put its state back. The record is single-use and expires.
//
// This module is dependency-free on purpose (it is imported by utils.js, the
// tab-entry gate, the editors and main.js, and must not drag any of them in).
//
//   record = { v: 1, at: <ms>, hash: '#add', kind: 'lead-sheet'|'tab'|'route', state?: {...} }
//
// Sources: each editor registers a function that returns its part of the
// record (or null when it is not the thing on screen). The first source that
// answers wins; with none, the record is just the current route.

export const RETURN_KEY = 'bgb-auth-return';

/**
 * How long a record stays usable. Long enough for Google's consent screen,
 * 2FA and a slow phone; short enough that a record an abandoned sign-in left
 * behind cannot hijack a visit days later.
 */
export const RETURN_TTL_MS = 30 * 60 * 1000;

/** Upper bound on what a record may hold — localStorage is ~5MB, shared. */
const MAX_RECORD_CHARS = 1_500_000;

const sources = new Set();

/**
 * Register a source of return state. `fn()` runs synchronously, right before
 * the redirect, and returns `{ kind, hash?, state? }` or null.
 * @returns {() => void} unregister
 */
export function registerReturnSource(fn) {
    sources.add(fn);
    return () => { sources.delete(fn); };
}

// ---------------------------------------------------------------------------
// Did THIS page load come back from an auth redirect?
// ---------------------------------------------------------------------------

/**
 * Classify the URL a page loaded with. Pure, so it can be tested.
 *
 *   `#access_token=…` / `#refresh_token=…`  → 'signed-in'   (implicit flow)
 *   `#error=…` / `#error_description=…`     → 'error'       (consent refused…)
 *   anything else                           → null
 *
 * Only a page that actually came back from the redirect may apply a record;
 * a record left by an abandoned attempt must not fire when the user later
 * signs in some other way (email/password never leaves the page).
 */
export function detectAuthRedirect(hash = '', search = '') {
    const fragment = String(hash).replace(/^#/, '');
    if (fragment) {
        const params = new URLSearchParams(fragment);
        if (params.has('access_token') || params.has('refresh_token')) return 'signed-in';
        if (params.has('error') || params.has('error_description')) return 'error';
    }
    const query = new URLSearchParams(String(search).replace(/^\?/, ''));
    if (query.has('error_description') && (query.has('error') || query.has('error_code'))) {
        return 'error';
    }
    return null;
}

/**
 * The URL is read at import time, before supabase-js (created later, in
 * main.js's init) strips the fragment.
 */
export const AUTH_REDIRECT = (() => {
    try {
        return detectAuthRedirect(globalThis.location?.hash, globalThis.location?.search);
    } catch {
        return null;
    }
})();

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function storage() {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;     // blocked storage throws on access
    }
}

/**
 * Is `hash` something we are willing to route back to? An in-app route and
 * nothing else: it is written by us, but it is replayed into the router, so
 * it is validated on the way out as well as on the way in.
 */
export function isSafeReturnHash(hash) {
    return typeof hash === 'string'
        && hash.length > 1
        && hash.length <= 600
        && hash.startsWith('#')
        && !/access_token|refresh_token|provider_token/.test(hash)
        // an invite link is consumed by its own pending-invite flow
        && !hash.startsWith('#invite/');
}

/** Shape-check a parsed record; anything off is treated as no record. */
function validRecord(record, now) {
    return !!record
        && record.v === 1
        && Number.isFinite(record.at)
        && now - record.at < RETURN_TTL_MS
        && record.at - now < 60 * 1000          // not from the future
        && isSafeReturnHash(record.hash)
        && ['lead-sheet', 'tab', 'route'].includes(record.kind);
}

/** What to write for the page as it is right now. */
export function buildReturnRecord(now = Date.now()) {
    let picked = null;
    for (const source of sources) {
        try {
            const answer = source();
            if (answer) { picked = answer; break; }
        } catch (err) {
            console.warn('[auth-return] a source failed', err);
        }
    }
    const currentHash = globalThis.location?.hash || '';
    const hash = isSafeReturnHash(picked?.hash) ? picked.hash : currentHash;
    if (!isSafeReturnHash(hash)) return null;      // home: nothing to return to
    return {
        v: 1,
        at: now,
        hash,
        kind: picked?.kind || 'route',
        ...(picked?.state ? { state: picked.state } : {}),
    };
}

/**
 * Write the return record. Call immediately before starting the redirect.
 * Never throws: failing to remember where you were must not stop you
 * signing in.
 * @returns {boolean} whether a record was written
 */
export function persistReturnRecord(now = Date.now()) {
    try {
        const store = storage();
        if (!store) return false;
        const record = buildReturnRecord(now);
        if (!record) {
            store.removeItem(RETURN_KEY);
            return false;
        }
        const json = JSON.stringify(record);
        if (json.length > MAX_RECORD_CHARS) {
            // Too big to keep (a pasted novel): keep the ROUTE at least.
            const { state, ...routeOnly } = record;
            store.setItem(RETURN_KEY, JSON.stringify({ ...routeOnly, kind: 'route' }));
            return true;
        }
        store.setItem(RETURN_KEY, json);
        return true;
    } catch (err) {
        console.warn('[auth-return] could not save the return record', err);
        return false;
    }
}

/** Remove whatever record is stored. */
export function clearReturnRecord() {
    try { storage()?.removeItem(RETURN_KEY); } catch { /* nothing to do */ }
}

/**
 * Read AND remove the record. Returns null when there is none, it has
 * expired, or it does not check out — and removes it in every one of those
 * cases, so a bad record cannot linger.
 */
export function takeReturnRecord(now = Date.now()) {
    const store = storage();
    if (!store) return null;
    let raw = null;
    try {
        raw = store.getItem(RETURN_KEY);
        store.removeItem(RETURN_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const record = JSON.parse(raw);
        return validRecord(record, now) ? record : null;
    } catch {
        return null;
    }
}

/** Drop an expired record at startup (they hold a user's draft text). */
export function pruneReturnRecord(now = Date.now()) {
    const store = storage();
    if (!store) return;
    try {
        const raw = store.getItem(RETURN_KEY);
        if (!raw) return;
        if (!validRecord(JSON.parse(raw), now)) store.removeItem(RETURN_KEY);
    } catch {
        clearReturnRecord();
    }
}
