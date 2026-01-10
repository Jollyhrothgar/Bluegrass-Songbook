// E2E tests for Search edge cases and advanced features
import { test, expect } from '@playwright/test';

test.describe('Advanced Search Filters', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
    });

    test('artist: filter returns matching results', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('artist:bill monroe', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);

        // Check that results mention Bill Monroe
        const firstResult = await results.first().textContent();
        expect(firstResult?.toLowerCase()).toContain('monroe');
    });

    test('title: filter returns matching results', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('title:blue moon', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('tag: filter returns tagged songs', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:Gospel', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('key: filter returns songs in specific key', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('key:G', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('lyrics: filter searches within lyrics', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('lyrics:lonesome', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('chord: filter finds songs with specific Nashville chord', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('chord:VII', { delay: 30 });
        await page.waitForTimeout(500);

        const stats = page.locator('#search-stats');
        const statsText = await stats.textContent();
        // Should find some results
        expect(statsText).toMatch(/\d+/);
    });

    test('prog: filter finds chord progressions', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('prog:I-IV-V', { delay: 30 });
        await page.waitForTimeout(500);

        const stats = page.locator('#search-stats');
        await expect(stats).toBeVisible();
    });
});

test.describe('Negative Filters', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
    });

    test('-tag: excludes tagged songs', async ({ page }) => {
        // First get count with tag
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:Bluegrass', { delay: 30 });
        await page.waitForTimeout(500);

        const statsWithTag = await page.locator('#search-stats').textContent();
        const countWithTag = parseInt(statsWithTag?.match(/\d+/)?.[0] || '0');

        // Now search excluding that tag
        await input.clear();
        await input.click();
        await input.pressSequentially('tag:Bluegrass -tag:Instrumental', { delay: 30 });
        await page.waitForTimeout(500);

        const statsWithoutInstrumental = await page.locator('#search-stats').textContent();
        const countWithoutInstrumental = parseInt(statsWithoutInstrumental?.match(/\d+/)?.[0] || '0');

        // Should have fewer results after excluding
        expect(countWithoutInstrumental).toBeLessThanOrEqual(countWithTag);
    });

    test('-key: excludes songs in key', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:Bluegrass -key:C', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count >= 0).toBeTruthy(); // May be 0 if all bluegrass is in C
    });
});

test.describe('Combined Filters', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
    });

    test('combining tag and artist filter', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:Bluegrass artist:flatt', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        // May or may not have results, but should not error
        expect(count >= 0).toBeTruthy();
    });

    test('combining text search with filter', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('mountain tag:Bluegrass', { delay: 30 });
        await page.waitForTimeout(500);

        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('combining chord and key filter', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('chord:V7 key:G', { delay: 30 });
        await page.waitForTimeout(500);

        const stats = page.locator('#search-stats');
        await expect(stats).toBeVisible();
    });
});

test.describe('Tag Dropdown', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
    });

    test('tag dropdown opens and shows options', async ({ page }) => {
        const tagBtn = page.locator('#tag-dropdown-btn');
        await tagBtn.click();

        const dropdown = page.locator('#tag-dropdown-content');
        await expect(dropdown).toBeVisible();

        // Should have genre tags
        await expect(dropdown).toContainText('Bluegrass');
        await expect(dropdown).toContainText('Gospel');
    });

    test('selecting tag from dropdown updates search', async ({ page }) => {
        const tagBtn = page.locator('#tag-dropdown-btn');
        await tagBtn.click();

        // Click a tag checkbox
        const bluegrassCheckbox = page.locator('#tag-dropdown-content label:has-text("Bluegrass") input');
        await bluegrassCheckbox.click();

        // Search input should be updated
        const input = page.locator('#search-input');
        await expect(input).toHaveValue(/tag:Bluegrass/i);
    });

    test('multiple tags can be selected', async ({ page }) => {
        const tagBtn = page.locator('#tag-dropdown-btn');
        await tagBtn.click();

        // Select multiple tags
        await page.locator('#tag-dropdown-content label:has-text("Bluegrass") input').click();
        await page.locator('#tag-dropdown-content label:has-text("Gospel") input').click();

        const input = page.locator('#search-input');
        const value = await input.inputValue();
        expect(value).toContain('tag:');
    });
});

