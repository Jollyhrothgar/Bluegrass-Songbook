// The tab editor's front door on a phone (iPhone 13 metrics, touch): the
// same flows as the desktop spec, plus the one that is the point of G15c: a
// phone cannot drag a file, so Open has to be a button that works signed out.
import { test, expect } from './fixtures.js';
import { gotoSearch } from './helpers.js';
import {
    tef, gotoFrontDoor, chooseFile, expectEditorWithNotes, clickFileItem, clickOverflow,
} from './helpers/front-door.js';
import { registerFrontDoorFlows } from './helpers/front-door-flows.js';

registerFrontDoorFlows(test, expect);

test.describe('the front door, phone', () => {
    test('⋯ ▸ Tab editor ▸ Open a tab file… opens a .tef, signed out', async ({ page }) => {
        await gotoSearch(page);
        await clickOverflow(page, 'Tab editor');
        await expect(page.locator('.tab-home')).toBeVisible({ timeout: 20000 });
        await chooseFile(page, page.locator('.tab-open-file'), tef.file);
        await expectEditorWithNotes(page);
    });

    test('File ▸ Open… is in the phone menu sheet, and opens a file', async ({ page }) => {
        await page.goto('/#new-tab?title=Phone%20Tune&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            clickFileItem(page, 'Open…'),
        ]);
        await chooser.setFiles(tef.file);
        await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
        await expectEditorWithNotes(page);
    });
});
