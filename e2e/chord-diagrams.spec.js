// Chord diagrams (G15d3): a .tef whose chord table is imported draws its chord
// boxes above the owning track's staff in the tab editor, and they move with
// the measures. The file is the hand-built tests/parser/fixtures/
// chord_diagrams_v3.tef (a banjo and a guitar track, four diagrams), taken
// from the golden oracle like the other import specs.
import { test, expect } from './fixtures.js';
import { clickFileItem } from './helpers/front-door.js';
import { tefFixture } from './helpers/tef-fixture.js';

const band = (page) => page.locator('#app-bottomband');

async function importFixture(page) {
    const fixture = tefFixture('chord_diagrams_v3.tef');
    await page.goto('/index.html#new-tab?title=Empty%20Take&instrument=banjo');
    await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        clickFileItem(page, 'Import .tef'),
    ]);
    await chooser.setFiles(fixture.file);
    await expect(band(page).locator('.tab-edit-status'))
        .toContainText(`Imported ${fixture.file.name}`, { timeout: 20000 });
    return fixture;
}

test.describe('chord diagrams in the tab editor', () => {
    test('an imported chord table draws boxes for the track being edited', async ({ page }) => {
        const fixture = await importFixture(page);
        expect(fixture.otf.chord_diagrams).toHaveLength(4);

        // The editor shows the first track (banjo): its two diagrams, not the guitar's.
        const boxes = page.locator('.editor-renderer .chord-diagram');
        await expect(boxes.first()).toBeVisible();
        await expect(boxes).toHaveCount(2);

        // D has a shape, Am7 is just a name; the "G" text annotation sits at
        // m1 +240, a different place from either, so no name is suppressed.
        const d = page.locator('.editor-renderer .chord-diagram[data-chord="2"]');
        await expect(d.locator('.chord-name')).toHaveText('D');
        await expect(d.locator('.chord-dot')).not.toHaveCount(0);
        await expect(page.locator('.editor-renderer .chord-diagram[data-chord="1"] .chord-name'))
            .toHaveText('Am7');

        // above the strings: the box's bottom edge is over the first string line
        const geometry = await page.evaluate(() => {
            const box = document.querySelector('.editor-renderer .chord-diagram[data-chord="2"]');
            const svg = box.ownerSVGElement;
            const stringY = Math.min(...[...svg.querySelectorAll(':scope > line')]
                .filter(l => l.getAttribute('y1') === l.getAttribute('y2'))
                .map(l => Number(l.getAttribute('y1'))));
            const r = box.getBoundingClientRect();
            const s = svg.getBoundingClientRect();
            const scale = s.height / Number(svg.viewBox.baseVal.height);
            return { boxBottom: (r.bottom - s.top) / scale, stringY };
        });
        expect(geometry.boxBottom).toBeLessThanOrEqual(geometry.stringY);
    });

    test('fits a phone-width screen', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await importFixture(page);
        const boxes = page.locator('.editor-renderer .chord-diagram');
        await expect(boxes.first()).toBeVisible();
        const { svgWidth, rights } = await page.evaluate(() => {
            const first = document.querySelector('.editor-renderer .chord-diagram');
            const svg = first.ownerSVGElement;
            const sr = svg.getBoundingClientRect();
            return {
                svgWidth: sr.width,
                rights: [...svg.querySelectorAll('.chord-diagram')].map(b => [
                    b.getBoundingClientRect().left - sr.left, b.getBoundingClientRect().right - sr.left]),
            };
        });
        for (const [l, r] of rights) {
            expect(l).toBeGreaterThanOrEqual(-1);
            expect(r).toBeLessThanOrEqual(svgWidth + 1);
        }
    });

    test('deleting a measure takes its diagrams with it, and undo brings them back', async ({ page }) => {
        await importFixture(page);
        const boxes = page.locator('.editor-renderer .chord-diagram');
        await expect(boxes).toHaveCount(2);
        const diagrams = () => page.evaluate(() =>
            document.querySelector('.otf-editor').__otfEditor.state.facade.export().chord_diagrams
                .map(d => [d.measure, d.track, d.chord]));
        expect(await diagrams()).toEqual([[1, 'guitar', 0], [1, 'banjo', 2], [2, 'banjo', 1], [2, 'guitar', 4]]);

        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('Control+Home');
        await page.locator('.otf-menu-bar .menu-trigger[data-menu="edit"]').click();
        await page.locator('.menu-popup .menu-item', { hasText: 'Delete measure' }).first().click();
        expect(await diagrams()).toEqual([[1, 'banjo', 1], [1, 'guitar', 4]]);
        await expect(boxes).toHaveCount(1);
        await expect(boxes.first().locator('.chord-name')).toHaveText('Am7');

        await page.locator('.otf-menu-bar .menu-trigger[data-menu="edit"]').click();
        await page.locator('.menu-popup .menu-item', { hasText: 'Undo' }).first().click();
        expect(await diagrams()).toEqual([[1, 'guitar', 0], [1, 'banjo', 2], [2, 'banjo', 1], [2, 'guitar', 4]]);
        await expect(boxes).toHaveCount(2);
    });
});
