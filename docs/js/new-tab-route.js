// The `#new-tab` / `#work/{slug}/add-tab` seam.
//
// §9.1 of docs/plans/tab-editor-input-parity.md moves tab creation INTO the
// song page: `#new-tab` renders a provisional work page with the editor open,
// and `#work/{slug}/add-tab` renders the real one with an empty take. That
// work is in flight elsewhere. Everything the PWA needs — the Drafts list's
// Open button, the file handler, drag-and-drop, the manifest shortcut and the
// `file_handlers` action URL — points at those canonical routes TODAY, and
// this module is the one place that decides what they currently do.
//
// Until the in-page surface exists, the routes forward to `create.html`,
// which is the same editor with the same submit path (create-tab-entry.js →
// submit-tab.js). When the song-page surface lands, call
// `registerNewTabHandler()` from its module and this file's fallback stops
// being reached — no other caller changes.

import { hashPath, parseHashParams } from './drafts.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let handler = null;

/**
 * Install the in-page implementation of the new-tab / add-tab routes.
 * @param {Function} fn - ({ workId, takeRef, draftId, fromFile }) => boolean
 *        Returning false (or throwing) falls back to create.html.
 */
export function registerNewTabHandler(fn) {
    handler = typeof fn === 'function' ? fn : null;
}

/** Test seam / teardown. */
export function clearNewTabHandler() {
    handler = null;
}

/**
 * Break a new-tab-ish hash into its parts. Pure.
 *
 *   `#new-tab?draft=d-1`               → { workId: null, takeRef: null, draftId: 'd-1' }
 *   `#work/foggy-mountain/add-tab`     → { workId: 'foggy-mountain', ... }
 *   `#work/foggy-mountain/edit/banjo`  → { workId: 'foggy-mountain', takeRef: 'banjo' }
 *
 * @returns {{workId: string|null, takeRef: string|null, draftId: string|null,
 *            fromFile: boolean}|null} null when the hash is not one of ours.
 */
export function parseNewTabHash(hash) {
    const path = hashPath(hash);
    const { draft, file } = parseHashParams(hash);
    const base = { draftId: draft, fromFile: file };

    if (path === '#new-tab') return { workId: null, takeRef: null, ...base };

    const work = /^#work\/([^/]+)\/(add-tab|edit)(?:\/([^/]+))?$/.exec(path);
    if (!work) return null;
    const workId = decodeURIComponent(work[1]);
    if (!SLUG_RE.test(workId)) return null;
    return {
        workId,
        takeRef: work[2] === 'edit' && work[3] ? decodeURIComponent(work[3]) : null,
        ...base,
    };
}

/**
 * The create.html URL a parsed route falls back to. Pure.
 *
 * Known compromise: an `edit` route (a correction in progress) has no
 * create.html equivalent, so it opens as a NEW take on the same work rather
 * than as a correction to a specific one. The document is intact either way;
 * only the submission's shape differs, and the user still chooses to submit.
 */
export function createHrefFor(route, base = 'create.html') {
    if (!route) return base;
    const params = new URLSearchParams();
    if (route.workId) params.set('work', route.workId);
    if (route.draftId) params.set('draft', route.draftId);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
}

/**
 * Handle a `#new-tab` / `#work/{slug}/add-tab` / `#work/{slug}/edit/{take}`
 * hash. Returns true when the hash was ours (and something happened).
 */
export function openNewTabRoute(hash, {
    navigate = (href) => { globalThis.location.href = href; },
} = {}) {
    const route = parseNewTabHash(hash);
    if (!route) return false;
    if (handler) {
        try {
            if (handler(route) !== false) return true;
        } catch (err) {
            console.error('new-tab handler failed; falling back to create.html', err);
        }
    }
    navigate(createHrefFor(route));
    return true;
}
