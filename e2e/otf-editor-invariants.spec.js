// Layout and history INVARIANTS for the tab editor — rules that must hold
// after any sequence of edits, checked against what is actually drawn.
//
// The checks live in the app (`otf-editor/automation.js`: layout() measures
// the drawn ruler lines, fret digits, rests and cursor against the
// barlines; check() applies the rules), so the same call works here and
// from a browser session on the live site:
//
//   document.querySelector('.otf-editor').__otfEditor.automation.check()
//
// What these caught first: per-measure note centering put an EMPTY bar's
// tick 0 in its middle, so the ruler started mid-bar and ran half a bar
// past the barline, notes slid left as you typed, and rests landed in the
// next measure. Every check below failed on that build.
import { test, expect } from '@playwright/test';

async function openDemo(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    // no native dialog may ever open in the tab editor (e2e/CLAUDE.md)
    page.on('dialog', d => { errors.push(`native dialog: ${d.message()}`); d.dismiss(); });
    await page.goto('/editor-demo.html');
    await page.locator('.editor-renderer .stave-row').first().waitFor();
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
    await page.keyboard.press('Control+Home');
    await settle(page);
    return errors;
}

/** Two frames: the editor refreshes its overlays on a double rAF. */
const settle = (page) => page.evaluate(() => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(r))));

const auto = (page, fn, arg) => page.evaluate(([src, a]) => {
    const api = document.querySelector('.otf-editor').__otfEditor.automation;
    return new Function('api', 'arg', `return (${src})(api, arg)`)(api, a);
}, [fn.toString(), arg]);

const violations = async (page) => { await settle(page); return auto(page, api => api.check()); };

