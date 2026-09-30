// Bluegrass Book service worker — the offline half of the PWA (§9.3 of
// docs/plans/tab-editor-input-parity.md).
//
// This file is deliberately mechanical: every "should this be cached, and
// how" decision lives in js/sw-strategy.js so it can be unit-tested in jsdom.
// Read that file first — it explains why app code is network-first.
//
// Registered as a MODULE worker (`{ type: 'module' }` in js/pwa.js) so it can
// import the strategy table instead of keeping a second, drifting copy of it.
// Chrome 91+, Safari 16.4+, Firefox 114+; older browsers simply fail to
// register and get the plain online site, which is the correct fallback.

import {
    CACHE_NAMES,
    PRECACHE_URLS,
    STRATEGIES,
    networkFirstWithTimeout,
    routeFor,
    shellPolicy,
    startsFreshWindow,
    freshNetworkActive,
    staleCaches,
    wantsFreshNetwork,
} from './js/sw-strategy.js';

const ORIGIN = self.location.origin;

/** When a shell request last gave up on the network for the cache (ms epoch),
 *  or null. Worker-global on purpose: one slow link, one answer. */
let slowSince = null;

/** When a shell ES module was last answered by the network (ms epoch), or null.
 *  The mirror of slowSince: while it is fresh the rest of the page load waits
 *  for the network too, so a stalled module is never served old beside
 *  modules that arrived new. */
let freshSince = null;

self.addEventListener('install', (event) => {
    // Individually, so one 404 in the list cannot fail the whole install.
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAMES.shell);
        await Promise.all(PRECACHE_URLS.map(url =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
        // A new worker takes over immediately; clients.claim() below then
        // pulls the open tabs onto it and they are told (see MESSAGE).
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(staleCaches(names).map(name => caches.delete(name)));
        // Navigation preload: start the page request while this worker is
        // still booting (a cold worker costs tens to hundreds of ms before
        // its fetch handler runs). The fetch handler consumes
        // `event.preloadResponse`; it is always consumed for navigations, so
        // the preload is never wasted.
        try { await self.registration.navigationPreload?.enable(); } catch { /* optional */ }
        await self.clients.claim();
        await announceUpdate();
    })());
});

/**
 * Tell open pages a new worker is live so they can offer a reload.
 *
 * Sent on EVERY activation, including a first install: the worker cannot tell
 * whether a given tab was already running older code. The page side decides
 * whether that is news — js/pwa.js only toasts when the tab already had a
 * controller when it loaded, which is exactly the "you are looking at code
 * that was just replaced" case.
 */
async function announceUpdate() {
    const clientList = await self.clients.matchAll({ type: 'window' });
    for (const client of clientList) {
        client.postMessage({ type: 'sw-activated', version: CACHE_NAMES.shell });
    }
}

self.addEventListener('message', (event) => {
    if (event.data?.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const { strategy, cache, timeoutMs } = routeFor(event.request, { origin: ORIGIN });
    if (strategy === STRATEGIES.BYPASS) return;   // no respondWith == untouched

    // A navigation starts a new page load, and "the network has delivered
    // this load's modules" is a per-load fact: forget it, so a stall on the
    // new load's entry module still gets the timeout. (The slow latch is
    // deliberately NOT reset: a link that just timed out is still slow.)
    if (event.request.mode === 'navigate') freshSince = null;

    if (strategy === STRATEGIES.CACHE_FIRST) {
        event.respondWith(cacheFirst(event.request, cache));
    } else if (strategy === STRATEGIES.STALE_WHILE_REVALIDATE) {
        event.respondWith(staleWhileRevalidate(event, cache));
    } else if (!wantsFreshNetwork(event.request) && shellPolicy({ slowSince, freshSince }) === 'prefer-cache') {
        // The network was just too slow to wait on: stay on the cached
        // generation of the app for this page load (see sw-strategy.js).
        event.respondWith(staleWhileRevalidate(event, cache));
    } else {
        // A hard reload asks for the network, so it waits for it; so does a
        // load that the network has already started answering.
        const patient = wantsFreshNetwork(event.request)
            || shellPolicy({ slowSince, freshSince }) === 'wait';
        event.respondWith(networkFirst(event, cache, patient ? 0 : timeoutMs));
    }
});

/** Cacheable = a real response we are allowed to store. Opaque is fine for
 *  the third-party soundfonts/font: we can't read them, only replay them. */
function isCacheable(response) {
    if (!response) return false;
    return response.ok || response.type === 'opaque';
}

/**
 * The network half of network-first: the navigation preload when there is
 * one (it is already in flight), else a fetch — and either way the response
 * refreshes the cache, including when the page was already answered from the
 * cache because this took too long.
 */
function fetchAndCache(event, cacheName) {
    const request = event.request;
    return (async () => {
        const preloaded = await event.preloadResponse;   // undefined unless preloading
        const response = preloaded || await fetch(request);
        if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(cacheName).then(c => c.put(request, copy)).catch(() => {});
        }
        return response;
    })();
}

async function networkFirst(event, cacheName, timeoutMs) {
    const request = event.request;
    const network = fetchAndCache(event, cacheName);
    // Keep the worker alive until the (possibly abandoned) fetch has landed
    // and refreshed the cache.
    event.waitUntil(network.catch(() => {}));

    try {
        // A request already in flight when the network proves itself (another
        // shell request answered) must not abandon it for the old copy later.
        const { response, source, reason } = await networkFirstWithTimeout(
            network, () => caches.match(request), timeoutMs,
            () => !freshNetworkActive(freshSince));
        if (reason === 'timeout') slowSince = Date.now();
        // Only the first decision of a load counts: if a timeout already
        // latched the old generation, a straggler's network answer must not
        // flip the rest of the load to the new one. And the window is
        // anchored at the first answer, not slid by later ones, so a network
        // that degrades mid-session still gets the timeout once it lapses.
        else if (source === 'network' && startsFreshWindow(request) && shellPolicy({ slowSince }) !== 'prefer-cache'
            && !freshNetworkActive(freshSince)) freshSince = Date.now();
        return response;
    } catch (err) {
        // A navigation with no cached page still deserves the app shell:
        // index.html is a hash-routed SPA, so any route can be served from it.
        if (request.mode === 'navigate') {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
        }
        throw err;
    }
}

/**
 * Serve the cached copy instantly and refresh it behind. The refresh asks the
 * server to revalidate (`no-cache` = conditional request, a 304 when nothing
 * changed) rather than trusting the HTTP cache: GitHub Pages sends
 * `max-age=600`, and a background refresh that the HTTP cache answers from its
 * own stale copy would keep the cache exactly one deploy behind for ten
 * minutes. Used for corpus data, and for the shell while the network is slow.
 */
async function staleWhileRevalidate(event, cacheName) {
    const request = event.request;
    const cached = await caches.match(request);
    const refresh = request.mode === 'navigate'
        ? Promise.resolve(event.preloadResponse).then(r => r || fetch(request))
        : fetch(new Request(request, { cache: 'no-cache' }));
    const network = refresh.then((response) => {
        if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(cacheName).then(c => c.put(request, copy)).catch(() => {});
        }
        return response;
    }).catch(() => null);

    if (cached) {
        // Let the refresh finish after the (instant) cached answer is served.
        event.waitUntil(network);
        return cached;
    }
    const response = await network;
    if (response) return response;
    if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
    }
    throw new Error('offline and uncached');
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (isCacheable(response)) {
        const copy = response.clone();
        caches.open(cacheName).then(c => c.put(request, copy)).catch(() => {});
    }
    return response;
}
