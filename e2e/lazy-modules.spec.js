// E2E for B7a: route-specific modules load on demand, not at boot.
//
// The unit scan (docs/js/__tests__/lazy-modules.test.js) proves what main.js
// imports STATICALLY. These tests prove the other half in a real browser: the
// modules really are absent from a cold load, and every route/action that
// needs one still works once it is fetched — the behaviour must be identical,
// only later.
import { test, expect } from '@playwright/test';
import { gotoSearch, searchAndOpen, searchFor, navClick, openPill } from './helpers.js';
import { mockSupabase } from './helpers/supabase-mock.js';

// The service worker answers fetches itself, which page.route() cannot see —
// the held-back and failing module downloads below need the page's own.
test.use({ serviceWorkers: 'block' });

// Everything a reader of the home page / a chord chart must never download.
const EDITOR_SIDE = /\/js\/(editor|smart-paste|dedup-check)\.js|\/js\/visual-editor\/|\/js\/otf-editor\/(editor|state|facade|cursor|actions|work-edit)\.js/;
const TAB_SIDE = /\/js\/renderers\/(tablature|tab-player|tab-ascii)\.js|\/js\/audio-unlock\.js|\/js\/tab-(controls-sheet|playback-interactions|edit-band)\.js/;
const VIEW_SIDE = /\/js\/(bounty-view|my-submissions|high-scores|drafts-view|review-queue|list-export|zip)\.js/;

/** Collect every same-origin /js/ module the page requests. */
function trackModules(page) {
    const seen = [];
    page.on('request', (req) => {
        const { pathname } = new URL(req.url());
        if (pathname.startsWith('/js/')) seen.push(pathname);
    });
    return {
        all: () => [...seen],
        matching: (re) => seen.filter(p => re.test(p)),
    };
}

test.describe('cold load', () => {
    test('home page loads no editor, tab or view modules', async ({ page }) => {
        const mods = trackModules(page);
        await gotoSearch(page);
        // let anything that was going to be prefetched land
        await page.waitForTimeout(1000);

        expect(mods.matching(EDITOR_SIDE)).toEqual([]);
        expect(mods.matching(TAB_SIDE)).toEqual([]);
        expect(mods.matching(VIEW_SIDE)).toEqual([]);
        // and the core still came down: main plus its graph (was 65 modules)
        expect(mods.all().length).toBeGreaterThan(20);
        expect(mods.all().length).toBeLessThan(40);
    });

    test('a chord chart loads no tab modules and renders', async ({ page }) => {
        const mods = trackModules(page);
        await page.goto('/#work/rocky-top');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.cl-chord').first()).toBeVisible();

        expect(mods.matching(TAB_SIDE)).toEqual([]);
        expect(mods.matching(EDITOR_SIDE)).toEqual([]);
    });
});

test.describe('tablature', () => {
    test('opening a tab loads the renderer and player, draws it, and never loads the editor', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        const mods = trackModules(page);

        await page.goto('/#work/foggy-mountain-breakdown');
        await expect(page.locator('.tablature-container svg').first()).toBeVisible({ timeout: 20000 });

        expect(mods.matching(/\/renderers\/tablature\.js/)).toHaveLength(1);
        expect(mods.matching(/\/renderers\/tab-player\.js/)).toHaveLength(1);
        // the controls band was built by the lazily loaded helpers
        await expect(page.locator('.tab-play-btn')).toBeVisible();

        // Click-to-arm is the reading-view interaction that used to drag in
        // the whole editor (positionFromSvgPoint lived in otf-editor/cursor.js)
        const svg = page.locator('.tablature-container svg').first();
        const box = await svg.boundingBox();
        await page.mouse.click(box.x + Math.min(200, box.width / 2), box.y + Math.min(40, box.height / 2));
        await expect(page.locator('.play-caret-armed')).toHaveCount(1);

        expect(mods.matching(/\/js\/otf-editor\//).filter(p => !/(create-tab|existing-tabs|submit-tab|new-otf)/.test(p))).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('the Edit button loads the editor on demand and it opens', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown');
        await expect(page.locator('.tablature-container svg').first()).toBeVisible({ timeout: 20000 });
        const mods = trackModules(page);

        await page.locator('.tab-edit-btn').click();
        await expect(page.locator('.otf-editor')).toBeVisible({ timeout: 15000 });
        expect(mods.matching(/\/js\/otf-editor\/editor\.js/)).toHaveLength(1);
        expect(mods.matching(/\/js\/tab-edit-band\.js/)).toHaveLength(1);
    });

    test('#new-tab (no rendered take yet) still opens the editor with its band', async ({ page }) => {
        await page.goto('/#new-tab');
        await expect(page.locator('.otf-editor')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('.tab-play-btn')).toBeVisible();
    });
});

test.describe('song editor', () => {
    test('#add loads the editor and wires the textarea and preview', async ({ page }) => {
        const mods = trackModules(page);
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.ve-preview-empty')).toBeVisible({ timeout: 15000 });
        expect(mods.matching(/\/js\/editor\.js/)).toHaveLength(1);

        await page.locator('#editor-content').fill('{title: Lazy}\n[G]Hello [C]world');
        await expect(page.locator('.ve-chip').first()).toHaveText('G', { timeout: 5000 });
    });

    test('the Edit pill on a song page fills the editor from that song', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'old home place');
        await page.locator('#edit-song-btn').click();
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/old home place/i);
    });

    test('leaving the editor and coming back keeps working', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await navClick(page, 'search');
        await expect(page.locator('#editor-panel')).toBeHidden();
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible();
    });
});

