// What the app downloads at boot, and when.
//
//   B1  the landing page's collection cards (and their images) are built only
//       when the home view is shown — a deep link to a song never builds them
//   B2  data/archive.jsonl is fetched ON DEMAND, never speculatively
//   B3  the Supabase overlays start with the index, carry no pending content,
//       and a cached deleted/promoted set is applied before they land
//   B6  the legacy-ID map is fetched only for a list holding an unknown id
//
// Supabase is mocked (helpers/supabase-mock.js); the pending_songs route here
// additionally honours PostgREST column selection so the test can see what the
// app asked for.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockSupabase } from './helpers/supabase-mock.js';

const DATA = path.resolve('docs/data');

/** An archived row whose title appears nowhere in the canon — only the archive can supply it. */
function archivedOnlyRow() {
    const canonTitles = new Set();
    for (const line of fs.readFileSync(path.join(DATA, 'index.jsonl'), 'utf8').split('\n')) {
        if (line.trim()) canonTitles.add((JSON.parse(line).title || '').toLowerCase());
    }
    for (const line of fs.readFileSync(path.join(DATA, 'archive.jsonl'), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        const title = (row.title || '').toLowerCase();
        if (title.length > 12 && !/[^a-z0-9 ]/.test(title) && !canonTitles.has(title) && row.has_content) return row;
    }
    throw new Error('no archived-only row found');
}

const CARD_IMAGES = /images\/(Scruggs|billy|jimmy_martin_gospel|fiddle_tunes|jam_friendly|bluegrass_dungeon)\./;

/** Every request URL the page makes, for "did X happen" assertions. */
function recordRequests(page) {
    const urls = [];
    page.on('request', r => urls.push(r.url()));
    return {
        urls,
        count: re => urls.filter(u => re.test(u)).length,
    };
}

/**
 * pending_songs GETs with PostgREST column selection honoured, and a gate the
 * test can hold the overlay tables behind.
 */
async function routeOverlays(page, { pending = [], deleted = [], promoted = [], gate = null } = {}) {
    const log = [];
    await page.route('**/*.supabase.co/rest/v1/pending_songs*', async (route) => {
        const req = route.request();
        if (req.method() !== 'GET') return route.fallback();
        if (gate) await gate;
        const u = new URL(req.url());
        log.push(u.search);
        const select = u.searchParams.get('select') || '*';
        let rows = pending;
        const idEq = u.searchParams.get('id');
        if (idEq?.startsWith('eq.')) rows = rows.filter(r => r.id === idEq.slice(3));
        if (u.searchParams.getAll('content').some(v => v.startsWith('not.is.null'))) {
            rows = rows.filter(r => r.content);
        }
        if (select !== '*') {
            const cols = select.split(',');
            rows = rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
        }
        if ((req.headers().accept || '').includes('pgrst.object')) {
            return rows.length
                ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[0]) })
                : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ message: 'no rows' }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });
    for (const [table, rows] of [['deleted_songs', deleted], ['promoted_songs', promoted]]) {
        await page.route(`**/*.supabase.co/rest/v1/${table}*`, async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            if (gate) await gate;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
        });
    }
    return log;
}

async function typeSearch(page, query) {
    const input = page.locator('#search-input');
    await input.click();
    await input.fill('');
    await input.pressSequentially(query, { delay: 15 });
}

test.describe('B1 — collection cards belong to the home view', () => {
    test('a deep link to a song never builds the cards or downloads their images', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const seen = recordRequests(page);
        await page.goto('/#work/rocky-top');
        await expect(page.locator('#song-content .song-title, .song-title').first()).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(1500);

        expect(seen.count(CARD_IMAGES)).toBe(0);
        await expect(page.locator('.collection-card')).toHaveCount(0);
    });

    test('going home afterwards builds them', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.goto('/#work/rocky-top');
        await expect(page.locator('.song-title').first()).toBeVisible({ timeout: 20000 });

        await page.locator('#topbar-brand').click();
        await expect(page.locator('.collection-card')).toHaveCount(6);
    });

    test('a plain load shows the cards', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.goto('/');
        await expect(page.locator('.collection-card')).toHaveCount(6, { timeout: 20000 });
    });
});

