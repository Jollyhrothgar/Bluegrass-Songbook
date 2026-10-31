// E2E tests for View ▸ Versions (G19b; it was the Arrangement pill, and
// before that the version-picker modal and the work-dashboard version cards).
// A work whose group has multiple versions shows View ▾ in the reading dock;
// its sheet lists each version (canonical badge, current marker, vote
// affordance) and clicking one navigates to that arrangement.
import { test, expect } from './fixtures.js';
import { gotoSearch, searchFor, openDock } from './helpers.js';

// wagon-wheel has a 2-version group (wagon-wheel, wagon-wheel-1)
const MULTI_VERSION_URL = '/#work/wagon-wheel';

test.describe('View ▸ Versions', () => {
    test('clicking a multi-version search result opens content directly (no modal)', async ({ page }) => {
        await gotoSearch(page);
        await searchFor(page, 'wagon wheel');

        const resultWithVersions = page.locator('.result-item:has(.version-badge)').first();
        await expect(resultWithVersions).toBeVisible();
        await resultWithVersions.click();

        // Straight to the song page — no picker modal in between
        await expect(page.locator('#song-view')).toBeVisible();
        await expect(page.locator('#version-modal')).toHaveCount(0);

        // View ▾ is how the dock offers the group's versions
        await expect(page.locator('#dock-view-btn')).toContainText('View');
    });

    test('the sheet lists the versions with the current one marked', async ({ page }) => {
        await page.goto(MULTI_VERSION_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const popover = await openDock(page, 'view');

        const items = popover.locator('.arrangement-item');
        await expect(items.nth(1)).toBeVisible();  // retrying: list renders async

        // Exactly one is marked as currently viewing
        await expect(popover.locator('.arrangement-item.current')).toHaveCount(1);
        await expect(popover.locator('.current-badge')).toBeVisible();

        // Each row has a label and a vote affordance
        await expect(items.first().locator('.arrangement-label')).toBeVisible();
        await expect(items.first().locator('.arrangement-vote-btn')).toBeVisible();
        await expect(items.first().locator('.vote-count')).toBeVisible();
    });

    test('clicking another arrangement navigates to it', async ({ page }) => {
        await page.goto(MULTI_VERSION_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const popover = await openDock(page, 'view');

        const otherItem = popover.locator('.arrangement-item:not(.current)').first();
        const otherId = await otherItem.getAttribute('data-song-id');
        await otherItem.click();

        // The selected arrangement opens, at its own song path, and re-renders
        await expect.poll(() => page.evaluate(() => history.state?.songId)).toBe(otherId);
        await expect(page).toHaveURL(/\/songs\/[^/]+\/(?:[^/]+\/)?$/);
        await expect(page.locator('#song-view')).toBeVisible();

        // Reopening the sheet now marks the new arrangement as current
        const popover2 = await openDock(page, 'view');
        const current = popover2.locator('.arrangement-item.current');
        await expect(current).toHaveAttribute('data-song-id', otherId);
    });

    test('single-version works have no View at all', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        // The dock is there; View is not, because there is nothing to choose
        await expect(page.locator('#dock-key-btn')).toBeVisible();
        await expect(page.locator('#dock-view-btn, #dock-view')).toHaveCount(0);
    });

    test('voting while logged out prompts sign-in instead of casting', async ({ page }) => {
        await page.goto(MULTI_VERSION_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const popover = await openDock(page, 'view');
        const voteBtn = popover.locator('.arrangement-vote-btn').first();
        const countBefore = await popover.locator('.vote-count').first().textContent();

        let alertShown = false;
        page.on('dialog', async (dialog) => {
            alertShown = true;
            await dialog.accept();
        });
        await voteBtn.click();
        await page.waitForTimeout(300);

        expect(alertShown).toBe(true);
        // Count unchanged — no anonymous votes
        expect(await popover.locator('.vote-count').first().textContent()).toBe(countBefore);
    });
});
