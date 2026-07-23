// E2E tests for export actions. The old #export-btn/#export-dropdown,
// #copy-btn and #download-btn are gone — all export actions (print, copy,
// download) live in the top band's Export pill (#export-pill).
import { test, expect } from '@playwright/test';
import { gotoSearch, searchAndOpen, searchFor, navClick, openPill } from './helpers.js';

test.describe('Export Pill', () => {
    test.beforeEach(async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'your cheating heart hank williams');
    });

    test('Export pill is visible in the top band on song pages', async ({ page }) => {
        await expect(page.locator('#export-pill')).toBeVisible();
    });

    test('Export pill lists all five actions', async ({ page }) => {
        const popover = await openPill(page, 'export-pill');

        await expect(popover.locator('[data-action="print"]')).toBeVisible();
        await expect(popover.locator('[data-action="copy-chordpro"]')).toBeVisible();
        await expect(popover.locator('[data-action="copy-text"]')).toBeVisible();
        await expect(popover.locator('[data-action="download-chordpro"]')).toBeVisible();
        await expect(popover.locator('[data-action="download-text"]')).toBeVisible();
        await expect(popover).toContainText(/\.pro/);
        await expect(popover).toContainText(/\.txt/);
    });

    test('copy as ChordPro writes the song source to the clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        const popover = await openPill(page, 'export-pill');
        await popover.locator('[data-action="copy-chordpro"]').click();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toContain('{');
        expect(clipboardText).toContain('[');
    });

    test('copy as plain text strips chords and directives', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        const popover = await openPill(page, 'export-pill');
        await popover.locator('[data-action="copy-text"]').click();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText.length).toBeGreaterThan(0);
        expect(clipboardText).not.toMatch(/\[[A-G][^\]]*\]/);
        expect(clipboardText).not.toContain('{meta:');
    });

    test('download .pro triggers a file download', async ({ page }) => {
        const popover = await openPill(page, 'export-pill');

        const downloadPromise = page.waitForEvent('download');
        await popover.locator('[data-action="download-chordpro"]').click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/\.pro$/);
    });

    test('print action triggers window.print', async ({ page }) => {
        let printCalled = false;
        await page.exposeFunction('trackPrint', () => { printCalled = true; });
        await page.evaluate(() => { window.print = () => window.trackPrint(); });

        const popover = await openPill(page, 'export-pill');
        await popover.locator('[data-action="print"]').click();

        expect(printCalled).toBe(true);
    });

    test('clicking outside closes the export popover', async ({ page }) => {
        const popover = await openPill(page, 'export-pill');
        await expect(popover).toBeVisible();

        await page.locator('.song-content').click();

        await expect(popover).toBeHidden();
    });
});

test.describe('List Print', () => {
    test('print list button visible when viewing a list', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await gotoSearch(page);

        // Add a song to favorites
        await searchFor(page, 'wildwood flower');
        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites via the top band
        await navClick(page, 'favorites');
        await page.waitForTimeout(500);

        // Print button lives in the list header bar
        await expect(page.locator('#list-print-btn')).toBeVisible();
    });

    test('print list button hidden when not viewing a list', async ({ page }) => {
        await gotoSearch(page);
        await searchFor(page, 'bluegrass');

        await expect(page.locator('#print-list-btn')).toBeHidden();
    });
});