test.describe('B2 — the archive is fetched on demand', () => {
    test('an idle home page never downloads it (not even after the old 2s idle timer)', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const seen = recordRequests(page);
        await page.goto('/');
        await expect(page.locator('.collection-card')).toHaveCount(6, { timeout: 20000 });
        await page.waitForTimeout(3500);
        expect(seen.count(/archive\.jsonl/)).toBe(0);
    });

    test('a deep link to a canon song does not download it either', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const seen = recordRequests(page);
        await page.goto('/#work/rocky-top');
        await expect(page.locator('.song-title').first()).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(3500);
        expect(seen.count(/archive\.jsonl/)).toBe(0);
    });

    test('a deep link to an archived song loads it on demand', async ({ page }) => {
        const row = archivedOnlyRow();
        await mockSupabase(page, { signedIn: false });
        const seen = recordRequests(page);
        await page.goto(`/#work/${row.id}`);
        await expect(page.locator('.song-title').first()).toContainText(row.title, { timeout: 30000 });
        expect(seen.count(/archive\.jsonl/)).toBe(1);
    });

    test('the Dungeon loads it', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const seen = recordRequests(page);
        await page.goto('/#dungeon');
        await expect(page.locator('.result-item').first()).toBeVisible({ timeout: 30000 });
        expect(seen.count(/archive\.jsonl/)).toBe(1);
    });

    test('a list holding an archived song still shows it', async ({ page }) => {
        const row = archivedOnlyRow();
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript((songs) => {
            localStorage.setItem('songbook-lists', JSON.stringify([
                { id: 'local_e2e_archived', name: 'Mixed', songs, songMetadata: {}, cloudId: null },
            ]));
            localStorage.setItem('songbook-legacy-cleanup-v2', '1');
        }, ['rocky-top', row.id]);
        const seen = recordRequests(page);
        await page.goto('/#list/local_e2e_archived');
        await expect(page.locator('#list-header-count')).toContainText('2 songs', { timeout: 30000 });
        await expect(page.locator('.result-item', { hasText: row.title })).toHaveCount(1);
        expect(seen.count(/archive\.jsonl/)).toBe(1);
    });

    test('opening a song while the archive downloads is not undone when it lands', async ({ page }) => {
        const row = archivedOnlyRow();
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript((songs) => {
            localStorage.setItem('songbook-lists', JSON.stringify([
                { id: 'local_e2e_slow', name: 'Slow', songs, songMetadata: {}, cloudId: null },
            ]));
            localStorage.setItem('songbook-legacy-cleanup-v2', '1');
        }, ['rocky-top', row.id, 'wagon-wheel']);
        let archiveLanded = false;
        await page.context().route('**/data/archive.jsonl*', async (route) => {
            await new Promise(r => setTimeout(r, 4000));
            await route.continue();
            archiveLanded = true;
        });
        await page.goto('/#list/local_e2e_slow');
        await expect(page.locator('#list-header-count')).toContainText('2 songs', { timeout: 30000 });
        await page.locator('.result-item', { hasText: /rocky top/i }).first().click();
        await expect(page.locator('#song-view')).toBeVisible();
        const url = page.url();
        await expect.poll(() => archiveLanded, { timeout: 30000 }).toBe(true);
        await page.waitForTimeout(1500);
        await expect(page.locator('#song-view')).toBeVisible();
        expect(page.url()).toBe(url);
    });

    test('a list of canon songs does not need it', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript(() => {
            localStorage.setItem('songbook-lists', JSON.stringify([
                { id: 'local_e2e_canon', name: 'Canon', songs: ['rocky-top'], songMetadata: {}, cloudId: null },
            ]));
            localStorage.setItem('songbook-legacy-cleanup-v2', '1');
        });
        const seen = recordRequests(page);
        await page.goto('/#list/local_e2e_canon');
        await expect(page.locator('#list-header-count')).toContainText('1 song', { timeout: 20000 });
        await page.waitForTimeout(2500);
        expect(seen.count(/archive\.jsonl/)).toBe(0);
    });

    test('a fresh promotion of an archived work is searchable — the archive comes in to rescue it', async ({ page }) => {
        const row = archivedOnlyRow();
        await mockSupabase(page, { signedIn: false });
        await routeOverlays(page, { promoted: [{ song_id: row.id }] });
        const seen = recordRequests(page);
        await page.goto('/#search');
        await expect(page.locator('#search-stats')).toContainText(/[1-9][\d,]*\s+songs/, { timeout: 20000 });
        await expect.poll(() => seen.count(/archive\.jsonl/), { timeout: 30000 }).toBe(1);
        await page.waitForTimeout(500);

        await typeSearch(page, row.title);
        await expect(page.locator('.result-item', { hasText: row.title }).first()).toBeVisible({ timeout: 10000 });
    });

    test('without the promotion the same title is not searchable, and the archive stays away', async ({ page }) => {
        const row = archivedOnlyRow();
        await mockSupabase(page, { signedIn: false });
        await routeOverlays(page, {});
        const seen = recordRequests(page);
        await page.goto('/#search');
        await expect(page.locator('#search-stats')).toContainText(/[1-9][\d,]*\s+songs/, { timeout: 20000 });
        await typeSearch(page, row.title);
        await page.waitForTimeout(1500);
        await expect(page.locator('.result-item', { hasText: row.title })).toHaveCount(0);
        expect(seen.count(/archive\.jsonl/)).toBe(0);
    });
});

