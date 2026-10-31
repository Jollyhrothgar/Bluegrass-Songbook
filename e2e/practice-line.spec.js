// Practice line under the title: Strum Machine (when matched) + YouTube search.
import { test, expect } from './fixtures.js';
import { openDock } from './helpers.js';

test.describe('Practice line', () => {
    test('lead sheet shows YouTube and Strum Machine links, none in the Key sheet', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const line = page.locator('.song-practice-line');
        await expect(line).toBeVisible();
        const yt = line.locator('a[data-practice="youtube"]');
        await expect(yt).toHaveAttribute('href', /youtube\.com\/results\?search_query=.*bluegrass/);
        await expect(yt).toHaveAttribute('target', '_blank');
        await expect(yt).toHaveAttribute('rel', /noopener/);

        const sheet = await openDock(page, 'key');
        await expect(sheet.locator('.pill-strum-btn')).toHaveCount(0);
    });

    test('Strum Machine link follows transposition without a click', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        const strum = page.locator('.song-practice-line a[data-practice="strum"]');
        await expect(strum).toBeVisible();
        const before = await strum.getAttribute('href');

        const sheet = await openDock(page, 'key');
        await sheet.locator('[data-transpose="1"]').click();

        // The href itself changes, so middle-click and "copy link" get the new key.
        await expect(strum).not.toHaveAttribute('href', before);
        await expect(strum).toHaveAttribute('href', /\?key=/);
    });

    test('tab-only work still has the Practice line', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.song-practice-line a[data-practice="youtube"]')).toBeVisible();
    });
});
