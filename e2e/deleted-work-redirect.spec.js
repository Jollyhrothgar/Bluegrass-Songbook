// A work deleted as a duplicate still resolves: the URL is redirected to the
// single surviving twin (A10).
import { test, expect } from '@playwright/test';

test('deleted duplicate URL redirects to its surviving work', async ({ page }) => {
    await page.goto('/#work/blue-moon-of-kentucky');

    await expect(page.locator('.not-found')).toHaveCount(0);
    await expect(page).toHaveURL(/#work\/blue-moon-of-kentucky-1/, { timeout: 15000 });
    await expect(page.locator('#song-content')).toContainText(/blue moon of kentucky/i, { timeout: 15000 });
});
