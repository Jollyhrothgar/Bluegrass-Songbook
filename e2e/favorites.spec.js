// E2E tests for favorites and lists functionality
import { test, expect } from '@playwright/test';

// Helper to open sidebar (required before clicking nav items)
async function openSidebar(page) {
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
}

test.describe('Favorites', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage before each test
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.removeItem('songbook-favorites');
        });
        await page.reload();
        await page.waitForSelector('#search-input');
    });

    test('favorites view shows empty state initially', async ({ page }) => {
        await openSidebar(page);
        await page.locator('#nav-favorites').click();

        // Empty favorites shows "0 favorites"
        await expect(page.locator('#search-stats')).toContainText('0 favorites');
    });

    test('adding song to favorites works', async ({ page }) => {
        // Search for a song
        await page.fill('#search-input', 'blue moon');
        await page.waitForTimeout(300);

        // Click the list button
        await page.locator('.result-list-btn').first().click();

        // List picker should show (floating picker element)
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Click favorites checkbox in the picker
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites via sidebar
        await openSidebar(page);
        await page.locator('#nav-favorites').click();

        // Should have 1 favorite (text format: "Favorites: 1 song")
        await expect(page.locator('#search-stats')).toContainText('1 song');
    });

    test('favorites persist across page reload', async ({ page }) => {
        // Add a favorite
        await page.fill('#search-input', 'foggy mountain');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Wait for the favorite to be saved (badge should update)
        await expect(page.locator('#nav-favorites-count')).toHaveText('1');

        // Reload page
        await page.reload();
        await page.waitForSelector('#search-input');

        // Navigate to favorites via sidebar
        await openSidebar(page);
        await page.locator('#nav-favorites').click();

        // Favorite should still be there
        await expect(page.locator('#search-stats')).toContainText('1 song');
    });

    test('removing from favorites works', async ({ page }) => {
        // Add a favorite first
        await page.fill('#search-input', 'wagon wheel');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Go to favorites via sidebar
        await openSidebar(page);
        await page.locator('#nav-favorites').click();
        await expect(page.locator('#search-stats')).toContainText('1 song');

        // Open list picker on the favorite
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Uncheck favorites - the checkbox should be checked, click to uncheck
        const checkbox = page.locator('.list-picker-popup .favorites-option input');
        await checkbox.click();

        // Wait for state update
        await page.waitForTimeout(500);

        // Verify item was removed - should show 0
        await expect(page.locator('#search-stats')).toContainText(/0 (favorites|songs)/);
    });

    test('favorites count badge updates', async ({ page }) => {
        const badge = page.locator('#nav-favorites-count');

        // Initially hidden or shows 0

        // Add a favorite
        await page.fill('#search-input', 'cripple creek');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Badge should show 1
        await expect(badge).toHaveText('1');

        // Add another
        await page.fill('#search-input', 'john henry');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Badge should show 2
        await expect(badge).toHaveText('2');
    });
});

test.describe('Lists', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.reload();
        await page.waitForSelector('#search-input');
    });

    test('list picker shows favorites option', async ({ page }) => {
        await page.fill('#search-input', 'test');
        await page.waitForTimeout(300);

        await page.locator('.result-list-btn').first().click();

        await expect(page.locator('.list-picker-popup')).toBeVisible();
        // Should have favorites option in the picker
        await expect(page.locator('.list-picker-popup .favorites-option')).toBeVisible();
    });

    test('can add song to favorites from result', async ({ page }) => {
        await page.fill('#search-input', 'mountain');
        await page.waitForTimeout(300);

        // Click list button
        await page.locator('.result-list-btn').first().click();

        // Click favorites checkbox
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Button should now show checked state
        await expect(page.locator('.result-list-btn').first()).toHaveClass(/has-lists/);
    });
});

test.describe('Song in Favorites', () => {
    test('result item shows favorite indicator', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#search-input');

        // Add a favorite
        await page.fill('#search-input', 'salty dog');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Close picker by clicking elsewhere
        await page.locator('#search-input').click();

        // Result should have is-favorite class
        await expect(page.locator('.result-item').first()).toHaveClass(/is-favorite/);
    });
});