test.describe('B3 — the overlays are lean and do not block first paint', () => {
    const PENDING = {
        id: 'e2e-pending-song',
        title: 'E2E Pending Waltz',
        artist: 'Test Band',
        part_type: 'lead-sheet',
        created_by: 'someone-else',
        created_at: '2026-09-30T00:00:00Z',
        key: 'G',
        // (sections are tagged: lyrics outside a section render blank — A4)
        content: '{title: E2E Pending Waltz}\n{key: G}\n\n{start_of_verse}\n[G]Hello from the pending overlay\n{end_of_verse}\n',
    };

    test('pending rows are fetched without `content`; it is read when the song opens', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const log = await routeOverlays(page, { pending: [PENDING] });
        await page.goto('/#search');
        await expect(page.locator('#search-stats')).toContainText(/[1-9][\d,]*\s+songs/, { timeout: 20000 });

        // Boot asked for columns, not `*`, and never for the body.
        expect(log.length).toBeGreaterThan(0);
        for (const search of log.filter(s => !s.includes('id=eq.'))) {
            expect(search).not.toMatch(/select=\*/);
            expect(decodeURIComponent(search)).not.toMatch(/select=[^&]*\bcontent\b/);
        }
        expect(log.some(s => s.includes('id=eq.'))).toBe(false);

        // The song is in search (by title) and opens with its text.
        await typeSearch(page, 'E2E Pending Waltz');
        await page.locator('.result-item', { hasText: 'E2E Pending Waltz' }).first().click();
        await expect(page.locator('#song-content')).toContainText('Hello from the pending overlay', { timeout: 10000 });
        expect(log.some(s => s.includes('select=content') && s.includes('id=eq.e2e-pending-song'))).toBe(true);
    });

    test('a pending-only song deep link waits for the overlay, not the archive', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await routeOverlays(page, { pending: [PENDING] });
        const seen = recordRequests(page);
        await page.goto('/#work/e2e-pending-song');
        await expect(page.locator('#song-content')).toContainText('Hello from the pending overlay', { timeout: 20000 });
        expect(seen.count(/archive\.jsonl/)).toBe(0);
    });

    test('a deletion cached from the last visit applies before the overlays answer', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript(() => {
            localStorage.setItem('songbook-curation-deleted', JSON.stringify(['rocky-top']));
        });
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await routeOverlays(page, { deleted: [{ song_id: 'rocky-top' }], gate });

        await page.goto('/#search');
        // First paint happens while the overlays are still held back.
        await expect(page.locator('#search-stats')).toContainText(/[1-9][\d,]*\s+songs/, { timeout: 20000 });
        await typeSearch(page, 'rocky top');
        await expect(page.locator('.result-item').first()).toBeVisible();
        await expect(page.locator('.result-item[data-id="rocky-top"]')).toHaveCount(0);

        release();
        await page.waitForTimeout(500);
        await typeSearch(page, 'rocky top');
        await expect(page.locator('.result-item').first()).toBeVisible();
        await expect(page.locator('.result-item[data-id="rocky-top"]')).toHaveCount(0);
    });

    test('a cached deletion the server no longer reports is lifted', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript(() => {
            if (!localStorage.getItem('e2e-seeded')) {
                localStorage.setItem('songbook-curation-deleted', JSON.stringify(['rocky-top']));
                localStorage.setItem('e2e-seeded', '1');
            }
        });
        await routeOverlays(page, { deleted: [] });
        await page.goto('/#search');
        await expect(page.locator('#search-stats')).toContainText(/[1-9][\d,]*\s+songs/, { timeout: 20000 });
        await page.waitForTimeout(1200);   // overlays land, corpus re-merges
        await typeSearch(page, 'rocky top');
        await expect(page.locator('.result-item[data-id="rocky-top"]').first()).toBeVisible({ timeout: 10000 });
        expect(await page.evaluate(() => localStorage.getItem('songbook-curation-deleted'))).toBe('[]');
    });

    test('a slow backend does not hold the first render hostage', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const gate = new Promise(() => {});   // never answers
        await routeOverlays(page, { gate });
        const started = Date.now();
        await page.goto('/');
        await expect(page.locator('.collection-card')).toHaveCount(6, { timeout: 20000 });
        expect(Date.now() - started).toBeLessThan(15000);
    });
});

