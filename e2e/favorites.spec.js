// E2E tests for favorites and lists functionality
import { test, expect } from '@playwright/test';

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
        await page.locator('#nav-favorites').click();

        await expect(page.locator('#search-stats')).toContainText('0 favorite');
    });

    test('adding song to favorites works', async ({ page }) => {
        // Search for a song
        await page.fill('#search-input', 'blue moon');
        await page.waitForTimeout(300);

        // Click the list button
        await page.locator('.result-list-btn').first().click();

        // List picker should show
        await expect(page.locator('#list-picker-dropdown')).toBeVisible();

        // Click favorites checkbox
        const favCheckbox = page.locator('.list-picker-item').first();
        await favCheckbox.click();

        // Navigate to favorites
        await page.locator('#nav-favorites').click();

        // Should have 1 favorite
        await expect(page.locator('#search-stats')).toContainText('1 favorite');
    });

    test('favorites persist across page reload', async ({ page }) => {
        // Add a favorite
        await page.fill('#search-input', 'foggy mountain');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-item').first().click();

        // Reload page
        await page.reload();
        await page.waitForSelector('#search-input');

        // Navigate to favorites
        await page.locator('#nav-favorites').click();

        // Favorite should still be there
        await expect(page.locator('#search-stats')).toContainText('1 favorite');
    });

    test('removing from favorites works', async ({ page }) => {
        // Add a favorite first
        await page.fill('#search-input', 'wagon wheel');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-item').first().click();

        // Go to favorites
        await page.locator('#nav-favorites').click();
        await expect(page.locator('#search-stats')).toContainText('1 favorite');

        // Open list picker on the favorite
        await page.locator('.result-list-btn').first().click();

        // Uncheck favorites
        await page.locator('.list-picker-item').first().click();

        // Should now be empty
        await expect(page.locator('#search-stats')).toContainText('0 favorite');
    });

    test('favorites count badge updates', async ({ page }) => {
        const badge = page.locator('#nav-favorites-count');

        // Initially hidden or shows 0

        // Add a favorite
        await page.fill('#search-input', 'cripple creek');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-item').first().click();

        // Badge should show 1
        await expect(badge).toHaveText('1');

        // Add another
        await page.fill('#search-input', 'john henry');
        await page.waitForTimeout(300);
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-item').first().click();

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

        await expect(page.locator('#list-picker-dropdown')).toBeVisible();
        // Should have favorites option
        await expect(page.locator('.list-picker-item')).toBeVisible();
    });

    test('can add song to favorites from result', async ({ page }) => {
        await page.fill('#search-input', 'mountain');
        await page.waitForTimeout(300);

        // Click list button
        await page.locator('.result-list-btn').first().click();

        // Click favorites item
        await page.locator('.list-picker-item').first().click();

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
        await page.locator('.list-picker-item').first().click();

        // Close picker by clicking elsewhere
        await page.locator('#search-input').click();

        // Result should have is-favorite class
        await expect(page.locator('.result-item').first()).toHaveClass(/is-favorite/);
    });
});
