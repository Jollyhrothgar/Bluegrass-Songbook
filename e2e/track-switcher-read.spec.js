// G23: a multi-track tab switches its staves on the staff header
// ("Banjo ▾ 1 of 4"), on every width; the View sheet lists only the song's
// tabs. Foggy Mountain Breakdown's ensemble has four pitched tracks.
import { test, expect } from './fixtures.js';
import { openDock } from './helpers.js';

const ENSEMBLE = '/#work/foggy-mountain-breakdown/ensemble';

async function gotoTab(page, hash) {
    await page.goto(hash);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
}

const visibleTracks = (page) => page.locator('.tablature-track-section').evaluateAll(
    els => els.filter(e => e.style.display !== 'none').map(e => e.dataset.trackId));

for (const width of [390, 1440]) {
    test.describe(`the staff header's track switcher at ${width}px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('Banjo ▾ 1 of 4; Guitar shows the guitar staff; All shows every staff', async ({ page }) => {
            await gotoTab(page, ENSEMBLE);
            const btn = page.locator('.track-info .track-switcher-button');
            await expect(btn).toHaveCount(1);
            await expect(btn).toHaveText('Banjo ▾ 1 of 4');
            expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(44);
            expect(await visibleTracks(page)).toEqual(['banjo']);

            await btn.click();
            await expect(btn).toHaveAttribute('aria-expanded', 'true');
            const items = page.locator('.track-switcher-item');
            await expect(items).toHaveCount(5);
            await expect(items.last()).toContainText('All tracks');
            await items.filter({ hasText: /^\s*Guitar\s*$/ }).click();
            await expect(page.locator('.track-switcher-list')).toHaveCount(0);
            expect(await visibleTracks(page)).toEqual(['guitar']);
            await expect(page.locator('.track-info .track-switcher-button')).toHaveText('Guitar ▾ 2 of 4');

            await page.locator('.track-info .track-switcher-button').click();
            await page.locator('.track-switcher-item', { hasText: 'All tracks' }).click();
            expect((await visibleTracks(page)).length).toBe(4);
            await expect(page.locator('.track-info .track-switcher-button')).toHaveText('All tracks ▾');
            await expect(page.locator('.track-info .track-switcher-button')).toHaveCount(1);

            // Escape closes the list
            await page.locator('.track-info .track-switcher-button').click();
            await page.keyboard.press('Escape');
            await expect(page.locator('.track-switcher-list')).toHaveCount(0);
        });

        test('the View sheet has no Tracks section and reads "versions"', async ({ page }) => {
            await gotoTab(page, ENSEMBLE);
            const sheet = await openDock(page, 'view');
            await expect(sheet.locator('.dock-sheet-heading')).toHaveText(['Tabs for this song']);
            await expect(sheet.locator('[data-track]')).toHaveCount(0);
            await expect(sheet).not.toContainText('Tracks');
            await expect(sheet.locator('[data-part="banjo-tab"] .dock-count')).toHaveText(/^\d+ versions$/);
            await expect(sheet.locator('[data-part].on')).toContainText('Ensemble');
        });

        test('a single-track tab has no ▾', async ({ page }) => {
            // (Foggy's banjo-tab is the pick with three tracks; this one has just a banjo)
            await gotoTab(page, '/#work/arkansas-traveler-1/banjo-tab');
            await expect(page.locator('.track-info').first()).toBeVisible();
            await expect(page.locator('.track-switcher-button')).toHaveCount(0);
            await expect(page.locator('.track-info')).not.toContainText('▾');
        });
    });
}
