// Rectangular selection, driven the way a person drives it: a mouse drag
// across a real published tab.
//
// `red-haired-boy`'s banjo take is the fixture because it is a single
// 5-string track in 2/4 with notes on every string in measures 2-4 — so
// "strings 3-5 of measures 2-4" is a block with something in it, and
// strings 1-2 are the control group that must come out untouched.
//
// Every claim about the DOCUMENT is read from the live facade through the
// editor's QA handle (`.otf-editor.__otfEditor`); every claim about the
// HIGHLIGHT is read from real bounding boxes against the string lines the
// renderer drew.
import { test, expect } from '@playwright/test';

const WORK = '/#work/red-haired-boy/banjo';

const band = (page) => page.locator('#app-bottomband');

async function openBanjoEditor(page) {
    await page.goto(WORK);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
    await band(page).locator('.tab-edit-btn').click();
    await page.locator('.editor-renderer .stave-row').first()
        .waitFor({ timeout: 20000 });
    await expect(page.locator('.otf-editor')).toBeVisible();
}

/**
 * Viewport point of (measure, string), `frac` of the way across the
 * measure's note area — computed from the renderer's own geometry, so it
 * lands where the renderer actually drew that string and measure.
 */
function pointFor(page, measure, string, frac = 0.3) {
    return page.evaluate(([m, s, f]) => {
        const ed = document.querySelector('.otf-editor').__otfEditor;
        const r = ed.cursor.renderer;
        const opt = r.options;
        const row = r.rowData.find(rw => rw.measures.some(g => g.display === m));
        const geom = row.measures.find(g => g.display === m);
        const noteX0 = (geom.noteX0 ?? geom.x + 15) + (geom.noteOffset ?? 0);
        const noteW = geom.noteW ?? geom.width - 30;
        const xSvg = noteX0 + f * noteW;
        const ySvg = opt.topMargin + (s - 1) * opt.stringSpacing;
        const rect = row.svg.getBoundingClientRect();
        const vb = row.svg.viewBox.baseVal;
        return {
            x: rect.left + xSvg * (rect.width / vb.width),
            y: rect.top + ySvg * (rect.height / vb.height),
        };
    }, [measure, string, frac]);
}

/** Viewport y of each string line in the row that holds `measure`. */
function stringYs(page, measure) {
    return page.evaluate((m) => {
        const ed = document.querySelector('.otf-editor').__otfEditor;
        const r = ed.cursor.renderer;
        const opt = r.options;
        const row = r.rowData.find(rw => rw.measures.some(g => g.display === m));
        const rect = row.svg.getBoundingClientRect();
        const vb = row.svg.viewBox.baseVal;
        const sy = rect.height / vb.height;
        const out = {};
        for (let s = 1; s <= ed.state.getStringCount(); s++) {
            out[s] = rect.top + (opt.topMargin + (s - 1) * opt.stringSpacing) * sy;
        }
        return out;
    }, measure);
}

/** Every note in the edited track as `measure:tick:string=fret`. */
function notes(page) {
    return page.evaluate(() => {
        const ed = document.querySelector('.otf-editor').__otfEditor;
        const { facade, trackId } = ed.state;
        const out = [];
        for (const measure of facade.getNotation(trackId)) {
            for (const event of measure.events) {
                for (const note of event.notes) {
                    out.push(`${measure.measure}:${event.tick}:${note.s}=${note.f}`);
                }
            }
        }
        return out;
    });
}

const inMeasures = (list, ms) =>
    list.filter(n => ms.includes(Number(n.split(':')[0])));
const onStrings = (list, ss) =>
    list.filter(n => ss.includes(Number(n.split(':')[2].split('=')[0])));

/** Drag from string 3 of measure 2 to string 5 of measure 4. */
async function dragBlock(page) {
    const from = await pointFor(page, 2, 3, 0.1);
    const to = await pointFor(page, 4, 5, 0.9);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.editor-selection-rect').first()).toBeVisible();
}

test.describe('the selection is a rectangle', () => {
    test('a drag from string 3 to string 5 selects exactly those strings', async ({ page }) => {
        await openBanjoEditor(page);
        await dragBlock(page);

        expect(await page.evaluate(
            () => document.querySelector('.otf-editor').__otfEditor.state.selectionStrings()
        )).toEqual([3, 4, 5]);
        await expect(page.locator('.mode-indicator')).toContainText('VISUAL');
    });

    test('the highlight covers strings 3-5 and never reaches 1-2', async ({ page }) => {
        await openBanjoEditor(page);
        await dragBlock(page);

        const ys = await stringYs(page, 2);
        const rects = page.locator('.editor-selection-rect');
        const count = await rects.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
            const box = await rects.nth(i).boundingBox();
            // Below string 2's line, above (or level with) string 3's…
            expect(box.y).toBeGreaterThan(ys[2]);
            expect(box.y).toBeLessThanOrEqual(ys[3]);
            // …and it reaches string 5 without running off the staff.
            const bottom = box.y + box.height;
            expect(bottom).toBeGreaterThanOrEqual(ys[5]);
            expect(bottom).toBeLessThan(ys[5] + (ys[5] - ys[4]));
        }
    });

    test('a drag along ONE string selects that string alone', async ({ page }) => {
        await openBanjoEditor(page);
        const from = await pointFor(page, 2, 4, 0.1);
        const to = await pointFor(page, 3, 4, 0.9);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 6 });
        await page.mouse.up();
        await expect(page.locator('.editor-selection-rect').first()).toBeVisible();

        expect(await page.evaluate(
            () => document.querySelector('.otf-editor').__otfEditor.state.selectionStrings()
        )).toEqual([4]);
    });
});

