// Render counts for the song page: a lead sheet or a tab should be drawn
// ONCE per open, not once per state notification. This is the before/after
// harness for the B7b double-render fixes (state.js no-op sets, the Bravura
// re-render, popstate + hashchange de-dup).
//
// Black-box on purpose: a MutationObserver counts DOM rebuilds rather than
// patching the renderers, so a refactor that keeps the output keeps the test.
//   lead sheet  renderLeadSheetContent rebuilds `#chord-view` every call, so
//               each added #chord-view is one render.
//   tab         TabRenderer._renderInternal empties `.tablature-container`
//               before drawing, so draws = (emptyings that removed stave
//               rows) + 1.
import { test, expect } from '@playwright/test';
import { gotoSearch, searchAndOpen } from './helpers.js';

/** Install the counters before any app code runs. */
async function installCounters(page) {
    await page.addInitScript(() => {
        window.__renders = { lead: 0, tabEmptied: 0, tabRows: 0 };
        const isEl = (n) => n && n.nodeType === 1;
        const seen = new WeakSet();   // one count per #chord-view element
        const start = () => {
            new MutationObserver((records) => {
                for (const r of records) {
                    for (const n of r.addedNodes) {
                        if (!isEl(n)) continue;
                        const cv = n.id === 'chord-view' ? n : n.querySelector?.('#chord-view');
                        if (cv && !seen.has(cv)) { seen.add(cv); window.__renders.lead++; }
                        if (n.classList?.contains('stave-row') || n.querySelector?.('.stave-row')) window.__renders.tabRows++;
                    }
                    const removedRows = [...r.removedNodes].some(n =>
                        isEl(n) && (n.classList.contains('stave-row') || n.querySelector('.stave-row')));
                    if (removedRows && r.target.classList?.contains('tablature-container')) {
                        window.__renders.tabEmptied++;
                    }
                }
            }).observe(document.documentElement, { childList: true, subtree: true });
        };
        if (document.documentElement) start();
        else document.addEventListener('DOMContentLoaded', start);
    });
}

const counts = (page) => page.evaluate(() => ({ ...window.__renders }));
const settle = (page) => page.evaluate(() => new Promise(r =>
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))), 400)));

test.describe('render counts', () => {
    test('a lead sheet renders once per open', async ({ page }) => {
        await installCounters(page);
        await gotoSearch(page);
        await searchAndOpen(page, 'old home place', /old home place/i);
        await expect(page.locator('.cl-chord').first()).toBeVisible();
        await settle(page);
        const { lead } = await counts(page);
        console.log('LEAD RENDERS', lead);
        expect(lead).toBe(1);
    });

    test('a lead sheet deep link renders once', async ({ page }) => {
        await installCounters(page);
        await page.goto('/#work/old-home-place');
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
        await settle(page);
        const { lead } = await counts(page);
        console.log('LEAD DEEPLINK RENDERS', lead);
        expect(lead).toBe(1);
    });

    test('a tab draws once per open', async ({ page }) => {
        await installCounters(page);
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.stave-row').first().waitFor({ timeout: 20000 });
        await settle(page);
        const c = await counts(page);
        console.log('TAB DRAWS', c.tabEmptied + 1, c);
        expect(c.tabEmptied).toBe(0);
    });
});

test.describe('render counts — navigation', () => {
    test('back/forward opens a song once, not once per event', async ({ page }) => {
        await installCounters(page);
        await page.goto('/#work/old-home-place');
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
        // A second song, reached the way a reader reaches it
        await page.evaluate(() => { window.location.hash = '#work/beautiful-home'; });
        await expect(page.locator('.song-title')).toContainText(/beautiful home/i, { timeout: 15000 });
        await settle(page);

        const before = (await counts(page)).lead;
        await page.goBack();
        await expect(page.locator('.song-title')).toContainText(/old home place/i, { timeout: 15000 });
        await settle(page);
        const after = (await counts(page)).lead;
        console.log('BACK RENDERS', after - before);
        expect(after - before).toBe(1);

        const beforeFwd = after;
        await page.goForward();
        await expect(page.locator('.song-title')).toContainText(/beautiful home/i, { timeout: 15000 });
        await settle(page);
        console.log('FORWARD RENDERS', (await counts(page)).lead - beforeFwd);
        expect((await counts(page)).lead - beforeFwd).toBe(1);
    });

    test('re-opening a song whose chart is cached renders once', async ({ page }) => {
        await installCounters(page);
        await page.goto('/#work/old-home-place');
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
        await page.evaluate(() => { window.location.hash = '#work/beautiful-home'; });
        await expect(page.locator('.song-title')).toContainText(/beautiful home/i, { timeout: 15000 });
        await settle(page);

        // Both charts are in memory now, so this open renders synchronously
        // — the path where the old key notification drew it a second time.
        const before = (await counts(page)).lead;
        await page.evaluate(() => { window.location.hash = '#work/old-home-place'; });
        await expect(page.locator('.song-title')).toContainText(/old home place/i, { timeout: 15000 });
        await settle(page);
        const after = (await counts(page)).lead;
        console.log('REOPEN RENDERS', after - before);
        expect(after - before).toBe(1);
    });
});
