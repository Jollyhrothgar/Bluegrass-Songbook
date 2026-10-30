// E2E for the chord chart on the song page (G18b2, re-homed in G19b): Old Home
// Place is the one song with a chart. Structure only: its chords can be edited
// from the site, so the exact numbers live in Vitest against a frozen copy
// (docs/js/__tests__/chord-chart-view.test.js).
//
// The chart has no controls of its own: View is Lyrics | Chart (Lyrics | Lyrics
// + Chart | Chart on a wide screen) and the chart's choices are in Display ▸ Chart.
import { test, expect } from './fixtures.js';
import { openDock, closeSheet } from './helpers.js';

const open = async (page, { column = true } = {}) => {
    await page.goto('/#work/old-home-place');
    await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
    // the chart column loads lazily, a moment after the lyrics (wide only)
    if (column) await page.locator('.cc-sec').first().waitFor({ state: 'attached' });
};

const view = (page, id) => page.locator(`#dock-view [data-view="${id}"]`);
const chartRows = (page) => page.locator('.cc-sec').first().locator('.cc-line');
const cellsIn = (line) => line.locator('.cc-cell');

async function chartOption(page, group, value) {
    const sheet = await openDock(page, 'display');
    await sheet.locator(`#${group} [data-value="${value}"]`).click();
    await closeSheet(page);
}

