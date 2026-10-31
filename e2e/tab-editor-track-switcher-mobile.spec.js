// G20a: on a phone the toolbar's Track row is hidden, so the track name above
// the tab is the switcher ("mandolin ▾ 1 of 4"). Driven through the front
// door with a real 4-track .tef.
import { test, expect } from './fixtures.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gotoFrontDoor, chooseFile } from './helpers/front-door.js';

const here = dirname(fileURLToPath(import.meta.url));
const FOUR_TRACK = resolve(here, '../tests/parser/fixtures/tabledit_306_blank_4track.tef');

const switcher = (page) => page.locator('.track-info .track-switcher-button');

async function openFile(page, file) {
    await gotoFrontDoor(page);
    await chooseFile(page, page.locator('.tab-open-file'), file);
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
}

/** Note count per track id, read from the editor's document. */
const notesByTrack = (page) => page.evaluate(() => {
    const otf = document.querySelector('.otf-editor').__otfEditor.state.otf;
    const out = {};
    for (const [id, ms] of Object.entries(otf.notation || {})) {
        out[id] = ms.reduce((n, m) => n + m.events.reduce((k, e) => k + e.notes.length, 0), 0);
    }
    return out;
});

test.describe('phone track switcher', () => {
    test('switch to Banjo with the ▾ and type a fret on it', async ({ page }) => {
        await openFile(page, FOUR_TRACK);
        await expect(page.locator('.track-section')).toBeHidden();
        await expect(switcher(page)).toHaveText(/ ▾ 1 of 4$/);
        await expect(switcher(page)).toHaveAttribute('aria-expanded', 'false');
        expect((await switcher(page).boundingBox()).height).toBeGreaterThanOrEqual(44);

        await switcher(page).tap();
        await expect(switcher(page)).toHaveAttribute('aria-expanded', 'true');
        const items = page.locator('.track-switcher-item');
        await expect(items).toHaveCount(4);
        await expect(items.first()).toHaveAttribute('aria-checked', 'true');
        await items.filter({ hasText: /banjo/i }).first().tap();

        await expect(page.locator('.track-switcher-list')).toHaveCount(0);
        await expect(switcher(page)).toHaveText(/^banjo.* ▾ \d of 4$/i);
        await expect(page.locator('.otf-editor')).toBeFocused();

        await page.keyboard.press('5');
        const counts = await notesByTrack(page);
        const banjoId = Object.keys(counts).find(id => /banjo/i.test(id));
        expect(counts[banjoId]).toBe(1);
        expect(Object.entries(counts).filter(([id]) => id !== banjoId)
            .every(([, n]) => n === 0)).toBe(true);
    });

    test('Escape closes the list', async ({ page }) => {
        await openFile(page, FOUR_TRACK);
        await switcher(page).tap();
        await expect(page.locator('.track-switcher-list')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.track-switcher-list')).toHaveCount(0);
        await expect(switcher(page)).toHaveAttribute('aria-expanded', 'false');
    });

    test('a one-track file shows no ▾', async ({ page }) => {
        await page.goto('/#new-tab?title=Solo&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await expect(page.locator('.track-info strong')).toBeVisible();
        await expect(switcher(page)).toHaveCount(0);
        await expect(page.locator('.track-info')).not.toContainText('▾');
    });
});
