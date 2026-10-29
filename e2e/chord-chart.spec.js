// E2E for the chord chart on the song page (G18b2): Old Home Place is the one
// song with a chart. Structure only: its chords and the verse 2 mismatch can
// be edited from the site, so the exact numbers live in Vitest against a
// frozen copy (docs/js/__tests__/chord-chart-view.test.js).
import { test, expect } from './fixtures.js';
import { openPill } from './helpers.js';

const open = async (page) => {
    await page.goto('/#work/old-home-place');
    await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
    // the chart loads lazily, a moment after the lyrics
    await page.locator('.cc-sec').first().waitFor({ state: 'attached' });
};

test.describe('Chord chart, wide screens', () => {
    test.beforeEach(async ({ page }) => { await open(page); });

    test('is a column beside the lyrics, with a Verse and a Chorus, and no tabs', async ({ page }) => {
        const column = page.locator('.cc-chart-col');
        await expect(column).toBeVisible();
        await expect(column.locator('.cc-cap b', { hasText: 'Verse' })).toBeVisible();
        await expect(column.locator('.cc-cap b', { hasText: 'Chorus' })).toBeVisible();
        await expect(column.locator('.cc-by')).toContainText('Chart by');
        await expect(page.locator('.cc-lyrics #chord-view .cl-chord').first()).toBeVisible();
        await expect(page.locator('#part-tabs')).toBeHidden();
        const lyrics = await page.locator('.cc-lyrics').boundingBox();
        const chart = await column.boundingBox();
        expect(chart.x).toBeGreaterThan(lyrics.x + lyrics.width - 1);
    });

    test('Two cells halves the bar count, and the choice is remembered', async ({ page }) => {
        const bars = page.locator('.cc-chart .cc-bar');
        const one = await bars.count();
        expect(one).toBeGreaterThan(0);
        await page.getByRole('button', { name: 'Two cells' }).click();
        await expect(bars).toHaveCount(one / 2);
        await page.reload();
        await expect(page.locator('.cc-chart .cc-bar')).toHaveCount(one / 2);
        await page.getByRole('button', { name: 'One cell' }).click();
        await expect(page.locator('.cc-chart .cc-bar')).toHaveCount(one);
    });

    test('Practice shows the 7 sections of the playing order beside the lyrics', async ({ page }) => {
        await page.getByRole('button', { name: 'Practice' }).click();
        await expect(page.locator('.cc-psec')).toHaveCount(7);
        await expect(page.locator('.cc-psec').first().locator('.cc-pchart .cc-line').first()).toBeVisible();
        // no playback yet (G18d)
        await expect(page.locator('.cc-psec.now, .cc-playing')).toHaveCount(0);
        const row = page.locator('.cc-prow').first();
        const lyric = await row.locator('.cc-plyric').boundingBox();
        const chart = await row.locator('.cc-pchart').boundingBox();
        expect(chart.x).toBeGreaterThan(lyric.x);
        await page.getByRole('button', { name: 'Chart', exact: true }).click();
        await expect(page.locator('.cc-psec')).toHaveCount(0);
        await expect(page.locator('.cc-chart-col .cc-sec').first()).toBeVisible();
    });

    test('the Key pill moves the chart, and Nashville turns it into numbers', async ({ page }) => {
        const first = page.locator('.cc-chart .cc-slot:not(.cc-hold)').first();
        const before = await first.textContent();
        const popover = await openPill(page, 'key-pill');
        const current = (await popover.locator('.pill-current-key').textContent())?.trim();
        const next = current === 'A' ? 'G' : 'A';
        await popover.locator(`.pill-key-btn[data-key="${next}"]`).click();
        await expect(page.locator('#key-pill .pill-label')).toContainText(`Key of ${next}`);
        await expect(first).not.toHaveText(before);
        await expect(first).toHaveText(await page.locator('.cc-lyrics .cl-chord').filter({ hasText: /\S/ }).first().textContent());

        await popover.locator('.pill-nashville-btn').click();
        await expect(first).toHaveText(/^[IiVv]+$/);
    });
});

test.describe('Chord chart, narrow screens', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a Chart tab beside Lyrics, whose practice mode puts each chart line under its lyric line', async ({ page }) => {
        await open(page);
        await expect(page.locator('.cc-chart-col')).toBeHidden();
        const tabs = page.locator('#part-tabs');
        await expect(tabs.getByRole('button', { name: 'Lyrics' })).toBeVisible();
        await tabs.getByRole('button', { name: 'Chart' }).click();
        await expect(page.locator('.cc-tab .cc-sec').first()).toBeVisible();
        await expect(page).toHaveURL(/\/chart$/);

        await page.getByRole('button', { name: 'Practice' }).click();
        await expect(page.locator('.cc-psec')).toHaveCount(7);
        const row = page.locator('.cc-prow').first();
        const lyric = await row.locator('.cc-plyric .song-line').boundingBox();
        const chart = await row.locator('.cc-pchart .cc-line').boundingBox();
        expect(chart.y).toBeGreaterThan(lyric.y);
        await expect(page.locator('.cc-psec').first().locator('.cc-prow')).toHaveCount(4);
    });

    test('a deep link to the Chart tab opens it, and widening the window leaves the tab', async ({ page }) => {
        await page.goto('/#work/old-home-place/chart');
        await expect(page.locator('.cc-tab .cc-sec').first()).toBeVisible({ timeout: 20000 });
        await page.setViewportSize({ width: 1200, height: 800 });
        await expect(page.locator('.cc-chart-col')).toBeVisible();
        await expect(page.locator('.cc-tab')).toHaveCount(0);
    });
});

test('a wide deep link to the Chart tab lands on the lead sheet with the column', async ({ page }) => {
    await page.goto('/#work/old-home-place/chart');
    await expect(page.locator('.cc-chart-col')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.cc-tab')).toHaveCount(0);
});

test('a song without a chart has no chart column or tab', async ({ page }) => {
    await page.goto('/#work/beautiful-home');
    await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.cc-cols, .cc-chart-col')).toHaveCount(0);
});
