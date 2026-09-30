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
// deploy is picked up on the next load, modulo the HTTP cache's max-age; the cache answers only when the
// network fails or is SLOW — see NETWORK_TIMEOUT_MS), corpus data (index,
// tabs, and each song's .pro) is stale-while-revalidate (instant paint, fresh
// on the next visit), and only the two immutable third-party assets — the
// WebAudioFont soundfonts and the Bravura music font — are cache-first.
//
// Why app code is NOT stale-while-revalidate, even though that would be
// faster: there is no build step and no content hashing, so a deploy changes
// dozens of ES modules at once. SWR would serve the old copy of whichever
// modules were cached and the new copy of the rest on the load after a
// deploy, and a module importing a name its (old) sibling does not export is
// a hard failure — a blank app for a returning user. Network-first with a
// timeout gives up on "a deploy is picked up on the next load" only on a
// connection that is already too slow to be getting anything done, and the
// give-up is made sticky in BOTH directions (see shellPolicy) so one page
// load is one generation of the app: once any shell ES module has been
// answered by the network, the rest of that load waits for it too; once one
// has timed out to the cache, the rest of that load reads the cache.
//
// What "live on the next load" means here: the worker's fetch() goes through
// the browser's HTTP cache, and GitHub Pages sends `max-age=600`, so a deploy
// can take up to ten minutes to reach a returning user (this is unchanged
// from before the worker had a timeout). A hard reload skips that.
//
// Cache versioning: bump CACHE_VERSION whenever THIS FILE's strategy changes.
// You do not need to bump it to ship new app code or new corpus data — that
// is what network-first and stale-while-revalidate are for.

// v2: songs' .pro files moved from the shell cache (network-first) to the
// data cache (stale-while-revalidate), and shell requests gained a network
// timeout. Bumping sweeps the v1 caches on activate.
export const CACHE_VERSION = 'v2';

/** All caches this app owns share this prefix so `activate` can sweep. */
export const CACHE_PREFIX = 'bgb-';

export const CACHE_NAMES = {
    /** Pages, JS, CSS, images — network-first, cache answers offline or slow. */
    shell: `${CACHE_PREFIX}shell-${CACHE_VERSION}`,
    /** docs/data/**.json(l) and data/songs/*.pro — stale-while-revalidate. */
    data: `${CACHE_PREFIX}data-${CACHE_VERSION}`,
    /** Immutable third-party assets — cache-first, opaque responses welcome. */
    vendor: `${CACHE_PREFIX}vendor-${CACHE_VERSION}`,
};

/**
 * How long a network-first request may wait before a CACHED copy is served
 * instead. Only a timeout when a cached copy exists: with nothing cached the
 * request keeps waiting for the network (there is nothing better to show).
 * The fetch is not abandoned — its response still refreshes the cache, so
 * the next load is current.
 */
export const NETWORK_TIMEOUT_MS = 1800;

/**
 * After one shell request has timed out to the cache, the network is known
 * to be slow; for this long every shell request prefers its cached copy
 * (refreshing behind). That keeps one page load on ONE generation of the
 * app: without it a slow link could serve an old `main.js` from cache and
 * then the new `work-view.js` from the network a moment later.
 *
 * The mirror image is the FRESH window: after any shell ES MODULE has been
 * answered by the network, for this long every shell request waits for the
 * network (no timeout; the cache answers only on a network ERROR). Without
 * it, after a deploy one stalled module would be served from the old cache
 * beside the modules the network already delivered new — an export that
 * moved between modules is then a blank app. Same length as the slow window:
 * a page load's module graph is fetched within seconds.
 */
export const SLOW_NETWORK_WINDOW_MS = 15000;
export const FRESH_NETWORK_WINDOW_MS = 15000;

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
    // NEXT load has the new build — never cached as immutable. That is the
    // two indexes, every tab document (data/tabs/*.json) and every song's
    // ChordPro (data/songs/*.pro, which is what a song page blocks on).
    // The .pro files are data, not code: a stale chart cannot break a module
    // graph, and it is at most one visit behind.
    if (/\/data\/.*\.(jsonl|json)$/i.test(url.pathname)
        || /\/data\/songs\/[^/]+\.pro$/i.test(url.pathname)) {
        return { strategy: STRATEGIES.STALE_WHILE_REVALIDATE, cache: CACHE_NAMES.data };
    }

    // Navigations and app code: network wins whenever there is a network, so
    // a deploy is picked up on the next load (subject to the HTTP cache's
    // max-age) and a healthy network never serves a stale module. The cache answers when the fetch fails — or takes longer than
    // `timeoutMs`, because a hung request is indistinguishable from a
    // missing one to the person waiting on it.
    return {
        strategy: STRATEGIES.NETWORK_FIRST,
        cache: CACHE_NAMES.shell,
        timeoutMs: NETWORK_TIMEOUT_MS,
    };
}

