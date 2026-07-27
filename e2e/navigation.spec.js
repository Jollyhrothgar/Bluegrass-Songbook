// E2E tests for navigation and history in the redesigned shell:
// the hamburger sidebar is gone — every view renders under the slim
// top band (#app-topbar) with nav links, and song URLs are unified on
// the #work/{slug} form (#song/{id} permanently redirects).
import { test, expect } from '@playwright/test';
import { gotoSearch, searchAndOpen, navClick } from './helpers.js';

test.describe('Top Band Navigation', () => {
    test('home page loads with landing page (logo hero lives only there)', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('#landing-page')).toBeVisible();
        await expect(page.locator('.landing-hero')).toBeVisible();

        // Collection cards should load
        await page.waitForSelector('.collection-card', { timeout: 5000 });
    });

    test('top band renders brand, nav links, theme and overflow', async ({ page }) => {
        await gotoSearch(page);

        await expect(page.locator('#app-topbar')).toBeVisible();
        await expect(page.locator('#topbar-brand')).toBeVisible();
        await expect(page.locator('.topbar-nav-link[data-nav="search"]')).toBeVisible();
        await expect(page.locator('.topbar-nav-link[data-nav="add"]')).toBeVisible();
        await expect(page.locator('.topbar-nav-link[data-nav="favorites"]')).toBeVisible();
        await expect(page.locator('.topbar-nav-link[data-nav="lists"]')).toBeVisible();
        await expect(page.locator('#topbar-theme')).toBeVisible();
        await expect(page.locator('#topbar-overflow-btn')).toBeVisible();
    });

    test('favorites nav link works', async ({ page }) => {
        await gotoSearch(page);

        await navClick(page, 'favorites');

        // URL should change to the favorites list
        await expect(page).toHaveURL(/#list\/favorites/);
        await expect(page.locator('#search-stats')).toContainText(/favorite/);
    });

    test('search nav link shows search view', async ({ page }) => {
        await gotoSearch(page);

        // Go to favorites, then back to search via the nav
        await navClick(page, 'favorites');
        await expect(page).toHaveURL(/#list\/favorites/);

        await navClick(page, 'search');

        await expect(page.locator('.search-container')).toBeVisible();
        await expect(page.locator('#search-input')).toBeVisible();
    });

    test('lists nav link opens the Song Lists view', async ({ page }) => {
        await gotoSearch(page);

        await navClick(page, 'lists');

        await expect(page.locator('#song-lists-view')).toBeVisible();
        await expect(page).toHaveURL(/#lists/);
    });

    test('add song nav opens the picker; Lyrics & Chords lands in the editor', async ({ page }) => {
        await gotoSearch(page);

        await navClick(page, 'add');

        // The top-band Add Song entry opens the add-song picker modal
        await expect(page.locator('#add-song-picker')).toBeVisible();

        // Choosing Lyrics & Chords goes to the new-song editor
        await page.locator('.picker-card[data-type="chordpro"]').click();
        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#editor-content')).toBeVisible();
    });

    test('brand link returns home', async ({ page }) => {
        await gotoSearch(page);

        await page.locator('#topbar-brand').click();

        await expect(page.locator('#landing-page')).toBeVisible();
        await expect(page.locator('.search-container')).toBeHidden();
    });
});

test.describe('Deep Links', () => {
    test('#song/{id} URL permanently redirects to #work/{slug}', async ({ page }) => {
        await page.goto('/#song/your-cheating-heart');

        // The song page renders and the URL is rewritten to the work form
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.song-title')).toContainText(/cheat/i);
        await expect(page).toHaveURL(/#work\/your-cheating-heart/);
    });

    test('legacy #song id resolves and redirects to the canonical slug', async ({ page }) => {
        await page.goto('/#song/bluemoonofkentuckylyricschords');

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        // URL must be the canonical work form, not the legacy song form
        await expect(page).toHaveURL(/#work\//);
        expect(page.url()).not.toContain('#song/');
    });

    test('direct favorites URL loads favorites', async ({ page }) => {
        await page.goto('/#list/favorites');

        // Stats should show favorites
        await expect(page.locator('#search-stats')).toContainText(/favorite/, { timeout: 15000 });
    });

    test('invalid hash gracefully falls back to home', async ({ page }) => {
        await page.goto('/#invalid/route/here');

        await page.waitForTimeout(300);

        await expect(page.locator('#landing-page')).toBeVisible();
    });
});

test.describe('History Navigation', () => {
    test('browser back works from song to search', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'your cheating heart hank williams');

        await page.goBack();

        await expect(page.locator('#results')).toBeVisible();
    });

    test('top-band back button returns from song to search', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'your cheating heart hank williams');

        // The song page shows the back arrow in the top band
        const backBtn = page.locator('#topbar-back');
        await expect(backBtn).toBeVisible();
        await backBtn.click();

        await expect(page.locator('#results')).toBeVisible();
    });

    test('browser forward works after back', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'mountain dew');

        await page.goBack();
        await page.goForward();

        await expect(page.locator('#song-view')).toBeVisible();
    });

    test('multiple back navigations work', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        // Navigate to search via collection card
        await page.locator('.collection-card').first().click();
        await page.waitForTimeout(300);

        // Nav to favorites, then search
        await navClick(page, 'favorites');
        await page.waitForTimeout(200);
        await navClick(page, 'search');
        await page.waitForTimeout(200);

        await page.goBack();
        await page.goBack();

        await expect(page.locator('.search-container')).toBeVisible();
    });
});

test.describe('Mobile Layout', () => {
    test('top band is present on mobile (no hamburger, no sidebar)', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });

        await page.goto('/');
        await page.waitForSelector('.collection-card', { timeout: 5000 });

        await expect(page.locator('#app-topbar')).toBeVisible();
        // The old drawer chrome must not exist at all
        await expect(page.locator('#hamburger-btn')).toHaveCount(0);
        await expect(page.locator('#sidebar')).toHaveCount(0);
    });
});