test.describe('B3 follow-ups — deep links vs. slow and hung overlays', () => {
    const SLOW_PENDING = {
        id: 'e2e-slow-pending',
        title: 'E2E Slow Overlay Reel',
        artist: 'Test Band',
        part_type: 'lead-sheet',
        created_by: 'someone-else',
        created_at: '2026-09-30T00:00:00Z',
        key: 'G',
        content: '{title: E2E Slow Overlay Reel}\n{key: G}\n\n{start_of_verse}\n[G]Slow overlay body\n{end_of_verse}\n',
    };

    test('overlays slower than the grace period still resolve a pending-only deep link without the archive', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const gate = new Promise(resolve => setTimeout(resolve, 1800));
        await routeOverlays(page, { pending: [SLOW_PENDING], gate });
        const seen = recordRequests(page);
        await page.goto('/#work/e2e-slow-pending');
        await expect(page.locator('#song-content')).toContainText('Slow overlay body', { timeout: 20000 });
        expect(seen.count(/archive\.jsonl/)).toBe(0);
    });

    test('a hung backend does not strand a deep link to an archived song on "Loading"', async ({ page }) => {
        const row = archivedOnlyRow();
        await mockSupabase(page, { signedIn: false });
        await routeOverlays(page, { gate: new Promise(() => {}) });
        await page.goto(`/#work/${row.id}`);
        await expect(page.locator('.song-title').first()).toContainText(row.title, { timeout: 20000 });
    });
});

test.describe('B2 follow-up — a list opened before the corpus exists does not freeze the tab', () => {
    const responsive = page => Promise.race([
        page.evaluate(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 5000)),
    ]);

    async function seedList(page) {
        await page.addInitScript(() => {
            localStorage.setItem('songbook-lists', JSON.stringify([
                { id: 'local_e2e_freeze', name: 'Freeze', songs: ['rocky-top', 'some-archived-id'], songMetadata: {}, cloudId: null },
            ]));
            localStorage.setItem('songbook-legacy-cleanup-v2', '1');
        });
    }

    test('index.jsonl still in flight', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await seedList(page);
        await page.route('**/data/index.jsonl*', async (route) => {
            await new Promise(resolve => setTimeout(resolve, 6000));
            return route.continue();
        });
        await page.goto('/');
        await page.evaluate(() => { location.hash = '#list/local_e2e_freeze'; });
        await page.waitForTimeout(500);
        expect(await responsive(page)).toBe(true);
        // and the corpus lands afterwards as usual
        await expect(page.locator('#list-header-count')).toContainText('1 song', { timeout: 30000 });
        expect(await responsive(page)).toBe(true);
    });

    test('index.jsonl failed', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await seedList(page);
        await page.route('**/data/index.jsonl*', route => route.abort());
        await page.goto('/');
        await page.waitForTimeout(1000);
        await page.evaluate(() => { location.hash = '#list/local_e2e_freeze'; });
        await page.waitForTimeout(1000);
        expect(await responsive(page)).toBe(true);
    });
});

test.describe('B6 — the legacy-ID map is fetched only when a list needs it', () => {
    test('a first visit with no lists never downloads it', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const seen = recordRequests(page);
        await page.goto('/');
        await expect(page.locator('.collection-card')).toHaveCount(6, { timeout: 20000 });
        await page.waitForTimeout(1500);
        expect(seen.count(/legacy_id_mapping/)).toBe(0);
    });

    test('lists of known slugs do not need it', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript(() => {
            localStorage.setItem('songbook-lists', JSON.stringify([
                { id: 'local_known', name: 'Known', songs: ['rocky-top'], songMetadata: {}, cloudId: null },
            ]));
        });
        const seen = recordRequests(page);
        await page.goto('/');
        await expect(page.locator('.collection-card')).toHaveCount(6, { timeout: 20000 });
        await page.waitForTimeout(1500);
        expect(seen.count(/legacy_id_mapping/)).toBe(0);
    });

    test('a list holding an old-style id downloads it once and is migrated', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript(() => {
            if (localStorage.getItem('e2e-seeded')) return;
            localStorage.setItem('e2e-seeded', '1');
            localStorage.setItem('songbook-lists', JSON.stringify([
                { id: 'local_old', name: 'Old', songs: ['rockytoplyricsandchords'], songMetadata: {}, cloudId: null },
            ]));
        });
        const seen = recordRequests(page);
        await page.goto('/');
        await expect(page.locator('.collection-card')).toHaveCount(6, { timeout: 20000 });
        await expect.poll(() => seen.count(/legacy_id_mapping/), { timeout: 10000 }).toBe(1);
        await expect.poll(async () => page.evaluate(
            () => JSON.parse(localStorage.getItem('songbook-lists'))[0].songs), { timeout: 10000 }).toEqual(['rocky-top']);

        // The next visit has nothing left to migrate.
        const again = recordRequests(page);
        await page.reload();
        await expect(page.locator('.collection-card')).toHaveCount(6, { timeout: 20000 });
        await page.waitForTimeout(1500);
        expect(again.count(/legacy_id_mapping/)).toBe(0);
    });
});
