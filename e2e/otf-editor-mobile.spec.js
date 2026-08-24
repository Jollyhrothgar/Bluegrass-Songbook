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
import { test, expect } from '@playwright/test';

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

/** Read a tab, then press ✏️ Edit (which lives in the sheet on a phone). */
async function enterEditMode(page) {
    const sheet = await openSheet(page);
    await sheet.locator('.tab-edit-btn').click();
    await page.locator('.editor-renderer .stave-row').first()
        .waitFor({ timeout: 20000 });
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
        await expect(sheet.locator('.tab-edit-btn')).toBeVisible();
        await expect(sheet.locator('.tab-size-group')).toBeVisible();
        const labels = await sheet.locator('.tab-sheet-row:visible .tab-sheet-label')
            .allTextContents();
        expect(labels).toContain('Tab');
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

        // §9.1: the session's buttons take the ✏️ Edit slot at BAND level —
        // Submit / Cancel / Done behind a disclosure is not a thing anyone
        // would find.
        const actions = band(page).locator('.tab-edit-actions');
        await expect(actions).toBeVisible();
        await expect(actions.locator('.tab-edit-submit')).toBeVisible();
        await expect(actions.locator('.tab-edit-cancel')).toBeVisible();
        await expect(actions.locator('.tab-edit-done')).toBeVisible();
        await expect(actions.locator('.tab-edit-download')).toBeVisible();

        // and the band kept its transport rather than being replaced
        await expect(band(page).locator('.tab-play-btn')).toBeVisible();
        await expect(band(page).locator('.tab-edit-btn')).toHaveCount(0);
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
    });

    test('“Press ? for help” is a button, and it opens the overlay', async ({ page }) => {
        await openTab(page);
        await enterEditMode(page);

        // A touch user has no `?` key; the hint has to be tappable.
        const help = page.locator('.status-help-btn');
        await expect(help).toBeVisible();
        await help.click();
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

        await band(page).locator('.tab-edit-cancel').click();
        const ask = band(page).locator('.tab-edit-discard-confirm');
        await expect(ask).toBeVisible();
        await expect(ask).toContainText('Discard edits?');
        expect(dialogs).toEqual([]);

        await ask.locator('.tab-edit-discard-no').click();
        await expect(ask).toHaveCount(0);
        await expect(band(page).locator('.tab-edit-done')).toBeVisible();

        await band(page).locator('.tab-edit-cancel').click();
        await band(page).locator('.tab-edit-discard-yes').click();
        // Back to reading: the band has ✏️ Edit again (in the ⚙ sheet).
        await expect(band(page).locator('.tab-edit-actions')).toHaveCount(0);
        expect(dialogs).toEqual([]);
    });
});
