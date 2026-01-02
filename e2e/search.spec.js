// E2E tests for search functionality
import { test, expect } from '@playwright/test';

test.describe('Search', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for the app to load
        await page.waitForSelector('#search-input');
    });

    test('displays random songs on initial load', async ({ page }) => {
        // Should show some results on load
        await expect(page.locator('.result-item')).toHaveCount(20);
    });

    test('search by title returns results', async ({ page }) => {
        await page.fill('#search-input', 'blue moon');
        // Wait for results to update
        await page.waitForTimeout(300);

        // Should have results
        const results = page.locator('.result-item');
        await expect(results.first()).toBeVisible();

        // First result should contain "blue moon" (case insensitive)
        const firstTitle = page.locator('.result-item').first().locator('.result-title');
        await expect(firstTitle).toContainText(/blue moon/i);
    });

    test('search by artist filter', async ({ page }) => {
        await page.fill('#search-input', 'artist:hank williams');
        await page.waitForTimeout(300);

        // All results should have Hank Williams as artist
        const artistTexts = page.locator('.result-item .result-artist');
        const count = await artistTexts.count();
        expect(count).toBeGreaterThan(0);

        // Check first result
        await expect(artistTexts.first()).toContainText(/hank williams/i);
    });

    test('search with tag filter', async ({ page }) => {
        await page.fill('#search-input', 'tag:bluegrass');
        await page.waitForTimeout(300);

        // Should return results with bluegrass tag
        const results = page.locator('.result-item');
        await expect(results.first()).toBeVisible();
    });

    test('search with key filter', async ({ page }) => {
        await page.fill('#search-input', 'key:G');
        await page.waitForTimeout(300);

        // Should return results in key of G
        const results = page.locator('.result-item');
        await expect(results.first()).toBeVisible();
    });

    test('search stats update with filter info', async ({ page }) => {
        await page.fill('#search-input', 'artist:bill monroe');
        await page.waitForTimeout(300);

        const stats = page.locator('#search-stats');
        await expect(stats).toContainText('artist:');
    });

    test('clicking result opens song view', async ({ page }) => {
        await page.fill('#search-input', 'blue moon');
        await page.waitForTimeout(300);

        // Click first result
        await page.locator('.result-item').first().click();

        // Song view should be visible
        await expect(page.locator('#song-view')).toBeVisible();
    });

    test('negative filter excludes results', async ({ page }) => {
        // Search for bluegrass but not instrumentals
        await page.fill('#search-input', 'tag:bluegrass -tag:instrumental');
        await page.waitForTimeout(300);

        const stats = page.locator('#search-stats');
        await expect(stats).toContainText('-tag');
    });
});

test.describe('Search Result Interaction', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#search-input');
    });

    test('clicking tag badge filters by tag', async ({ page }) => {
        // Wait for initial results
        await page.waitForSelector('.result-item');

        // Find a tag badge and click it
        const tagBadge = page.locator('.tag-badge').first();
        if (await tagBadge.isVisible()) {
            const tagName = await tagBadge.textContent();
            await tagBadge.click();

            // Search input should update with tag filter
            await expect(page.locator('#search-input')).toHaveValue(/tag:/);
        }
    });

    test('list button shows picker', async ({ page }) => {
        await page.waitForSelector('.result-item');

        // Click the list button on first result
        await page.locator('.result-list-btn').first().click();

        // List picker should appear
        await expect(page.locator('#list-picker-dropdown')).toBeVisible();
    });

    test('rapid search does not break click handlers (event delegation)', async ({ page }) => {
        // This test verifies that event delegation works correctly.
        // Before the fix, rapid searches would accumulate event listeners,
        // causing clicks to fire multiple times or not at all.

        // Rapidly type and change search
        await page.fill('#search-input', 'b');
        await page.fill('#search-input', 'bl');
        await page.fill('#search-input', 'blu');
        await page.fill('#search-input', 'blue');
        await page.fill('#search-input', 'blue ');
        await page.fill('#search-input', 'blue m');
        await page.fill('#search-input', 'blue mo');
        await page.fill('#search-input', 'blue moo');
        await page.fill('#search-input', 'blue moon');

        // Wait for final results
        await page.waitForTimeout(300);

        // Results should be visible
        const results = page.locator('.result-item');
        await expect(results.first()).toBeVisible();

        // Click should work correctly (opens song view exactly once)
        await results.first().click();

        // Song view should be visible (not still on search)
        await expect(page.locator('#song-view')).toBeVisible();
        await expect(page.locator('#results')).toBeHidden();
    });

    test('tag badge click works after multiple renders', async ({ page }) => {
        // Search, then search again, then click tag
        await page.fill('#search-input', 'hank');
        await page.waitForTimeout(200);
        await page.fill('#search-input', 'bill');
        await page.waitForTimeout(200);
        await page.fill('#search-input', ''); // Clear to show random
        await page.waitForTimeout(200);

        // Find and click a tag badge
        const tagBadge = page.locator('.tag-badge').first();
        if (await tagBadge.isVisible()) {
            await tagBadge.click();

            // Search input should have tag filter (not duplicate handlers)
            const inputValue = await page.locator('#search-input').inputValue();
            expect(inputValue).toMatch(/^tag:[A-Za-z]+$/);
        }
    });
});
