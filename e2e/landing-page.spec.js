// E2E tests for landing page / homepage
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
    test('landing page loads with collection cards', async ({ page }) => {
        await page.goto('/');

        // Landing page should be visible
        await expect(page.locator('#landing-page')).toBeVisible();

        // Collections grid should be visible
        await expect(page.locator('#collections-grid')).toBeVisible();

        // Should have collection cards (wait for them to load)
        await page.waitForSelector('.collection-card', { timeout: 5000 });
        const cards = page.locator('.collection-card');
        await expect(cards).toHaveCount(6); // 6 collections defined
    });

    test('collection cards have expected content', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Check for expected collection titles
        await expect(page.locator('.collection-card')).toContainText(['Bluegrass Standards']);
        await expect(page.locator('.collection-card')).toContainText(['Gospel Standards']);
        await expect(page.locator('.collection-card')).toContainText(['Fiddle Tunes']);
        await expect(page.locator('.collection-card')).toContainText(['Search All Songs']);
    });

    test('landing search input is visible', async ({ page }) => {
        await page.goto('/');

        // Landing search input should be visible
        await expect(page.locator('#landing-search-input')).toBeVisible();
    });

    test('bounty link is visible', async ({ page }) => {
        await page.goto('/');

        // Bounty link should be visible
        await expect(page.locator('.bounty-link')).toBeVisible();
        await expect(page.locator('.bounty-link')).toContainText('Help us grow');
    });
});

test.describe('Landing Page Search', () => {
    test('typing in landing search navigates to search view on Enter', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#landing-search-input');

        // Type a search query
        await page.fill('#landing-search-input', 'blue moon');
        await page.keyboard.press('Enter');

        // Should navigate to search view
        await expect(page.locator('.search-container')).toBeVisible();
        await expect(page.locator('#search-input')).toBeVisible();

        // Search input should have the query
        await expect(page.locator('#search-input')).toHaveValue('blue moon');

        // URL should reflect search state
        await expect(page).toHaveURL(/#search/);
    });

    test('landing search query shows results', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#landing-search-input');

        await page.fill('#landing-search-input', 'wagon wheel');
        await page.keyboard.press('Enter');

        // Results should be visible
        await expect(page.locator('#results')).toBeVisible();
        await page.waitForSelector('.result-item', { timeout: 3000 });
    });
});

test.describe('Collection Card Navigation', () => {
    test('clicking collection card navigates to search with filter', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Click on Bluegrass Standards card
        await page.locator('.collection-card').filter({ hasText: 'Bluegrass Standards' }).click();

        // Should navigate to search view
        await expect(page.locator('.search-container')).toBeVisible();

        // Search input should have the tag filter
        await expect(page.locator('#search-input')).toHaveValue(/tag:Bluegrass/i);

        // Results should be visible
        await expect(page.locator('#results')).toBeVisible();
    });

    test('Search All Songs card navigates to empty search', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Click on Search All Songs card
        await page.locator('.collection-card').filter({ hasText: 'Search All Songs' }).click();

        // Should navigate to search view
        await expect(page.locator('.search-container')).toBeVisible();

        // Search input should be empty or minimal
        await expect(page.locator('#search-input')).toHaveValue('');

        // Results should show popular songs
        await expect(page.locator('#results')).toBeVisible();
    });

    test('Gospel collection shows gospel songs', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Click on Gospel card
        await page.locator('.collection-card').filter({ hasText: 'Gospel Standards' }).click();

        // Search should have gospel tag
        await expect(page.locator('#search-input')).toHaveValue(/tag:Gospel/i);

        // Results should be visible
        await page.waitForSelector('.result-item', { timeout: 3000 });
    });
});

test.describe('URL Routing', () => {
    test('root URL shows landing page', async ({ page }) => {
        await page.goto('/');

        // Landing page should be visible
        await expect(page.locator('#landing-page')).toBeVisible();

        // Search container should be hidden
        await expect(page.locator('.search-container')).toBeHidden();
    });

    test('#home URL shows landing page', async ({ page }) => {
        await page.goto('/#home');

        await page.waitForTimeout(300);

        // Landing page should be visible
        await expect(page.locator('#landing-page')).toBeVisible();
    });

    test('#search URL shows search view', async ({ page }) => {
        await page.goto('/#search');

        await page.waitForTimeout(300);

        // Search container should be visible
        await expect(page.locator('.search-container')).toBeVisible();

        // Landing page should be hidden
        await expect(page.locator('#landing-page')).toBeHidden();
    });

    test('#search/query URL shows search with query', async ({ page }) => {
        await page.goto('/#search/tag:Bluegrass');

        await page.waitForTimeout(500);

        // Search container should be visible
        await expect(page.locator('.search-container')).toBeVisible();

        // Search input should have the query
        await expect(page.locator('#search-input')).toHaveValue('tag:Bluegrass');
    });

    test('refresh on search page stays on search', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Navigate to search
        await page.locator('.collection-card').filter({ hasText: 'Bluegrass Standards' }).click();
        await expect(page.locator('.search-container')).toBeVisible();

        // Refresh the page
        await page.reload();

        await page.waitForTimeout(500);

        // Should still be on search view (URL has #search)
        await expect(page.locator('.search-container')).toBeVisible();
    });
});

test.describe('Navigation Between Views', () => {
    test('can navigate from search back to home', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Navigate to search
        await page.locator('.collection-card').filter({ hasText: 'Gospel Standards' }).click();
        await expect(page.locator('.search-container')).toBeVisible();

        // Click logo or home link to go back
        await page.locator('.logo').click();

        // Should be back on landing page
        await expect(page.locator('#landing-page')).toBeVisible();
    });

    test('browser back from search returns to home', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Navigate to search
        await page.locator('.collection-card').filter({ hasText: 'Fiddle Tunes' }).click();
        await expect(page.locator('.search-container')).toBeVisible();

        // Go back
        await page.goBack();

        // Should be back on landing page
        await expect(page.locator('#landing-page')).toBeVisible();
    });

    test('can open song from collection and return', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Navigate to a collection
        await page.locator('.collection-card').filter({ hasText: 'Bluegrass Standards' }).click();
        await page.waitForSelector('.result-item', { timeout: 3000 });

        // Click a song
        await page.locator('.result-item').first().click();

        // Song view should be visible
        await expect(page.locator('#song-view')).toBeVisible();

        // Go back twice (song -> search -> home)
        await page.goBack();
        await expect(page.locator('.search-container')).toBeVisible();

        await page.goBack();
        await expect(page.locator('#landing-page')).toBeVisible();
    });
});

test.describe('Responsive Layout', () => {
    test('collection cards display correctly on mobile', async ({ page }) => {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });

        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Cards should still be visible
        const cards = page.locator('.collection-card');
        await expect(cards.first()).toBeVisible();
    });

    test('collection cards display correctly on desktop', async ({ page }) => {
        // Set desktop viewport
        await page.setViewportSize({ width: 1280, height: 800 });

        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Cards should be visible
        const cards = page.locator('.collection-card');
        await expect(cards).toHaveCount(6);
    });
});
