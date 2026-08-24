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
 * Build the URL for a (possibly targeted) new tab.
 * No target → the plain "start a tab from scratch" page.
 *
 * §9.1: these are HASH ROUTES on the song page, not a separate page.
 * `#work/{slug}/add-tab` renders the song it belongs to — title, artist,
 * Info, the other takes — with the new take selected and the editor open;
 * `#new-tab` renders a provisional work page for a song we don't have.
 * `create.html` survives only as a redirect shim into these.
 *
 * `existingCount` rides along so the page can be honest from the first
 * pixel ("adding your version alongside 8 existing banjo tabs"). It is
 * display copy only — nothing branches on it, so a stale or hand-edited
 * number costs a wrong noun, never a wrong write.
 *
 * @param {Object} target
 * @param {string} [base] - prefix for the hash (e.g. 'index.html' from a
 *   page that is not the app itself). Empty means "this page".
 */
export function createTabHref(target = {}, base = '') {
    const params = new URLSearchParams();
    const workId = typeof target.workId === 'string' && SLUG_RE.test(target.workId)
        ? target.workId : '';
    const instrument = sanitizeInstrument(target.instrument);
    if (instrument) params.set('instrument', instrument);
    if (target.title) params.set('title', String(target.title).slice(0, 200));
    const existing = workId ? sanitizeCount(target.existingCount) : 0;
    if (existing) params.set('have', String(existing));
    const query = params.toString();
    const path = workId ? `#work/${workId}/add-tab` : '#new-tab';
    return `${base}${path}${query ? `?${query}` : ''}`;
}

/** The hash that opens ONE existing take of a work in the editor. */
export function editTabHref(workId, partRef, base = '') {
    if (!workId || !partRef) return `${base}#work/${workId || ''}`;
    return `${base}#work/${workId}/edit/${encodeURIComponent(partRef)}`;
}

// Time signatures the create form offered; anything else is not a shape
// the editor's measure timing knows how to build.
const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '2/2', '6/8'];

/**
 * `#new-tab`'s query string → the arguments `buildNewTab` takes.
 * Every field is clamped here rather than trusted: a hash is user input.
 */
export function parseNewTabOptions(search) {
    const params = new URLSearchParams(
        typeof search === 'string' ? search : (search || ''));
    const title = (params.get('title') || '').trim().slice(0, 200);
    const instrument = sanitizeInstrument(params.get('instrument')) || null;
    const ts = params.get('ts') || params.get('timeSignature') || '';
    // Number('') is 0, which is finite — an ABSENT parameter has to fall
    // through to the default rather than clamp to the floor.
    const num = (key) => {
        const raw = (params.get(key) || '').trim();
        return raw ? Number(raw) : NaN;
    };
    const tempo = num('tempo');
    const measures = num('measures');
    return {
        title: title || null,
        instrument,
        instruments: [presetForInstrument(instrument || '')],
        timeSignature: TIME_SIGNATURES.includes(ts) ? ts : '4/4',
        tempo: Number.isFinite(tempo) ? Math.max(40, Math.min(280, Math.round(tempo))) : 120,
        measures: Number.isFinite(measures)
            ? Math.max(1, Math.min(128, Math.round(measures))) : 16,
    };
}

/**
 * Which tab-authoring surface a hash asks for, or null when it asks for
 * none of them (every other route is somebody else's).
 *
 * The three shapes (§9.2):
 *   #work/{slug}/edit/{partRef}   correct an existing take — reload-safe
 *   #work/{slug}/add-tab?…        a new take on a song we have
 *   #new-tab?…                    a new take on a song we don't
 *
 * @returns {{kind: 'edit'|'add-tab'|'new-tab', workId?: string,
 *   partRef?: string, target?: Object, options?: Object}|null}
 */
export function parseTabRoute(hash) {
    const raw = String(hash || '');
    const qi = raw.indexOf('?');
    const path = qi === -1 ? raw : raw.slice(0, qi);
    const query = qi === -1 ? '' : raw.slice(qi + 1);

    if (path === '#new-tab') {
        return { kind: 'new-tab', options: parseNewTabOptions(query) };
    }
    if (!path.startsWith('#work/')) return null;

    const segments = path.slice(6).split('/').filter(Boolean);
    const [workId, verb, ...rest] = segments;
    if (!workId || !SLUG_RE.test(workId)) return null;

    if (verb === 'add-tab') {
        // The work id is in the PATH here, so the sibling count has to be
        // re-read against it: parseCreateTarget only trusts `have=` when it
        // has seen a `work=` of its own.
        const params = new URLSearchParams(query);
        return {
            kind: 'add-tab',
            workId,
            target: {
                ...parseCreateTarget(query),
                workId,
                existingCount: sanitizeCount(params.get('have')),
            },
        };
    }
    if (verb === 'edit' && rest.length) {
        const partRef = decodeURIComponent(rest.join('/')).slice(0, 200);
        return partRef ? { kind: 'edit', workId, partRef } : null;
    }
    return null;
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
    base = '',
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
 * `artist` is the mirror image of `workId` and only travels with a MINT.
 * A tab-only work is created from this row alone, so if the artist isn't
 * here it is nowhere: works_writer omits the key entirely and the minted
 * work.yaml carries a title and nothing else (that is how
 * works/welcome-to-new-york ended up artist-less). When there IS a target
 * work the field is deliberately dropped — that work already has its own
 * artist, and a tab contributor is not the person who gets to restate it.
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
    const artist = String(target.artist || '').trim().slice(0, 200);
    return submit({
        type: 'tab-submission',
        otf,
        title,
        instrument: partInstrumentFor(otf, target.instrument),
        ...(target.workId
            ? { workId: target.workId }
            : (artist ? { artist } : {})),
    });
}
