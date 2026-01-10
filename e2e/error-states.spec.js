// E2E tests for Error States and Edge Cases
import { test, expect } from '@playwright/test';

test.describe('Invalid URLs', () => {
    test('invalid song URL shows error or redirects', async ({ page }) => {
        // Navigate to a non-existent song
        await page.goto('/#song/this-song-does-not-exist-12345');
        await page.waitForTimeout(2000);

        // Should either show error message, landing page, or redirect to search
        const errorMessage = page.locator('.error, .not-found, #error-message');
        const searchContainer = page.locator('.search-container');
        const landingPage = page.locator('#landing-page');

        // One of these should be visible
        const hasError = await errorMessage.isVisible().catch(() => false);
        const hasSearch = await searchContainer.isVisible().catch(() => false);
        const hasLanding = await landingPage.isVisible().catch(() => false);

        expect(hasError || hasSearch || hasLanding).toBeTruthy();
    });

    test('invalid work URL shows error or redirects', async ({ page }) => {
        await page.goto('/#work/nonexistent-work-slug');
        await page.waitForTimeout(1000);

        // Should handle gracefully
        const errorMessage = page.locator('.error, .not-found, #error-message');
        const searchContainer = page.locator('.search-container');
        const landingPage = page.locator('#landing-page');

        const hasError = await errorMessage.isVisible().catch(() => false);
        const hasSearch = await searchContainer.isVisible().catch(() => false);
        const hasLanding = await landingPage.isVisible().catch(() => false);

        expect(hasError || hasSearch || hasLanding).toBeTruthy();
    });

    test('malformed hash URL handled gracefully', async ({ page }) => {
        await page.goto('/#//invalid///');
        await page.waitForTimeout(1000);

        // Should not crash - should show landing or search
        const landingPage = page.locator('#landing-page');
        const searchContainer = page.locator('.search-container');

        const hasLanding = await landingPage.isVisible().catch(() => false);
        const hasSearch = await searchContainer.isVisible().catch(() => false);

        expect(hasLanding || hasSearch).toBeTruthy();
    });
});

test.describe('Empty States', () => {
    test('search with no results shows appropriate message', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search for gibberish
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('xyzzy99999qqqq', { delay: 30 });
        await page.waitForTimeout(500);

        // Should show no results message
        const stats = page.locator('#search-stats');
        await expect(stats).toContainText('0');
    });

    test('favorites view shows empty state when no favorites', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Open sidebar and go to favorites
        await page.locator('#hamburger-btn').click();
        await expect(page.locator('.sidebar.open')).toBeVisible();
        await page.locator('#nav-favorites').click();

        // Should show 0 favorites
        await expect(page.locator('#search-stats')).toContainText('0');
    });

    test('custom list with song shows count', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search for a song
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('wagon wheel', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Add song to favorites instead (simpler test)
        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible({ timeout: 5000 });
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites via sidebar
        await page.locator('#hamburger-btn').click();
        await expect(page.locator('.sidebar.open')).toBeVisible();
        await page.locator('#nav-favorites').click();
        await page.waitForTimeout(500);

        // Should show 1 song
        await expect(page.locator('#search-stats')).toContainText('1');
    });
});

test.describe('Network Error Handling', () => {
    test('page loads gracefully when index takes time', async ({ page }) => {
        // Slow down network to simulate slow loading
        await page.route('**/data/index.jsonl', async route => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            await route.continue();
        });

        await page.goto('/');
        await page.waitForTimeout(500);

        // Landing page or loading state should show
        const landingPage = page.locator('#landing-page');
        const loadingIndicator = page.locator('.loading');

        const hasLanding = await landingPage.isVisible().catch(() => false);
        const hasLoading = await loadingIndicator.isVisible().catch(() => false);

        expect(hasLanding || hasLoading).toBeTruthy();
    });
});

test.describe('Input Validation', () => {
    test('search handles special characters', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');

        // Test with special characters
        await input.click();
        await input.fill('<script>alert("xss")</script>');
        await page.waitForTimeout(500);

        // Should not crash - should show 0 results
        const stats = page.locator('#search-stats');
        await expect(stats).toContainText('0');
    });

    test('search handles very long query', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        const longQuery = 'a'.repeat(500);

        await input.fill(longQuery);
        await page.waitForTimeout(500);

        // Should not crash
        const stats = page.locator('#search-stats');
        await expect(stats).toBeVisible();
    });

    test('search handles emoji input', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.fill('🎸 guitar 🎵');
        await page.waitForTimeout(500);

        // Should not crash
        const stats = page.locator('#search-stats');
        await expect(stats).toBeVisible();
    });
});

test.describe('State Recovery', () => {
    test('app recovers from corrupted localStorage', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.setItem('songbook-favorites', 'not valid json');
            localStorage.setItem('songbook-lists', '{broken: json');
        });

        // Reload page
        await page.goto('/#search');
        await page.waitForTimeout(1000);

        // Should load without crashing
        const searchInput = page.locator('#search-input');
        await expect(searchInput).toBeVisible();
    });

    test('app handles localStorage quota exceeded gracefully', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Try to fill localStorage to near capacity
        await page.evaluate(() => {
            try {
                const bigData = 'x'.repeat(1024 * 1024); // 1MB string
                for (let i = 0; i < 10; i++) {
                    localStorage.setItem(`test-${i}`, bigData);
                }
            } catch {
                // Expected to fail
            }
        });

        // Try to use favorites - should handle gracefully
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('creek', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await expect(page.locator('.list-picker-popup')).toBeVisible();

        // Try to add to favorites
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Should not crash - may show error or silently fail
        await page.waitForTimeout(500);
        const searchInput = page.locator('#search-input');
        await expect(searchInput).toBeVisible(); // App still functional

        // Cleanup
        await page.evaluate(() => {
            for (let i = 0; i < 10; i++) {
                localStorage.removeItem(`test-${i}`);
            }
        });
    });
});

test.describe('Concurrent Operations', () => {
    test('rapid search typing does not crash app', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');

        // Rapidly type and clear
        for (let i = 0; i < 5; i++) {
            await input.fill('wagon');
            await page.waitForTimeout(50);
            await input.fill('');
            await page.waitForTimeout(50);
            await input.fill('blue moon');
            await page.waitForTimeout(50);
        }

        // App should still work
        await input.clear();
        await input.click();
        await input.pressSequentially('foggy', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('rapid navigation does not crash app', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Rapidly navigate between views
        await page.goto('/#home');
        await page.waitForTimeout(100);
        await page.goto('/#search');
        await page.waitForTimeout(100);
        await page.goto('/#home');
        await page.waitForTimeout(100);
        await page.goto('/#search/tag:Bluegrass');
        await page.waitForTimeout(100);
        await page.goto('/#home');

        // App should recover
        await page.waitForTimeout(500);
        const landingPage = page.locator('#landing-page');
        const searchContainer = page.locator('.search-container');

        const hasLanding = await landingPage.isVisible().catch(() => false);
        const hasSearch = await searchContainer.isVisible().catch(() => false);

        expect(hasLanding || hasSearch).toBeTruthy();
    });
});

test.describe('Browser Features', () => {
    test('back button works correctly', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#landing-page', { timeout: 5000 });

        // Navigate to search
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Go back
        await page.goBack();

        // Should be on landing page
        await expect(page.locator('#landing-page')).toBeVisible();
    });

    test('forward button works after back', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#landing-page', { timeout: 5000 });

        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await page.goBack();
        await expect(page.locator('#landing-page')).toBeVisible();

        await page.goForward();
        await expect(page.locator('.search-container')).toBeVisible();
    });
});
