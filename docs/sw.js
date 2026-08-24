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
    routeFor,
    staleCaches,
} from './js/sw-strategy.js';

const ORIGIN = self.location.origin;

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
    const { strategy, cache } = routeFor(event.request, { origin: ORIGIN });
    if (strategy === STRATEGIES.BYPASS) return;   // no respondWith == untouched

    if (strategy === STRATEGIES.CACHE_FIRST) {
        event.respondWith(cacheFirst(event.request, cache));
    } else if (strategy === STRATEGIES.STALE_WHILE_REVALIDATE) {
        event.respondWith(staleWhileRevalidate(event, cache));
    } else {
        event.respondWith(networkFirst(event.request, cache));
    }
});

/** Cacheable = a real response we are allowed to store. Opaque is fine for
 *  the third-party soundfonts/font: we can't read them, only replay them. */
function isCacheable(response) {
    if (!response) return false;
    return response.ok || response.type === 'opaque';
}

async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request);
        if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(cacheName).then(c => c.put(request, copy)).catch(() => {});
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        // A navigation with no cached page still deserves the app shell:
        // index.html is a hash-routed SPA, so any route can be served from it.
        if (request.mode === 'navigate') {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
        }
        throw err;
    }
}

async function staleWhileRevalidate(event, cacheName) {
    const request = event.request;
    const cached = await caches.match(request);
    const network = fetch(request).then((response) => {
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
