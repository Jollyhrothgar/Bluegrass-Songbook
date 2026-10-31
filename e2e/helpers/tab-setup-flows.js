// Score ▸ Tab setup… (G20b), registered by the desktop spec and the phone spec
// (tab-setup-mobile.spec.js) so the same behaviours are checked at both sizes.
import { readFileSync } from 'fs';
import {
    tef, gotoFrontDoor, chooseFile, expectEditorWithNotes, clickFileItem, saveAs, saveAsPanel,
} from './front-door.js';

export const setupPanel = (page) => page.locator('.otf-tab-setup-popover');

/** The document the editor holds, through its debug handle. */
export const doc = (page) => page.evaluate(() =>
    document.querySelector('.otf-editor').__otfEditor.state.facade.export());

/** Open a Score menu item on a laptop or a phone (☰, then the folded Score heading). */
export async function clickScoreItem(page, label) {
    const bar = page.locator('.otf-menu-bar');
    const hamburger = bar.locator('.menu-hamburger');
    if (await hamburger.isVisible()) {
        await hamburger.click();
        const head = page.locator('.menu-sheet-head[data-menu="score"]');
        if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    } else {
        await bar.locator('.menu-trigger[data-menu="score"]').click();
    }
    await page.locator('.menu-popup .menu-item', { hasText: label }).first().click();
}

export async function openTabSetup(page) {
    await clickScoreItem(page, 'Tab setup');
    await page.locator('.otf-tab-setup-popover').waitFor({ state: 'visible' });
    return setupPanel(page);
}

export async function openNewTab(page, query = 'title=Setup%20Tune&instrument=banjo') {
    await page.goto(`/#new-tab?${query}`);
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
}

/** Put a note on (measure, tick, string) through the editor's own key path. */
export async function putNote(page, { measure = 1, tick = 0, string = 3, fret = 5 } = {}) {
    await page.evaluate(({ measure, tick, string, fret }) => {
        const auto = document.querySelector('.otf-editor').__otfEditor.automation;
        auto.setCursor({ measure, tick, string });
        auto.press(String(fret));
    }, { measure, tick, string, fret });
}

/** A download as a file a chooser can be given (its own name, so the app sees the extension). */
function asFile(download) {
    return download.path().then(path => ({
        name: download.suggestedFilename(),
        mimeType: 'application/octet-stream',
        buffer: readFileSync(path),
    }));
}

