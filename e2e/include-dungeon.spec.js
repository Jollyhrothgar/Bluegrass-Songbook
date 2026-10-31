// "Include the dungeon": a remembered search-scope checkbox. Off, search is
// the curated canon; on, archived songs join the results (badged, ranked
// below the canon at equal relevance) and the archive loads on demand.
import { test, expect } from './fixtures.js';

const ARCHIVED = '1+1 = Love';   // works/1-1-love is in archive.jsonl

const box = (page) => page.locator('#include-dungeon');
const archivedResult = (page) =>
    page.locator('.result-item', { hasText: ARCHIVED });

test.describe('Include the dungeon', () => {
    test('is off by default: archived songs stay out of search', async ({ page }) => {
        await page.goto('/#search');
        await expect(box(page)).not.toBeChecked();
        await page.fill('#search-input', ARCHIVED);
        await expect(page.locator('#search-stats')).toContainText('songs');
        await expect(archivedResult(page)).toHaveCount(0);
    });

    test('ticking it brings in the dungeon, badged, and it is remembered', async ({ page }) => {
        await page.goto('/#search');
        await page.fill('#search-input', ARCHIVED);
        await box(page).check();

        const row = archivedResult(page).first();
        await expect(row).toBeVisible({ timeout: 20000 });
        await expect(row.locator('.dungeon-badge')).toBeVisible();
        await expect(page.locator('#search-stats')).toContainText('incl. the dungeon');

        // Remembered across a reload, and the archive loads for it
        await page.reload();
        await expect(box(page)).toBeChecked();
        await page.fill('#search-input', ARCHIVED);
        await expect(archivedResult(page).first()).toBeVisible({ timeout: 20000 });

        // Unticking takes the dungeon back out
        await box(page).uncheck();
        await expect(archivedResult(page)).toHaveCount(0);
        await page.reload();
        await expect(box(page)).not.toBeChecked();
    });

    test('the home page offers it too, and it is the same choice', async ({ page }) => {
        const homeBox = page.locator('#landing-include-dungeon');
        await page.goto('/');
        await expect(homeBox).toBeVisible();
        await expect(homeBox).not.toBeChecked();

        // Ticked on the home page, it applies to a search started there
        await homeBox.check();
        await page.fill('#landing-search-input', ARCHIVED);
        await page.press('#landing-search-input', 'Enter');
        const row = archivedResult(page).first();
        await expect(row).toBeVisible({ timeout: 20000 });
        await expect(row.locator('.dungeon-badge')).toBeVisible();
        await expect(box(page)).toBeChecked();

        // Unticked on the search bar, the home page's box follows
        await box(page).uncheck();
        await expect(homeBox).not.toBeChecked();
        await page.goto('/');
        await expect(homeBox).not.toBeChecked();
    });

    test('is not offered inside the dungeon itself', async ({ page }) => {
        await page.goto('/#dungeon');
        await expect(page.locator('body')).toHaveClass(/dungeon-mode/);
        await expect(box(page)).toBeHidden();
    });
});
