// Local drafts for in-progress tab edits.
//
// The OTF editor's document lives in memory and nowhere else, so anything
// that unmounts the editor took the edits with it: switching parts, a
// top-nav click, a phone locking, a crashed tab. A draft is written on
// every document change and offered back the next time that same part is
// opened for editing.
//
// Keyed per (work, part), NOT globally. create.html's new-tab flow has its
// own single `otf-editor-draft` slot (create-tab.js) because it only ever
// holds one unsubmitted tab; a work page can have several takes of the same
// instrument, and one slot would have them overwrite each other. These live
// under their own prefix so the two never collide.

export const TAB_DRAFT_PREFIX = 'otf-tab-draft:';

/** How long a draft is worth offering back. Older ones are pruned on write. */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

/**
 * Address a draft. `partKey` should be work-view's `otfCacheKey(part)` —
 * the same tuple that already disambiguates arrangements in the view cache,
 * so a correction to take B never restores over take A.
 */
export function tabDraftKey(workId, partKey) {
    return `${TAB_DRAFT_PREFIX}${workId || 'unknown'}::${partKey || 'default'}`;
}

/**
 * Write a draft. Best-effort by design — private mode and a full quota both
 * throw, and neither is a reason to interrupt someone's editing. A quota
 * failure prunes expired drafts and retries once, because the common cause
 * is a pile of finished ones rather than this document being too big.
 *
 * @param {string} key - from tabDraftKey()
 * @param {Object} otf - the document as the editor currently holds it
 * @param {Object} [meta] - {workId, partId, title, instrument} for the banner
 */
export function saveTabDraft(key, otf, meta = {}, storage = globalThis.localStorage) {
    if (!key || !otf) return false;
    const payload = JSON.stringify({ savedAt: new Date().toISOString(), meta, otf });
    try {
        storage.setItem(key, payload);
        return true;
    } catch (e) {
        try {
            pruneTabDrafts(storage);
            storage.setItem(key, payload);
            return true;
        } catch (e2) {
            return false;
        }
    }
}

/**
 * Read a draft back, or null when there isn't a usable one. An expired or
 * malformed draft answers null AND is removed: a draft we would refuse to
 * restore should not keep occupying quota or reappearing in a prune scan.
 *
 * @returns {{savedAt: string, meta: Object, otf: Object}|null}
 */
export function loadTabDraft(key, storage = globalThis.localStorage) {
    if (!key) return null;
    let raw;
    try {
        raw = storage.getItem(key);
    } catch (e) {
        return null;
    }
    if (!raw) return null;
    try {
        const draft = JSON.parse(raw);
        // A document with no tracks can't be loaded into the editor, and a
        // draft we can't date can't be aged out — treat both as garbage.
        if (!draft?.otf?.tracks?.length || !draft.savedAt) {
            clearTabDraft(key, storage);
            return null;
        }
        if (isExpired(draft.savedAt)) {
            clearTabDraft(key, storage);
            return null;
        }
        return draft;
    } catch (e) {
        clearTabDraft(key, storage);
        return null;
    }
}

export function clearTabDraft(key, storage = globalThis.localStorage) {
    if (!key) return;
    try {
        storage.removeItem(key);
    } catch (e) { /* best-effort */ }
}

/** Drop every expired draft. Called on a quota failure, and on editor entry. */
export function pruneTabDrafts(storage = globalThis.localStorage) {
    let keys;
    try {
        keys = Object.keys(storage).filter(k => k.startsWith(TAB_DRAFT_PREFIX));
    } catch (e) {
        return 0;
    }
    let dropped = 0;
    for (const key of keys) {
        let savedAt = null;
        try {
            savedAt = JSON.parse(storage.getItem(key))?.savedAt;
        } catch (e) { /* unparseable — drop it below */ }
        if (!savedAt || isExpired(savedAt)) {
            clearTabDraft(key, storage);
            dropped++;
        }
    }
    return dropped;
}

function isExpired(savedAt) {
    const at = Date.parse(savedAt);
    return !Number.isFinite(at) || (Date.now() - at) > DRAFT_TTL_MS;
}

/**
 * "3 minutes ago" for the restore banner. Deliberately coarse: the point is
 * "is this the thing I was just doing, or something I abandoned last week",
 * which minutes-and-days answers and a timestamp doesn't.
 */
export function draftAge(savedAt, now = Date.now()) {
    const ms = now - Date.parse(savedAt);
    if (!Number.isFinite(ms) || ms < 0) return 'just now';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 minute ago';
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.floor(mins / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
}
