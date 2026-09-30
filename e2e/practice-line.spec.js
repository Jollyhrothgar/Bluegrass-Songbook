// Practice line under the title: Strum Machine (when matched) + YouTube search.
import { test, expect } from '@playwright/test';

test.describe('Practice line', () => {
    test('lead sheet shows YouTube and Strum Machine links, none in the Key pill', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const line = page.locator('.song-practice-line');
        await expect(line).toBeVisible();
        const yt = line.locator('a[data-practice="youtube"]');
        await expect(yt).toHaveAttribute('href', /youtube\.com\/results\?search_query=.*bluegrass/);
        await expect(yt).toHaveAttribute('target', '_blank');
        await expect(yt).toHaveAttribute('rel', /noopener/);

        await page.locator('#key-pill .pill-btn').click();
        await expect(page.locator('#key-pill .pill-strum-btn')).toHaveCount(0);
    });

    test('tab-only work still has the Practice line', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.song-practice-line a[data-practice="youtube"]')).toBeVisible();
    });
});
