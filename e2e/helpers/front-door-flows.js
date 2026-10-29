// The front door's core flows, registered by both the desktop spec and the
// phone spec (tab-editor-front-door-mobile.spec.js) so one list of
// behaviours is checked at both sizes.
import {
    tef, otfJsonFile, gotoFrontDoor, chooseFile, expectEditorWithNotes,
} from './front-door.js';

export function registerFrontDoorFlows(test, expect) {
    test.describe('open, edit, find it in My tabs, come back', () => {
        for (const [label, file, expectedTitle] of [
            ['a .tef', () => tef.file, tef.title],
            ['an .otf.json', () => otfJsonFile(), null],
        ]) {
            test(`Open a tab file… opens ${label}; My tabs lists it; Back returns to the front door`,
                async ({ page }) => {
                    await gotoFrontDoor(page);
                    await chooseFile(page, page.locator('.tab-open-file'), file());

                    await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
                    await expectEditorWithNotes(page);
                    await expect(page.locator('.arr-status')).toContainText('Imported from a file');
                    if (expectedTitle) {
                        await expect(page.locator('#new-tab-title')).toHaveValue(expectedTitle);
                    }
                    // The URL belongs to the root once it left the front door.
                    expect(new URL(page.url()).pathname).toBe('/');

                    await page.goBack();
                    await expect(page.locator('.tab-home')).toBeVisible({ timeout: 20000 });
                    expect(new URL(page.url()).pathname).toBe('/tab-editor/');
                    // My tabs lists the file just opened.
                    await expect(page.locator('.tab-home-mytabs .draft-row')).toHaveCount(1);
                    if (expectedTitle) {
                        await expect(page.locator('.tab-home-mytabs .draft-row-title'))
                            .toHaveText(expectedTitle);
                    }

                    // …and its Open reopens it with the notes.
                    await page.locator('.tab-home-mytabs .draft-open').click();
                    await expectEditorWithNotes(page);
                });
        }

        test('a file that is not a tab says so and leaves the front door as it was', async ({ page }) => {
            await gotoFrontDoor(page);
            await chooseFile(page, page.locator('.tab-open-file'),
                { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a tab') });
            await expect(page.locator('.auth-toast').filter({ hasText: 'notes.txt' }).first())
                .toBeVisible({ timeout: 10000 });
            await expect(page.locator('.tab-home')).toBeVisible();
            expect(new URL(page.url()).pathname).toBe('/tab-editor/');
        });

        test('Start a new tab opens an empty take with the title and instrument', async ({ page }) => {
            await gotoFrontDoor(page);
            await page.locator('.tab-home-title').fill('Sally Goodin');
            await page.locator('.tab-home-instrument').selectOption('mandolin');
            await page.locator('.tab-home-new button[type=submit]').click();

            await page.waitForURL(/#new-tab\?/, { timeout: 20000 });
            await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
            expect(await page.locator('.editor-renderer .note-text').count()).toBe(0);
            await expect(page.locator('#new-tab-title')).toHaveValue('Sally Goodin');
            expect(page.url()).toContain('instrument=mandolin');

            await page.goBack();
            await expect(page.locator('.tab-home')).toBeVisible({ timeout: 20000 });
        });
    });
}