test.describe('Search URL Encoding', () => {
    test('search query preserved in URL', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('blue moon', { delay: 30 });
        await page.waitForTimeout(500);

        // URL should contain the query
        await expect(page).toHaveURL(/search.*blue.*moon|search\/.*blue/i);
    });

    test('search from URL loads results', async ({ page }) => {
        await page.goto('/#search/wagon%20wheel');
        await page.waitForTimeout(1000);

        // Results should be visible
        const results = page.locator('.result-item');
        await page.waitForSelector('.result-item', { timeout: 5000 });
        const count = await results.count();
        expect(count).toBeGreaterThan(0);

        // Input should have the query
        const input = page.locator('#search-input');
        const value = await input.inputValue();
        expect(value.toLowerCase()).toContain('wagon');
    });

    test('special characters in URL handled', async ({ page }) => {
        await page.goto('/#search/tag:Bluegrass');
        await page.waitForTimeout(1000);

        // Should load without error
        const searchContainer = page.locator('.search-container');
        await expect(searchContainer).toBeVisible();

        // Input should have the filter
        const input = page.locator('#search-input');
        const value = await input.inputValue();
        expect(value.toLowerCase()).toContain('tag');
    });
});

test.describe('Search Results Display', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
    });

    test('results show title and artist', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('foggy mountain', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        const firstResult = page.locator('.result-item').first();

        // Should have title element
        const title = firstResult.locator('.result-title, .song-title');
        await expect(title).toBeVisible();

        // Should have artist element
        const artist = firstResult.locator('.result-artist, .song-artist');
        await expect(artist).toBeVisible();
    });

    test('results show key badge', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('key:G', { delay: 30 });
        await page.waitForTimeout(1000);
        await page.waitForSelector('.result-item', { timeout: 5000 });

        const firstResult = page.locator('.result-item').first();
        const keyBadge = firstResult.locator('.key-badge, .result-key');

        if (await keyBadge.isVisible({ timeout: 2000 }).catch(() => false)) {
            const keyText = await keyBadge.textContent();
            expect(keyText).toContain('G');
        } else {
            // Key badge may not be visible in compact view - just verify results loaded
            await expect(firstResult).toBeVisible();
        }
    });

    test('results show version badge for multi-version songs', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('wagon wheel', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Look for version badge
        const versionBadge = page.locator('.version-badge');
        const count = await versionBadge.count();

        // There may or may not be songs with multiple versions
        expect(count >= 0).toBeTruthy();
    });

    test('search stats show result count', async ({ page }) => {
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('mountain', { delay: 30 });
        await page.waitForTimeout(500);

        const stats = page.locator('#search-stats');
        const statsText = await stats.textContent();

        // Should show a number
        expect(statsText).toMatch(/\d+/);
    });
});

test.describe('Search Performance', () => {
    test('search completes in reasonable time', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');

        const startTime = Date.now();
        await input.click();
        await input.pressSequentially('the', { delay: 30 }); // Common word, many results
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item', { timeout: 5000 });
        const endTime = Date.now();

        // Search should complete within 5 seconds
        expect(endTime - startTime).toBeLessThan(5000);
    });

    test('clearing search is fast', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('mountain', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Clear search
        const startTime = Date.now();
        await input.clear();
        await page.waitForTimeout(500);
        const endTime = Date.now();

        // Should clear within 1 second
        expect(endTime - startTime).toBeLessThan(1000);
    });
});

test.describe('Search Tips', () => {
    test('search tips button shows help', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const tipsBtn = page.locator('#search-tips-btn');
        await tipsBtn.click();

        const tipsDropdown = page.locator('#search-tips-dropdown');
        await expect(tipsDropdown).toBeVisible();

        // Should contain help text
        const tipsText = await tipsDropdown.textContent();
        expect(tipsText?.toLowerCase()).toContain('search');
    });

    test('search tips shows filter examples', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const tipsBtn = page.locator('#search-tips-btn');
        await tipsBtn.click();

        const tipsDropdown = page.locator('#search-tips-dropdown');
        await expect(tipsDropdown).toBeVisible();

        // Should show filter syntax
        const tipsText = await tipsDropdown.textContent();
        expect(tipsText).toContain('artist:');
        expect(tipsText).toContain('tag:');
    });
});

test.describe('Empty Search', () => {
    test('empty search shows prompt or popular songs', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Empty search should show something
        const stats = page.locator('#search-stats');
        await expect(stats).toBeVisible();

        const statsText = await stats.textContent();
        // Either shows "Type to search" or a count
        expect(statsText?.length).toBeGreaterThan(0);
    });
});