test.describe('tab editor layout invariants', () => {
    test('an empty tab is sane at every step size', async ({ page }) => {
        const errors = await openDemo(page);
        expect(await violations(page)).toEqual([]);
        for (const sub of ['480', '240', '120', '60']) {
            await page.locator(`.grid-btn[data-subdivision="${sub}"]`).click();
            expect(await violations(page), `step ${sub}`).toEqual([]);
        }
        expect(errors).toEqual([]);
    });

    test('changing the cursor step never resizes or reflows the tab', async ({ page }) => {
        // Mike, 2026-10-21: 1/8 → 1/16 → 1/32 shrank the whole tab to ~0.58x
        // and it never came back. The step had set a minimum measure width
        // (and ratcheted it); with the row count pinned, rows outgrew the
        // container and CSS scaled them down.
        await page.setViewportSize({ width: 1700, height: 1000 });
        const errors = await openDemo(page);
        const shape = () => auto(page, api => api.layout().measures
            .map(m => [m.measure, m.row, Math.round(m.left), Math.round(m.right)]));
        const before = await shape();
        for (const sub of ['240', '120', '60', '160', '480']) {
            await page.locator(`.grid-btn[data-subdivision="${sub}"]`).click();
            await settle(page);
            expect(await shape(), `step ${sub}`).toEqual(before);
            expect(await violations(page), `step ${sub}`).toEqual([]);
        }
        expect(errors).toEqual([]);
    });

    test('zooming in makes every 1/32 step visible and clickable (A21)', async ({ page }) => {
        // Mike, 2026-10-21: cursor step and note length both 1/32, and the
        // 32nds landed a 16th apart. At 1/32 a desktop slot was 4.7px, so
        // the ruler drew every OTHER line and clicking the drawn lines
        // skipped a step each time. Horizontal zoom gives the step room.
        await page.setViewportSize({ width: 1440, height: 900 });
        const errors = await openDemo(page);
        await page.locator('.duration-button[data-duration="60"]').click();
        await page.locator('.grid-btn[data-subdivision="60"]').click();
        await settle(page);
        const m2Lines = () => auto(page, api => api.layout().ruler.filter(r => r.measure === 2));
        expect((await m2Lines()).some(l => l.hidden), 'zoom 1 thins the 1/32 ruler').toBe(true);

        for (let i = 0; i < 6 && (await m2Lines()).some(l => l.hidden); i++) {
            await page.locator('.zoom-in-button').click();
            await settle(page);
        }
        expect((await m2Lines()).some(l => l.hidden), 'zoomed in, every line draws').toBe(false);
        expect(await violations(page)).toEqual([]);

        // Click the first four drawn lines of bar 2 and type a 0 at each
        for (const tick of [0, 60, 120, 180]) {
            const t = await auto(page, (api, tick) => {
                const l = api.layout();
                const m = l.measures.find(x => x.measure === 2);
                const line = l.ruler.find(r => r.measure === 2 && r.tick === tick);
                return { x: line.x, y: m.strings[2] };
            }, tick);
            await page.mouse.click(t.x, t.y);
            await page.keyboard.press('0');
            await settle(page);
        }
        const ticks = await auto(page, api => api.doc().notation[Object.keys(api.doc().notation)[0]]
            .find(m => m.measure === 2).events.map(e => [e.tick, e.notes[0].dur]));
        expect(ticks).toEqual([[0, 60], [60, 60], [120, 60], [180, 60]]);
        expect(await violations(page)).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('a row zoomed wider than the canvas scrolls, and stays measurable', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 800 });
        const errors = await openDemo(page);
        const zoomIn = page.locator('.zoom-in-button');
        while (await zoomIn.isEnabled()) await zoomIn.click();   // to the top level
        await settle(page);
        const { scrollW, clientW } = await page.evaluate(() => {
            const c = document.querySelector('.editor-canvas-container');
            return { scrollW: c.scrollWidth, clientW: c.clientWidth };
        });
        expect(scrollW).toBeGreaterThan(clientW);
        // walk to the far end of bar 1: the canvas scrolls to keep the
        // cursor in view, and ruler/notes/cursor still agree
        await auto(page, api => api.setCursor({ measure: 1, tick: 1860, string: 3 }));
        await settle(page);
        expect(await page.evaluate(() =>
            document.querySelector('.editor-canvas-container').scrollLeft)).toBeGreaterThan(0);
        expect(await violations(page)).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('an empty measure\'s ruler starts at its left barline', async ({ page }) => {
        await openDemo(page);
        const { m, first } = await auto(page, api => {
            const l = api.layout();
            const m = l.measures.find(x => x.measure === 2);
            const first = Math.min(...l.ruler.filter(r => r.measure === 2).map(r => r.x));
            return { m, first };
        });
        // tick 0 within the first eighth of the bar — not in its middle
        expect(first - m.left).toBeLessThan((m.right - m.left) / 8);
    });

    test('clicking a ruler line puts the cursor on that tick', async ({ page }) => {
        await openDemo(page);
        const targets = await auto(page, api => {
            const l = api.layout();
            const m = l.measures.find(x => x.measure === 2);
            return l.ruler.filter(r => r.measure === 2)
                .map(r => ({ tick: r.tick, x: r.x, y: m.strings[2] }));
        });
        expect(targets.length).toBeGreaterThan(1);
        for (const t of targets) {
            await page.mouse.click(t.x, t.y);
            expect(await auto(page, api => api.cursor()), `tick ${t.tick}`)
                .toMatchObject({ measure: 2, tick: t.tick, string: 3 });
        }
    });

    test('typing a note does not move the notes already typed', async ({ page }) => {
        await openDemo(page);
        await auto(page, api => api.setCursor({ measure: 2, tick: 0, string: 3 }));
        const xs = [];
        // frets that can't combine into one two-digit fret (2 then 3 is 23)
        for (const fret of ['0', '5', '7', '9']) {
            await page.keyboard.press(fret);
            await settle(page);
            const notes = await auto(page, api => api.layout().notes
                .filter(n => n.measure === 2).sort((a, b) => a.tick - b.tick)
                .map(n => n.x));
            // every earlier note is where it was a keystroke ago
            expect(notes.slice(0, xs.length).map(Math.round)).toEqual(xs.map(Math.round));
            xs.push(notes[notes.length - 1]);
            expect(await violations(page)).toEqual([]);
        }
    });

    test('a two-digit fret is undone in one step', async ({ page }) => {
        await openDemo(page);
        const before = await auto(page, api => api.doc());
        await page.keyboard.press('1');
        await page.keyboard.press('2');
        await page.keyboard.press('Control+z');
        expect(await auto(page, api => api.doc())).toEqual(before);
    });
});

// ----------------------------------------------------------------------
// A seeded random walk through the binding table. Each step presses one
// chord a person could press, then requires: no layout rule broken, no
// page error. At the end, undo must take the document all the way back.
// A failure prints the seed and the keys so far — paste them into a test.

const KEYS = [
    ...'0123456789'.split(''), '1', '2', '3', '5', '7',      // frets, weighted
    'Shift+Digit0', 'Shift+Digit2', 'Shift+Digit3',          // stack a chord
    'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Shift+ArrowRight', 'Shift+ArrowLeft', 'Shift+ArrowDown', 'Escape',
    'Tab', 'Shift+Tab', '.', 'Enter', ',', ';', 'Home', 'End',
    'q', 'e', '=', '<', '>', 'J',                            // durations
    'h', 'p', 's', 'm', 'l', 'n', 'b', 'c', 'g', 'r', '/',   // effects
    '+', '-', 'Alt+ArrowUp', 'Alt+ArrowDown',
    'Delete', 'Backspace', 'Insert', 'Control+m', 'Alt+r',
    'Control+c', 'Control+x', 'Control+v', 'Control+z', 'Control+y',
    '[', ']',                                                // step size
];

function rng(seed) {   // mulberry32
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test.describe('random editing walk', () => {
    const SEEDS = process.env.WALK_SEEDS
        ? process.env.WALK_SEEDS.split(',').map(Number)
        : [1, 2, 3];
    for (const seed of SEEDS) {
        test(`seed ${seed}: 120 keys keep the layout sane, undo restores the doc`, async ({ page }) => {
            test.setTimeout(120_000);
            const errors = await openDemo(page);
            const initial = await auto(page, api => api.doc());
            const rand = rng(seed);
            const pressed = [];
            for (let i = 0; i < 120; i++) {
                const key = KEYS[Math.floor(rand() * KEYS.length)];
                pressed.push(key);
                await page.keyboard.press(key);
                const v = await violations(page);
                expect(v, `seed ${seed} after ${JSON.stringify(pressed)}`).toEqual([]);
                expect(errors, `seed ${seed} after ${JSON.stringify(pressed)}`).toEqual([]);
                // keys must keep reaching the editor (a Tab once leaked focus)
                expect(await page.evaluate(() => !!document.activeElement?.closest('.otf-editor')),
                    `seed ${seed}: focus left the editor after ${JSON.stringify(pressed)}`).toBe(true);
            }
            // Undo everything, one Ctrl+Z per step on the undo stack. It
            // must land exactly on the starting document.
            await page.keyboard.press('Escape');
            const { index } = await auto(page, api => api.history());
            for (let i = 0; i <= index; i++) await page.keyboard.press('Control+z');
            const hist = await auto(page, api => api.history());
            expect(hist.index, `seed ${seed}: ${hist.steps.join(' | ')}`).toBe(-1);
            expect(await auto(page, api => api.doc()),
                `seed ${seed}: ${JSON.stringify(pressed)}\nhistory: ${hist.steps.join(' | ')}`)
                .toEqual(initial);
        });
    }
});
