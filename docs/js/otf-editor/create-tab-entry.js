// Entry points into the new-tab flow (Phase 4c).
//
// `create-tab.js` builds the document and `submit-tab.js` posts it, but
// until now nothing in the site constructed a `tab-submission`. This is
// the thin layer in between: where a "tab this song" click comes from,
// what instrument the finished part is called, and how the target work
// travels from the click to the submission.
//
// Deliberately dependency-light (only submit-tab.js) so both the SPA and
// the standalone create page can import it, and so tests can drive it in
// jsdom with everything injected.

import { submitTab } from './submit-tab.js';

/**
 * Corpus part-instrument names, keyed by the editor's instrument preset.
 *
 * The published file is `works/<slug>/<instrument>.otf.json` and
 * `process_tab.py` reads work.yaml's `instrument` straight back off that
 * filename — so this is the corpus vocabulary (`banjo`, not
 * `5-string-banjo`), matching the 260 banjo / 45 mandolin / 23 guitar
 * parts already in works/.
 *
 * It is also a validation gate: the writer only accepts an instrument
 * matching /^[a-z0-9-]+$/ (it becomes a filename), which the editor's
 * tenor-banjo TRACK ID (`tenor_banjo`) is not. Neither the track id nor the
 * raw preset is a safe thing to send; this map is.
 */
export const PART_INSTRUMENTS = {
    '5-string-banjo': 'banjo',
    '6-string-guitar': 'guitar',
    'mandolin': 'mandolin',
    'upright-bass': 'bass',
    'tenor-banjo': 'tenor-banjo',
    'dobro': 'dobro',
};

/**
 * Editor preset to open when a bounty asks for a given instrument.
 * Fiddle has no preset of its own and needs none — it is tuned GDAE,
 * exactly like the mandolin stave; only the part's NAME differs, and the
 * caller's requested instrument is what gets published.
 */
export const TARGET_PRESETS = {
    'banjo': '5-string-banjo',
    'guitar': '6-string-guitar',
    'mandolin': 'mandolin',
    'fiddle': 'mandolin',
    'dobro': 'dobro',
    'bass': 'upright-bass',
    'tenor-banjo': 'tenor-banjo',
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Coerce a name into something the works writer will accept, or ''. */
export function sanitizeInstrument(name) {
    if (!name || typeof name !== 'string') return '';
    const clean = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/, '');
    return SLUG_RE.test(clean) ? clean : '';
}

/**
 * The instrument this submission publishes as.
 * An explicitly requested instrument (bounty / picker) wins; otherwise
 * it comes from the document's lead track.
 */
export function partInstrumentFor(otf, requested = null) {
    const asked = sanitizeInstrument(requested);
    if (asked) return asked;
    const track = otf?.tracks?.[0] || {};
    return PART_INSTRUMENTS[track.instrument]
        || sanitizeInstrument(track.instrument)
        || sanitizeInstrument(track.id)
        || 'banjo';
}

/** The editor preset to start from for a requested corpus instrument. */
export function presetForInstrument(instrument) {
    return TARGET_PRESETS[sanitizeInstrument(instrument)] || '5-string-banjo';
}

/** Clamp a "tabs already published for this instrument" count, or 0. */
function sanitizeCount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999) : 0;
}

/**
 * Build the create-page URL for a (possibly targeted) new tab.
 * No target → the plain "start a tab from scratch" page.
 *
 * `existingCount` rides along so the create page can be honest from the
 * first pixel ("adding your version alongside 8 existing banjo tabs")
 * without loading the search index: create.html is a standalone page, and
 * the entry points that send you here have already counted the siblings
 * client-side. It is display copy only — nothing branches on it, so a
 * stale or hand-edited number costs a wrong noun, never a wrong write.
 */
