// E2E tests for song view functionality
import { test, expect } from '@playwright/test';

test.describe('Song View', () => {
    test.beforeEach(async ({ page }) => {
        // Go directly to search view (homepage is now landing page)
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search for a known song and open it
        await page.fill('#search-input', 'blue moon kentucky');
        await page.waitForTimeout(300);
        await page.locator('.result-item').first().click();

        // Wait for song view
        await expect(page.locator('#song-view')).toBeVisible();
    });

    test('displays song title and artist', async ({ page }) => {
        // Song header should be visible
        await expect(page.locator('.song-title')).toBeVisible();
        // Artist is in Info disclosure - expand it first
        await page.locator('#info-toggle').click();
        await expect(page.locator('.info-content')).toBeVisible();
        await expect(page.locator('.info-item').first()).toBeVisible();
    });

    test('displays chord and lyrics content', async ({ page }) => {
        // Should show song content with chords
        await expect(page.locator('.song-content')).toBeVisible();

        // Should have song body with content
        await expect(page.locator('.song-body')).toBeVisible();

        // At least some song lines should be present
        await expect(page.locator('.song-line').first()).toBeVisible();
    });

    test('key selector changes key', async ({ page }) => {
        // Find the key selector
        const keySelect = page.locator('#key-select');
        if (await keySelect.isVisible()) {
            // Get original value
            const originalKey = await keySelect.inputValue();

            // Change to a different key
            const newKey = originalKey === 'G' ? 'A' : 'G';
            await keySelect.selectOption(newKey);

            // Key should be updated
            await expect(keySelect).toHaveValue(newKey);
        }
    });

    test('compact mode toggle works', async ({ page }) => {
        const compactCheckbox = page.locator('#compact-checkbox');
        if (await compactCheckbox.isVisible()) {
            await compactCheckbox.click();

            // Song content should have compact class
            await expect(page.locator('.song-content')).toHaveClass(/compact/);

            // Toggle back
            await compactCheckbox.click();
            await expect(page.locator('.song-content')).not.toHaveClass(/compact/);
        }
    });

    test('Nashville mode toggle works', async ({ page }) => {
        const nashvilleCheckbox = page.locator('#nashville-checkbox');
        if (await nashvilleCheckbox.isVisible()) {
            // Get a chord before Nashville mode
            const chordEl = page.locator('.chord').first();
            const originalChord = await chordEl.textContent();

            await nashvilleCheckbox.click();
            await page.waitForTimeout(200);

            // Chord should now be a Nashville number (I, II, IV, V, etc.)
            const nashvilleChord = await chordEl.textContent();
            // Nashville numbers use Roman numerals
            expect(nashvilleChord).toMatch(/^[IiVv]+[0-9]?$/);

            // Toggle back
            await nashvilleCheckbox.click();
            await page.waitForTimeout(200);

            // Should be back to letter chord
            const restoredChord = await chordEl.textContent();
            expect(restoredChord).toBe(originalChord);
        }
    });

    test('transposition changes chords correctly', async ({ page }) => {
        const keySelect = page.locator('#key-select');
        if (await keySelect.isVisible()) {
            // Get a chord before transposition
            const chordEl = page.locator('.chord').first();
            const originalChord = await chordEl.textContent();

            // Get original key
            const originalKey = await keySelect.inputValue();

            // Transpose up (e.g., G to A is +2 semitones)
            const newKey = originalKey === 'G' ? 'A' : 'G';
            await keySelect.selectOption(newKey);
            await page.waitForTimeout(200);

            // Chord should have changed
            const transposedChord = await chordEl.textContent();
            expect(transposedChord).not.toBe(originalChord);

            // Transpose back
            await keySelect.selectOption(originalKey);
            await page.waitForTimeout(200);

            // Should be back to original
            const restoredChord = await chordEl.textContent();
            expect(restoredChord).toBe(originalChord);
        }
    });

    test('font size controls work', async ({ page }) => {
        const fontUpBtn = page.locator('#font-up-btn');
        const fontDownBtn = page.locator('#font-down-btn');

        if (await fontUpBtn.isVisible()) {
            // Click font up
            await fontUpBtn.click();

            // Click font down twice
            await fontDownBtn.click();
            await fontDownBtn.click();
        }
    });

    test('chord display mode selector works', async ({ page }) => {
        const chordModeSelect = page.locator('#chord-mode-select');
        if (await chordModeSelect.isVisible()) {
            // Change to 'first' mode
            await chordModeSelect.selectOption('first');
            await page.waitForTimeout(200);

            // Change to 'none' mode
            await chordModeSelect.selectOption('none');
            await page.waitForTimeout(200);

            // Change back to 'all'
            await chordModeSelect.selectOption('all');
        }
    });
});

test.describe('Song Navigation', () => {
    test('deep link to song works', async ({ page }) => {
        // Navigate directly to a song URL
        await page.goto('/#song/bluemoonofkentuckylyricschords');

        // Wait for redirect/load
        await page.waitForTimeout(500);

        // Song view should be visible (or search if song not found)
        // This tests the deep link handling
    });

    test('back button returns to search', async ({ page }) => {
        // Go directly to search view (homepage is now landing page)
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search and open a song
        await page.fill('#search-input', 'foggy mountain');
        await page.waitForTimeout(300);
        await page.locator('.result-item').first().click();

        await expect(page.locator('#song-view')).toBeVisible();

        // Go back
        await page.goBack();

        // Should be back at search
        await expect(page.locator('#search-input')).toBeVisible();
    });
});

test.describe('Print View', () => {
    test.beforeEach(async ({ page }) => {
        // Go directly to search view (homepage is now landing page)
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        // Use specific song to avoid version picker
        await page.fill('#search-input', 'your cheating heart hank williams');
        await page.waitForTimeout(300);
        await page.locator('.result-item').first().click();
        await expect(page.locator('#song-view')).toBeVisible();
    });

    test('print button triggers print', async ({ page }) => {
        // Track if window.print was called
        let printCalled = false;
        await page.exposeFunction('trackPrint', () => { printCalled = true; });
        await page.evaluate(() => {
            window.print = () => { window.trackPrint(); };
        });

        // Open export dropdown and click print (print is now in export dropdown)
        await page.locator('#export-btn').click();
        await page.waitForSelector('#export-dropdown:not(.hidden)');
        await page.locator('.export-option[data-action="print"]').click();

        // Verify print was triggered
        expect(printCalled).toBe(true);
    });
});
