// Empty tracks, Delete track and Add track, driven through the real editor (G15c).
//
// FIXTURE: e2e/fixtures/14809_tef_red_haired_boy.tef is a frozen copy of
// sources/banjo-hangout/downloads/14809_tef_red_haired_boy.tef (Banjo Hangout
// tab 14809, copied 2026-10-29): a banjo track of 65 measures and a guitar
// track with NO notes, which imports with no `notation` key for the guitar.
//
// The document is read through the editor's debug handle
// (`.otf-editor.__otfEditor.state`), so a failure names the wrong field.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures.js';
import { gotoFrontDoor, chooseFile } from './helpers/front-door.js';

const here = dirname(fileURLToPath(import.meta.url));
const tef14809 = {
    name: '14809_tef_red_haired_boy.tef',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(resolve(here, 'fixtures/14809_tef_red_haired_boy.tef')),
};

const trackButtons = (page) => page.locator('.track-buttons .track-button');
const trackNames = (page) => trackButtons(page).allTextContents();
const popover = (page) => page.locator('.otf-track-overlay[style*="flex"] .otf-track-popover');

const doc = (page) => page.evaluate(() =>
    document.querySelector('.otf-editor').__otfEditor.state.facade.export());

async function openScore(page, label) {
    await page.locator('.otf-menu-bar .menu-trigger[data-menu="score"]').click();
    return page.locator('.menu-popup .menu-item', { hasText: label }).first();
}

async function openEmptyGuitarTake(page) {
    await gotoFrontDoor(page);
    await chooseFile(page, page.locator('.tab-open-file').first(), tef14809);
    await page.waitForURL(/#new-tab\?draft=/, { timeout: 20000 });
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
    await expect(trackButtons(page).filter({ hasText: 'guitar' })).toBeVisible();
}

test.describe('an empty track in a new take', () => {
    test('switch to the empty guitar track, type a fret, see the note', async ({ page }) => {
        await openEmptyGuitarTake(page);
        const before = await doc(page);
        expect(Object.keys(before.notation)).not.toContain('guitar');

        await trackButtons(page).filter({ hasText: 'guitar' }).click();
        await expect(page.locator('.track-button.active')).toHaveText('guitar');
        await expect(page.locator('.tablature-container, .editor-renderer')
            .first()).not.toContainText('No notation');
        await expect(page.locator('.editor-renderer .stave-row').first()).toBeVisible();
        // looking wrote nothing
        expect(Object.keys((await doc(page)).notation)).not.toContain('guitar');

        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('Control+Home');
        await page.keyboard.press('5');
        await expect(page.locator('.editor-renderer .note-text', { hasText: '5' }).first())
            .toBeVisible();
        const after = await doc(page);
        expect(after.notation.guitar.map(m => m.measure)).toEqual([1]);
    });

    test('Score ▸ Delete track… asks, deletes, updates TRACK, and Undo restores it', async ({ page }) => {
        await openEmptyGuitarTake(page);
        await trackButtons(page).filter({ hasText: 'guitar' }).click();
        const names = await trackNames(page);

        await (await openScore(page, 'Delete track…')).click();
        await expect(popover(page)).toContainText('Delete the guitar track');
        await expect(popover(page)).toContainText('no notes');
        await popover(page).locator('.confirm-btn').click();

        expect(await trackNames(page)).toEqual(names.filter(n => n !== 'guitar'));
        await expect(page.locator('.track-button.active')).toHaveText('banjo');

        await page.keyboard.press('Escape');
        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('u');
        expect(await trackNames(page)).toEqual(names);
    });

    test('Add track ▸ mandolin, type a note, Undo', async ({ page }) => {
        await openEmptyGuitarTake(page);
        const names = await trackNames(page);

        await (await openScore(page, 'Add track…')).click();
        await popover(page).locator('.track-add-instrument').selectOption('mandolin');
        await popover(page).locator('.confirm-btn').click();

        expect(await trackNames(page)).toEqual([...names, 'mandolin']);
        await expect(page.locator('.track-button.active')).toHaveText('mandolin');
        const added = (await doc(page)).tracks.at(-1);
        expect(added).toMatchObject({ id: 'mandolin', capo: 0, role: 'rhythm' });
        expect(Object.keys((await doc(page)).notation)).not.toContain('mandolin');

        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('Control+Home');
        await page.keyboard.press('3');
        await expect(page.locator('.editor-renderer .note-text', { hasText: '3' }).first())
            .toBeVisible();
        expect((await doc(page)).notation.mandolin).toHaveLength(1);

        await page.keyboard.press('u');   // the note
        await page.keyboard.press('u');   // the track
        expect(await trackNames(page)).toEqual(names);
    });
});

test.describe('a correction session', () => {
    test('cannot delete its own track, but can delete another', async ({ page }) => {
        await page.goto('/#work/red-haired-boy/ensemble-tab');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await page.locator('#app-bottomband .tab-edit-btn').click();
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });

        const own = (await page.locator('.track-button.active').textContent()).trim();
        const item = await openScore(page, 'Delete track…');
        await expect(item).toBeDisabled();
        await expect(item).toHaveAttribute('title', /correction/);

        await page.keyboard.press('Escape');
        const other = (await trackNames(page)).find(n => n !== own);
        await trackButtons(page).filter({ hasText: other }).first().click();
        const enabled = await openScore(page, 'Delete track…');
        await expect(enabled).toBeEnabled();
    });
});
