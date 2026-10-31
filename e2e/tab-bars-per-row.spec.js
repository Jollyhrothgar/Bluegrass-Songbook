// G22: "Bars per row" in the tab's Display sheet, − Auto (n) +, an offset from
// the automatic count. The label states the count in use; the staff's row count
// follows it. Pressing Edit keeps the reader's row shape.
import { test, expect } from './fixtures.js';
import { openDock, closeSheet } from './helpers.js';
import { pressTabEdit } from './helpers/tab-edit.js';

const TAB = '/#work/foggy-mountain-breakdown/banjo-tab';
const KEY = 'bgb-tab-bars-offset';

const gotoTab = async (page) => {
    await page.goto(TAB);
    await page.locator('.tablature-container .stave-row').first().waitFor({ timeout: 20000 });
};
const rowCount = (page) => page.locator('.tablature-container:visible .stave-row').count();
/** "Auto (4)" -> {auto: 4, count: 4}; "5 (auto +1)" -> {count: 5} */
const readLabel = async (sheet) => {
    const text = await sheet.locator('#tab-bars-auto').textContent();
    return { text, count: Number(/\d+/.exec(text)[0]) };
};
const noSidewaysScroll = (page) => page.evaluate(() => {
    const widest = Math.max(...[...document.querySelectorAll('.tablature-container .stave-row svg')]
        .map(s => s.getBoundingClientRect().right));
    return { widest, inner: window.innerWidth, scroll: document.documentElement.scrollWidth };
});

test.describe('bars per row on a tab', () => {
    test('+ and - change the bars per row and the label; Auto resets', async ({ page }) => {
        await gotoTab(page);
        let sheet = await openDock(page, 'display');
        const auto = await readLabel(sheet);
        expect(auto.text).toMatch(/^Auto \(\d+\)$/);
        await expect(sheet.locator('#tab-bars-auto')).toBeDisabled();
        const autoRows = await rowCount(page);

        await sheet.locator('#tab-bars [data-bars="1"]').click();
        await expect(sheet.locator('#tab-bars-auto')).toHaveText(`${auto.count + 1} (auto +1)`);
        expect(await rowCount(page)).toBeLessThan(autoRows);

        await sheet.locator('#tab-bars [data-bars="-1"]').click();
        await sheet.locator('#tab-bars [data-bars="-1"]').click();
        await expect(sheet.locator('#tab-bars-auto')).toHaveText(`${auto.count - 1} (auto −1)`);
        expect(await rowCount(page)).toBeGreaterThan(autoRows);

        await sheet.locator('#tab-bars-auto').click();
        await expect(sheet.locator('#tab-bars-auto')).toHaveText(`Auto (${auto.count})`);
        expect(await rowCount(page)).toBe(autoRows);
        expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('0');
    });

    // Mike, 2026-10-31: "-" toggled between Auto and -1. The label grew from
    // "Auto (3)" to "2 (auto −1)", pushed "-" ~19px left, and the next tap
    // landed on the label, which resets. The buttons must not move.
    test('the buttons stay put as the label changes, so - keeps stepping down', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        const minus = sheet.locator('#tab-bars [data-bars="-1"]');
        const before = await minus.boundingBox();
        const auto = await readLabel(sheet);
        for (let i = 1; i <= 2; i++) {
            // tap where "-" was at the start, as a finger would
            await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
            await expect(sheet.locator('#tab-bars-auto')).toHaveText(`${auto.count - i} (auto −${i})`);
            expect(await minus.boundingBox()).toEqual(before);
        }
    });

    // Mike, 2026-10-31: "the bars should expand to fill the width of the page,
    // rather than just stopping" (fewer bars than auto stopped at the 288px cap).
    test('fewer bars than fit still fill the row', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        const fullRow = await page.evaluate(() => document.querySelector('.tablature-container .stave-row svg').getBoundingClientRect().width);
        for (let i = 0; i < 3; i++) await sheet.locator('#tab-bars [data-bars="-1"]').click();
        await closeSheet(page);
        const row = await page.evaluate(() => document.querySelector('.tablature-container .stave-row svg').getBoundingClientRect().width);
        expect(row).toBeGreaterThanOrEqual(fullRow - 2);
    });

    test('is remembered across a reload', async ({ page }) => {
        await gotoTab(page);
        let sheet = await openDock(page, 'display');
        const auto = await readLabel(sheet);
        await sheet.locator('#tab-bars [data-bars="1"]').click();
        expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('1');
        await page.reload();
        await page.locator('.tablature-container .stave-row').first().waitFor({ timeout: 20000 });
        sheet = await openDock(page, 'display');
        await expect(sheet.locator('#tab-bars-auto')).toHaveText(`${auto.count + 1} (auto +1)`);
    });

    test('the - end is disabled at one bar', async ({ page }) => {
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        const down = sheet.locator('#tab-bars [data-bars="-1"]');
        for (let i = 0; i < 8 && await down.isEnabled(); i++) await down.click();
        await expect(down).toBeDisabled();
        await expect(sheet.locator('#tab-bars-auto')).toHaveText(/^1 \(auto −\d+\)$|^Auto \(1\)$/);
    });

    for (const width of [360, 1440]) {
        test(`never runs sideways at ${width}px, even at the + limit`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await gotoTab(page);
            const sheet = await openDock(page, 'display');
            const up = sheet.locator('#tab-bars [data-bars="1"]');
            for (let i = 0; i < 8 && await up.isEnabled(); i++) await up.click();
            await expect(up).toBeDisabled();
            await closeSheet(page);
            const m = await noSidewaysScroll(page);
            expect(m.widest).toBeLessThanOrEqual(m.inner + 1);
            expect(m.scroll).toBeLessThanOrEqual(m.inner + 1);
        });
    }

    test('an offset re-fits when the window resizes', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 800 });
        await gotoTab(page);
        let sheet = await openDock(page, 'display');
        await sheet.locator('#tab-bars [data-bars="1"]').click();
        await closeSheet(page);
        await page.setViewportSize({ width: 360, height: 800 });
        await expect.poll(async () => (await noSidewaysScroll(page)).widest).toBeLessThanOrEqual(361);
        sheet = await openDock(page, 'display');
        await expect(sheet.locator('#tab-bars-auto')).toHaveText(/auto \+1\)|Auto/);
    });

    test('pressing Edit after +1 keeps the reader\'s bars per row', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoTab(page);
        const sheet = await openDock(page, 'display');
        await sheet.locator('#tab-bars [data-bars="1"]').click();
        const { count } = await readLabel(sheet);
        await closeSheet(page);
        await pressTabEdit(page, { waitForEditor: true });
        const pinned = await page.evaluate(() =>
            document.querySelector('.otf-editor').__otfEditor.renderer._computedMeasuresPerRow);
        expect(pinned).toBe(count);
    });
});
