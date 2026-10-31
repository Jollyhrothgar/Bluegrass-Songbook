// File ▸ Save as… (G15f), registered by the desktop spec and the phone spec
// (tab-save-as-mobile.spec.js) so the same behaviours are checked at both sizes.
import { readFileSync } from 'fs';
import {
    tef, gotoFrontDoor, chooseFile, expectEditorWithNotes, clickFileItem, saveAs, saveAsPanel, notes,
} from './front-door.js';
import { tefFixture } from './tef-fixture.js';

const skipped = tefFixture('skipped_v3_all.tef');

async function openFixture(page, fixture) {
    await gotoFrontDoor(page);
    await chooseFile(page, page.locator('.tab-open-file'), fixture.file);
    await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
    await expectEditorWithNotes(page);
}

export function registerSaveAsFlows(test, expect) {
    test.describe('Save as…', () => {
        test('open a .tef, change a note, save as .tef, reopen the download: the change is there',
            async ({ page }) => {
                await openFixture(page, tef);
                const before = (await notes(page).first().textContent()).trim();
                const changed = before === '9' ? '8' : '9';

                await notes(page).first().click();
                await page.keyboard.press(changed);
                await expect(notes(page).first()).toHaveText(changed);

                // .tef is the default: the document came from one, and keeps its name
                await clickFileItem(page, 'Save as');
                const panel = saveAsPanel(page);
                await expect(panel.locator('input[value="tef"]')).toBeChecked();
                await expect(panel.locator('.save-as-name')).toHaveValue(tef.file.name);
                await page.keyboard.press('Escape');
                await expect(panel).toBeHidden();

                const download = await saveAs(page);
                expect(download.suggestedFilename()).toBe(tef.file.name);
                const path = await download.path();
                expect(readFileSync(path).length).toBeGreaterThan(256);

                // File ▸ Open… the file just saved
                const [chooser] = await Promise.all([
                    page.waitForEvent('filechooser'),
                    clickFileItem(page, 'Open…'),
                ]);
                await chooser.setFiles(path);
                await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
                await expectEditorWithNotes(page);
                await expect(notes(page).first()).toHaveText(changed);
            });

        test('.otf.json and .txt get the opened name with their own extension', async ({ page }) => {
            await openFixture(page, tef);
            const stem = tef.file.name.replace(/\.tef$/, '');
            const otf = await saveAs(page, { format: 'otf' });
            expect(otf.suggestedFilename()).toBe(`${stem}.otf.json`);
            expect(JSON.parse(readFileSync(await otf.path(), 'utf-8')).metadata.title).toBe(tef.title);

            const txt = await saveAs(page, { format: 'txt' });
            expect(txt.suggestedFilename()).toBe(`${stem}.txt`);
            expect(readFileSync(await txt.path(), 'utf-8')).toContain(tef.title);
        });

        test('the name is editable and its extension follows the format', async ({ page }) => {
            await openFixture(page, tef);
            await clickFileItem(page, 'Save as');
            const panel = saveAsPanel(page);
            await panel.locator('.save-as-name').fill('my tune.tef');
            await panel.locator('input[value="txt"]').check();
            await expect(panel.locator('.save-as-name')).toHaveValue('my tune.txt');
            await panel.locator('input[value="tef"]').check();
            await expect(panel.locator('.save-as-name')).toHaveValue('my tune.tef');
        });

        test('the panel says what was not kept from the file, before Save', async ({ page }) => {
            await openFixture(page, skipped);
            await clickFileItem(page, 'Save as');
            const panel = saveAsPanel(page);
            await expect(panel.locator('.save-as-notice'))
                .toContainText('Not kept from this file: 2 tempo changes');
            await panel.locator('input[value="otf"]').check();
            await expect(panel.locator('.save-as-notice')).toContainText('Not kept from this file');
        });

        test('a new tab starts at .tef, named after its title', async ({ page }) => {
            await page.goto('/#new-tab?title=Phone%20Tune&instrument=banjo');
            await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
            await clickFileItem(page, 'Save as');
            const panel = saveAsPanel(page);
            await expect(panel.locator('input[value="tef"]')).toBeChecked();
            await expect(panel.locator('.save-as-name')).toHaveValue(/\.tef$/);
        });
    });
}