export function createTabHref(target = {}, base = 'create.html') {
    const params = new URLSearchParams();
    const workId = typeof target.workId === 'string' && SLUG_RE.test(target.workId)
        ? target.workId : '';
    if (workId) params.set('work', workId);
    const instrument = sanitizeInstrument(target.instrument);
    if (instrument) params.set('instrument', instrument);
    if (target.title) params.set('title', String(target.title).slice(0, 200));
    const existing = workId ? sanitizeCount(target.existingCount) : 0;
    if (existing) params.set('have', String(existing));
    const query = params.toString();
    return query ? `${base}?${query}` : base;
}

/**
 * Read a target back off the create page's query string. Anything that
 * isn't a clean slug is dropped rather than repaired — a bad `work=`
 * becomes an untargeted new tab, never a path we half-trust.
 *
 * @returns {{workId: string|null, instrument: string|null, title: string|null}}
 */
export function parseCreateTarget(search) {
    const params = new URLSearchParams(
        typeof search === 'string' ? search : (search || ''));
    const rawWork = params.get('work') || '';
    const title = (params.get('title') || '').trim().slice(0, 200);
    const workId = SLUG_RE.test(rawWork) ? rawWork : null;
    return {
        workId,
        instrument: sanitizeInstrument(params.get('instrument')) || null,
        title: title || null,
        existingCount: workId ? sanitizeCount(params.get('have')) : 0,
    };
}

/**
 * The target banner's sentence.
 *
 * When siblings already exist the banner says so BEFORE a note is
 * entered — "adding your version alongside 8 existing banjo tabs". The
 * old copy promised "It joins that song as a new part", which was true
 * only until the server's 409; both halves of that lie are gone (the
 * server now lands siblings additively, and the count is stated up front).
 *
 * "when it's published" went the same way: a tab is live on that song's
 * page the moment it is submitted, so the banner no longer promises a
 * later date the reader would have to wait through.
 */
export function targetBannerText(target = {}) {
    const count = sanitizeCount(target.existingCount);
    if (!count) return 'It joins that song as a new part as soon as you submit.';
    const kind = target.instrument ? `${target.instrument} ` : '';
    return `You’re adding your version alongside ${count} existing ${kind}`
        + `tab${count === 1 ? '' : 's'} — takes live side by side, nothing is `
        + 'replaced.';
}

/** Default login gate — the same three lines as utils.requireLogin. */
function defaultRequireLogin() {
    const auth = globalThis.window?.SupabaseAuth;
    if (auth?.isLoggedIn?.()) return true;
    auth?.signInWithGoogle?.();
    return false;
}

/**
 * Open the tab editor in create mode, pre-targeted at a work.
 *
 * Login is required AT THE ACTION (Phase 2a): browsing the work page
 * stays open to everyone, and the sign-in prompt happens the moment
 * someone commits to contributing — not a page earlier.
 *
 * @returns {boolean} false when the click turned into a sign-in instead.
 */
export function launchTabCreator(target = {}, {
    requireLogin = defaultRequireLogin,
    navigate = (href) => { globalThis.location.href = href; },
    base = 'create.html',
} = {}) {
    if (!requireLogin('add a tab')) return false;
    navigate(createTabHref(target, base));
    return true;
}

/**
 * Submit a finished new tab.
 *
 * `workId` is what makes this a tab for an EXISTING work: the pending row is
 * written against that work, so the overlay hangs the part on it immediately
 * and the writer appends the part to that work.yaml. Omit it and the
 * submission mints its own work (a tab-only one, until someone adds a chart).
 *
 * Resolves once the tab is LIVE — see submit-tab.js for the return shape.
 * Nothing here waits on a review any more; there is no review.
 */
export async function submitNewTab(otf, target = {}, {
    requireLogin = defaultRequireLogin,
    submit = submitTab,
} = {}) {
    if (!requireLogin('submit tabs')) {
        throw new Error('Sign in to submit — opening sign-in…');
    }
    const title = (target.title || otf?.metadata?.title || 'Untitled').trim()
        || 'Untitled';
    return submit({
        type: 'tab-submission',
        otf,
        title,
        instrument: partInstrumentFor(otf, target.instrument),
        ...(target.workId ? { workId: target.workId } : {}),
    });
}
