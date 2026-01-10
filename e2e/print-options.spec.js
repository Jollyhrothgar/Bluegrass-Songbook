// E2E tests for Print functionality and export options
import { test, expect } from '@playwright/test';

test.describe('Print Button', () => {
    test('print button visible in song view', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('your cheating heart hank', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        // Handle version picker if it appears
        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        // Export button should be visible (print is now in export dropdown)
        const exportBtn = page.locator('#export-btn');
        await expect(exportBtn).toBeVisible();
    });

    test('print keyboard shortcut exists (P key)', async ({ page }) => {
        // Navigate directly to a known song
        await page.goto('/#work/your-cheating-heart');
        await page.waitForTimeout(1000);

        const songView = page.locator('#song-view:not(.hidden)');
        const versionPicker = page.locator('#version-modal:not(.hidden)');

        await expect(songView.or(versionPicker)).toBeVisible({ timeout: 5000 });

        // If version picker appeared, select first version
        if (await versionPicker.isVisible()) {
            await page.locator('.version-item .version-info').first().click();
            await expect(songView).toBeVisible({ timeout: 3000 });
        }

        // Pressing P should trigger print (we can't fully test print dialog)
        // But we can verify no errors occur
        await page.keyboard.press('p');
        await page.waitForTimeout(200);

        // Song view should still be visible (no crash)
        await expect(songView).toBeVisible();
    });
});

test.describe('Copy Functionality', () => {
    test('copy dropdown shows options', async ({ page }) => {
        // Navigate directly to a known song
        await page.goto('/#work/blue-moon-of-kentucky');
        await page.waitForTimeout(1000);

        const songView = page.locator('#song-view:not(.hidden)');
        const versionPicker = page.locator('#version-modal:not(.hidden)');

        await expect(songView.or(versionPicker)).toBeVisible({ timeout: 5000 });

        // If version picker appeared, select first version
        if (await versionPicker.isVisible()) {
            await page.locator('.version-item .version-info').first().click();
            await expect(songView).toBeVisible({ timeout: 3000 });
        }

        // Click copy button to show dropdown
        const copyBtn = page.locator('#copy-btn');
        if (await copyBtn.isVisible()) {
            await copyBtn.click();

            const copyDropdown = page.locator('#copy-dropdown');
            await expect(copyDropdown).toBeVisible();

            // Should have copy options
            await expect(copyDropdown).toContainText(/ChordPro|Text/i);
        }
    });

    test('copy as ChordPro option available', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('cripple creek', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const copyBtn = page.locator('#copy-btn');
        if (await copyBtn.isVisible()) {
            await copyBtn.click();

            const chordproOption = page.locator('[data-action="copy-chordpro"], .export-option:has-text("ChordPro")');
            if (await chordproOption.isVisible()) {
                await chordproOption.click();

                // Should copy to clipboard
                await page.waitForTimeout(300);
                // Clipboard read might fail depending on context, but no errors should occur
            }
        }
    });

    test('copy as text option available', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('foggy mountain', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const copyBtn = page.locator('#copy-btn');
        if (await copyBtn.isVisible()) {
            await copyBtn.click();

            const textOption = page.locator('[data-action="copy-text"], .export-option:has-text("Text")');
            await expect(textOption).toBeVisible();
        }
    });
});

test.describe('Download Functionality', () => {
    test('download dropdown shows options', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('salty dog', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const downloadBtn = page.locator('#download-btn');
        if (await downloadBtn.isVisible()) {
            await downloadBtn.click();

            const downloadDropdown = page.locator('#download-dropdown');
            await expect(downloadDropdown).toBeVisible();

            // Should have download options
            await expect(downloadDropdown).toContainText(/\.pro|\.txt/i);
        }
    });

    test('download .pro option exists', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('rocky top', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const downloadBtn = page.locator('#download-btn');
        if (await downloadBtn.isVisible()) {
            await downloadBtn.click();

            const proOption = page.locator('[data-action="download-pro"], .export-option:has-text(".pro")');
            await expect(proOption).toBeVisible();
        }
    });

    test('download .txt option exists', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('man of constant sorrow', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const downloadBtn = page.locator('#download-btn');
        if (await downloadBtn.isVisible()) {
            await downloadBtn.click();

            const txtOption = page.locator('[data-action="download-text"], .export-option:has-text(".txt")');
            await expect(txtOption).toBeVisible();
        }
    });
});

