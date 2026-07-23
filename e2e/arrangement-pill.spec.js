// E2E tests for the Arrangement pill — the replacement for the old
// version-picker modal (#version-modal) and work-dashboard version cards.
// A work whose group has multiple versions shows an "N arrangements" pill;
// its popover lists each version (canonical badge, current marker, vote
// affordance) and clicking one navigates to that arrangement.
import { test, expect } from '@playwright/test';
import { gotoSearch, searchFor, openPill } from './helpers.js';

// wagon-wheel has a 2-version group (wagon-wheel, wagon-wheel-1)
const MULTI_VERSION_URL = '/#work/wagon-wheel';

test.describe('Arrangement Pill', () => {
    test('clicking a multi-version search result opens content directly (no modal)', async ({ page }) => {
        await gotoSearch(page);
        await searchFor(page, 'wagon wheel');

        const resultWithVersions = page.locator('.result-item:has(.version-badge)').first();
        await expect(resultWithVersions).toBeVisible();
        await resultWithVersions.click();

        // Straight to the song page — no picker modal in between
        await expect(page.locator('#song-view')).toBeVisible();
        await expect(page.locator('#version-modal')).toHaveCount(0);

        // The arrangement pill announces the group
        await expect(page.locator('#arrangement-pill .pill-label')).toContainText(/\d+ arrangements/);
    });

    test('popover lists the versions with the current one marked', async ({ page }) => {
        await page.goto(MULTI_VERSION_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const popover = await openPill(page, 'arrangement-pill');

        const items = popover.locator('.arrangement-item');
        expect(await items.count()).toBeGreaterThanOrEqual(2);

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

        const popover = await openPill(page, 'arrangement-pill');

        const otherItem = popover.locator('.arrangement-item:not(.current)').first();
        const otherId = await otherItem.getAttribute('data-song-id');
        await otherItem.click();

        // URL moves to the selected arrangement and the page re-renders
        await expect(page).toHaveURL(new RegExp(`#work/${otherId}`));
        await expect(page.locator('#song-view')).toBeVisible();

        // Reopening the pill now marks the new arrangement as current
        const popover2 = await openPill(page, 'arrangement-pill');
        const current = popover2.locator('.arrangement-item.current');
        await expect(current).toHaveAttribute('data-song-id', otherId);
    });

    test('single-version works do not render an arrangement pill', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        // Pill row is there, arrangement pill is not
        await expect(page.locator('#song-pill-row')).toBeVisible();
        await expect(page.locator('#arrangement-pill')).toHaveCount(0);
    });

    test('voting while logged out prompts sign-in instead of casting', async ({ page }) => {
        await page.goto(MULTI_VERSION_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const popover = await openPill(page, 'arrangement-pill');
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
