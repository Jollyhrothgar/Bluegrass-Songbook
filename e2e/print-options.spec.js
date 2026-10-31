// E2E tests for export actions. All export actions (print, copy, download)
// live in the song page's ⋯ menu: This song ▸ Export / Print, which opens in
// place to list all five. (The list view keeps its own Export pill.)
import { test, expect } from './fixtures.js';
import { gotoSearch, searchAndOpen, searchFor, navClick, openPill } from './helpers.js';

/** ⋯ ▸ Export / Print, opened; returns the group of five actions. */
async function openExport(page) {
    await page.locator('#topbar-overflow-btn').click();
    await page.locator('#export-menu-btn').click();
    const group = page.locator('#export-menu-btn + .menu-sub');
    await expect(group).toBeVisible();
    return group;
}

test.describe('Export / Print (⋯ menu)', () => {
    test.beforeEach(async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'old home place');
    });

    test('Export / Print is in ⋯, and the band carries no Export pill any more', async ({ page }) => {
        await expect(page.locator('#export-pill')).toHaveCount(0);
        await page.locator('#topbar-overflow-btn').click();
        const row = page.locator('#export-menu-btn');
        await expect(row).toBeVisible();
        await expect(row).toHaveAttribute('aria-expanded', 'false');
    });

    test('Export / Print lists all five actions', async ({ page }) => {
        const popover = await openExport(page);
        await expect(page.locator('#export-menu-btn')).toHaveAttribute('aria-expanded', 'true');

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

        const popover = await openExport(page);
        await popover.locator('[data-action="copy-chordpro"]').click();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toContain('{');
        expect(clipboardText).toContain('[');
    });

    test('copy as plain text strips chords and directives', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        const popover = await openExport(page);
        await popover.locator('[data-action="copy-text"]').click();

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText.length).toBeGreaterThan(0);
        expect(clipboardText).not.toMatch(/\[[A-G][^\]]*\]/);
        expect(clipboardText).not.toContain('{meta:');
    });

    test('download .pro triggers a file download', async ({ page }) => {
        const popover = await openExport(page);

        const downloadPromise = page.waitForEvent('download');
        await popover.locator('[data-action="download-chordpro"]').click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/\.pro$/);
    });

    test('download .txt triggers a file download', async ({ page }) => {
        const popover = await openExport(page);

        const downloadPromise = page.waitForEvent('download');
        await popover.locator('[data-action="download-text"]').click();
        expect((await downloadPromise).suggestedFilename()).toMatch(/\.txt$/);
    });

    test('print action triggers window.print', async ({ page }) => {
        let printCalled = false;
        await page.exposeFunction('trackPrint', () => { printCalled = true; });
        await page.evaluate(() => { window.print = () => window.trackPrint(); });

        const popover = await openExport(page);
        await popover.locator('[data-action="print"]').click();

        expect(printCalled).toBe(true);
    });

    test('clicking outside closes the menu', async ({ page }) => {
        await openExport(page);
        await expect(page.locator('#topbar-overflow-menu')).toBeVisible();

        await page.locator('.song-content').click();

        await expect(page.locator('#topbar-overflow-menu')).toBeHidden();
    });
});

test.describe('List Print', () => {
    test('list Export pill offers print and downloads when viewing a list', async ({ page }) => {
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

        // The bare Print button was replaced by the Export pill in the list
        // header (main.js mountListExportPill) — same control the song page
        // has, so a list can be printed OR downloaded.
        await expect(page.locator('#list-export-pill')).toBeVisible();
        const popover = await openPill(page, 'list-export-pill');
        await expect(popover.locator('[data-action="print"]')).toBeVisible();
        await expect(popover.locator('[data-action="download-chordpro"]')).toBeVisible();
        await expect(popover.locator('[data-action="download-zip"]')).toBeVisible();
    });

    test('list Export pill hidden when not viewing a list', async ({ page }) => {
        await gotoSearch(page);
        await searchFor(page, 'bluegrass');

        await expect(page.locator('#list-export-pill')).toBeHidden();
    });
});
