// The service worker's routing table. sw.js is a mechanical shell around
// routeFor(), so these are the tests that actually protect the cache
// behaviour — above all the rule that app code is NEVER cache-first (a stale
// main.js has bitten this project before, and nothing here is content-hashed).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
    CACHE_NAMES,
    CACHE_VERSION,
    NETWORK_TIMEOUT_MS,
    PRECACHE_URLS,
    SLOW_NETWORK_WINDOW_MS,
    STRATEGIES,
    isOurCache,
    networkFirstWithTimeout,
    routeFor,
    slowNetworkActive,
    staleCaches,
    wantsFreshNetwork,
} from '../sw-strategy.js';

const ORIGIN = 'https://bluegrassbook.com';
const at = (url, extra = {}) => routeFor({ url, ...extra }, { origin: ORIGIN });

const SHELL_ROUTE = {
    strategy: STRATEGIES.NETWORK_FIRST,
    cache: CACHE_NAMES.shell,
    timeoutMs: NETWORK_TIMEOUT_MS,
};

describe('routeFor — same-origin app shell', () => {
    it('serves navigations network-first', () => {
        expect(at(`${ORIGIN}/index.html`, { mode: 'navigate' })).toEqual(SHELL_ROUTE);
    });

    it('gives the shell a short network timeout (about 1.5-2s)', () => {
        // Long enough that a normal connection always wins; short enough
        // that a stalled one is not a blank page.
        expect(NETWORK_TIMEOUT_MS).toBeGreaterThanOrEqual(1500);
        expect(NETWORK_TIMEOUT_MS).toBeLessThanOrEqual(2000);
        for (const path of ['/', '/js/main.js', '/css/style.css']) {
            expect(at(`${ORIGIN}${path}`).timeoutMs).toBe(NETWORK_TIMEOUT_MS);
        }
    });

    it.each([
        '/index.html',
        '/js/main.js',
        '/js/renderers/tablature.js',
        '/css/style.css',
        '/create.html',
    ])('serves %s network-first so a deploy is picked up next load', (path) => {
        const { strategy } = at(`${ORIGIN}${path}`);
        expect(strategy).toBe(STRATEGIES.NETWORK_FIRST);
    });

    it('never routes app code to cache-first', () => {
        for (const path of ['/js/main.js', '/css/style.css', '/']) {
            expect(at(`${ORIGIN}${path}`).strategy).not.toBe(STRATEGIES.CACHE_FIRST);
        }
    });

    it('falls back to the shell cache for anything else same-origin', () => {
        expect(at(`${ORIGIN}/images/banjo.png`)).toEqual(SHELL_ROUTE);
    });
});

describe('routeFor — corpus data', () => {
    it.each([
        '/data/index.jsonl',
        '/data/archive.jsonl',
        '/data/artist_tags.json',
        '/data/tabs/foggy-mountain_tef.otf.json',
    ])('serves %s stale-while-revalidate', (path) => {
        expect(at(`${ORIGIN}${path}`))
            .toEqual({ strategy: STRATEGIES.STALE_WHILE_REVALIDATE, cache: CACHE_NAMES.data });
    });

    it.each([
        '/data/songs/old-home-place.pro',
        '/data/songs/foggy-mountain-breakdown--bill-monroe-style.pro',
        '/data/songs/1-1-love.pro?v=2',
    ])('serves %s stale-while-revalidate, not network-first', (path) => {
        // A song page blocks on its .pro: paint from cache, refresh behind.
        expect(at(`${ORIGIN}${path}`))
            .toEqual({ strategy: STRATEGIES.STALE_WHILE_REVALIDATE, cache: CACHE_NAMES.data });
    });

    it('does not widen the .pro rule to code or to other directories', () => {
        expect(at(`${ORIGIN}/js/songs/x.pro`).strategy).toBe(STRATEGIES.NETWORK_FIRST);
        expect(at(`${ORIGIN}/data/songs/x.js`).strategy).toBe(STRATEGIES.NETWORK_FIRST);
    });

    it('is not fooled by a query string on the jsonl', () => {
        expect(at(`${ORIGIN}/data/index.jsonl?v=3`).strategy)
            .toBe(STRATEGIES.STALE_WHILE_REVALIDATE);
    });

    it('does not treat a .json OUTSIDE data/ as corpus data', () => {
        expect(at(`${ORIGIN}/manifest.webmanifest`).cache).toBe(CACHE_NAMES.shell);
    });
});