export function registerTabSetupFlows(test, expect) {
    test.describe('Score ▸ Tab setup…', () => {
        test('change capo, tuning and time signature, Save as .tef, reopen it: the change is there',
            async ({ page }) => {
                await openNewTab(page);
                await putNote(page, { string: 2, fret: 3 });
                await expect(page.locator('.editor-renderer .note-text').first()).toHaveText('3');

                const panel = await openTabSetup(page);
                await expect(panel.locator('.tab-setup-track legend')).toHaveText('Track: banjo');
                await expect(panel.locator('.tab-setup-keeps')).toBeVisible();
                await panel.locator('.tab-setup-time').selectOption('3/4');
                await panel.locator('.tab-setup-capo').fill('2');
                await panel.locator('.tab-setup-tuning').selectOption('Double C');
                expect(await panel.locator('.tab-setup-pitch').evaluateAll(els => els.map(e => e.value)))
                    .toEqual(['D4', 'C4', 'G3', 'C3', 'G4']);
                await panel.locator('.apply-btn').click();
                await expect(panel).toBeHidden();

                // every note kept its string and fret
                const after = await doc(page);
                expect(after.metadata.time_signature).toBe('3/4');
                expect(after.tracks[0]).toMatchObject({ capo: 2, tuning: ['D4', 'C4', 'G3', 'C3', 'G4'] });
                await expect(page.locator('.editor-renderer .note-text').first()).toHaveText('3');

                const download = await saveAs(page, { format: 'tef' });
                const path = await download.path();
                expect(readFileSync(path).length).toBeGreaterThan(256);

                const [chooser] = await Promise.all([
                    page.waitForEvent('filechooser'),
                    clickFileItem(page, 'Open…'),
                ]);
                await chooser.setFiles(await asFile(download));
                await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
                await expectEditorWithNotes(page);
                const back = await doc(page);
                expect(back.metadata.time_signature).toBe('3/4');
                expect(back.tracks[0]).toMatchObject({ capo: 2, tuning: ['D4', 'C4', 'G3', 'C3', 'G4'] });
                await expect(page.locator('.editor-renderer .note-text').first()).toHaveText('3');
            });

        test('Apply is one undo step, and redo brings it back', async ({ page }) => {
            await openNewTab(page);
            const panel = await openTabSetup(page);
            await panel.locator('.tab-setup-capo').fill('3');
            await panel.locator('.tab-setup-key').fill('A');
            await panel.locator('.tab-setup-tempo').fill('96');
            await panel.locator('.apply-btn').click();
            expect((await doc(page)).tracks[0].capo).toBe(3);

            await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
            await page.keyboard.press('Control+z');
            const undone = await doc(page);
            expect(undone.tracks[0].capo).toBe(0);
            expect(undone.metadata.tempo).toBe(120);
            expect(undone.metadata.key || '').toBe('');
            await page.keyboard.press('Control+y');
            const redone = await doc(page);
            expect(redone.tracks[0].capo).toBe(3);
            expect(redone.metadata).toMatchObject({ key: 'A', tempo: 96 });
        });

        test('a time signature some notes do not fit is refused in the panel, naming the measure',
            async ({ page }) => {
                await openNewTab(page);
                await putNote(page, { measure: 2, tick: 1440, string: 3, fret: 5 });   // beat 4 of bar 2
                const panel = await openTabSetup(page);
                await panel.locator('.tab-setup-time').selectOption('3/4');
                await panel.locator('.apply-btn').click();
                await expect(panel.locator('.tab-setup-error')).toHaveText(
                    '1 measure has notes that do not fit 3/4; the first is measure 2.');
                await expect(panel).toBeVisible();
                expect((await doc(page)).metadata.time_signature).toBe('4/4');
            });

        test('a tuning that would drop a string with notes on it is refused: the count and the measure',
            async ({ page }) => {
                await openNewTab(page);
                await putNote(page, { measure: 3, tick: 0, string: 5, fret: 0 });
                const panel = await openTabSetup(page);
                await panel.locator('.tab-setup-instrument').selectOption('mandolin');
                await panel.locator('.apply-btn').click();
                await expect(panel.locator('.tab-setup-error')).toHaveText(
                    'This tuning has 4 strings, but 1 note is on string 5; the first is in measure 3. '
                    + 'Move or delete it first.');
                const unchanged = await doc(page);
                expect(unchanged.tracks[0]).toMatchObject({ instrument: '5-string-banjo' });
                expect(unchanged.tracks[0].tuning).toHaveLength(5);
            });

        test('a pitch that is not a note is a sentence, and Cancel leaves everything alone', async ({ page }) => {
            await openNewTab(page);
            const panel = await openTabSetup(page);
            await panel.locator('.tab-setup-pitch').nth(1).fill('H4');
            await panel.locator('.apply-btn').click();
            await expect(panel.locator('.tab-setup-error')).toContainText('String 2: "H4" is not a note');
            await panel.locator('.cancel-btn').click();
            await expect(panel).toBeHidden();
            expect((await doc(page)).tracks[0].tuning[1]).toBe('B3');
        });

        test('Tab setup on an opened .tef starts from the file\'s own values', async ({ page }) => {
            await gotoFrontDoor(page);
            await chooseFile(page, page.locator('.tab-open-file'), tef.file);
            await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
            await expectEditorWithNotes(page);
            const panel = await openTabSetup(page);
            await expect(panel.locator('.tab-setup-title')).toHaveValue(tef.title);
            const track = (await doc(page)).tracks[0];
            await expect(panel.locator('.tab-setup-track legend')).toHaveText(`Track: ${track.id}`);
            await expect(panel.locator('.tab-setup-pitch')).toHaveCount(track.tuning.length);
            await expect(panel.locator('.tab-setup-keeps')).toBeVisible();
        });
    });

    test.describe('the title of a new tab', () => {
        test('a renamed new tab saves under its new title', async ({ page }) => {
            await openNewTab(page, 'title=Old%20Name&instrument=banjo');
            await putNote(page, { string: 2, fret: 3 });
            await page.locator('#new-tab-title').fill('Fresh Name');
            await page.locator('#new-tab-title').press('Enter');
            expect((await doc(page)).metadata.title).toBe('Fresh Name');

            const download = await saveAs(page, { format: 'otf' });
            const saved = JSON.parse(readFileSync(await download.path(), 'utf-8'));
            expect(saved.metadata.title).toBe('Fresh Name');

            const tefDownload = await saveAs(page, { format: 'tef' });
            const [chooser] = await Promise.all([
                page.waitForEvent('filechooser'),
                clickFileItem(page, 'Open…'),
            ]);
            await chooser.setFiles(await asFile(tefDownload));
            await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
            await expectEditorWithNotes(page);
            expect((await doc(page)).metadata.title).toBe('Fresh Name');
        });

        test('the title in Tab setup updates the box, and the box updates Tab setup', async ({ page }) => {
            await openNewTab(page, 'title=Old%20Name&instrument=banjo');
            let panel = await openTabSetup(page);
            await expect(panel.locator('.tab-setup-title')).toHaveValue('Old Name');
            await panel.locator('.tab-setup-title').fill('From Setup');
            await panel.locator('.apply-btn').click();
            await expect(page.locator('#new-tab-title')).toHaveValue('From Setup');

            await page.locator('#new-tab-title').fill('Typed Last');
            await page.locator('#new-tab-title').press('Enter');
            panel = await openTabSetup(page);
            await expect(panel.locator('.tab-setup-title')).toHaveValue('Typed Last');
            await panel.locator('.cancel-btn').click();

            // undo puts the earlier title back in the box
            await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
            await page.keyboard.press('Control+z');
            await expect(page.locator('#new-tab-title')).toHaveValue('From Setup');
        });
    });

    test.describe('the front door\'s time signature', () => {
        test('Start a new tab in 3/4 opens a tab with three-beat bars', async ({ page }) => {
            await gotoFrontDoor(page);
            await expect(page.locator('.tab-home-time')).toHaveValue('4/4');
            await page.locator('.tab-home-title').fill('Waltz Time');
            await page.locator('.tab-home-time').selectOption('3/4');
            await page.locator('.tab-home-new button[type="submit"]').click();
            await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
            const made = await doc(page);
            expect(made.metadata).toMatchObject({ title: 'Waltz Time', time_signature: '3/4' });
            const bar = await page.evaluate(() => document.querySelector('.otf-editor').__otfEditor.state.facade.ticksFor(1));
            expect(bar).toBe(1440);

            // Tab setup shows what the front door chose
            const panel = await openTabSetup(page);
            await expect(panel.locator('.tab-setup-time')).toHaveValue('3/4');
        });

        test('left alone it is 4/4', async ({ page }) => {
            await gotoFrontDoor(page);
            await page.locator('.tab-home-new button[type="submit"]').click();
            await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
            expect((await doc(page)).metadata.time_signature).toBe('4/4');
        });
    });
}
