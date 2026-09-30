// Theme is applied before first paint and follows the OS (perf B5); abcjs is
// loaded on demand, not in the head (perf B4).
import { test, expect } from '@playwright/test';

test.describe('theme at boot', () => {
    test.describe('OS dark, no saved choice', () => {
        test.use({ colorScheme: 'dark' });
        test('dark theme and dark theme-color', async ({ page }) => {
            await page.goto('/');
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');
        });
        test('saved light choice wins and the toggle flips theme-color', async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem('theme', 'light'));
            await page.goto('/');
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
            await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#fafafa');
            await page.locator('#topbar-theme').click();
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
            await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');
        });
    });

    test.describe('OS light', () => {
        test.use({ colorScheme: 'light' });
        test('light theme by default', async ({ page }) => {
            await page.goto('/');
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        });
    });
});

test('abcjs is not loaded for a chord-only song', async ({ page }) => {
    await page.goto('/');
    await page.locator('#search-input').waitFor({ state: 'attached' });
    expect(await page.evaluate(() => typeof window.ABCJS)).toBe('undefined');
    expect(await page.locator('script[src*="abcjs"]').count()).toBe(0);
});