test.describe('whole-page views', () => {
    test('#bounty loads its module and renders', async ({ page }) => {
        const mods = trackModules(page);
        await page.goto('/#bounty');
        await expect(page.locator('#results .bounty-title').first()).toBeVisible({ timeout: 15000 });
        expect(mods.matching(/\/js\/bounty-view\.js/)).toHaveLength(1);
    });

    test('#high-scores loads its module and renders', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const mods = trackModules(page);
        await page.goto('/#high-scores');
        await expect(page.locator('#results .high-scores-view')).toBeVisible({ timeout: 15000 });
        expect(mods.matching(/\/js\/high-scores\.js/)).toHaveLength(1);
    });

    test('#my-submissions loads its module and renders', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        const mods = trackModules(page);
        await page.goto('/#my-submissions');
        await expect(page.locator('#my-submissions-sign-in-btn')).toBeVisible({ timeout: 15000 });
        expect(mods.matching(/\/js\/my-submissions\.js/)).toHaveLength(1);
    });

    test('#drafts loads its module and renders', async ({ page }) => {
        const mods = trackModules(page);
        await page.goto('/#drafts');
        await expect(page.locator('#results .drafts-view')).toBeVisible({ timeout: 15000 });
        expect(mods.matching(/\/js\/drafts-view\.js/)).toHaveLength(1);
    });

    test('navigating away before a view finishes loading does not paint it over the new page', async ({ page }) => {
        // Hold the bounty module back, leave, then let it through.
        let release;
        const held = new Promise(resolve => { release = resolve; });
        await page.route('**/js/bounty-view.js', async (route) => {
            await held;
            await route.continue();
        });
        await gotoSearch(page);
        await page.evaluate(() => { location.hash = '#bounty'; });
        await page.waitForTimeout(200);
        await navClick(page, 'search');
        await expect(page.locator('#search-input')).toBeVisible();
        release();
        await page.waitForTimeout(800);
        await expect(page.locator('#results .bounty-title')).toHaveCount(0);
    });

    test('a failed module download says so instead of leaving a blank page', async ({ page }) => {
        await page.route('**/js/high-scores.js', route => route.abort());
        await gotoSearch(page);
        await page.evaluate(() => { location.hash = '#high-scores'; });
        await expect(page.locator('.auth-toast').first()).toContainText(/Couldn't load/i, { timeout: 10000 });
    });
});

test.describe('review queue', () => {
    test('an anonymous visitor in the Dungeon never downloads it', async ({ page }) => {
        const mods = trackModules(page);
        await page.goto('/#dungeon');
        await expect(page.locator('#results')).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(1500);
        expect(mods.matching(/review-queue\.js/)).toEqual([]);
    });

    test('a trusted user in the Dungeon gets the queue', async ({ page }) => {
        await mockSupabase(page, { rpc: { is_trusted_user: true } });
        const mods = trackModules(page);
        await page.goto('/#dungeon');
        await expect(page.locator('#review-queue-panel')).toBeVisible({ timeout: 20000 });
        expect(mods.matching(/review-queue\.js/)).toHaveLength(1);
    });
});

test.describe('list export', () => {
    test('Download .zip loads the exporter on demand and downloads', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await gotoSearch(page);
        await searchFor(page, 'rocky top');
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();
        await navClick(page, 'favorites');
        await expect(page.locator('#list-export-pill')).toBeVisible({ timeout: 10000 });

        const mods = trackModules(page);
        const popover = await openPill(page, 'list-export-pill');
        const download = page.waitForEvent('download');
        await popover.locator('[data-action="download-zip"]').click();
        expect((await download).suggestedFilename()).toMatch(/\.zip$/);
        expect(mods.matching(/\/js\/zip\.js/)).toHaveLength(1);
        expect(mods.matching(/\/js\/list-export\.js/)).toHaveLength(1);
    });
});
