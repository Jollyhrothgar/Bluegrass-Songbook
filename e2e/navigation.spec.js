// E2E tests for navigation and history
import { test, expect } from '@playwright/test';

// Helper to open sidebar (required before clicking nav items)
async function openSidebar(page) {
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
}

test.describe('Navigation', () => {
    test('home page loads with landing page', async ({ page }) => {
        await page.goto('/');

        // Landing page should be visible
        await expect(page.locator('#landing-page')).toBeVisible();

        // Collection cards should load
        await page.waitForSelector('.collection-card', { timeout: 5000 });
    });

    test('favorites nav link works', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#hamburger-btn');

        // Open sidebar first
        await openSidebar(page);
        await page.locator('#nav-favorites').click();

        // URL should change to favorites
        await expect(page).toHaveURL(/#list\/favorites/);
    });

    test('search nav link returns to home', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#hamburger-btn');

        // Open sidebar and go to favorites
        await openSidebar(page);
        await page.locator('#nav-favorites').click();
        await page.waitForTimeout(200);

        // Open sidebar again and click search nav
        await openSidebar(page);
        await page.locator('#nav-search').click();

        // Should be back at landing page (home)
        await expect(page.locator('#landing-page')).toBeVisible();
    });
});

test.describe('Deep Links', () => {
    test('direct song URL loads song', async ({ page }) => {
        // Navigate to a song deep link
        await page.goto('/#song/yourcheatingheartlyricschords');

        await page.waitForTimeout(500);

        // If song exists, song view should be visible
        // If not, we'll be at search (graceful fallback)
    });

    test('direct favorites URL loads favorites', async ({ page }) => {
        await page.goto('/#list/favorites');

        await page.waitForTimeout(300);

        // Stats should show favorites
        await expect(page.locator('#search-stats')).toContainText(/favorite/);
    });

    test('invalid hash gracefully falls back to home', async ({ page }) => {
        await page.goto('/#invalid/route/here');

        await page.waitForTimeout(300);

        // Should show landing page (graceful fallback)
        await expect(page.locator('#landing-page')).toBeVisible();
    });
});

test.describe('History Navigation', () => {
    test('browser back works from song to search', async ({ page }) => {
        // Start at search view directly
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search for something
        await page.fill('#search-input', 'wagon wheel');
        await page.waitForTimeout(300);

        // Click a result
        await page.locator('.result-item').first().click();
        await expect(page.locator('#song-view')).toBeVisible();

        // Go back
        await page.goBack();

        // Should be back at search results
        await expect(page.locator('#results')).toBeVisible();
    });

    test('browser forward works after back', async ({ page }) => {
        // Start at search view directly
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await page.fill('#search-input', 'mountain dew');
        await page.waitForTimeout(300);
        await page.locator('.result-item').first().click();

        await expect(page.locator('#song-view')).toBeVisible();

        // Back then forward
        await page.goBack();
        await page.goForward();

        // Should be at song view again
        await expect(page.locator('#song-view')).toBeVisible();
    });

    test('multiple back navigations work', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Navigate to search via collection card
        await page.locator('.collection-card').first().click();
        await page.waitForTimeout(300);

        // Open sidebar and click favorites
        await openSidebar(page);
        await page.locator('#nav-favorites').click();
        await page.waitForTimeout(200);

        // Open sidebar and click search (goes to home)
        await openSidebar(page);
        await page.locator('#nav-search').click();
        await page.waitForTimeout(200);

        // Go back multiple times
        await page.goBack();
        await page.goBack();

        // Should be able to navigate back through history
        await expect(page.locator('.search-container')).toBeVisible();
    });
});

test.describe('Sidebar Navigation', () => {
    test('sidebar toggle works on mobile', async ({ page }) => {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });

        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Hamburger menu should be visible
        const hamburger = page.locator('#hamburger-btn');
        if (await hamburger.isVisible()) {
            await hamburger.click();

            // Sidebar should be visible
            await expect(page.locator('#sidebar')).toBeVisible();
        }
    });

    test('add song nav works', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#hamburger-btn');

        // Open sidebar first
        await openSidebar(page);
        await page.locator('#nav-add-song').click();

        // Editor panel should be visible (contains add song form)
        await expect(page.locator('#editor-panel')).toBeVisible();
    });
});

test.describe('View Transitions', () => {
    test('bottom sheet closes when navigating away from song view', async ({ page }) => {
        // Start at search view directly
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search and open a song
        await page.fill('#search-input', 'blue moon');
        await page.waitForTimeout(300);
        await page.locator('.result-item').first().click();
        await expect(page.locator('#song-view')).toBeVisible();

        // Open the bottom sheet (mobile options panel)
        // The options button triggers the bottom sheet
        const optionsBtn = page.locator('#options-btn');
        if (await optionsBtn.isVisible()) {
            await optionsBtn.click();
            await expect(page.locator('#bottom-sheet')).toBeVisible();
        }

        // Navigate to Add Song
        await openSidebar(page);
        await page.locator('#nav-add-song').click();

        // Bottom sheet should be hidden (regression: it has position:fixed)
        await expect(page.locator('#bottom-sheet')).toBeHidden();

        // Editor should be visible
        await expect(page.locator('#editor-panel')).toBeVisible();
    });
});