/**
 * Network-first with a timeout.
 *
 * Resolves with the network response unless (a) the network FAILS, or (b) it
 * has not answered within `timeoutMs` — in both cases the cached response is
 * used when there is one. Two rules that make it safe:
 *   - a slow network is only abandoned for a cache HIT; on a miss the
 *     request keeps waiting for the network (and a failed network rethrows);
 *   - abandoning is not cancelling: the caller's `networkPromise` keeps
 *     running, and is expected to refresh the cache when it lands.
 *
 * Pure (everything injected) so it is tested without a service worker.
 *
 * @param {Promise<Response>} networkPromise
 * @param {() => Promise<Response|undefined>} lookupCache
 * @param {number} timeoutMs - <= 0 or non-finite waits for the network forever
 * @param {() => boolean} [canAbandon] - asked when the timer fires; false
 *        means "keep waiting" (the network has since proved itself this load,
 *        see shellPolicy). Defaults to always allowed.
 * @returns {Promise<{response: Response, source: 'network'|'cache',
 *          reason: 'timeout'|'error'|null}>} `reason` says why the cache won
 *          (null when the network did)
 */
export function networkFirstWithTimeout(networkPromise, lookupCache, timeoutMs, canAbandon = () => true) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            fn(value);
        };

        networkPromise.then(
            (response) => finish(resolve, { response, source: 'network', reason: null }),
            async (err) => {
                if (settled) return;
                const cached = await lookupCache().catch(() => undefined);
                if (cached) finish(resolve, { response: cached, source: 'cache', reason: 'error' });
                else finish(reject, err);
            },
        );

        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timer = setTimeout(async () => {
                timer = null;
                if (settled || !canAbandon()) return;
                const cached = await lookupCache().catch(() => undefined);
                // Re-check: the network may have answered while we looked.
                if (cached) finish(resolve, { response: cached, source: 'cache', reason: 'timeout' });
            }, timeoutMs);
        }
    });
}

/**
 * True while a recent timeout says the network is too slow to wait on — see
 * SLOW_NETWORK_WINDOW_MS. `slowSince` is when the last timeout fallback was
 * served (null/undefined = never).
 */
export function slowNetworkActive(slowSince, now = Date.now()) {
    return typeof slowSince === 'number' && now - slowSince < SLOW_NETWORK_WINDOW_MS;
}

/**
 * True while a recent network answer says the network is delivering — see
 * FRESH_NETWORK_WINDOW_MS. `freshSince` is when a shell request was last
 * answered by the network (null/undefined = never).
 */
export function freshNetworkActive(freshSince, now = Date.now()) {
    return typeof freshSince === 'number' && now - freshSince < FRESH_NETWORK_WINDOW_MS;
}

/**
 * Does a network answer to this request start the fresh window? Only ES
 * MODULES do (destination 'script', mode 'cors': module scripts and dynamic
 * import() are CORS-mode, a same-origin classic <script src> is no-cors).
 * The generation hazard is between modules: one importing a name its sibling
 * lacks. A fast stylesheet, a tiny classic script or the page itself must not
 * make the entry module wait out the very stall the timeout exists for, and
 * a stylesheet/markup generation mismatch is cosmetic, not a blank app.
 */
export function startsFreshWindow(request) {
    return request?.destination === 'script' && request?.mode === 'cors';
}

/**
 * How a (non-hard-reload) shell request should be served right now, given
 * the two per-load latches:
 *   'prefer-cache' - a request already timed out: serve the cache, refresh
 *                    behind, so the load stays on the old generation
 *   'wait'         - the network already answered one: no timeout, cache only
 *                    on a network error, so the load stays on the new one
 *   'timeout'      - nothing decided yet: network-first with the timeout
 * The slow latch wins a tie (it means a request was ALREADY served old).
 *
 * @param {{slowSince?: number|null, freshSince?: number|null, now?: number}} state
 * @returns {'prefer-cache'|'wait'|'timeout'}
 */
export function shellPolicy({ slowSince = null, freshSince = null, now = Date.now() } = {}) {
    if (slowNetworkActive(slowSince, now)) return 'prefer-cache';
    if (freshNetworkActive(freshSince, now)) return 'wait';
    return 'timeout';
}

/**
 * Should this request get the patient (no-timeout) network-first treatment?
 * A hard reload / `no-store` fetch is the person asking for the network, so
 * it is never answered from the cache just because the network is slow.
 */
export function wantsFreshNetwork(request) {
    return request?.cache === 'reload' || request?.cache === 'no-store';
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