test.describe('Chord chart, wide screens', () => {
    test.beforeEach(async ({ page }) => { await open(page); });

    test('View offers Lyrics | Lyrics + Chart | Chart, and starts on the two columns', async ({ page }) => {
        await expect(page.locator('#dock-view [data-view]')).toHaveText(['Lyrics', 'Lyrics + Chart', 'Chart']);
        await expect(view(page, 'both')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#part-tabs')).toHaveCount(0);
        const column = page.locator('.cc-chart-col');
        await expect(column).toBeVisible();
        await expect(column.locator('.cc-cap b', { hasText: 'Verse' })).toBeVisible();
        await expect(column.locator('.cc-cap b', { hasText: 'Chorus' })).toBeVisible();
        await expect(column.locator('.cc-by')).toContainText('Chart by');
        await expect(page.locator('.cc-lyrics #chord-view .cl-chord').first()).toBeVisible();
        const lyrics = await page.locator('.cc-lyrics').boundingBox();
        const chart = await column.boundingBox();
        expect(chart.x).toBeGreaterThan(lyrics.x + lyrics.width - 1);
        // and it has no controls of its own
        await expect(column.locator('button')).toHaveCount(0);
    });

    test('Lyrics drops the chart column, Chart shows the chart alone, and the choice is remembered', async ({ page }) => {
        await view(page, 'lyrics').click();
        await expect(page.locator('.cc-cols, .cc-chart-col')).toHaveCount(0);
        await expect(page.locator('.song-body')).toBeVisible();
        await page.reload();
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
        await expect(view(page, 'lyrics')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.cc-cols, .cc-chart-col')).toHaveCount(0);

        await view(page, 'chart').click();
        await expect(page.locator('.cc-tab .cc-sec').first()).toBeVisible();
        await expect(page.locator('.song-body')).toHaveCount(0);
        await expect(page).toHaveURL(/\/chart$/);

        await view(page, 'both').click();
        await expect(page.locator('.cc-chart-col .cc-sec').first()).toBeVisible();
        await expect(page.locator('.cc-lyrics .cl-chord').first()).toBeVisible();
    });

    test('Display ▸ Chart: cells per row wraps each section, and is remembered', async ({ page }) => {
        const first = chartRows(page);
        const perRow = await cellsIn(first.first()).count();
        expect(perRow).toBe(4);                      // the default
        const total = await page.locator('.cc-sec').first().locator('.cc-cell').count();

        await chartOption(page, 'pill-chart-cells', 2);
        await expect(cellsIn(chartRows(page).first())).toHaveCount(2);
        await expect(chartRows(page)).toHaveCount(total / 2);

        await chartOption(page, 'pill-chart-cells', 8);
        await expect(cellsIn(chartRows(page).first())).toHaveCount(8);

        await page.reload();
        await page.locator('.cc-sec').first().waitFor({ state: 'attached' });
        await expect(cellsIn(chartRows(page).first())).toHaveCount(8);
        const sheet = await openDock(page, 'display');
        await expect(sheet.locator('#pill-chart-cells .active')).toHaveText('8');
    });

    test('Display ▸ Chart: Two cells halves the bar count, and is remembered', async ({ page }) => {
        const bars = page.locator('.cc-chart .cc-bar');
        const one = await bars.count();
        expect(one).toBeGreaterThan(0);
        await chartOption(page, 'pill-chart-bars', 2);
        await expect(bars).toHaveCount(one / 2);
        await page.reload();
        await expect(page.locator('.cc-chart .cc-bar')).toHaveCount(one / 2);
        await chartOption(page, 'pill-chart-bars', 1);
        await expect(page.locator('.cc-chart .cc-bar')).toHaveCount(one);
    });

    test('Display ▸ Chart: As sung unrolls the form, named and counted', async ({ page }) => {
        await expect(page.locator('.cc-sec')).toHaveCount(2);
        await chartOption(page, 'pill-chart-order', 'sung');
        await expect(page.locator('.cc-sec')).toHaveCount(7);
        await expect(page.locator('.cc-cap span').first()).toHaveText('1 of 7');
        await expect(page.locator('.cc-cap b').nth(2)).toHaveText('Chorus');
        await expect(page.locator('.cc-form')).toHaveCount(0);
        await chartOption(page, 'pill-chart-order', 'once');
        await expect(page.locator('.cc-sec')).toHaveCount(2);
    });

    test('Size scales the chart with the lyrics', async ({ page }) => {
        const slot = page.locator('.cc-chart-col .cc-slot').first();
        const lyric = page.locator('.song-body').first();
        const px = (loc) => loc.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        const [s0, l0] = [await px(slot), await px(lyric)];
        await page.locator('#dock-size [data-size="1"]').click();
        await expect.poll(() => px(slot)).toBeGreaterThan(s0);
        await expect.poll(() => px(lyric)).toBeGreaterThan(l0);
        const ratio = (await px(slot)) / (await px(lyric));
        expect(ratio).toBeCloseTo(s0 / l0, 1);        // they grow together
        await page.locator('#dock-size [data-size="-1"]').click();
        await expect.poll(() => px(slot)).toBeCloseTo(s0, 0);
    });

    test('the chart column sticks under the top dock, not under a guess', async ({ page }) => {
        const top = await page.evaluate(() => getComputedStyle(document.querySelector('.cc-chart-col')).top);
        const h = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
        expect(parseFloat(h)).toBe(48);
        expect(parseFloat(top)).toBeGreaterThan(48);
        expect(parseFloat(top)).toBeLessThan(48 + 24);
    });

    test('the Key sheet moves the chart, and Nashville turns it into numbers', async ({ page }) => {
        const first = page.locator('.cc-chart .cc-slot:not(.cc-hold)').first();
        const before = await first.textContent();
        const sheet = await openDock(page, 'key');
        const current = (await sheet.locator('.pill-current-key').textContent())?.trim();
        const next = current === 'A' ? 'G' : 'A';
        await sheet.locator(`.pill-key-btn[data-key="${next}"]`).click();
        await expect(page.locator('#dock-key-btn')).toContainText(`Key: ${next}`);
        await expect(first).not.toHaveText(before);
        await expect(first).toHaveText(await page.locator('.cc-lyrics .cl-chord').filter({ hasText: /\S/ }).first().textContent());

        await sheet.locator('.pill-nashville-btn').click();
        await expect(first).toHaveText(/^[IiVv]+$/);
    });
});

test.describe('Chord chart, narrow screens', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('View is Lyrics | Chart; the chart is its own page of the song', async ({ page }) => {
        await open(page, { column: false });
        await expect(page.locator('.cc-chart-col')).toHaveCount(0);
        await expect(page.locator('#part-tabs')).toHaveCount(0);
        await expect(page.locator('#dock-view [data-view]')).toHaveText(['Lyrics', 'Chart']);
        await expect(view(page, 'lyrics')).toHaveAttribute('aria-pressed', 'true');
        await view(page, 'chart').click();
        await expect(page.locator('.cc-tab .cc-sec').first()).toBeVisible();
        await expect(page).toHaveURL(/\/chart$/);
        // the dock stays, with its Key and Size, and the chart scales
        await expect(page.locator('#dock-key-btn')).toBeVisible();
        await expect(page.locator('.cc-head, .cc-seg-btn')).toHaveCount(0);   // no Practice mode, no header
        await view(page, 'lyrics').click();
        await expect(page.locator('.song-body')).toBeVisible();
    });

    test('a deep link to the chart opens it, and widening the window keeps it', async ({ page }) => {
        await page.goto('/#work/old-home-place/chart');
        await expect(page.locator('.cc-tab .cc-sec').first()).toBeVisible({ timeout: 20000 });
        await page.setViewportSize({ width: 1200, height: 800 });
        await expect(page.locator('#dock-view [data-view]')).toHaveText(['Lyrics', 'Lyrics + Chart', 'Chart']);
        await expect(view(page, 'chart')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.cc-tab .cc-sec').first()).toBeVisible();
    });

    test('a wide choice of Lyrics + Chart is Lyrics here', async ({ page }) => {
        await page.goto('/#work/old-home-place');
        await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
        await expect(page.locator('.cc-cols')).toHaveCount(0);
        await expect(view(page, 'lyrics')).toHaveAttribute('aria-pressed', 'true');
    });
});

test('a song without a chart has no chart column or View, and no Chart group in Display', async ({ page }) => {
    await page.goto('/#work/your-cheating-heart');
    await expect(page.locator('.cl-chord').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.cc-cols, .cc-chart-col')).toHaveCount(0);
    await expect(page.locator('#dock-view, #dock-view-btn')).toHaveCount(0);
    const sheet = await openDock(page, 'display');
    await expect(sheet.locator('#pill-chart-cells')).toHaveCount(0);
});
