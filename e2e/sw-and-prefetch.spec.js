// The service worker and the chart prefetch, in a real browser.
//
// sw.js is a thin shell around js/sw-strategy.js (unit-tested), so these
// cover what only a browser can: that the worker registers, enables
// navigation preload, sweeps the previous cache generation, caches a song's
// .pro stale-while-revalidate, and — above all — that a returning user with
// no network still gets the app (a bad service worker strands people).
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { gotoSearch, searchFor } from './helpers.js';

const swReady = (page) => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    // clients.claim() lands a moment after "ready"
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) {
        await new Promise(r => setTimeout(r, 50));
    }
    return { active: reg.active?.state, controlled: !!navigator.serviceWorker.controller };
});

test.describe('service worker', () => {
    test('registers, takes over, enables navigation preload and sweeps the old generation', async ({ page }) => {
        // A cache from the previous strategy generation, and someone else's
        await page.addInitScript(() => {
            caches.open('bgb-shell-v1');
            caches.open('bgb-data-v1');
            caches.open('some-other-apps-cache');
        });
        await gotoSearch(page);
        expect(await swReady(page)).toEqual({ active: 'activated', controlled: true });

        const state = await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.ready;
            return {
                preload: (await reg.navigationPreload.getState()).enabled,
                caches: (await caches.keys()).sort(),
            };
        });
        expect(state.preload).toBe(true);
        expect(state.caches).not.toContain('bgb-shell-v1');
        expect(state.caches).not.toContain('bgb-data-v1');
        expect(state.caches).toContain('some-other-apps-cache');   // not ours: untouched
        expect(state.caches.some(n => /^bgb-shell-v\d+$/.test(n))).toBe(true);
    });

    test('caches a song\'s .pro in the data cache (stale-while-revalidate), not the shell', async ({ page }) => {
        await page.goto('/#search');
        await swReady(page);
        await page.goto('/#work/old-home-place');
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });

        await expect.poll(() => page.evaluate(async () => {
            const where = {};
            for (const name of await caches.keys()) {
                const keys = await (await caches.open(name)).keys();
                if (keys.some(r => /\/data\/songs\/old-home-place\.pro$/.test(r.url))) where[name] = true;
            }
            return Object.keys(where);
        }), { timeout: 10000 }).toEqual([expect.stringMatching(/^bgb-data-v\d+$/)]);
    });

    test('a returning user with no network still gets the app and a song they read before', async ({ page, context }) => {
        await page.goto('/#work/old-home-place');
        await swReady(page);
        // The first visit's own requests predate the worker's control, so
        // they are not in its cache; the SECOND (online) load is the one that
        // fills it — which is exactly a returning user's situation.
        await page.reload();
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
        // Let the background cache writes land
        await page.waitForTimeout(1500);

        await context.setOffline(true);
        await page.reload();
        // The shell comes from the cache at once (not after a network wait)…
        await expect(page.locator('#topbar-brand')).toBeVisible({ timeout: 3000 });
        // …and the song once the app's own offline Supabase retries give up.
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('.song-title')).toContainText(/old home place/i);
        await expect(page.locator('.cl-chord').first()).toBeVisible();
        await context.setOffline(false);
    });
});

// A real slow server. `page.route` cannot stand in for one: while a route is
// installed Playwright turns the HTTP cache off, which makes every request
// `cache: 'reload'` — and the worker (correctly) never times out on those.
// So these tests put a small delaying proxy in front of the app server and
// load the app from THAT origin (its own worker registration, its own caches).
const APP_PORT = Number(process.env.PW_PORT) || 8137;

