// G22: "Bars per row" in the tab's Display sheet, [Auto] − n +.
//   Auto (the default) reads the music and the window and re-fits on resize;
//   − / + leave it for an EXACT count that a resize does not change (until it
//   cannot fit: "4 · 3 fit"). Each window keeps its own choice; the latest seeds
//   a new one. Pressing Edit keeps the reader's row shape.
import { test, expect } from './fixtures.js';
import { openDock, closeSheet } from './helpers.js';
import { pressTabEdit } from './helpers/tab-edit.js';

const TAB = '/#work/foggy-mountain-breakdown/banjo-tab';
const DENSE_TAB = '/#work/brown-county-breakdown/banjo-tab';   // 32nds, the densest banjo tab in works/
const KEY = 'bgb-tab-bars';

const gotoTab = async (page, url = TAB) => {
    await page.goto(url);
    await page.locator('.tablature-container .stave-row').first().waitFor({ timeout: 20000 });
};
const rowCount = (page) => page.locator('.tablature-container:visible .stave-row').count();
const countText = (sheet) => sheet.locator('#tab-bars-count').textContent();
const pressed = (sheet) => sheet.locator('#tab-bars-auto').getAttribute('aria-pressed');
/** The number Auto (or the choice) shows, with the sheet opened and closed again. */
const shown = async (page) => {
    const sheet = await openDock(page, 'display');
    const text = await countText(sheet);
    const isAuto = (await pressed(sheet)) === 'true';
    await closeSheet(page);
    return { text, count: Number(/\d+/.exec(text)[0]), isAuto };
};
const resize = async (page, width) => {
    await page.setViewportSize({ width, height: 800 });
    // the renderer re-fits on a debounced ResizeObserver
    await page.waitForTimeout(400);
};
const noSidewaysScroll = (page) => page.evaluate(() => {
    const widest = Math.max(...[...document.querySelectorAll('.tablature-container .stave-row svg')]
        .map(s => s.getBoundingClientRect().right));
    return { widest, inner: window.innerWidth, scroll: document.documentElement.scrollWidth };
});
const minus = (sheet) => sheet.locator('#tab-bars [data-bars="-1"]');
const plus = (sheet) => sheet.locator('#tab-bars [data-bars="1"]');

