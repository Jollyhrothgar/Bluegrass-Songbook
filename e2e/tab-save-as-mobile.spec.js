// File ▸ Save as… on a phone (iPhone 13 metrics): the same flows, and the panel
// has to fit the screen with Save reachable.
import { test, expect } from './fixtures.js';
import { registerSaveAsFlows } from './helpers/save-as-flows.js';
import { tef, gotoFrontDoor, chooseFile, expectEditorWithNotes, clickFileItem, saveAsPanel } from './helpers/front-door.js';

registerSaveAsFlows(test, expect);

test.describe('Save as…, phone layout', () => {
    test('the panel fits 390px: no sideways scroll, every control on screen', async ({ page }) => {
        await gotoFrontDoor(page);
        await chooseFile(page, page.locator('.tab-open-file'), tef.file);
        await expectEditorWithNotes(page);
        await clickFileItem(page, 'Save as');
        const panel = saveAsPanel(page);
        await expect(panel).toBeVisible();

        const viewport = page.viewportSize();
        expect(viewport.width).toBe(390);
        for (const sel of ['', 'input[value="tef"]', 'input[value="txt"]', '.save-as-name', '.save-btn', '.cancel-btn']) {
            const box = await (sel ? panel.locator(sel) : panel).boundingBox();
            expect(box, sel).not.toBeNull();
            expect(box.x, sel).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, sel).toBeLessThanOrEqual(viewport.width);
            expect(box.y + box.height, sel).toBeLessThanOrEqual(viewport.height);
        }
        // touch targets
        expect((await panel.locator('.save-btn').boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
