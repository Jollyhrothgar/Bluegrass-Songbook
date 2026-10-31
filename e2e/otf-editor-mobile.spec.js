// The tab editor on a phone (390x844 — the `mobile` project in
// playwright.config.js).
//
// The phone layouts are not a courtesy: they are where the band collapses to
// ⚙, where the editor's menu bar collapses to ☰, and where a control that
// went missing is simply gone with no second place to look. All three were
// untestable until the suite had a phone project, which is the same defect
// as an untestable native dialog — a surface a human can reach and a test
// can't.
//
// No audio assertions (WebAudioFont's CDN is blocked in the sandbox) and no
// submission here — submissions live in otf-editor-submit.spec.js, which
// needs the Supabase mock.
import { test, expect } from './fixtures.js';
import { clickFileItem } from './helpers/front-door.js';
import { pressTabEdit } from './helpers/tab-edit.js';

/** A tab-only work: the band is the tablature band from the first paint. */
const TAB_WORK = '/#work/foggy-mountain-breakdown/mandolin';

const band = (page) => page.locator('#app-bottomband');

async function openTab(page) {
    await page.goto(TAB_WORK);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
    await expect(band(page).locator('.tab-play-btn')).toBeVisible();
}

/** Open the ⚙ sheet and return it. */
async function openSheet(page) {
    const more = band(page).locator('.tab-more-btn');
    await expect(more).toBeVisible();
    await more.click();
    const sheet = band(page).locator('.tab-settings-sheet');
    await expect(sheet).toBeVisible();
    return sheet;
}

/** Read a tab, then press ✏️ Edit (the top band's, the same on a phone). */
async function enterEditMode(page) {
    await pressTabEdit(page, { waitForEditor: true });
}

test.describe('phone: the read band', () => {
    test('collapses to ⚙, and the sheet holds what the band gave up', async ({ page }) => {
        await openTab(page);

        // Performance controls stay on the band…
        await expect(band(page).locator('.tab-play-btn')).toBeVisible();
        await expect(band(page).locator('.tab-stop-btn')).toBeVisible();
        await expect(band(page).locator('.tab-tempo-display')).toBeVisible();

        // …everything else moved behind ⚙, and the band says so in the DOM
        // (tab-controls-sheet.js publishes the decision it made).
        await expect(band(page).locator('.tab-controls'))
            .toHaveClass(/is-narrow-band/);
        await expect(band(page).locator('.tab-settings-sheet')).toBeHidden();

        const sheet = await openSheet(page);
        await expect(sheet.locator('.tab-size-group')).toBeVisible();
        const labels = await sheet.locator('.tab-sheet-row:visible .tab-sheet-label')
            .allTextContents();
        // Edit left the sheet: it is the top band's now
        expect(labels).not.toContain('Tab');
        await expect(sheet.locator('.tab-edit-btn')).toHaveCount(0);
    });

    test('the sheet closes on Escape and on an outside tap', async ({ page }) => {
        await openTab(page);
        await openSheet(page);
        await page.keyboard.press('Escape');
        await expect(band(page).locator('.tab-settings-sheet')).toBeHidden();

        await openSheet(page);
        await page.locator('.song-title').click();
        await expect(band(page).locator('.tab-settings-sheet')).toBeHidden();
    });
});

