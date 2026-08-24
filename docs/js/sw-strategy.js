// Service-worker routing table — the ONLY place that decides how a request
// is cached. `sw.js` is a thin shell around `routeFor()`; the decisions live
// here so they can be unit-tested in jsdom without a service-worker runtime.
//
// The shape of the problem, in one paragraph: this site is a GitHub Pages
// deploy of `docs/`, and `docs/data/*.jsonl` is REBUILT on every deploy
// (build.yml runs build_works_index.py then uploads docs/). Nothing here has
// a content hash in its filename, so a cache-first strategy on app code would
// serve last week's `main.js` forever — a failure mode this project has
// already been bitten by. Hence: app code and pages are network-first (a
// deploy is picked up on the very next load; the cache is a plane-mode
// fallback only), corpus data is stale-while-revalidate (instant paint, fresh
// on the next visit), and only the two immutable third-party assets — the
// WebAudioFont soundfonts and the Bravura music font — are cache-first.
//
// Cache versioning: bump CACHE_VERSION whenever THIS FILE's strategy changes.
// You do not need to bump it to ship new app code or new corpus data — that
// is what network-first and stale-while-revalidate are for.

export const CACHE_VERSION = 'v1';

/** All caches this app owns share this prefix so `activate` can sweep. */
export const CACHE_PREFIX = 'bgb-';

export const CACHE_NAMES = {
    /** Pages, JS, CSS, images — network-first, cache is the offline fallback. */
    shell: `${CACHE_PREFIX}shell-${CACHE_VERSION}`,
    /** docs/data/*.json(l) — stale-while-revalidate. */
    data: `${CACHE_PREFIX}data-${CACHE_VERSION}`,
    /** Immutable third-party assets — cache-first, opaque responses welcome. */
    vendor: `${CACHE_PREFIX}vendor-${CACHE_VERSION}`,
};

export const STRATEGIES = {
    NETWORK_FIRST: 'network-first',
    STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
    CACHE_FIRST: 'cache-first',
    /** Not our business — hand it straight to the network, cache nothing. */
    BYPASS: 'bypass',
};

/**
 * The minimum needed to paint something offline. Deliberately tiny: the app
 * is dozens of ES modules with no content hashes, and precaching a module
 * graph by hand is a list that rots. Everything else lands in the shell cache
 * the first time it is fetched online.
 */
export const PRECACHE_URLS = [
    './',
    './index.html',
    './css/style.css',
    './manifest.webmanifest',
    './images/icon-192.png',
];

/** Hosts whose assets are content-addressed enough to cache forever. */
const VENDOR_HOSTS = {
    // WebAudioFont player + instrument soundfonts (renderers/tab-player.js)
    'surikov.github.io': () => true,
    // Bravura, the SMuFL music font (renderers/tablature.js::_ensureBravura)
    'cdn.jsdelivr.net': (path) => /bravura/i.test(path),
};

const bypass = () => ({ strategy: STRATEGIES.BYPASS, cache: null });

function parse(rawUrl) {
    // `new URL(null, base)` happily yields <base>/null, so a non-string is
    // rejected up front rather than being routed as a same-origin page.
    if (typeof rawUrl !== 'string' || !rawUrl) return null;
    try {
        return new URL(rawUrl, 'https://bluegrassbook.com/');
    } catch {
        return null;
    }
}

/**
 * Decide how one request should be served.
 *
 * @param {{url: string, method?: string, mode?: string, destination?: string}} request
 *        A `Request`, or anything with the same three fields (tests pass a
 *        plain object).
 * @param {{origin?: string}} [options] - the service worker's own origin;
 *        defaults to the request's, which makes single-argument calls in
 *        tests behave as same-origin.
 * @returns {{strategy: string, cache: string|null}}
 */
export function routeFor(request, { origin = null } = {}) {
    const method = (request?.method || 'GET').toUpperCase();
    // Writes are never cached and never replayed. Anything that isn't a plain
    // GET (submissions, auth, analytics beacons) goes straight through.
    if (method !== 'GET') return bypass();

    const url = parse(request?.url);
    if (!url) return bypass();
    // chrome-extension:, blob:, data: — not ours to touch.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return bypass();

    const sameOrigin = origin ? url.origin === origin : true;

    if (!sameOrigin) {
        // Supabase is the backend: auth, submissions, overlays. Caching any
        // of it would serve a stale session or a stale corpus overlay, so it
        // is excluded by name rather than by accident.
        if (/(^|\.)supabase\.(co|in)$/i.test(url.hostname)) return bypass();
        const vendorMatch = VENDOR_HOSTS[url.hostname];
        if (vendorMatch && vendorMatch(url.pathname)) {
            return { strategy: STRATEGIES.CACHE_FIRST, cache: CACHE_NAMES.vendor };
        }
        // Everything else third-party (analytics, the abcjs/supabase-js CDN
        // bundles) is left alone.
        return bypass();
    }

    // Corpus data: rebuilt by every deploy, and big. Stale-while-revalidate
    // paints instantly from cache and refreshes in the background, so the
    // NEXT load has the new build — never cached as immutable.
    if (/\/data\/.*\.(jsonl|json)$/i.test(url.pathname)) {
        return { strategy: STRATEGIES.STALE_WHILE_REVALIDATE, cache: CACHE_NAMES.data };
    }

    // Navigations and app code: network wins whenever there is a network, so
    // a deploy is live on the next load and a stale module is impossible
    // online. The cache only answers when the fetch fails.
    return { strategy: STRATEGIES.NETWORK_FIRST, cache: CACHE_NAMES.shell };
}

/** True for caches this app owns (i.e. safe for `activate` to delete). */
export function isOurCache(name) {
    return typeof name === 'string' && name.startsWith(CACHE_PREFIX);
}

/**
 * Cache names to delete on activate: ours, minus the current generation.
 * Pure so the sweep is testable without a CacheStorage.
 */
export function staleCaches(existingNames = []) {
    const keep = new Set(Object.values(CACHE_NAMES));
    return existingNames.filter(name => isOurCache(name) && !keep.has(name));
}