describe('routeFor — third parties', () => {
    it('caches the WebAudioFont player and soundfonts first', () => {
        for (const url of [
            'https://surikov.github.io/webaudiofont/npm/dist/WebAudioFontPlayer.js',
            'https://surikov.github.io/webaudiofontdata/sound/1050_FluidR3_GM_sf2_file.js',
        ]) {
            expect(at(url)).toEqual({
                strategy: STRATEGIES.CACHE_FIRST, cache: CACHE_NAMES.vendor,
            });
        }
    });

    it('caches the Bravura music font first', () => {
        expect(at('https://cdn.jsdelivr.net/gh/steinbergmedia/bravura@latest/redist/woff/Bravura.woff2'))
            .toEqual({ strategy: STRATEGIES.CACHE_FIRST, cache: CACHE_NAMES.vendor });
    });

    it('caches the PINNED Bravura url first too (the version is not part of the rule)', () => {
        expect(at('https://cdn.jsdelivr.net/gh/steinbergmedia/bravura@bravura-1.482/redist/woff/Bravura.woff2'))
            .toEqual({ strategy: STRATEGIES.CACHE_FIRST, cache: CACHE_NAMES.vendor });
    });

    it('leaves other jsdelivr bundles alone', () => {
        expect(at('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2').strategy)
            .toBe(STRATEGIES.BYPASS);
    });

    it('NEVER intercepts Supabase', () => {
        for (const url of [
            'https://abcdefg.supabase.co/rest/v1/pending_songs?select=*',
            'https://abcdefg.supabase.co/auth/v1/token',
        ]) {
            expect(at(url)).toEqual({ strategy: STRATEGIES.BYPASS, cache: null });
        }
    });

    it('leaves analytics alone', () => {
        expect(at('https://www.googletagmanager.com/gtag/js?id=G-X').strategy)
            .toBe(STRATEGIES.BYPASS);
    });
});

describe('routeFor — never touched', () => {
    it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('bypasses %s', (method) => {
        expect(at(`${ORIGIN}/index.html`, { method })).toEqual({
            strategy: STRATEGIES.BYPASS, cache: null,
        });
    });

    it('bypasses non-http schemes', () => {
        expect(at('chrome-extension://abc/inject.js').strategy).toBe(STRATEGIES.BYPASS);
        expect(at('data:text/plain,hi').strategy).toBe(STRATEGIES.BYPASS);
    });

    it('bypasses unparseable urls', () => {
        expect(routeFor({ url: null }).strategy).toBe(STRATEGIES.BYPASS);
    });
});

describe('cache versioning', () => {
    it('stamps every cache name with the version', () => {
        for (const name of Object.values(CACHE_NAMES)) {
            expect(name.endsWith(`-${CACHE_VERSION}`)).toBe(true);
            expect(isOurCache(name)).toBe(true);
        }
    });

    it('sweeps our old generations and nothing else', () => {
        const existing = [
            ...Object.values(CACHE_NAMES),
            'bgb-shell-v0',
            'bgb-data-v0',
            'workbox-precache',    // someone else's cache
        ];
        expect(staleCaches(existing).sort()).toEqual(['bgb-data-v0', 'bgb-shell-v0']);
    });

    it('sweeps the previous generation (v1) when the strategy changed', () => {
        expect(CACHE_VERSION).not.toBe('v1');
        const existing = [...Object.values(CACHE_NAMES),
            'bgb-shell-v1', 'bgb-data-v1', 'bgb-vendor-v1'];
        expect(staleCaches(existing).sort())
            .toEqual(['bgb-data-v1', 'bgb-shell-v1', 'bgb-vendor-v1']);
    });

    it('does not claim caches that are not ours', () => {
        expect(isOurCache('some-other-cache')).toBe(false);
        expect(isOurCache(undefined)).toBe(false);
    });
});