async function startSlowProxy() {
    // `generation` simulates deploys: when set, every app module under /js/
    // (except the worker's own strategy file, which would make the browser
    // see a new worker) gets a line appended recording which generation
    // served it, and every response is `no-cache` so the worker's fetch()
    // really reaches this server instead of the HTTP cache.
    const state = { delayMs: 0, slowPath: /^\/js\/main\.js/, generation: null };
    const server = http.createServer((req, res) => {
        const delay = state.slowPath.test(req.url) ? state.delayMs : 0;
        const path = req.url.split('?')[0];
        const stamp = state.generation != null && /^\/js\/.+\.js$/.test(path) && path !== '/js/sw-strategy.js'
            ? state.generation : null;
        setTimeout(() => {
            const headers = { ...req.headers };
            if (stamp != null) { delete headers['accept-encoding']; delete headers['if-none-match']; delete headers['if-modified-since']; }
            const upstream = http.request(
                { host: 'localhost', port: APP_PORT, path: req.url, method: req.method, headers },
                (up) => {
                    if (stamp == null) { res.writeHead(up.statusCode, up.headers); up.pipe(res); return; }
                    const chunks = [];
                    up.on('data', c => chunks.push(c));
                    up.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf8')
                            + `\n;(globalThis.__gens ||= {})[${JSON.stringify(path)}] = ${stamp};\n`;
                        const out = { ...up.headers, 'cache-control': 'no-cache' };
                        delete out['content-length']; delete out.etag; delete out['last-modified'];
                        res.writeHead(up.statusCode, out);
                        res.end(body);
                    });
                });
            upstream.on('error', () => { res.statusCode = 502; res.end(); });
            req.pipe(upstream);
        }, delay);
    });
    await new Promise(resolve => server.listen(0, 'localhost', resolve));
    return {
        state,
        origin: `http://localhost:${server.address().port}`,
        close: () => new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections?.();
        }),
    };
}

test.describe('service worker — slow network', () => {
    let proxy;
    test.beforeEach(async () => { proxy = await startSlowProxy(); });
    test.afterEach(async () => { await proxy.close(); });

    async function warm(page) {
        await page.goto(`${proxy.origin}/#search`);
        await swReady(page);
        await page.reload();                                   // fills the shell cache
        await expect(page.locator('#search-input')).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(1500);
    }

    test('a stalled script is answered from the cache after ~2s, not after the stall', async ({ page }) => {
        await warm(page);
        proxy.state.delayMs = 8000;

        // A plain navigation (cache: default)
        const started = Date.now();
        await page.goto(`${proxy.origin}/?slow=1#search`);
        await expect(page.locator('#search-input')).toBeVisible({ timeout: 7000 });
        const took = Date.now() - started;
        expect(took).toBeGreaterThan(1500);    // it DID wait its turn for the network…
        expect(took).toBeLessThan(6500);       // …and then stopped waiting
    });

    test('a hard reload waits for the network instead of serving the cache', async ({ page }) => {
        await warm(page);
        proxy.state.delayMs = 4000;

        // Shift-reload / "empty cache and hard reload": every request is
        // `cache: 'reload'`, i.e. the reader asked for the network.
        const cdp = await page.context().newCDPSession(page);
        const started = Date.now();
        await cdp.send('Page.reload', { ignoreCache: true });
        await expect(page.locator('#search-input')).toBeVisible({ timeout: 15000 });
        expect(Date.now() - started).toBeGreaterThanOrEqual(3900);
    });

    // A deploy changes dozens of modules at once and nothing is content-hashed,
    // so an app load that mixes generations can import a name its (old)
    // sibling does not export — a blank app. One stalled module after the
    // network has already delivered new ones must be WAITED for, not filled
    // in from the old cache.
    test('after a deploy, one stalled module is waited for so the load stays on one generation', async ({ page }) => {
        proxy.state.generation = 1;
        await warm(page);                                      // the cache now holds generation 1
        proxy.state.generation = 2;                            // "deploy"
        proxy.state.slowPath = /^\/js\/state\.js/;              // a non-entry module stalls past the timeout
        proxy.state.delayMs = 4000;

        const started = Date.now();
        await page.goto(`${proxy.origin}/?deploy=1#search`);
        await expect(page.locator('#search-input')).toBeVisible({ timeout: 20000 });
        expect(Date.now() - started).toBeGreaterThanOrEqual(3900);   // it waited for the network
        const gens = await page.evaluate(() => ({ ...globalThis.__gens }));
        expect(Object.keys(gens)).toContain('/js/main.js');
        expect(Object.keys(gens)).toContain('/js/state.js');
        expect([...new Set(Object.values(gens))]).toEqual([2]);
    });

    test('a stalled entry module (nothing answered yet) falls back to the cache and the load stays on the old generation', async ({ page }) => {
        proxy.state.generation = 1;
        await warm(page);
        proxy.state.generation = 2;
        proxy.state.delayMs = 8000;                            // the entry module (main.js) stalls

        await page.goto(`${proxy.origin}/?deploy=2#search`);
        await expect(page.locator('#search-input')).toBeVisible({ timeout: 7000 });
        const gens = await page.evaluate(() => ({ ...globalThis.__gens }));
        // (A module the warm-up never loaded is not in the cache and has to
        // come from the network — that one is new and unavoidable.)
        expect(gens['/js/main.js']).toBe(1);
        expect(gens['/js/state.js']).toBe(1);
        expect(gens['/js/work-view.js']).toBe(1);
    });

    test('with nothing cached, a slow script is waited for, not abandoned', async ({ page }) => {
        proxy.state.delayMs = 3500;                            // past the timeout, nothing to fall back to
        const started = Date.now();
        await page.goto(`${proxy.origin}/#search`);
        await expect(page.locator('#search-input')).toBeVisible({ timeout: 20000 });
        expect(Date.now() - started).toBeGreaterThanOrEqual(3400);
    });
});

