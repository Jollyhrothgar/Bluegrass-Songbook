// E2E tests for the unified song page (work-view.js). Key, Size and Display
// are the reading dock in the bottom band (Key and Display open sheets);
// export actions live in the top band's ⋯ menu; song facts are the Details sheet.
import { test, expect } from './fixtures.js';
import { gotoSearch, searchAndOpen, openDock, openMenu, chords } from './helpers.js';

test.describe('Song View', () => {
    test.beforeEach(async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'old home place', /old home place/i);
    });

    test('displays song title and writer line, no artist (F9)', async ({ page }) => {
        await expect(page.locator('.song-title')).toBeVisible();
        await expect(page.locator('.song-title')).toContainText(/old home place/i);
        await expect(page.locator('.song-writer-line')).toContainText(/Written by Dean Webb/);
        await expect(page.locator('.song-header')).not.toContainText(/New South/);
    });

    test('the writer line opens Details: song facts and tags', async ({ page }) => {
        await page.locator('#song-details-btn').click();
        const sheet = page.locator('#song-details-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.info-item').first()).toBeVisible();
        await expect(sheet.locator('.info-tags')).toBeVisible();
        await expect(page.locator('#info-pill')).toHaveCount(0);   // the Info pill is gone
    });

    test('displays chord and lyrics content', async ({ page }) => {
        await expect(page.locator('.song-content')).toBeVisible();
        await expect(page.locator('.song-body')).toBeVisible();
        await expect(page.locator('.song-line').first()).toBeVisible();
        await expect(chords(page).first()).toBeVisible();
    });

    test('the dock\'s Key shows the detected key and transposes chords', async ({ page }) => {
        const label = page.locator('#dock-key-btn');
        await expect(label).toContainText(/Key: [A-G]/);

        const originalChord = await chords(page).first().textContent();

        const popover = await openDock(page, 'key');
        // Pick a key different from the current one
        const currentKey = (await popover.locator('.pill-current-key').textContent())?.trim();
        const newKey = currentKey === 'A' ? 'G' : 'A';
        await popover.locator(`.pill-key-btn[data-key="${newKey}"]`).click();

        await expect(label).toContainText(`Key: ${newKey}`);
        // Re-render is reactive — toHaveText retries until it settles
        await expect(chords(page).first()).not.toHaveText(originalChord);

        // Transpose back to the original key restores the chord
        await popover.locator(`.pill-key-btn[data-key="${currentKey}"]`).click();
        await expect(label).toContainText(`Key: ${currentKey}`);
        await expect(chords(page).first()).toHaveText(originalChord);
    });

    test('semitone +/- buttons in the Key sheet step the key', async ({ page }) => {
        const popover = await openDock(page, 'key');
        const currentKeyEl = popover.locator('.pill-current-key');
        const before = (await currentKeyEl.textContent())?.trim();

        await popover.locator('[data-transpose="1"]').click();
        const up = (await currentKeyEl.textContent())?.trim();
        expect(up).not.toBe(before);

        await popover.locator('[data-transpose="-1"]').click();
        const back = (await currentKeyEl.textContent())?.trim();
        expect(back).toBe(before);
    });

    test('Nashville toggle in the Key sheet converts chords to numerals', async ({ page }) => {
        const chordEl = chords(page).first();
        const originalChord = await chordEl.textContent();

        const popover = await openDock(page, 'key');
        const nashBtn = popover.locator('.pill-nashville-btn');
        await nashBtn.click();
        await page.waitForTimeout(200);

        const nashvilleChord = await chordEl.textContent();
        expect(nashvilleChord).toMatch(/^[IiVv]+[0-9]?$/);

        await nashBtn.click();
        await page.waitForTimeout(200);
        expect(await chordEl.textContent()).toBe(originalChord);
    });

    test('chord display mode "none" hides chords (Display sheet)', async ({ page }) => {
        const popover = await openDock(page, 'display');
        const modeGroup = popover.locator('#pill-chord-mode');

        await modeGroup.locator('[data-mode="none"]').click();
        await page.waitForTimeout(200);
        await expect(chords(page)).toHaveCount(0);

        await modeGroup.locator('[data-mode="all"]').click();
        await page.waitForTimeout(200);
        expect(await chords(page).count()).toBeGreaterThan(0);
    });

    test('two-column toggle adds the layout class (Display sheet)', async ({ page }) => {
        const popover = await openDock(page, 'display');

        await popover.locator('#pill-twocol').click();
        await page.waitForTimeout(200);
        await expect(page.locator('.song-body')).toHaveClass(/two-column/);

        await popover.locator('#pill-twocol').click();
        await page.waitForTimeout(200);
        await expect(page.locator('.song-body')).not.toHaveClass(/two-column/);
    });

    test('Size in the dock changes the rendered size', async ({ page }) => {
        const body = page.locator('.song-body');
        await expect(body).toBeVisible();
        const initialSize = await body.evaluate(el => parseFloat(getComputedStyle(el).fontSize));

        const size = page.locator('#dock-size');
        await size.locator('[data-size="1"]').click();

        // The size change lands on a reactive re-render (state.js notifyChange
        // → work-view re-render), so poll rather than race a fixed timeout.
        await expect
            .poll(() => body.evaluate(el => parseFloat(getComputedStyle(el).fontSize)))
            .toBeGreaterThan(initialSize);

        await size.locator('[data-size="-1"]').click();
        await expect
            .poll(() => body.evaluate(el => parseFloat(getComputedStyle(el).fontSize)))
            .toBe(initialSize);
    });

    test('only one dock sheet is open at a time', async ({ page }) => {
        await openDock(page, 'key');
        await page.keyboard.press('Escape');
        await openDock(page, 'display');

        await expect(page.locator('#dock-display-sheet')).toBeVisible();
        await expect(page.locator('#dock-key-sheet')).toHaveCount(0);
    });
});

test.describe('Song Navigation', () => {
    test('deep link to song redirects to the song\'s path and renders', async ({ page }) => {
        await page.goto('/#song/blue-moon-of-kentucky-1');

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        // blue-moon-of-kentucky-1's song is named by its work.yaml `slug:`
        await expect(page).toHaveURL(/\/songs\/blue-moon-of-kentucky\/$/);
    });

    test('back button returns to search', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'foggy mountain');

        await page.goBack();

        await expect(page.locator('#search-input')).toBeVisible();
    });
});

test.describe('Print', () => {
    test('⋯ ▸ Export / Print ▸ Print triggers print', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'old home place', /old home place/i);

        // Track if window.print was called
        let printCalled = false;
        await page.exposeFunction('trackPrint', () => { printCalled = true; });
        await page.evaluate(() => {
            window.print = () => { window.trackPrint(); };
        });

        await openMenu(page, 'export-menu-btn');
        await page.locator('#topbar-overflow-menu [data-action="print"]').click();

        expect(printCalled).toBe(true);
    });
});