describe('sw.js', () => {
    const sw = readFileSync(resolve(__dirname, '../../sw.js'), 'utf-8');

    it('imports the strategy table instead of restating it', () => {
        expect(sw).toMatch(/import\s*\{[^}]*routeFor[^}]*\}\s*from\s*'\.\/js\/sw-strategy\.js'/s);
        // No second copy of the decisions
        expect(sw).not.toMatch(/surikov/);
    });

    it('takes over immediately and claims open pages', () => {
        expect(sw).toContain('skipWaiting');
        expect(sw).toContain('clients.claim');
    });

    it('cleans up old caches on activate', () => {
        expect(sw).toContain('staleCaches');
        expect(sw).toContain('caches.delete');
    });

    it('tells clients when a new version activated', () => {
        expect(sw).toContain('sw-activated');
    });

    it('enables navigation preload and consumes it', () => {
        expect(sw).toContain('navigationPreload');
        expect(sw).toContain('.enable()');
        expect(sw).toContain('preloadResponse');
    });

    it('revalidates stale-while-revalidate refreshes instead of trusting the HTTP cache', () => {
        // GitHub Pages serves max-age=600; a refresh answered from the HTTP
        // cache would leave our cache one deploy behind.
        expect(sw).toMatch(/new Request\(request,\s*\{\s*cache:\s*'no-cache'\s*\}\)/);
    });

    it('waits patiently for the network on a hard reload', () => {
        expect(sw).toContain('wantsFreshNetwork');
    });

    it('precaches only the shell, not the module graph', () => {
        expect(PRECACHE_URLS.length).toBeLessThanOrEqual(6);
        expect(PRECACHE_URLS).toContain('./index.html');
        expect(PRECACHE_URLS.some(u => u.includes('main.js'))).toBe(false);
    });
});

describe('manifest.webmanifest', () => {
    const manifest = JSON.parse(
        readFileSync(resolve(__dirname, '../../manifest.webmanifest'), 'utf-8'));

    it('is an installable standalone app rooted at the site', () => {
        expect(manifest.name).toBe('Bluegrass Book');
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.start_url).toBe('./');
        expect(manifest.display).toBe('standalone');
    });

    it('ships the icon sizes installers require', () => {
        const sizes = manifest.icons.map(i => i.sizes);
        expect(sizes).toContain('192x192');
        expect(sizes).toContain('512x512');
        expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true);
    });

    it('handles .tef and .otf.json onto the new-tab route', () => {
        const [handler] = manifest.file_handlers;
        expect(handler.action).toContain('#new-tab');
        const extensions = Object.values(handler.accept).flat();
        expect(extensions).toContain('.tef');
        expect(extensions).toContain('.otf.json');
        expect(handler.accept['application/x-tabledit']).toEqual(['.tef']);
    });

    it('offers New tab and Drafts as shortcuts', () => {
        const urls = manifest.shortcuts.map(s => s.url);
        expect(urls.some(u => u.endsWith('#new-tab'))).toBe(true);
        expect(urls.some(u => u.endsWith('#drafts'))).toBe(true);
    });

    it('is linked from index.html with a theme colour', () => {
        const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
        expect(html).toMatch(/<link rel="manifest" href="manifest\.webmanifest">/);
        expect(html).toMatch(/<meta name="theme-color"/);
    });
});

