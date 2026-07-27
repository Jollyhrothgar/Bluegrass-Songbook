// E2E tests for transposition on the unified song page. All key controls
// live in the Key pill (#key-pill): chromatic +/- steps, the key grid,
// and the Nashville toggle. The old #key-select dropdown and quick-controls
// bar are gone.
import { test, expect } from '@playwright/test';
import { gotoSearch, searchAndOpen, openPill, chords } from './helpers.js';

test.describe('Key Detection and Display', () => {
    test('song page shows detected key in the Key pill label', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        await expect(page.locator('#key-pill .pill-label')).toContainText(/Key of [A-G][#b]?m?/);
    });

    test('song found via key:G search shows key G', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'key:G');

        const popover = await openPill(page, 'key-pill');
        await expect(popover.locator('.pill-current-key')).toHaveText(/^G/);
    });
});

test.describe('Key Transposition', () => {
    test('picking a key in the grid transposes chords', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(chords(page).first()).toBeVisible({ timeout: 15000 });

        const chordEl = chords(page).first();
        const initialChord = await chordEl.textContent();

        const popover = await openPill(page, 'key-pill');
        const currentKey = (await popover.locator('.pill-current-key').textContent())?.trim();
        const targetKey = currentKey === 'D' ? 'E' : 'D';
        await popover.locator(`.pill-key-btn[data-key="${targetKey}"]`).click();
        await page.waitForTimeout(200);

        const newChord = await chordEl.textContent();
        expect(newChord.length).toBeGreaterThan(0);
        expect(newChord).not.toBe(initialChord);
    });

    test('transposition preserves chord quality (minor stays minor)', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'blue moon kentucky');

        const chordEls = chords(page);
        await expect(chordEls.first()).toBeVisible();
        const chordTexts = await chordEls.allTextContents();
        const hasMinorBefore = chordTexts.some(c => c.includes('m') && !c.includes('maj'));
        const has7Before = chordTexts.some(c => c.includes('7'));

        const popover = await openPill(page, 'key-pill');
        await popover.locator('[data-transpose="1"]').click();
        await page.waitForTimeout(300);

        const newChordTexts = await chordEls.allTextContents();
        if (hasMinorBefore) {
            expect(newChordTexts.some(c => c.includes('m') && !c.includes('maj'))).toBeTruthy();
        }
        if (has7Before) {
            expect(newChordTexts.some(c => c.includes('7'))).toBeTruthy();
        }
        // Something must have rendered either way
        expect(newChordTexts.length).toBeGreaterThan(0);
    });
});

test.describe('Nashville Numbers', () => {
    test('Nashville toggle converts chords to numerals for the key', async ({ page }) => {
        await page.goto('/#work/wagon-wheel');
        await expect(chords(page).first()).toBeVisible({ timeout: 15000 });

        const popover = await openPill(page, 'key-pill');
        await popover.locator('.pill-nashville-btn').click();
        await page.waitForTimeout(300);

        const chordTexts = await chords(page).allTextContents();
        expect(chordTexts.length).toBeGreaterThan(0);
        // Every displayed chord is a Roman-numeral form
        for (const c of chordTexts.slice(0, 10)) {
            expect(c).toMatch(/^[b#]?[IiVv]+/);
        }
    });

    test('Nashville mode toggles off correctly', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'cripple creek');

        const chordEl = chords(page).first();
        await expect(chordEl).toBeVisible();
        const original = await chordEl.textContent();

        const popover = await openPill(page, 'key-pill');
        const nashBtn = popover.locator('.pill-nashville-btn');

        await nashBtn.click();
        await page.waitForTimeout(300);
        expect(await chordEl.textContent()).not.toBe(original);

        await nashBtn.click();
        await page.waitForTimeout(300);
        expect(await chordEl.textContent()).toBe(original);
    });
});

test.describe('Transposition Edge Cases', () => {
    test('handles songs with slash chords', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'amazing grace');

        const popover = await openPill(page, 'key-pill');
        await popover.locator('[data-transpose="1"]').click();
        await page.waitForTimeout(300);

        // Song should still render after transposition
        await expect(page.locator('.song-body')).toBeVisible();
        expect(await chords(page).count()).toBeGreaterThan(0);
    });

    test('transposing through several keys keeps the page stable', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'salty dog blues');

        const popover = await openPill(page, 'key-pill');
        const keyButtons = popover.locator('.pill-key-btn');
        const count = Math.min(5, await keyButtons.count());

        for (let i = 0; i < count; i++) {
            await keyButtons.nth(i).click();
            await page.waitForTimeout(150);
            await expect(page.locator('.song-body')).toBeVisible();
        }
    });

    test('chromatic +/- steps land back where they started', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'john henry');

        const popover = await openPill(page, 'key-pill');
        const currentKeyEl = popover.locator('.pill-current-key');
        const start = (await currentKeyEl.textContent())?.trim();

        // Up two, down two
        await popover.locator('[data-transpose="1"]').click();
        await popover.locator('[data-transpose="1"]').click();
        await popover.locator('[data-transpose="-1"]').click();
        await popover.locator('[data-transpose="-1"]').click();

        expect((await currentKeyEl.textContent())?.trim()).toBe(start);
    });
});
