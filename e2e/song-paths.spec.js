// A song's address is its path: /songs/{song}/ for the song, and
// /songs/{song}/{version}/ for each version (work.yaml `song:` + `version:`,
// built into each row's `path`). The page at that path is the app itself,
// pre-rendered with the chart (scripts/lib/build_song_pages.py); an archived
// song has no page and gets 404.html, the same app. Everything that isn't a
// song stays a hash route on the root.
import { test, expect } from './fixtures.js';

const songReady = (page) => expect(page.locator('#song-content .prerender')).toHaveCount(0, { timeout: 20000 });
const here = (page) => page.evaluate(() => location.pathname + location.hash);

test.describe('Song paths', () => {
    test('a song page boots the app on the song, at its own path', async ({ page }) => {
        const response = await page.goto('/songs/house-of-gold/');
        expect(response.status()).toBe(200);
        await songReady(page);
        await expect(page.locator('#landing-page')).toBeHidden();
        await expect(page.locator('.song-title')).toContainText(/house of gold/i);
        await expect(page.locator('.cl-chord').first()).toBeVisible();
        expect(await here(page)).toBe('/songs/house-of-gold/');
    });

    test('a version page opens that version, not the song\'s default', async ({ page }) => {
        await page.goto('/songs/house-of-gold/2/');
        await songReady(page);
        expect(await here(page)).toBe('/songs/house-of-gold/2/');
        expect(await page.evaluate(() => history.state?.songId)).toBe('a-house-of-gold');
    });

    test('leaving a song for search stays in the app and lands on the root', async ({ page }) => {
        await page.goto('/songs/house-of-gold/');
        await songReady(page);
        await page.evaluate(() => { window.__sameDocument = true; });

        await page.click('.topbar-nav-link[data-nav="search"]');
        await expect.poll(() => here(page)).toBe('/#search');
        expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
    });

    test('opening a search result shows its song path; back and forward follow', async ({ page }) => {
        await page.goto('/#search');
        await page.fill('#search-input', 'house of gold');
        await page.locator('.result-item').first().click();
        await songReady(page);
        await expect.poll(() => here(page)).toMatch(/^\/songs\/house-of-gold\//);

        await page.goBack();
        await expect.poll(() => here(page)).toMatch(/^\/#search/);
        await page.goForward();
        await expect.poll(() => here(page)).toMatch(/^\/songs\/house-of-gold\//);
    });

    test('an archived song has no page: 404.html boots the app on it', async ({ page }) => {
        const response = await page.goto('/songs/1-1-love/');
        expect(response.status()).toBe(404);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('#song-content')).toContainText(/1\+1 = Love/i, { timeout: 20000 });
        expect(await here(page)).toBe('/songs/1-1-love/');
    });

    test('a #work/ link lands on the song\'s path', async ({ page }) => {
        await page.goto('/#work/house-of-gold');
        await expect.poll(() => here(page), { timeout: 15000 }).toBe('/songs/house-of-gold/');
    });

    test('an unknown song path shows the not-found page', async ({ page }) => {
        await page.goto('/songs/no-such-song-xyz/');
        await expect(page.locator('.not-found')).toBeVisible({ timeout: 20000 });
    });
});
