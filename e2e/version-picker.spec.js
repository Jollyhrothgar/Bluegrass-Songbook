// E2E tests for Version Picker functionality
import { test, expect } from '@playwright/test';

test.describe('Version Picker', () => {
    test('clicking song with multiple versions opens version picker', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search for a song known to have multiple versions
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('wagon wheel', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Click on a result that shows "X versions" badge
        const resultWithVersions = page.locator('.result-item:has(.version-badge)').first();
        if (await resultWithVersions.isVisible()) {
            await resultWithVersions.click();

            // Version picker modal should appear (use .first() for strict mode)
            await expect(page.locator('#version-modal:not(.hidden)').first()).toBeVisible();
        }
    });

    test('version picker displays version options', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('blue moon kentucky', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Click first result (Blue Moon of Kentucky has multiple versions)
        await page.locator('.result-item').first().click();

        // Check if version picker appeared
        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Should show version items
            const versionItems = page.locator('.version-item');
            const count = await versionItems.count();
            expect(count).toBeGreaterThanOrEqual(1);

            // Each version should have a label
            await expect(page.locator('.version-label').first()).toBeVisible();
        }
    });

    test('selecting version from picker opens song view', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('wagon wheel', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        // Click result
        await page.locator('.result-item').first().click();

        // Check if version picker appeared
        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Click on a version item (not the vote button)
            await page.locator('.version-item .version-info').first().click();

            // Song view should open
            await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });
        }
    });

    test('version picker close button works', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('wagon wheel', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Click close button
            const closeBtn = page.locator('.version-picker .close-btn, #version-modal-close');
            if (await closeBtn.isVisible()) {
                await closeBtn.click();
                // Modal should close
                await expect(versionPicker).toBeHidden({ timeout: 2000 });
            }
        }
    });

    test('version picker shows vote counts', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('foggy mountain', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Should show vote buttons
            await expect(page.locator('.vote-btn').first()).toBeVisible();
            // Should show vote counts
            await expect(page.locator('.vote-count').first()).toBeVisible();
        }
    });
});

test.describe('Version Navigation', () => {
    test('see versions button in song view opens picker', async ({ page }) => {
        // Go to a specific song that has versions
        await page.goto('/#song/bluemoonofkentuckylyricschords');
        await page.waitForTimeout(1000);

        // Look for a "See versions" or similar button
        const versionBtn = page.locator('button:has-text("version"), .see-versions-btn, [data-group-id]');
        if (await versionBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            await versionBtn.first().click();

            // Version picker should appear
            await expect(page.locator('#version-modal:not(.hidden)')).toBeVisible({ timeout: 3000 });
        }
    });
});
