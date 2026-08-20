// The service worker's routing table. sw.js is a mechanical shell around
// routeFor(), so these are the tests that actually protect the cache
// behaviour — above all the rule that app code is NEVER cache-first (a stale
// main.js has bitten this project before, and nothing here is content-hashed).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
    CACHE_NAMES,
    CACHE_VERSION,
    PRECACHE_URLS,
    STRATEGIES,
    isOurCache,
    routeFor,
    staleCaches,
} from '../sw-strategy.js';

const ORIGIN = 'https://bluegrassbook.com';
const at = (url, extra = {}) => routeFor({ url, ...extra }, { origin: ORIGIN });

describe('routeFor — same-origin app shell', () => {
    it('serves navigations network-first', () => {
        expect(at(`${ORIGIN}/index.html`, { mode: 'navigate' }))
            .toEqual({ strategy: STRATEGIES.NETWORK_FIRST, cache: CACHE_NAMES.shell });
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
        expect(at(`${ORIGIN}/images/banjo.png`))
            .toEqual({ strategy: STRATEGIES.NETWORK_FIRST, cache: CACHE_NAMES.shell });
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
