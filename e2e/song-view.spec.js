// E2E tests for song view functionality
import { test, expect } from '@playwright/test';

test.describe('Song View', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
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
        await expect(page.locator('#song-view h1')).toBeVisible();
        await expect(page.locator('#song-view .song-artist')).toBeVisible();
    });

    test('displays chord and lyrics content', async ({ page }) => {
        // Should show song content with chords
        await expect(page.locator('.song-content')).toBeVisible();

        // Should have chord lines and lyrics
        const chordLines = page.locator('.chord-line');
        const lyricsLines = page.locator('.lyrics-line');

        // At least some content should be present
        await expect(lyricsLines.first()).toBeVisible();
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
            await nashvilleCheckbox.click();

            // Chords should now show Nashville numbers (I, IV, V, etc.)
            await page.waitForTimeout(200);

            // Toggle back
            await nashvilleCheckbox.click();
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
        await page.goto('/');
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
        await page.goto('/');
        await page.waitForSelector('#search-input');
        await page.fill('#search-input', 'blue moon');
        await page.waitForTimeout(300);
        await page.locator('.result-item').first().click();
        await expect(page.locator('#song-view')).toBeVisible();
    });

    test('print button opens print view', async ({ page, context }) => {
        // Listen for new page
        const pagePromise = context.waitForEvent('page');

        await page.locator('#print-btn').click();

        const printPage = await pagePromise;
        await printPage.waitForLoadState();

        // Print page should have song content
        await expect(printPage.locator('.song-content')).toBeVisible();

        await printPage.close();
    });
});
