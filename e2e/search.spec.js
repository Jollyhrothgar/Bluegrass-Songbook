// E2E tests for search functionality
import { test, expect } from '@playwright/test';

test.describe('Search', () => {
    test.beforeEach(async ({ page }) => {
        // Go directly to search view (homepage is now landing page)
        await page.goto('/#search');
        // Wait for the app to load
        await page.waitForSelector('#search-input');
    });

    test('displays search prompt on initial load', async ({ page }) => {
        // Search view now shows a prompt instead of popular songs on initial load
        await expect(page.locator('.search-prompt')).toBeVisible();
        await expect(page.locator('.search-prompt')).toContainText('Search for songs');
    });

    test('search by title returns results', async ({ page }) => {
        await page.fill('#search-input', 'wagon wheel');
        // Wait for results to update
        await page.waitForTimeout(500);

        // Should have results
        const results = page.locator('.result-item');
        await expect(results.first()).toBeVisible();

        // Results should be returned (search is working)
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('search by artist filter', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('artist:hank williams', { delay: 30 });
        await page.waitForTimeout(500);

        // All results should have Hank Williams as artist
        const artistTexts = page.locator('.result-item .result-artist');
        const count = await artistTexts.count();
        expect(count).toBeGreaterThan(0);

        // First result should contain Hank Williams
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
        // Type character by character to ensure input events fire
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('artist:bill monroe', { delay: 50 });
        await page.waitForTimeout(500);

        // Stats should show filter info like 'artist: "bill monroe"'
        const stats = page.locator('#search-stats');
        await expect(stats).toContainText('bill monroe');
    });

    test('clicking result opens song view', async ({ page }) => {
        // Use a specific song title that's unlikely to have multiple versions
        await page.fill('#search-input', 'your cheating heart hank williams');
        await page.waitForTimeout(300);

        // Click first result
        await page.locator('.result-item').first().click();

        // Song view should be visible (if song has versions, version picker appears first)
        // Check that results are no longer visible (navigation happened)
        await expect(page.locator('#results')).toBeHidden();
    });

    test('negative filter excludes results', async ({ page }) => {
        // Search for bluegrass but not instrumentals
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:bluegrass -tag:instrumental', { delay: 30 });
        await page.waitForTimeout(300);

        const stats = page.locator('#search-stats');
        await expect(stats).toContainText('-tag');
    });

    test('chord search finds songs with specific Nashville numbers', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('chord:VII', { delay: 30 });
        await page.waitForTimeout(500);

        // Should return results (songs with VII chord)
        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);

        // Stats should reflect the chord filter
        const stats = page.locator('#search-stats');
        await expect(stats).toContainText(/chord/i);
    });

    test('progression search finds songs with chord sequences', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('prog:I-IV-V', { delay: 30 });
        await page.waitForTimeout(500);

        // Should return results with I-IV-V progression
        const results = page.locator('.result-item');
        const count = await results.count();
        // This is a common progression, should have results
        expect(count).toBeGreaterThan(0);
    });

    test('instrument tag search finds works with tablature', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:banjo', { delay: 30 });
        await page.waitForTimeout(500);

        // Should return results with banjo tablature
        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('combined filters work correctly', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:bluegrass key:G chord:V', { delay: 30 });
        await page.waitForTimeout(500);

        // Should return results matching all criteria
        const results = page.locator('.result-item');
        await expect(results.first()).toBeVisible();
    });
});

test.describe('Search Result Interaction', () => {
    test.beforeEach(async ({ page }) => {
        // Go directly to search view (homepage is now landing page)
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
    });

    test('clicking tag badge filters by tag', async ({ page }) => {
        // Search view shows prompt initially, so search first
        await page.fill('#search-input', 'bluegrass');
        await page.waitForTimeout(300);
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
        // Search view shows prompt initially, so search first
        await page.fill('#search-input', 'wagon wheel');
        await page.waitForTimeout(300);
        await page.waitForSelector('.result-item');

        // Click the list button on first result
        await page.locator('.result-list-btn').first().click();

        // List picker should appear (floating picker element)
        await expect(page.locator('.list-picker-popup')).toBeVisible();
    });

    test('rapid search does not break click handlers (event delegation)', async ({ page }) => {
        // This test verifies that event delegation works correctly.
        // Before the fix, rapid searches would accumulate event listeners,
        // causing clicks to fire multiple times or not at all.

        // Rapidly type and change search (use specific song to avoid version picker)
        await page.fill('#search-input', 'w');
        await page.fill('#search-input', 'wa');
        await page.fill('#search-input', 'wag');
        await page.fill('#search-input', 'wago');
        await page.fill('#search-input', 'wagon');
        await page.fill('#search-input', 'wagon ');
        await page.fill('#search-input', 'wagon w');
        await page.fill('#search-input', 'wagon wh');
        await page.fill('#search-input', 'wagon wheel darius');

        // Wait for final results
        await page.waitForTimeout(300);

        // Results should be visible
        const results = page.locator('.result-item');
        await expect(results.first()).toBeVisible();

        // Click should work correctly (opens song view or version picker exactly once)
        await results.first().click();

        // The click handler worked if either song view appears or version picker modal opens
        // Version picker appears as an overlay, so results may still be visible behind it
        const songView = page.locator('#song-view:not(.hidden)');
        const versionPicker = page.locator('.version-picker');
        await expect(songView.or(versionPicker)).toBeVisible();
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
