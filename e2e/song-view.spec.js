// E2E tests for the unified song page (work-view.js). Transpose/display/
// info controls live in pill popovers on the #song-pill-row; export actions
// live in the top band's Export pill.
import { test, expect } from '@playwright/test';
import { gotoSearch, searchAndOpen, openPill, chords } from './helpers.js';

test.describe('Song View', () => {
    test.beforeEach(async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'your cheating heart', /your cheat/i);
    });

    test('displays song title and artist line', async ({ page }) => {
        await expect(page.locator('.song-title')).toBeVisible();
        await expect(page.locator('.song-title')).toContainText(/cheat/i);
        await expect(page.locator('.song-artist-line')).toBeVisible();
    });

    test('Info pill discloses song details and tags', async ({ page }) => {
        const popover = await openPill(page, 'info-pill');
        await expect(popover.locator('.info-item').first()).toBeVisible();
        await expect(popover.locator('.info-tags')).toBeVisible();
    });

    test('displays chord and lyrics content', async ({ page }) => {
        await expect(page.locator('.song-content')).toBeVisible();
        await expect(page.locator('.song-body')).toBeVisible();
        await expect(page.locator('.song-line').first()).toBeVisible();
        await expect(chords(page).first()).toBeVisible();
    });

    test('Key pill shows the detected key and transposes chords', async ({ page }) => {
        const label = page.locator('#key-pill .pill-label');
        await expect(label).toContainText(/Key of [A-G]/);

        const originalChord = await chords(page).first().textContent();

        const popover = await openPill(page, 'key-pill');
        // Pick a key different from the current one
        const currentKey = (await popover.locator('.pill-current-key').textContent())?.trim();
        const newKey = currentKey === 'A' ? 'G' : 'A';
        await popover.locator(`.pill-key-btn[data-key="${newKey}"]`).click();

        await expect(label).toContainText(`Key of ${newKey}`);
        // Re-render is reactive — toHaveText retries until it settles
        await expect(chords(page).first()).not.toHaveText(originalChord);

        // Transpose back to the original key restores the chord
        await popover.locator(`.pill-key-btn[data-key="${currentKey}"]`).click();
        await expect(label).toContainText(`Key of ${currentKey}`);
        await expect(chords(page).first()).toHaveText(originalChord);
    });

    test('semitone +/- buttons in the Key pill step the key', async ({ page }) => {
        const popover = await openPill(page, 'key-pill');
        const currentKeyEl = popover.locator('.pill-current-key');
        const before = (await currentKeyEl.textContent())?.trim();

        await popover.locator('[data-transpose="1"]').click();
        const up = (await currentKeyEl.textContent())?.trim();
        expect(up).not.toBe(before);

        await popover.locator('[data-transpose="-1"]').click();
        const back = (await currentKeyEl.textContent())?.trim();
        expect(back).toBe(before);
    });

    test('Nashville toggle in the Key pill converts chords to numerals', async ({ page }) => {
        const chordEl = chords(page).first();
        const originalChord = await chordEl.textContent();

        const popover = await openPill(page, 'key-pill');
        const nashBtn = popover.locator('.pill-nashville-btn');
        await nashBtn.click();
        await page.waitForTimeout(200);

        const nashvilleChord = await chordEl.textContent();
        expect(nashvilleChord).toMatch(/^[IiVv]+[0-9]?$/);

        await nashBtn.click();
        await page.waitForTimeout(200);
        expect(await chordEl.textContent()).toBe(originalChord);
    });

    test('chord display mode "none" hides chords (Display pill)', async ({ page }) => {
        const popover = await openPill(page, 'display-pill');
        const modeGroup = popover.locator('#pill-chord-mode');

        await modeGroup.locator('[data-mode="none"]').click();
        await page.waitForTimeout(200);
        await expect(chords(page)).toHaveCount(0);

        await modeGroup.locator('[data-mode="all"]').click();
        await page.waitForTimeout(200);
        expect(await chords(page).count()).toBeGreaterThan(0);
    });

    test('two-column toggle adds the layout class (Display pill)', async ({ page }) => {
        const popover = await openPill(page, 'display-pill');

        await popover.locator('#pill-twocol').click();
        await page.waitForTimeout(200);
        await expect(page.locator('.song-body')).toHaveClass(/two-column/);

        await popover.locator('#pill-twocol').click();
        await page.waitForTimeout(200);
        await expect(page.locator('.song-body')).not.toHaveClass(/two-column/);
    });

    test('font size controls change the rendered size (Display pill)', async ({ page }) => {
        const initialSize = await page.locator('.song-body')
            .evaluate(el => parseFloat(getComputedStyle(el).fontSize));

        const popover = await openPill(page, 'display-pill');
        await popover.locator('[data-size="1"]').click();
        await page.waitForTimeout(200);

        const newSize = await page.locator('.song-body')
            .evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(newSize).toBeGreaterThan(initialSize);

        await popover.locator('[data-size="-1"]').click();
    });

    test('only one pill popover is open at a time', async ({ page }) => {
        await openPill(page, 'key-pill');
        await openPill(page, 'display-pill');

        await expect(page.locator('#display-pill .pill-popover')).toBeVisible();
        await expect(page.locator('#key-pill .pill-popover')).toBeHidden();
    });
});

test.describe('Song Navigation', () => {
    test('deep link to song redirects to the work URL and renders', async ({ page }) => {
        await page.goto('/#song/blue-moon-of-kentucky-1');

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveURL(/#work\//);
    });

    test('back button returns to search', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'foggy mountain');

        await page.goBack();

        await expect(page.locator('#search-input')).toBeVisible();
    });
});

test.describe('Print', () => {
    test('Export pill print action triggers print', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'your cheating heart', /your cheat/i);

        // Track if window.print was called
        let printCalled = false;
        await page.exposeFunction('trackPrint', () => { printCalled = true; });
        await page.evaluate(() => {
            window.print = () => { window.trackPrint(); };
        });

        const popover = await openPill(page, 'export-pill');
        await popover.locator('[data-action="print"]').click();

        expect(printCalled).toBe(true);
    });
});