test.describe('phone: the edit session', () => {
    test('Edit opens the editor and its buttons stay ON the band', async ({ page }) => {
        await openTab(page);
        await enterEditMode(page);

        // §9.1: the session's buttons sit at BAND level, after Stop —
        // Submit / Done behind a disclosure is not a thing anyone would find.
        // G17: those two are all the bar holds; Download / Cancel / Import
        // are File menu commands (below), so nothing is cut off.
        const actions = band(page).locator('.tab-edit-actions');
        await expect(actions).toBeVisible();
        await expect(actions.locator('.tab-edit-submit')).toBeVisible();
        await expect(actions.locator('.tab-edit-done')).toBeVisible();
        await expect(actions.locator('button')).toHaveCount(2);
        await expect(actions.locator('.tab-edit-cancel')).toHaveCount(0);
        await expect(actions.locator('.tab-edit-download')).toHaveCount(0);

        // and the band kept its transport rather than being replaced
        await expect(band(page).locator('.tab-play-btn')).toBeVisible();
        await expect(page.locator('#edit-song-btn')).toBeHidden();
    });

    test('the menu bar collapses to ☰ and the sheet lists every menu', async ({ page }) => {
        await openTab(page);
        await enterEditMode(page);

        const bar = page.locator('.otf-menu-bar');
        await expect(bar).toHaveClass(/is-narrow/);
        const hamburger = bar.locator('.menu-hamburger');
        await expect(hamburger).toBeVisible();
        await expect(hamburger).toHaveText('☰');

        await hamburger.click();
        const popup = page.locator('.menu-popup');
        await expect(popup).toBeVisible();
        const text = await popup.textContent();
        for (const menu of ['File', 'Edit', 'Note', 'Play', 'Score', 'View', 'Help']) {
            expect(text).toContain(menu);
        }

        // G17: the sections fold under their headings, File open to start,
        // and the key column is hidden (a phone has no keyboard).
        await expect(popup.locator('.menu-sheet-head[data-menu="file"]'))
            .toHaveAttribute('aria-expanded', 'true');
        await expect(popup.locator('.menu-sheet-head[data-menu="edit"]'))
            .toHaveAttribute('aria-expanded', 'false');
        await expect(popup.locator('.menu-item', { hasText: 'Delete note' })).toHaveCount(0);
        await expect(popup.locator('.menu-item', { hasText: 'Save as' })).toBeVisible();
        await expect(popup.locator('.menu-item-key').first()).toBeHidden();
    });

    test('Delete note and Rest are reachable by touch from ☰', async ({ page }) => {
        // a new take is empty, so the count is the answer
        await page.goto('/index.html#new-tab?title=Touch&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await page.locator('.editor-canvas-container').click({ position: { x: 80, y: 50 } });
        await page.keyboard.press('5');
        const notes = page.locator('.editor-renderer .note-text');
        await expect(notes).toHaveCount(1);

        // Rest (Note ▸): steps the cursor on without writing a note
        await page.locator('.menu-hamburger').click();
        await page.locator('.menu-sheet-head[data-menu="note"]').click();
        const rest = page.locator('.menu-popup .menu-item', { hasText: 'Rest' });
        await expect(rest).toBeVisible();
        await rest.click();
        await expect(page.locator('.menu-popup')).toBeHidden();
        await expect(notes).toHaveCount(1);

        // Delete note (Edit ▸): tap the note, then delete it with no keyboard
        await notes.first().click();
        await page.locator('.menu-hamburger').click();
        await page.locator('.menu-sheet-head[data-menu="edit"]').click();
        await page.locator('.menu-popup .menu-item', { hasText: 'Delete note' }).click();
        await expect(notes).toHaveCount(0);
    });

    test('the toolbar is ONE slim row: undo, redo, note length, tie', async ({ page }) => {
        await openTab(page);
        await enterEditMode(page);
        const bar = page.locator('.otf-editor-toolbar');
        await expect(bar.locator('.undo-button')).toBeVisible();
        await expect(bar.locator('.redo-button')).toBeVisible();
        await expect(bar.locator('.length-picker-button')).toBeVisible();
        await expect(bar.locator('.articulation-button[data-action="effect.tie"]')).toBeVisible();
        for (const hidden of ['.grid-section', '.text-section', '.effects-button',
            '.duration-buttons', '.rest-button']) {
            await expect(bar.locator(hidden)).toBeHidden();
        }
        const box = await bar.boundingBox();
        expect(box.height).toBeLessThan(70);   // one row, not the ~290px stack

        // the active length stays visible, and the picker changes it
        const picker = bar.locator('.length-picker-button');
        await picker.click();
        await page.locator('.otf-length-popup .otf-fx-item', { hasText: /^1\/4$|^✓?\s*1\/4/ }).first().click();
        await expect(picker.locator('.length-picker-label')).toHaveText('1/4');
    });

    test('Help has one button: ☰ ▸ Help ▸ Keyboard shortcuts (no status-bar button)', async ({ page }) => {
        await openTab(page);
        await enterEditMode(page);

        // G17: the status bar's extra help button is gone, and the plain
        // "Press ? for help" hint is hidden where there is no keyboard.
        await expect(page.locator('.status-help-btn')).toHaveCount(0);
        await expect(page.locator('.status-hint')).toBeHidden();

        await page.locator('.menu-hamburger').click();
        await page.locator('.menu-sheet-head[data-menu="help"]').click();
        await page.locator('.menu-popup .menu-item', { hasText: 'Keyboard shortcuts' }).click();
        await expect(page.locator('.editor-help-overlay')).toBeVisible();

        await page.locator('.editor-help-close').first().click();
        await expect(page.locator('.editor-help-overlay')).toHaveCount(0);
    });

    test('typing digits still enters notes', async ({ page }) => {
        await openTab(page);
        await enterEditMode(page);

        // A phone has a soft keyboard, and the editor's canvas has to keep
        // accepting it: tapping places the cursor, a digit is a fret.
        await page.locator('.editor-canvas-container').click({ position: { x: 80, y: 50 } });
        const before = await page.locator('.editor-renderer .note-text').count();
        await page.keyboard.press('9');
        await expect(async () => {
            const frets = await page.locator('.editor-renderer .note-text')
                .allTextContents();
            expect(frets).toContain('9');
        }).toPass();
        expect(await page.locator('.editor-renderer .note-text').count())
            .toBe(before + 1);

        // …and it is a real edit, so undo takes it back off again.
        await page.keyboard.press('u');
        await expect(async () => {
            const frets = await page.locator('.editor-renderer .note-text')
                .allTextContents();
            expect(frets.length).toBe(before);
        }).toPass();
    });

    test('Cancel asks in the band, never in a native dialog', async ({ page }) => {
        const dialogs = [];
        page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });

        await openTab(page);
        await enterEditMode(page);
        await page.locator('.editor-canvas-container').click({ position: { x: 80, y: 50 } });
        await page.keyboard.press('7');

        // Cancel is a File menu command now; its question still lands in the
        // band, on screen, with both answers inside the viewport.
        await clickFileItem(page, 'Cancel');
        const ask = band(page).locator('.tab-edit-discard-confirm');
        await expect(ask).toBeVisible();
        await expect(ask).toContainText('Discard edits?');
        for (const answer of ['.tab-edit-discard-yes', '.tab-edit-discard-no']) {
            const box = await ask.locator(answer).boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(390);
        }
        expect(dialogs).toEqual([]);

        await ask.locator('.tab-edit-discard-no').click();
        await expect(ask).toHaveCount(0);
        await expect(band(page).locator('.tab-edit-done')).toBeVisible();

        await clickFileItem(page, 'Cancel');
        await band(page).locator('.tab-edit-discard-yes').click();
        // Back to reading: the top band has ✏️ Edit again.
        await expect(page.locator('#edit-song-btn')).toBeVisible();
        await expect(band(page).locator('.tab-edit-actions')).toHaveCount(0);
        expect(dialogs).toEqual([]);
    });
});

