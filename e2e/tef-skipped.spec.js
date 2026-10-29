// G15e: opening a .tef says what the book did not keep from it.
//
// skipped_v3_all.tef is a real V3 tab with records overwritten so it holds,
// among others, 2 tempo changes and 3 lines of lyrics
// (tests/parser/make_skipped_fixtures.py); it travels in golden.json beside
// the bytes of every other fixture.
import { test, expect } from './fixtures.js';
import { tefFixture } from './helpers/tef-fixture.js';
import { gotoFrontDoor, chooseFile, expectEditorWithNotes } from './helpers/front-door.js';

const skippedFile = tefFixture('skipped_v3_all.tef');
const cleanFile = tefFixture();

test.describe('Not kept from this file', () => {
    test('a .tef with a tempo change says so under "Imported from a file"', async ({ page }) => {
        await gotoFrontDoor(page);
        await chooseFile(page, page.locator('.tab-open-file'), skippedFile.file);
        await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
        await expectEditorWithNotes(page);

        const status = page.locator('.arr-status');
        await expect(status).toContainText('Imported from a file');
        await expect(status.locator('.arr-skipped')).toContainText(
            'Not kept from this file: 2 tempo changes, 1 instrument (MIDI) change, 3 scale diagrams');
        await expect(status.locator('.arr-skipped')).toContainText('3 lines of lyrics');
    });

    test('a .tef that lost nothing shows no such line', async ({ page }) => {
        await gotoFrontDoor(page);
        await chooseFile(page, page.locator('.tab-open-file'), cleanFile.file);
        await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
        await expectEditorWithNotes(page);

        await expect(page.locator('.arr-status')).toContainText('Imported from a file');
        await expect(page.locator('.arr-skipped')).toHaveCount(0);
    });
});
