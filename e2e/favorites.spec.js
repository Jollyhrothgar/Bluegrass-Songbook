// E2E tests for favorites and lists. Navigation goes through the top-band
// Favorites link (.topbar-nav-link[data-nav="favorites"]) — the sidebar and
// its favorites-count badge are gone, so state is asserted via the result
// buttons (has-lists / is-favorite classes) and the favorites view itself.
import { test, expect } from '@playwright/test';
import { gotoSearch, searchFor, navClick } from './helpers.js';

test.describe('Favorites', () => {
    test.beforeEach(async ({ page }) => {
        // Clear localStorage before each test
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.removeItem('songbook-favorites');
        });
        await gotoSearch(page);
    });

    test('favorites view shows empty state initially', async ({ page }) => {
        await navClick(page, 'favorites');

        await expect(page.locator('#search-stats')).toContainText('0 favorites');
    });

    test('adding song to favorites works', async ({ page }) => {
        await searchFor(page, 'wagon wheel');

        // Click the list button
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Click favorites checkbox in the picker
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites via the top band
        await navClick(page, 'favorites');

        await expect(page.locator('#list-header-count')).toContainText('1 song');
    });

    test('favorites persist across page reload', async ({ page }) => {
        await searchFor(page, 'foggy mountain');
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // The result button reflects membership immediately
        await expect(page.locator('.result-list-btn').first()).toHaveClass(/has-lists/);

        // Reload and confirm the favorite survived
        await gotoSearch(page);
        await navClick(page, 'favorites');

        await expect(page.locator('#list-header-count')).toContainText('1 song');
    });

    test('removing from favorites works', async ({ page }) => {
        await searchFor(page, 'wagon wheel');
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Go to favorites
        await navClick(page, 'favorites');
        await expect(page.locator('#list-header-count')).toContainText('1 song');

        // Open list picker on the favorite and uncheck it
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await page.locator('.list-picker-popup .favorites-option input').click();

        await page.waitForTimeout(500);

        await expect(page.locator('#search-stats')).toContainText(/0 (favorites|songs)/);
    });

    test('multiple favorites all appear in the favorites view', async ({ page }) => {
        await searchFor(page, 'cripple creek');
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await page.locator('.list-picker-popup .favorites-option input').click();
        await expect(page.locator('.result-list-btn').first()).toHaveClass(/has-lists/);

        await searchFor(page, 'john henry');
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await page.locator('.list-picker-popup .favorites-option input').click();
        await expect(page.locator('.result-list-btn').first()).toHaveClass(/has-lists/);

        await navClick(page, 'favorites');
        await expect(page.locator('#list-header-count')).toContainText('2 songs');
        await expect(page.locator('.result-item')).toHaveCount(2);
    });
});

test.describe('Lists', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await gotoSearch(page);
    });

    test('list picker shows favorites option', async ({ page }) => {
        await searchFor(page, 'wagon wheel');

        await page.locator('.result-list-btn').first().click();

        await expect(page.locator('.list-picker-popup')).toBeVisible();
        await expect(page.locator('.list-picker-popup .favorites-option')).toBeVisible();
    });

    test('can add song to favorites from result', async ({ page }) => {
        await searchFor(page, 'mountain');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        await expect(page.locator('.result-list-btn').first()).toHaveClass(/has-lists/);
    });
});

test.describe('Song in Favorites', () => {
    test('result item shows favorite indicator', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await gotoSearch(page);

        await searchFor(page, 'salty dog');
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Close picker by clicking elsewhere
        await page.locator('#search-input').click();

        await expect(page.locator('.result-item').first()).toHaveClass(/is-favorite/);
    });
});