test.describe('bars per row on a tab', () => {
    test('Auto is the default, pressed, and shows the count it chose', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        expect(await pressed(sheet)).toBe('true');
        expect(await countText(sheet)).toMatch(/^\d$/);
        expect(await page.evaluate((k) => [sessionStorage.getItem(k), localStorage.getItem(k)], KEY)).toEqual([null, null]);
    });

    test('- and + leave Auto from its count and set an exact one; Auto returns', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        const auto = Number(await countText(sheet));
        const autoRows = await rowCount(page);

        await plus(sheet).click();
        await expect(sheet.locator('#tab-bars-count')).toHaveText(String(auto + 1));
        expect(await pressed(sheet)).toBe('false');
        expect(await rowCount(page)).toBeLessThanOrEqual(autoRows);

        await minus(sheet).click();
        await minus(sheet).click();
        await expect(sheet.locator('#tab-bars-count')).toHaveText(String(auto - 1));
        expect(await rowCount(page)).toBeGreaterThan(autoRows);
        expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(String(auto - 1));

        await sheet.locator('#tab-bars-auto').click();
        await expect(sheet.locator('#tab-bars-count')).toHaveText(String(auto));
        expect(await pressed(sheet)).toBe('true');
        expect(await rowCount(page)).toBe(autoRows);
        expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('auto');
    });

    // Mike, 2026-10-31: "if I set rows to 2 and then make the window broader, it
    // eventually rolls over to 3." An exact count is exact.
    test('an exact count survives a resize: set 2, widen the window, still 2', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 800 });
        await gotoTab(page);
        let sheet = await openDock(page, 'display');
        for (let i = 0; i < 8 && (await countText(sheet)) !== '2'; i++) {
            await ((await countText(sheet)) > '2' ? minus(sheet) : plus(sheet)).click();
        }
        await expect(sheet.locator('#tab-bars-count')).toHaveText('2');
        await closeSheet(page);
        const rowsAt2 = await rowCount(page);
        for (const width of [1200, 1800]) {
            await resize(page, width);
            expect(await rowCount(page)).toBe(rowsAt2);
            expect(await shown(page)).toMatchObject({ text: '2', isAuto: false });
        }
    });

    test('Auto re-fits when the window resizes', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const wide = (await shown(page)).count;
        await resize(page, 600);
        const narrow = await shown(page);
        expect(narrow.isAuto).toBe(true);
        expect(narrow.count).toBeLessThan(wide);
    });

    test('a count that does not fit says so ("5 · n fit") and comes back with room', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        let sheet = await openDock(page, 'display');
        for (let i = 0; i < 8 && (await countText(sheet)) !== '5'; i++) {
            await ((await countText(sheet)) > '5' ? minus(sheet) : plus(sheet)).click();
        }
        await expect(sheet.locator('#tab-bars-count')).toHaveText('5');
        await closeSheet(page);
        await resize(page, 420);
        sheet = await openDock(page, 'display');
        await expect(sheet.locator('#tab-bars-count')).toHaveText(/^5 · [1-4] fit$/);
        await expect(plus(sheet)).toBeDisabled();
        await closeSheet(page);
        const m = await noSidewaysScroll(page);
        expect(m.widest).toBeLessThanOrEqual(m.inner + 1);
        await resize(page, 1440);
        expect(await shown(page)).toMatchObject({ text: '5', isAuto: false });
    });

    // Mike, 2026-10-31: "-" toggled between Auto and -1; the label grew, pushed "-"
    // left, and the next tap landed on the wrong control. The buttons must not move.
    test('the buttons stay put as the number changes, so - keeps stepping down', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        const before = await minus(sheet).boundingBox();
        const plusBefore = await plus(sheet).boundingBox();
        const auto = Number(await countText(sheet));
        for (let i = 1; i <= 2; i++) {
            // tap where "-" was at the start, as a finger would
            await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
            await expect(sheet.locator('#tab-bars-count')).toHaveText(String(auto - i));
            expect(await minus(sheet).boundingBox()).toEqual(before);
            expect(await plus(sheet).boundingBox()).toEqual(plusBefore);
        }
    });

    // Mike, 2026-10-31: "the bars should expand to fill the width of the page,
    // rather than just stopping" (fewer bars than auto stopped at the 288px cap).
    test('fewer bars than fit still fill the row', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        const fullRow = await page.evaluate(() => document.querySelector('.tablature-container .stave-row svg').getBoundingClientRect().width);
        for (let i = 0; i < 3; i++) await minus(sheet).click();
        await closeSheet(page);
        const row = await page.evaluate(() => document.querySelector('.tablature-container .stave-row svg').getBoundingClientRect().width);
        expect(row).toBeGreaterThanOrEqual(fullRow - 2);
    });

    test('the - end is disabled at one bar, and + at the most that fit', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        for (let i = 0; i < 8 && await minus(sheet).isEnabled(); i++) await minus(sheet).click();
        await expect(minus(sheet)).toBeDisabled();
        await expect(sheet.locator('#tab-bars-count')).toHaveText('1');
        for (let i = 0; i < 8 && await plus(sheet).isEnabled(); i++) await plus(sheet).click();
        await expect(plus(sheet)).toBeDisabled();
        await expect(sheet.locator('#tab-bars-count')).toHaveText('8');
    });

    for (const width of [360, 1440]) {
        test(`never runs sideways at ${width}px, even at the + limit`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await gotoTab(page);
            const sheet = await openDock(page, 'display');
            for (let i = 0; i < 8 && await plus(sheet).isEnabled(); i++) await plus(sheet).click();
            await expect(plus(sheet)).toBeDisabled();
            await closeSheet(page);
            const m = await noSidewaysScroll(page);
            expect(m.widest).toBeLessThanOrEqual(m.inner + 1);
            expect(m.scroll).toBeLessThanOrEqual(m.inner + 1);
        });
    }

    test('is kept across a reload of the same window', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        await minus(sheet).click();
        const set = await countText(sheet);
        await page.reload();
        await page.locator('.tablature-container .stave-row').first().waitFor({ timeout: 20000 });
        expect(await shown(page)).toMatchObject({ text: set, isAuto: false });
    });

    test('each window keeps its own choice; the latest seeds a new window', async ({ page, context }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        let sheet = await openDock(page, 'display');
        for (let i = 0; i < 8 && (await countText(sheet)) !== '3'; i++) {
            await ((await countText(sheet)) > '3' ? minus(sheet) : plus(sheet)).click();
        }
        await expect(sheet.locator('#tab-bars-count')).toHaveText('3');

        // a new window: empty sessionStorage, so it starts from the latest choice
        const other = await context.newPage();
        await other.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(other);
        expect(await shown(other)).toMatchObject({ text: '3', isAuto: false });

        // it sets its own; the first window is untouched, also across a reload
        sheet = await openDock(other, 'display');
        await plus(sheet).click();
        await expect(sheet.locator('#tab-bars-count')).toHaveText('4');
        await closeSheet(other);
        await page.reload();
        await page.locator('.tablature-container .stave-row').first().waitFor({ timeout: 20000 });
        expect(await shown(page)).toMatchObject({ text: '3', isAuto: false });
        expect(await shown(other)).toMatchObject({ text: '4', isAuto: false });

        // and the latest choice, Auto included, is what the next new window gets
        sheet = await openDock(other, 'display');
        await sheet.locator('#tab-bars-auto').click();
        await closeSheet(other);
        const third = await context.newPage();
        await third.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(third);
        expect((await shown(third)).isAuto).toBe(true);
    });

    // Mike: "if there's a ton of 64th notes … the auto should make the bars a bit
    // wider because otherwise the notes will be horridly cramped."
    test('Auto gives a dense tab fewer bars per row than a sparse one at the same width', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sparse = (await shown(page)).count;
        await gotoTab(page, DENSE_TAB);
        const dense = await shown(page);
        expect(dense.isAuto).toBe(true);
        expect(dense.count).toBeLessThan(sparse);
    });

    test('pressing Edit after + keeps the reader\'s bars per row', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        await minus(sheet).click();
        const count = Number(await countText(sheet));
        await closeSheet(page);
        await pressTabEdit(page, { waitForEditor: true });
        const pinned = await page.evaluate(() =>
            document.querySelector('.otf-editor').__otfEditor.renderer._computedMeasuresPerRow);
        expect(pinned).toBe(count);
    });
});