test.describe('block edits act on the rectangle only', () => {
    test('Delete removes strings 3-5 of measures 2-4 and nothing else', async ({ page }) => {
        await openBanjoEditor(page);
        const before = await notes(page);
        const controls = onStrings(inMeasures(before, [2, 3, 4]), [1, 2]);
        const untouched = inMeasures(before, [1, 5, 6, 7, 8]);
        expect(onStrings(inMeasures(before, [2, 3, 4]), [3, 4, 5]).length)
            .toBeGreaterThan(0);   // the block really has notes in it

        await dragBlock(page);
        await page.keyboard.press('Delete');

        const after = await notes(page);
        expect(onStrings(inMeasures(after, [2, 3, 4]), [3, 4, 5])).toEqual([]);
        expect(onStrings(inMeasures(after, [2, 3, 4]), [1, 2])).toEqual(controls);
        expect(inMeasures(after, [1, 5, 6, 7, 8])).toEqual(untouched);
    });

    test('+ raises every selected fret by one and leaves strings 1-2 alone', async ({ page }) => {
        await openBanjoEditor(page);
        const before = await notes(page);
        const controls = onStrings(inMeasures(before, [2, 3, 4]), [1, 2]);
        const raised = onStrings(inMeasures(before, [2, 3, 4]), [3, 4, 5])
            .map(n => {
                const [pos, fret] = n.split('=');
                return `${pos}=${Number(fret) + 1}`;
            });

        await dragBlock(page);
        await page.keyboard.press('+');

        const after = await notes(page);
        expect(onStrings(inMeasures(after, [2, 3, 4]), [3, 4, 5])).toEqual(raised);
        expect(onStrings(inMeasures(after, [2, 3, 4]), [1, 2])).toEqual(controls);
    });

    test('Ctrl+z takes the whole block back in ONE step', async ({ page }) => {
        await openBanjoEditor(page);
        const before = await notes(page);

        await dragBlock(page);
        await page.keyboard.press('+');
        expect(await notes(page)).not.toEqual(before);

        await page.keyboard.press('Control+z');
        await expect(async () => {
            expect(await notes(page)).toEqual(before);
        }).toPass();
    });

    test('a refused block + says so in the status bar and changes nothing', async ({ page }) => {
        await openBanjoEditor(page);
        // Park a fret 24 inside the block: the whole +1 must then refuse.
        await page.evaluate(() => {
            const ed = document.querySelector('.otf-editor').__otfEditor;
            ed.state.cursor.measure = 3;
            ed.state.cursor.tick = 0;
            ed.state.cursor.string = 4;
            ed.state.insertNote(24);
        });
        const before = await notes(page);

        await dragBlock(page);
        await page.keyboard.press('+');

        await expect(page.locator('.editor-status-bar .status-flash'))
            .toContainText(/refused/i);
        expect(await notes(page)).toEqual(before);
    });
});

test.describe('the keyboard grows the same rectangle', () => {
    test('Shift+ArrowDown adds a string, Shift+ArrowRight adds ticks', async ({ page }) => {
        await openBanjoEditor(page);
        const start = await pointFor(page, 2, 3, 0.1);
        await page.mouse.click(start.x, start.y);

        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');
        expect(await page.evaluate(
            () => document.querySelector('.otf-editor').__otfEditor.state.selectionStrings()
        )).toEqual([3, 4, 5]);

        const width = await page.evaluate(() => {
            const r = document.querySelector('.otf-editor').__otfEditor.state.selectionRange();
            return r.endAbs - r.startAbs;
        });
        await page.keyboard.press('Shift+ArrowRight');
        const wider = await page.evaluate(() => {
            const r = document.querySelector('.otf-editor').__otfEditor.state.selectionRange();
            return r.endAbs - r.startAbs;
        });
        expect(wider).toBeGreaterThan(width);
        // …and the height did not change with it
        expect(await page.evaluate(
            () => document.querySelector('.otf-editor').__otfEditor.state.selectionStrings()
        )).toEqual([3, 4, 5]);
    });

    test('Ctrl+A is still the whole column of the measure', async ({ page }) => {
        await openBanjoEditor(page);
        const start = await pointFor(page, 2, 3, 0.1);
        await page.mouse.click(start.x, start.y);
        await page.keyboard.press('Control+a');

        expect(await page.evaluate(
            () => document.querySelector('.otf-editor').__otfEditor.state.selectionStrings()
        )).toEqual([1, 2, 3, 4, 5]);
    });
});
