// Score ▸ Tab setup… on a phone (iPhone 13 metrics): the same flows, and the
// sheet has to fit the screen with Apply reachable.
import { test, expect } from './fixtures.js';
import { registerTabSetupFlows, openNewTab, openTabSetup, setupPanel } from './helpers/tab-setup-flows.js';

registerTabSetupFlows(test, expect);

test.describe('Tab setup, phone layout', () => {
    test('the sheet fits 390px: a bottom sheet, every control reachable, 44px buttons', async ({ page }) => {
        await openNewTab(page);
        const panel = await openTabSetup(page);
        const viewport = page.viewportSize();
        expect(viewport.width).toBe(390);

        const box = await panel.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        // pinned to the bottom edge like Save as
        expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 2);

        // the sheet scrolls inside itself: Apply scrolls into view, and is not clipped sideways
        await panel.locator('.apply-btn').scrollIntoViewIfNeeded();
        for (const sel of ['.tab-setup-title', '.tab-setup-capo', '.tab-setup-pitch', '.apply-btn', '.cancel-btn']) {
            await panel.locator(sel).first().scrollIntoViewIfNeeded();
            const b = await panel.locator(sel).first().boundingBox();
            expect(b, sel).not.toBeNull();
            expect(b.x, sel).toBeGreaterThanOrEqual(0);
            expect(b.x + b.width, sel).toBeLessThanOrEqual(viewport.width);
        }
        expect((await panel.locator('.apply-btn').boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(setupPanel(page)).toBeVisible();
    });
});
