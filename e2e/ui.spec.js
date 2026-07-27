// E2E tests for shell UI features: theme toggle (top band), focus mode
// (auto-hiding chrome), overflow menu, and view preference persistence.
// The old sidebar/hamburger and fullscreen-header tests died with those
// surfaces in the redesign.
import { test, expect } from '@playwright/test';
import { gotoSearch, searchAndOpen, openPill } from './helpers.js';

test.describe('Theme', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
    });

    test('top-band theme toggle switches between light and dark', async ({ page }) => {
        const htmlEl = page.locator('html');
        const initialTheme = await htmlEl.getAttribute('data-theme') || 'light';

        await page.locator('#topbar-theme').click();
        await page.waitForTimeout(100);

        const newTheme = await htmlEl.getAttribute('data-theme');
        expect(newTheme).not.toBe(initialTheme);

        await page.locator('#topbar-theme').click();
        await page.waitForTimeout(100);

        const restoredTheme = await htmlEl.getAttribute('data-theme');
        expect(restoredTheme).toBe(initialTheme === 'dark' ? 'dark' : 'light');
    });

    test('theme preference persists after reload', async ({ page }) => {
        const initialTheme = await page.locator('html').getAttribute('data-theme');

        await page.locator('#topbar-theme').click();
        await page.waitForTimeout(100);

        const setTheme = await page.locator('html').getAttribute('data-theme');
        expect(setTheme).not.toBe(initialTheme);

        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        const persistedTheme = await page.locator('html').getAttribute('data-theme');
        expect(persistedTheme).toBe(setTheme);
    });
});

test.describe('Auto-hiding chrome (song page)', () => {
    // Short viewport so any song overflows and the page can actually scroll
    test.use({ viewport: { width: 700, height: 480 } });

    test.beforeEach(async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'blue moon kentucky');
    });

    test('scrolling down hides the top band; scrolling up reveals it', async ({ page }) => {
        // Repeated small scrolls so the shell's rAF delta logic sees
        // downward motion (a single jump can land in one frame)
        for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, 120);
            await page.waitForTimeout(50);
        }
        await expect(page.locator('body')).toHaveClass(/chrome-hidden/);

        for (let i = 0; i < 3; i++) {
            await page.mouse.wheel(0, -120);
            await page.waitForTimeout(50);
        }
        await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
    });

    test('song content stays visible while chrome is hidden', async ({ page }) => {
        for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, 120);
            await page.waitForTimeout(50);
        }
        await expect(page.locator('.song-body')).toBeVisible();
    });

    test('Edit lives in the title row (Focus button is gone)', async ({ page }) => {
        await expect(page.locator('#focus-btn')).toHaveCount(0);
        const editBtn = page.locator('#edit-song-btn');
        await expect(editBtn).toBeVisible();
        await editBtn.click();
        await expect(page.locator('#editor-panel')).toBeVisible();
    });
});

test.describe('Overflow Menu', () => {
    test('overflow menu opens with persistent entries', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await page.locator('#topbar-overflow-btn').click();

        const menu = page.locator('#topbar-overflow-menu');
        await expect(menu).toBeVisible();
        await expect(menu).toContainText('About');
        await expect(menu).toContainText('Send Feedback');
    });

    test('Send Feedback opens the unified feedback modal', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await page.locator('#topbar-overflow-btn').click();
        await page.locator('#topbar-overflow-menu .pill-popover-item', { hasText: 'Send Feedback' }).click();

        await expect(page.locator('#flag-modal')).toBeVisible();
        await expect(page.locator('#flag-type-select')).toBeVisible();

        await page.locator('#flag-cancel').click();
        await expect(page.locator('#flag-modal')).toBeHidden();
    });

    test('song page overflow has Report issue → feedback modal', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'old home place', /old home place/i);

        await page.locator('#topbar-overflow-btn').click();
        const flagItem = page.locator('#flag-btn');
        await expect(flagItem).toBeVisible();
        await flagItem.click();

        await expect(page.locator('#flag-modal')).toBeVisible();
        // Song context is attached to the report
        await expect(page.locator('#flag-song-context')).toContainText(/old home place/i);
    });

    test('overflow menu closes on outside click', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        await page.locator('#topbar-overflow-btn').click();
        await expect(page.locator('#topbar-overflow-menu')).toBeVisible();

        await page.locator('#search-input').click();
        await expect(page.locator('#topbar-overflow-menu')).toBeHidden();
    });
});

test.describe('Keyboard Shortcuts', () => {
    test('back button returns from song to search', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'old home place', /old home place/i);

        await page.goBack();
        await page.waitForTimeout(300);

        await expect(page.locator('#search-input')).toBeVisible();
    });
});

test.describe('View Preferences', () => {
    test('display settings persist across song navigation', async ({ page }) => {
        await gotoSearch(page);
        await searchAndOpen(page, 'blue moon kentucky');

        // Toggle Compact in the Display pill
        const popover = await openPill(page, 'display-pill');
        await popover.locator('#pill-compact').click();
        await page.waitForTimeout(200);

        // Navigate back and open another song
        await page.goBack();
        await page.waitForTimeout(200);
        await searchAndOpen(page, 'wagon wheel');

        // The Display pill remembers the setting
        const popover2 = await openPill(page, 'display-pill');
        await expect(popover2.locator('#pill-compact')).toBeChecked();
    });
});