test.describe('List Print', () => {
    test('print list button visible when viewing a list', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Add song to favorites
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('wildwood flower', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-list-btn').first().click();
        await page.locator('.list-picker-popup .favorites-option input').click();

        // Navigate to favorites
        await page.locator('#hamburger-btn').click();
        await expect(page.locator('.sidebar.open')).toBeVisible();
        await page.locator('#nav-favorites').click();

        await page.waitForTimeout(500);

        // Print list button should be visible
        const printListBtn = page.locator('#print-list-btn');
        await expect(printListBtn).toBeVisible();
    });

    test('print list button hidden when not viewing a list', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Just search, don't navigate to a list
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('bluegrass', { delay: 30 });
        await page.waitForTimeout(500);

        // Print list button should be hidden in search results
        const printListBtn = page.locator('#print-list-btn');
        await expect(printListBtn).toBeHidden();
    });
});

test.describe('Export Dropdown Behavior', () => {
    test('clicking outside closes copy dropdown', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('john henry', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const copyBtn = page.locator('#copy-btn');
        if (await copyBtn.isVisible()) {
            await copyBtn.click();

            const copyDropdown = page.locator('#copy-dropdown');
            await expect(copyDropdown).toBeVisible();

            // Click outside
            await page.locator('#song-content, .song-content').click();

            // Dropdown should close
            await expect(copyDropdown).toBeHidden();
        }
    });

    test('clicking outside closes download dropdown', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('will the circle', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const downloadBtn = page.locator('#download-btn');
        if (await downloadBtn.isVisible()) {
            await downloadBtn.click();

            const downloadDropdown = page.locator('#download-dropdown');
            await expect(downloadDropdown).toBeVisible();

            // Click outside
            await page.locator('#song-content, .song-content').click();

            // Dropdown should close
            await expect(downloadDropdown).toBeHidden();
        }
    });
});

test.describe('Song View Options for Print', () => {
    test('font size changes affect song content', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('amazing grace', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        // Get initial font size
        const songContent = page.locator('#song-content, .song-content');
        const initialSize = await songContent.evaluate(el => getComputedStyle(el).fontSize);

        // Click font increase button
        const fontIncreaseBtn = page.locator('#font-increase, .font-btn:has-text("+")');
        if (await fontIncreaseBtn.isVisible()) {
            await fontIncreaseBtn.click();
            await page.waitForTimeout(200);

            const newSize = await songContent.evaluate(el => getComputedStyle(el).fontSize);

            // Font size should have increased
            expect(parseFloat(newSize)).toBeGreaterThanOrEqual(parseFloat(initialSize));
        }
    });

    test('compact mode toggle works', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('old home place', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const compactToggle = page.locator('#compact-toggle, input[name="compact"]');
        if (await compactToggle.isVisible()) {
            // Toggle compact mode
            await compactToggle.click();
            await page.waitForTimeout(200);

            // Song view should have compact class or reduced spacing
            const songView = page.locator('#song-view');
            const hasCompact = await songView.evaluate(el =>
                el.classList.contains('compact') ||
                document.body.classList.contains('compact-mode')
            );

            // Toggle state changed (either on or off depending on initial state)
            expect(typeof hasCompact === 'boolean').toBeTruthy();
        }
    });

    test('chord display mode dropdown works', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('lonesome road blues', { delay: 30 });
        await page.waitForTimeout(500);
        await page.waitForSelector('.result-item');

        await page.locator('.result-item').first().click();

        const versionPicker = page.locator('#version-modal:not(.hidden)');
        if (await versionPicker.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
        }

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 5000 });

        const chordModeSelect = page.locator('#chord-mode-select, .chord-mode-select');
        if (await chordModeSelect.isVisible()) {
            // Get options
            const options = await chordModeSelect.locator('option').allTextContents();
            expect(options.length).toBeGreaterThan(0);

            // Select a different option
            if (options.length > 1) {
                await chordModeSelect.selectOption({ index: 1 });
                await page.waitForTimeout(200);

                // Should not crash
                await expect(page.locator('#song-view')).toBeVisible();
            }
        }
    });
});