test.describe('phone: a new take', () => {
    test('the band fits 390px with no sideways scroll', async ({ page }) => {
        await page.goto('/index.html#new-tab?title=Fits&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        const b = band(page);
        await expect(b.locator('.tab-edit-submit')).toBeVisible();
        const sizes = await page.evaluate(() => {
            const strip = document.querySelector('#app-bottomband .tab-controls');
            const band = document.querySelector('#app-bottomband');
            return {
                strip: [strip.scrollWidth, strip.clientWidth],
                band: [band.scrollWidth, band.clientWidth],
                page: [document.documentElement.scrollWidth, innerWidth],
            };
        });
        expect(sizes.strip[0]).toBeLessThanOrEqual(sizes.strip[1]);
        expect(sizes.band[0]).toBeLessThanOrEqual(sizes.band[1]);
        expect(sizes.page[0]).toBeLessThanOrEqual(sizes.page[1]);
        // Submit is whole, inside the viewport
        const box = await b.locator('.tab-edit-submit').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
    });

    test('Import .tef… is reachable from ☰ (it left the band)', async ({ page }) => {
        await page.goto('/index.html#new-tab?title=Import&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await expect(band(page).locator('.tab-edit-import')).toHaveCount(0);
        await page.locator('.menu-hamburger').click();
        await expect(page.locator('.menu-popup .menu-item', { hasText: 'Import .tef' })).toBeVisible();
    });
});