describe('networkFirstWithTimeout', () => {
    afterEach(() => vi.useRealTimers());

    const net = () => {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    };
    const cachedHit = (body = 'cached') => vi.fn(async () => body);
    const cachedMiss = () => vi.fn(async () => undefined);

    it('returns the network response when it is fast (the cache is not even read)', async () => {
        const n = net();
        const lookup = cachedHit();
        const out = networkFirstWithTimeout(n.promise, lookup, 1800);
        n.resolve('fresh');
        expect(await out).toEqual({ response: 'fresh', source: 'network', reason: null });
        expect(lookup).not.toHaveBeenCalled();
    });

    it('serves the cache when the network is slower than the timeout', async () => {
        vi.useFakeTimers();
        const n = net();
        const out = networkFirstWithTimeout(n.promise, cachedHit(), 1800);
        await vi.advanceTimersByTimeAsync(1799);
        let settled = false;
        out.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);                 // still waiting at 1.799s
        await vi.advanceTimersByTimeAsync(2);
        expect(await out).toEqual({ response: 'cached', source: 'cache', reason: 'timeout' });
    });

    it('keeps waiting for a slow network when nothing is cached', async () => {
        vi.useFakeTimers();
        const n = net();
        const out = networkFirstWithTimeout(n.promise, cachedMiss(), 1800);
        await vi.advanceTimersByTimeAsync(10_000);
        n.resolve('late but the only answer');
        expect(await out).toEqual({
            response: 'late but the only answer', source: 'network', reason: null,
        });
    });

    it('falls back to the cache when the network fails outright', async () => {
        const n = net();
        const out = networkFirstWithTimeout(n.promise, cachedHit(), 1800);
        n.reject(new TypeError('Failed to fetch'));
        expect(await out).toEqual({ response: 'cached', source: 'cache', reason: 'error' });
    });

    it('rethrows a network failure when nothing is cached', async () => {
        const n = net();
        const out = networkFirstWithTimeout(n.promise, cachedMiss(), 1800);
        n.reject(new TypeError('Failed to fetch'));
        await expect(out).rejects.toThrow('Failed to fetch');
    });

    it('a network answer that beats a slow cache lookup wins', async () => {
        vi.useFakeTimers();
        const n = net();
        let release;
        const lookup = vi.fn(() => new Promise(res => { release = () => res('cached'); }));
        const out = networkFirstWithTimeout(n.promise, lookup, 1800);
        await vi.advanceTimersByTimeAsync(1800);     // timeout fires, lookup pending
        n.resolve('fresh');
        release();
        expect(await out).toMatchObject({ response: 'fresh', source: 'network' });
    });

    it('does not abandon the network (and so cannot leave a timer) after it answers', async () => {
        vi.useFakeTimers();
        const n = net();
        const out = networkFirstWithTimeout(n.promise, cachedHit(), 1800);
        n.resolve('fresh');
        await out;
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([0, -1, Infinity, NaN, undefined])(
        'waits for the network forever when timeoutMs is %s (a hard reload)', async (timeoutMs) => {
            vi.useFakeTimers();
            const n = net();
            const lookup = cachedHit();
            const out = networkFirstWithTimeout(n.promise, lookup, timeoutMs);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(lookup).not.toHaveBeenCalled();
            n.resolve('fresh');
            expect((await out).source).toBe('network');
        });
});

describe('slow-network latch', () => {
    it('is off until a timeout has happened', () => {
        expect(slowNetworkActive(null, 1_000_000)).toBe(false);
        expect(slowNetworkActive(undefined, 1_000_000)).toBe(false);
    });

    it('stays on for the window after a timeout, then expires', () => {
        const t0 = 1_000_000;
        expect(slowNetworkActive(t0, t0 + 1)).toBe(true);
        expect(slowNetworkActive(t0, t0 + SLOW_NETWORK_WINDOW_MS - 1)).toBe(true);
        expect(slowNetworkActive(t0, t0 + SLOW_NETWORK_WINDOW_MS)).toBe(false);
    });

    it('does not outlast a page load by much (seconds, not minutes)', () => {
        expect(SLOW_NETWORK_WINDOW_MS).toBeLessThanOrEqual(30_000);
    });
});

describe('wantsFreshNetwork', () => {
    it.each(['reload', 'no-store'])('treats cache mode %s as "I want the network"', (cache) => {
        expect(wantsFreshNetwork({ cache })).toBe(true);
    });

    it.each(['default', 'no-cache', 'force-cache', 'only-if-cached', undefined])(
        'treats cache mode %s as an ordinary request', (cache) => {
            expect(wantsFreshNetwork({ cache })).toBe(false);
        });

    it('copes with no request', () => {
        expect(wantsFreshNetwork(undefined)).toBe(false);
    });
});