test.describe('chart prefetch', () => {
    const proRequests = (page) => {
        const seen = [];
        page.on('request', (req) => {
            const m = req.url().match(/\/data\/songs\/([^/?]+)\.pro/);
            if (m) seen.push(m[1]);
        });
        return seen;
    };

    test('hovering a result warms its .pro, and opening it does not fetch again', async ({ page }) => {
        await gotoSearch(page);
        await searchFor(page, 'old home place');
        const seen = proRequests(page);

        const result = page.locator('.result-item').filter({ hasText: /old home place/i }).first();
        const id = await result.getAttribute('data-id');
        await result.hover();
        await expect.poll(() => seen.includes(id), { timeout: 5000 }).toBe(true);

        await result.click();
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 10000 });
        expect(seen.filter(x => x === id)).toHaveLength(1);
    });

    test('pointerdown (touch, pen, a quick click) warms it before the click lands', async ({ page }) => {
        await gotoSearch(page);
        await searchFor(page, 'old home place');
        const seen = proRequests(page);

        const result = page.locator('.result-item').filter({ hasText: /old home place/i }).first();
        const id = await result.getAttribute('data-id');
        // Dispatch only the pointerdown — no pointerup/click, no mouse hover
        await result.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
        await expect.poll(() => seen.includes(id), { timeout: 5000 }).toBe(true);
        await expect(page.locator('#song-view')).toBeHidden();   // not opened: prefetch only
    });

    test('sweeping the mouse across results does not fetch every row', async ({ page }) => {
        await gotoSearch(page);
        await searchFor(page, 'mountain');
        const seen = proRequests(page);

        const rows = page.locator('.result-item');
        const n = Math.min(await rows.count(), 6);
        for (let i = 0; i < n; i++) {
            await rows.nth(i).hover();            // no dwell
        }
        await page.mouse.move(2, 2);
        await page.waitForTimeout(400);
        expect(seen.length).toBeLessThan(n);
    });

    test('opening a song from a list warms the next one', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('songbook-lists', JSON.stringify([{
                id: 'local-e2e-set', name: 'E2E Set', cloudId: null, songMetadata: {},
                songs: ['old-home-place', 'a-beautiful-home', 'a-flower-blooming-in-the-wildwood'],
            }]));
        });
        const seen = proRequests(page);
        await page.goto('/#list/local-e2e-set/old-home-place');
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
        await expect.poll(() => seen.includes('a-beautiful-home'), { timeout: 10000 }).toBe(true);
        expect(seen).not.toContain('a-flower-blooming-in-the-wildwood');   // only the NEXT one
    });
});
