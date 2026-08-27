// The top band has to roll itself up as the window narrows. Regression cover
// for the reported bug: signed in on a song page at ~820px, the "Lists" NAV
// link painted 22px on top of the "Lists" ACTION button, and from ~840px down
// "Add Song" wrapped to two lines inside the 48px band.
//
// The old collapse was one @media (max-width: 800px) breakpoint. A viewport
// breakpoint cannot answer "does this fit?", because the band's content width
// does not follow the viewport — the actions differ per view and a signed-in
// display name is as long as the person is. So these tests drive real widths
// with a real name in the band and assert on measured geometry, not on the
// breakpoint that happens to implement it.
import { test, expect } from '@playwright/test';
import { searchAndOpen } from './helpers.js';

/** The DOM supabase-auth produces on sign-in. Signing in for real would need
 *  a live Supabase session; what the band cares about is the name's width. */
async function signInChip(page, name = 'Mike Beaumier') {
    await page.evaluate((who) => {
        document.getElementById('sign-in-btn')?.classList.add('hidden');
        document.getElementById('user-info')?.classList.remove('hidden');
        const initials = document.getElementById('user-avatar-initials');
        initials?.classList.remove('hidden');
        if (initials) initials.textContent = 'MB';
        document.getElementById('user-avatar')?.classList.add('hidden');
        const el = document.getElementById('user-name');
        if (el) el.textContent = who;
    }, name);
    await page.waitForTimeout(200);
}

/** Every visible control in the band, left to right, with its box. */
const BAND_CONTROLS = '.topbar-back, .topbar-brand, .topbar-nav-link, .topbar-action-btn, .pill, .topbar-icon-btn, #auth-section';

async function bandGeometry(page) {
    return page.evaluate((sel) => {
        const bar = document.getElementById('app-topbar');
        const controls = [...bar.querySelectorAll(sel)]
            .filter(el => el.getBoundingClientRect().width > 0)
            .map(el => ({ label: (el.textContent || el.id || '').trim().slice(0, 20), box: el.getBoundingClientRect() }))
            .sort((a, b) => a.box.left - b.box.left);

        const overlaps = [];
        for (let i = 0; i < controls.length - 1; i++) {
            const gap = controls[i + 1].box.left - controls[i].box.right;
            if (gap < -1) overlaps.push(`"${controls[i].label}" over "${controls[i + 1].label}" by ${Math.round(-gap)}px`);
        }

        const barBox = bar.getBoundingClientRect();
        return {
            density: bar.dataset.density,
            overlaps,
            // how far the rightmost control pokes past the band's edge
            spill: controls.length ? Math.round(Math.max(...controls.map(c => c.box.right)) - barBox.right) : 0,
            // a label that wrapped makes its own control taller than the band
            tallest: Math.round(Math.max(0, ...[...bar.querySelectorAll('.topbar-nav-link, .topbar-action-btn')]
                .map(el => el.getBoundingClientRect().height))),
            barHeight: Math.round(barBox.height),
            navInBand: [...bar.querySelectorAll('.topbar-nav-link')].filter(el => el.getBoundingClientRect().width > 0).length,
        };
    }, BAND_CONTROLS);
}

test.describe('Top band rolls up to fit', () => {
    // The reported width, plus the rest of the range the old breakpoint left
    // over-full, and the narrow end where the band must fully roll up.
    for (const width of [1440, 1000, 900, 860, 830, 820, 810, 800, 700, 640, 560, 480, 390, 330]) {
        test(`no control overlaps or spills at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await page.goto('/#work/nine-to-five');
            await page.waitForSelector('#app-topbar');
            await page.waitForSelector('.song-content, .song-view', { timeout: 20000 });
            await signInChip(page);

            const band = await bandGeometry(page);
            expect(band.overlaps, `controls collided at ${width}px`).toEqual([]);
            expect(band.spill, `band content ran past its right edge at ${width}px`).toBeLessThanOrEqual(1);
            // Nothing wrapped: a two-line label is ~40px against a 48px band
            expect(band.tallest, `a label wrapped at ${width}px`).toBeLessThan(34);
            expect(band.barHeight).toBe(48);
        });
    }

    test('sheds the display name before it sheds navigation', async ({ page }) => {
        await page.setViewportSize({ width: 820, height: 800 });
        await page.goto('/#work/nine-to-five');
        await page.waitForSelector('#app-topbar');
        await page.waitForSelector('.song-content, .song-view', { timeout: 20000 });
        await signInChip(page);

        // At the width that used to overlap, the band is rolled up but the
        // nav is still in it — the name went first.
        await expect(page.locator('#user-name')).toBeHidden();
        expect((await bandGeometry(page)).navInBand).toBeGreaterThan(0);
    });

    test('a longer display name starts rolling the band up at a wider window', async ({ page }) => {
        await page.goto('/#work/nine-to-five');
        await page.waitForSelector('#app-topbar');
        await page.waitForSelector('.song-content, .song-view', { timeout: 20000 });

        // The widest window at which this name no longer fits at full density.
        // Searched rather than hardcoded: the exact pixel depends on fonts,
        // and the property under test is the ORDER, not the number.
        async function rollUpWidth(name) {
            await signInChip(page, name);
            for (let width = 1000; width >= 700; width -= 10) {
                await page.setViewportSize({ width, height: 800 });
                await page.waitForTimeout(120);
                if ((await bandGeometry(page)).density !== 'full') return width;
            }
            return 0;
        }

        const short = await rollUpWidth('Al');
        const long = await rollUpWidth('Mike Beaumier');

        // Same band, same view, different content — which is the whole point.
        // A media query reports the same state for both; measuring does not.
        expect(long).toBeGreaterThan(short);
        expect((await bandGeometry(page)).overlaps).toEqual([]);
    });

    test('fully rolled up, the nav is still reachable in the ⋯ menu', async ({ page }) => {
        await page.setViewportSize({ width: 300, height: 700 });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await signInChip(page);

        expect((await bandGeometry(page)).density).toBe('nav-overflow');
        expect((await bandGeometry(page)).navInBand).toBe(0);

        await page.locator('#topbar-overflow-btn').click();
        const menu = page.locator('#topbar-overflow-menu');
        await expect(menu).toBeVisible();
        // the nav leads the menu, above the persistent entries
        await expect(menu.locator('.pill-popover-item').first()).toHaveText('Search');
        await expect(menu.locator('#overflow-nav-favorites')).toBeVisible();

        await menu.locator('#overflow-nav-favorites').click();
        await expect(page).toHaveURL(/#list\/favorites/);
    });

    test('widening the window puts the labels and the nav back', async ({ page }) => {
        await page.setViewportSize({ width: 300, height: 700 });
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await signInChip(page);
        expect((await bandGeometry(page)).navInBand).toBe(0);

        await page.setViewportSize({ width: 1440, height: 800 });
        await page.waitForTimeout(300);

        const band = await bandGeometry(page);
        expect(band.density).toBe('full');
        expect(band.navInBand).toBe(4);
        await expect(page.locator('#user-name')).toBeVisible();
        // and the nav is not left duplicated in the menu it came back from
        await expect(page.locator('#topbar-overflow-menu #overflow-nav-search')).toHaveCount(0);
    });
});
