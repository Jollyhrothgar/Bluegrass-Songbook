// E2E for the lead-sheet editor on a phone (390px, touch): Lyrics | Chords | ChordPro.
//   Lyrics    the platform's own typing, paste, selection; chords visible but inert
//   Chords    the chart is locked (no keyboard, no selection); the chord sheet is docked at the
//             bottom, its trackpad strip steps the box seam by seam, Move / Remove act on a chord
//   ChordPro  Source | Preview, never stacked
// Playwright cannot raise a real phone keyboard or emulate iOS selection handles; the plan's
// real-device test covers those. These drive taps with the touchscreen and the strip with
// synthetic pointer events.
import { test, expect } from './fixtures.js';
import {
    CM, SHEET, openFrozenOldHomePlace, setLead, leadText, leadReady, setMode, openEditor, boxPos, boxAt, syllableCentres, scrollLineToTop,
    boxState, lineEndPoint, centreOf, touchDrag, along, boxStopKind, stepKinds, segmentRects,
} from './helpers/lead-editor.js';

const LEAD = '#editor-lead';

// The top magnifier is OFF by default. Everything below that exercises the strip turns it on first
// (it is a per-device setting, `bgb-chord-magnifier`); the describe named "magnifier default and nav row"
// starts from a clean device instead.
test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.titlePath.some((t) => t.startsWith('magnifier default'))) return;
    await page.addInitScript(() => localStorage.setItem('bgb-chord-magnifier', '1'));
});
const CHORDS = `${CM} .cl-chord:not(.cl-chord-gap)`;

/** Tap a syllable (by seam) with a finger, from where it is drawn RIGHT NOW (a tap can move the line). */
async function tapSyllable(page, lineText, cached, rowAbove = false) {
    const s = (await syllableCentres(page, lineText)).find((c) => c.seam === cached.seam) || cached;
    const y = rowAbove ? s.top - s.h * 0.45 : s.y;
    await page.touchscreen.tap(s.x, y);
    return s;
}

test.describe('Lyrics mode on a phone', () => {
    test('the chart is editable; chords are visible but inert; no sheet', async ({ page }) => {
        await openEditor(page);
        await setLead(page, '[G]Hello [C]there');
        await expect(page.locator(CM)).toHaveAttribute('contenteditable', 'true');
        await page.locator(CHORDS).first().tap();
        await expect(page.locator(SHEET)).toBeHidden();
        await expect(page.locator(`${CM} .cl-box-chord, ${CM} .cl-slot`)).toHaveCount(0);
    });

    test('the empty sheet: the Paste button works by touch', async ({ page }) => {
        await openEditor(page);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { readText: async () => 'Title: Pasted\n\nG       C\nAmazing grace how sweet\nD       G\nThat saved a wretch' },
            });
        });
        const btn = page.locator(`${LEAD} .le-paste-btn`);
        await btn.tap();
        await expect(page.locator(CHORDS).first()).toBeVisible();
        expect(await leadText(page)).toMatch(/\[G\]Amazing/);
    });

    // On a plain-http page (the tailnet dev URL) the browser will not let a button read the clipboard: a Paste button
    // there did nothing but show a small hint. No dead button: the instruction is shown up front instead.
    test('where the page cannot read the clipboard there is no Paste button, just how to paste', async ({ page }) => {
        await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
        await openEditor(page);
        await expect(page.locator(`${LEAD} .le-empty`)).toBeVisible();
        await expect(page.locator(`${LEAD} .le-paste-btn`)).toHaveCount(0);
        await expect(page.locator(`${LEAD} .le-paste-hint`)).toBeVisible();
        await expect(page.locator(`${LEAD} .le-paste-hint`)).toHaveText('Tap and hold here, then Paste');
    });

    test('selecting lines shows the section bar and there is one selection highlight', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Line one\nLine two\n\nLine three');
        await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            editor.view.focus();
            editor.view.dispatch({ selection: { anchor: 2, head: 14 } });
        });
        await expect(page.locator('.le-selbar')).toBeVisible();
        await expect(page.locator(`${LEAD} .cm-selectionBackground`)).toHaveCount(0);
        await expect(page.locator(`${LEAD} .cm-selectionHandle`)).toHaveCount(0);
        await page.locator('.le-selbar [data-wrap="verse"]').tap();
        expect(await leadText(page)).toContain('{start_of_verse: Verse 1}\nLine one\nLine two\n{end_of_verse}');
    });

    // On a phone the iOS selection menu (Cut / Copy / Paste) draws right where a floating bar sat, above the selection
    // start, and the keyboard covers the bottom: the bar DOCKS at the bottom of the visual viewport (above the keyboard).
    test('on a phone the section bar docks at the bottom of the visible screen, clear of the selection start, and still works', async ({ page }) => {
        await openEditor(page);
        await setLead(page, Array.from({ length: 24 }, (_, i) => `Line number ${i + 1}`).join('\n'));
        const select = (a, b) => page.evaluate(([anchor, head]) => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            editor.view.focus();
            editor.view.dispatch({ selection: { anchor, head } });
        }, [a, b]);
        const place = () => page.evaluate(() => {
            const bar = document.querySelector('.le-selbar').getBoundingClientRect();
            const vv = window.visualViewport;
            const { editor } = document.querySelector('#editor-lead').__lead;
            const start = editor.view.coordsAtPos(editor.view.state.selection.main.from);
            return { top: bar.top, bottom: bar.bottom, left: bar.left, right: bar.right, vvTop: vv.offsetTop, vvBottom: vv.offsetTop + vv.height,
                vw: innerWidth, startTop: start ? start.top : null, startBottom: start ? start.bottom : null,
                docked: document.querySelector('.le-selbar').classList.contains('le-selbar-docked') };
        });
        await select(2, 30);
        await expect(page.locator('.le-selbar')).toBeVisible();
        let p = await place();
        expect(p.docked).toBe(true);
        expect(p.bottom).toBeLessThanOrEqual(p.vvBottom);
        expect(p.bottom).toBeGreaterThan(p.vvBottom - 30);                 // at the bottom, not floating mid-screen
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.right).toBeLessThanOrEqual(p.vw);
        expect(p.top > p.startBottom || p.bottom < p.startTop).toBe(true);  // not over the selection start (iOS's menu spot)
        const cut = await page.evaluate(() => [...document.querySelectorAll('.le-selbar button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).map((b) => b.textContent));
        expect(cut, 'every section type is in view').toEqual([]);
        // the selection start scrolled off the top: the bar stays where it is, on screen
        await page.evaluate(() => window.scrollBy(0, 400));
        p = await place();
        expect(p.top).toBeGreaterThanOrEqual(p.vvTop);
        expect(p.bottom).toBeLessThanOrEqual(p.vvBottom);
        await page.locator('.le-selbar [data-wrap="chorus"]').tap();
        expect(await leadText(page)).toMatch(/\{start_of_chorus[^}]*\}\nLine number 1\nLine number 2\nLine number 3\n\{end_of_chorus\}/);
    });

    for (const how of ['Enter', 'blur', 'Add']) {
        test(`section bar > Other... > type Solo > ${how} makes a solo section, with no page error`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await openEditor(page);
            await setLead(page, 'Line one\nLine two\n\nLine three');
            await page.evaluate(() => {
                const { editor } = document.querySelector('#editor-lead').__lead;
                editor.view.focus();
                editor.view.dispatch({ selection: { anchor: 2, head: 14 } });
            });
            await page.locator('.le-selbar [data-wrap="*"]').tap();
            const field = page.locator('.le-selbar-field');
            await expect(field).toBeFocused();
            await field.pressSequentially('Solo');
            if (how === 'Enter') await page.keyboard.press('Enter');
            else if (how === 'Add') await page.locator('.le-selbar-add').tap();
            else await page.evaluate(() => document.querySelector('.le-selbar-field').blur());
            await expect.poll(() => leadText(page)).toContain('{start_of_solo: Solo}');
            await expect(page.locator('.le-selbar-field')).toHaveCount(0);
            expect(errors).toEqual([]);
        });
    }
});

test.describe('rows are where the finger is (no height-map drift)', () => {
    test('posAtCoords at the middle of every line of old-home-place returns that line (phone viewport)', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        const res = await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            const view = editor.view;
            const wrong = [];
            let checked = 0;
            for (const el of document.querySelectorAll('#editor-lead .cm-line')) {
                const r = el.getBoundingClientRect();
                if (r.height < 4) continue;
                const want = view.state.doc.lineAt(view.posAtDOM(el, 0)).number;
                const pos = view.posAtCoords({ x: r.left + 30, y: r.top + r.height / 2 }, false);
                checked++;
                const got = pos == null ? -1 : view.state.doc.lineAt(pos).number;
                if (got !== want) wrong.push({ want, got });
            }
            return { wrong, checked };
        });
        expect(res.checked).toBeGreaterThan(15);
        expect(res.wrong).toEqual([]);
    });
});

test.describe('Chords mode on a phone', () => {
    test('the panel is split: magnifier docked at the top, picker at the bottom; the chart is locked (no keyboard, no selection)', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        const sheet = page.locator(SHEET);
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveClass(/chm-split/);
        const m = await page.evaluate(() => {
            const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height }; };
            const cs = getComputedStyle(document.documentElement);
            return { strip: r('.chm-strip'), body: r('.chm-body'), band: r('.app-topbar'), stripVar: cs.getPropertyValue('--chm-strip-h'), pickerVar: cs.getPropertyValue('--chm-picker-h') };
        });
        const vh = page.viewportSize().height;
        expect(Math.round(m.body.bottom)).toBe(vh);                                  // the picker is at the bottom
        expect(Math.abs(m.strip.top - m.band.bottom)).toBeLessThanOrEqual(1);        // the magnifier is right under the top band
        expect(m.strip.bottom).toBeLessThan(vh / 3);
        expect(m.body.top).toBeGreaterThan(m.strip.bottom + 100);                    // a real gap between them
        expect(parseInt(m.stripVar)).toBe(Math.ceil(m.strip.h));                     // published like --bottomband-h
        expect(parseInt(m.pickerVar)).toBe(Math.ceil(m.body.h));
        await expect(page.locator(CM)).toHaveAttribute('contenteditable', 'false');
        const cs = await page.locator(CM).evaluate((el) => {
            const s = getComputedStyle(el);
            return { us: s.userSelect || s.webkitUserSelect, callout: s.webkitTouchCallout };
        });
        expect(cs.us).toBe('none');
        // a tap never selects text or raises a keyboard (nothing is focused)
        await page.locator(CM).tap();
        expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
        expect(await page.evaluate(() => document.activeElement === document.querySelector('#editor-lead .cm-content'))).toBe(false);
    });

    // An EXISTING chart, signed out: the fork notice is inserted into the action row. Squeezed
    // into that non-wrapping row it made the page 482px wide on a 390px phone; the browser then
    // grew the layout viewport (innerHeight 1044) and the position:fixed sheet sat 200px below
    // the visible screen — its chords untappable. #add has no notice, so only this route shows it.
    test('editing an existing chart: no sideways overflow, and the docked sheet is tappable by finger', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await expect(page.locator('#editor-fork-notice')).toBeVisible();
        const fit = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
            inner: window.innerHeight,
            visual: Math.round(window.visualViewport.height),
        }));
        expect(fit.scroll).toBeLessThanOrEqual(fit.client);
        expect(fit.inner).toBe(fit.visual);
        await setMode(page, 'chords');
        // the docked sheet covers the lower half of a 664px-tall phone: bring the line above it
        await scrollLineToTop(page, 'In the hollow');
        const hollow = (await syllableCentres(page, 'In the hollow')).find((s) => s.text.startsWith('low'));
        await page.touchscreen.tap(hollow.x, hollow.y);
        const cell = page.locator(`${SHEET} .chm-cell[data-chord="D"]`);
        const c = await cell.boundingBox();
        expect(c.y + c.height).toBeLessThanOrEqual(fit.visual);
        // what a finger at the cell's centre actually hits is the cell (not the chart behind it)
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.chm-cell')?.dataset.chord,
            { x: c.x + c.width / 2, y: c.y + c.height / 2 })).toBe('D');
        await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
        expect(await leadText(page)).toContain('In the hol[D]low');
    });

    test('tap a syllable: the box lands on it; tap a chord in the sheet: it is placed', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        const how = (await syllableCentres(page, 'Amazing')).find((s) => s.text.startsWith('how'));
        await page.touchscreen.tap(how.x, how.y);
        expect(await boxPos(page)).toBe(how.seam);
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).tap();
        expect(await leadText(page)).toBe('Amazing grace [D]how sweet');
    });

    test('the strip: dragging with a finger steps the box; the arrows step too', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet\nsecond line here');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
        const strip = page.locator(`${SHEET} .chm-strip-view`);
        await expect(strip).toBeVisible();
        const before = await boxPos(page);
        const b = await strip.boundingBox();
        // a one-finger drag, as the touch pointer events a phone sends
        await page.evaluate(({ x, y }) => {
            const el = document.querySelector('.chm-strip-view');
            const o = { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true };
            el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y, button: 0 }));
            for (let i = 1; i <= 10; i++) window.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + i * 8, clientY: y }));
            window.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + 80, clientY: y }));
        }, { x: b.x + 20, y: b.y + b.height / 2 });
        // 80px at 22px per seam: three steps
        const at = await boxAt(page);
        expect(await boxPos(page)).toBeGreaterThan(before);
        expect(at.lyricsBefore.length).toBeGreaterThan(0);
        const p = await boxPos(page);
        await page.locator(`${SHEET} .chm-next`).tap();
        expect(await boxPos(page)).toBeGreaterThan(p);
        await page.locator(`${SHEET} .chm-down`).tap();
        expect((await boxAt(page)).line).toBe(2);
        await page.locator(`${SHEET} .chm-up`).tap();
        expect((await boxAt(page)).line).toBe(1);
        await page.locator(`${SHEET} .chm-prev`).tap();
    });

    test('tap a chord on the chart: Remove and Move appear; Move carries the chord with the strip', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace how sweet');
        await setMode(page, 'chords');
        const sheet = page.locator(SHEET);
        await expect(sheet.locator('.chm-remove')).toBeHidden();
        await page.locator(`${CM} .cl-chord-glyph`).first().tap();
        await expect(sheet.locator('.chm-remove')).toBeVisible();
        await sheet.locator('.chm-move').tap();
        await page.evaluate(({ x, y }) => {
            const el = document.querySelector('.chm-strip-view');
            const o = { pointerId: 6, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true };
            el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y, button: 0 }));
            for (let i = 1; i <= 6; i++) window.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + i * 8, clientY: y }));
            window.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + 48, clientY: y }));
        }, await (async () => { const b = await page.locator(`${SHEET} .chm-strip-view`).boundingBox(); return { x: b.x + 20, y: b.y + b.height / 2 }; })());
        const text = await leadText(page);
        expect(text.match(/\[G\]/g)).toHaveLength(1);
        expect(text).not.toBe('Amazing [G]grace how sweet');   // it travelled
        expect(text.replace('[G]', '')).toBe('Amazing grace how sweet');
        await sheet.locator('.chm-move').tap();                 // drop
        await sheet.locator('.chm-remove').tap();
        expect(await leadText(page)).toBe('Amazing grace how sweet');
    });

    test('tapping a chord that already sits on a syllable replaces it', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [C]grace');
        await setMode(page, 'chords');
        await page.locator(`${CM} .cl-chord-glyph`).first().tap();
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).tap();
        expect(await leadText(page)).toBe('Amazing [D]grace');
    });
});

test.describe('Chords mode: tap to seam', () => {
    // every syllable of Verse 1 and Verse 2 of old-home-place, tapped at its centre with a finger
    const LINES = [
        "ten long", 'In the hollow', 'cool fall', 'And the fox hunter',
        'I fell in', 'I thought that', 'I ran', 'And worked in a',
    ];

    test('tapping the centre of a syllable lands the box on that syllable (>= 94%)', async ({ page }) => {
        await openFrozenOldHomePlace(page);
        await setMode(page, 'chords');
        let total = 0;
        const misses = [];
        for (const needle of LINES) {
            await scrollLineToTop(page, needle);
            const list = await syllableCentres(page, needle);
            for (const c of list) {
                const s = await tapSyllable(page, needle, c);
                total++;
                if ((await boxPos(page)) !== s.seam) misses.push(`${needle} "${s.text}"`);
                // the box and sheet can scroll the page: bring the line back before the next tap
                await scrollLineToTop(page, needle);
            }
        }
        const rate = (total - misses.length) / total;
        console.log(`syllable tap hit rate: ${total - misses.length}/${total} = ${(rate * 100).toFixed(1)}%`, misses.slice(0, 8));
        expect(total).toBeGreaterThan(50);
        expect(rate).toBeGreaterThanOrEqual(0.94);
    });

    test('tapping the chord row above a syllable lands on that syllable (>= 94%)', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await setMode(page, 'chords');
        let total = 0;
        const misses = [];
        for (const needle of LINES) {
            await scrollLineToTop(page, needle);
            const list = await syllableCentres(page, needle);
            for (const c of list) {
                const s = await tapSyllable(page, needle, c, true);
                total++;
                if ((await boxPos(page)) !== s.seam) misses.push(`${needle} "${s.text}"`);
                await scrollLineToTop(page, needle);
            }
        }
        const rate = (total - misses.length) / total;
        console.log(`chord-row tap hit rate: ${total - misses.length}/${total} = ${(rate * 100).toFixed(1)}%`, misses.slice(0, 8));
        expect(rate).toBeGreaterThanOrEqual(0.94);
    });
});

test.describe('ChordPro mode on a phone', () => {
    test('Source | Preview toggle, never stacked', async ({ page }) => {
        await openEditor(page);
        await setLead(page, '[G]Hello [C]there');
        await setMode(page, 'chordpro');
        await expect(page.locator('#editor-pane-toggle')).toBeVisible();
        await expect(page.locator(`${LEAD} .le-source-pane`)).toBeVisible();
        await expect(page.locator(`${LEAD} .le-preview-pane`)).toBeHidden();
        await page.locator('#editor-pane-toggle [data-lead-pane="preview"]').tap();
        await expect(page.locator(`${LEAD} .le-preview-pane`)).toBeVisible();
        await expect(page.locator(`${LEAD} .le-source-pane`)).toBeHidden();
        await page.evaluate(() => localStorage.removeItem('bgb-lead-mode'));
    });
});

// ---------------------------------------------------------------------------------------------
// Gliding the chord cursor on a phone, and chords after the words. Real touch events (CDP), slow
// enough to be a letter-by-letter drag. Only what is on screen above the docked sheet is tapped.
// ---------------------------------------------------------------------------------------------
test.describe('hold the sheet: a trackpad', () => {
    test('hold ~0.3s, then a drag of N px moves the cursor N/11 letters; buttons fade and are not pressed; lifting restores them', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing river how sweet\nsecond line here');   // ("grace" is ONE syllable now, silent e)
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
        const sheet = page.locator(SHEET);
        const spacer = await centreOf(sheet.locator('.chm-row2 .chm-sp'));
        const before = await leadText(page);
        await touchDrag(page, spacer, along(10, 6), {   // 60px at 0.15 px/ms
            holdMs: 450,
            onHeld: async () => { await expect(sheet).toHaveClass(/is-trackpad/); },
        });
        // 60px at 1:1 from the middle of "A": about six letters on, i.e. INSIDE "ing" (4) or just past it (the gap 7, "riv" 8).
        // The stop is the one containing the point, like a tap (pickStop), so the end of "Amazing" still counts as "ing".
        expect(await boxPos(page)).toBeGreaterThanOrEqual(4);
        expect(await boxPos(page)).toBeLessThanOrEqual(8);
        await expect(sheet).not.toHaveClass(/is-trackpad/);
        expect(await leadText(page)).toBe(before);       // nothing was pressed, nothing was written
        // a drag that STARTS on a button works too (the buttons are not pressed), and its lift is not a tap
        const d = sheet.locator('.chm-cell[data-chord="D"]');
        const from = await boxPos(page);
        await touchDrag(page, await centreOf(d), along(5, 6), { holdMs: 450 });
        expect(await leadText(page)).toBe(before);
        expect(await boxPos(page)).toBeGreaterThan(from);   // 30px more: it moved on
    });

    test('a short tap still presses a button', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 8, active: true }));
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).tap();
        expect(await leadText(page)).toBe('Amazing [D]grace how sweet');
    });

    test('moving before the hold fires is not a trackpad (the sheet may scroll)', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        const spacer = await centreOf(page.locator(`${SHEET} .chm-row2 .chm-sp`));
        const p0 = await boxPos(page);
        await touchDrag(page, spacer, [[0, -30], [0, -30]], { stepMs: 10 });
        await expect(page.locator(SHEET)).not.toHaveClass(/is-trackpad/);
        expect(await boxPos(page)).toBe(p0);
    });

    test('the strip keeps the cursor fully in view, at the start and the end of a long line', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet the sound that saved a wretch like me');
        await setMode(page, 'chords');
        const inView = async () => { await page.waitForTimeout(250); return page.evaluate(() => {
            const v = document.querySelector('.chm-strip-view').getBoundingClientRect();
            const t = document.querySelector('.chm-strip-view .cl-slot-pill, .chm-strip-view .cl-box-chord .cl-chord-glyph').getBoundingClientRect();
            return t.left >= v.left && t.right <= v.right && t.width > 0;
        }); };
        expect(await inView()).toBe(true);
        await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; editor.setBox({ pos: editor.getText().length, active: true, after: 1 }); });
        await page.locator(`${SHEET} .chm-prev`).tap();
        expect(await inView()).toBe(true);
        await page.locator(`${SHEET} .chm-next`).tap();
        expect(await boxState(page)).toMatchObject({ after: 1 });
        expect(await inView()).toBe(true);
    });
});

test.describe('grab the cursor in the chart (touch)', () => {
    test('touch the cursor and drag: it moves letter by letter; a touch without movement is still a tap', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        const how = (await syllableCentres(page, 'Amazing')).find((s) => s.text.startsWith('how'));
        await page.touchscreen.tap(how.x, how.y);
        expect(await boxPos(page)).toBe(how.seam);
        const pill = page.locator(`${CM} .cl-slot-pill`);
        await expect(pill).toBeVisible();
        expect(await pill.evaluate((e) => getComputedStyle(e).touchAction)).toBe('none');
        const c = await centreOf(pill);
        await page.touchscreen.tap(c.x, c.y);
        expect(await boxPos(page)).toBe(how.seam);
        const y0 = await page.evaluate(() => window.scrollY);
        await touchDrag(page, await centreOf(page.locator(`${CM} .cl-slot-pill`)), along(10, 6));
        expect(await boxPos(page) - how.seam).toBeGreaterThanOrEqual(4);
        expect(await boxPos(page) - how.seam).toBeLessThanOrEqual(8);
        expect(await page.evaluate(() => window.scrollY)).toBe(y0);   // the page did not scroll under the finger
        expect(await leadText(page)).toBe('Amazing grace how sweet');
    });

    test('dragging a selected chord carries it', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace how sweet');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        await page.locator(`${CM} .cl-chord-glyph`).first().tap();      // select it
        await expect(page.locator(`${SHEET} .chm-remove`)).toBeVisible();
        await touchDrag(page, await centreOf(page.locator(`${CM} .cl-chord-glyph`).first()), along(10, 6));
        const text = await leadText(page);
        expect(text.match(/\[G\]/g)).toHaveLength(1);
        expect(text.indexOf('[G]')).toBeGreaterThan('Amazing '.length + 1);
        expect(text.replace('[G]', '')).toBe('Amazing grace how sweet');
    });
});

test.describe('chords after the words (phone)', () => {
    test('a tap to the RIGHT of the last word puts the cursor in the next empty slot; D then A gives `home  [D]   [A]` (every drawn gap 2)', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Old home');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Old home');
        const end = await lineEndPoint(page, 'Old home');
        await page.touchscreen.tap(end.farX, end.y);
        expect(await boxState(page)).toMatchObject({ after: 1, newLine: false });
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).tap();
        await page.locator(`${SHEET} .chm-cell[data-chord="A"]`).tap();
        expect(await leadText(page)).toBe('Old home  [D]   [A]');
        // with chords already trailing, the tap still opens the NEXT empty slot
        await scrollLineToTop(page, 'Old home');
        const end2 = await lineEndPoint(page, 'Old home');
        await page.touchscreen.tap(end2.farX, end2.y);
        await page.locator(`${SHEET} .chm-cell[data-chord="G"]`).tap();
        expect(await leadText(page)).toBe('Old home  [D]   [A]   [G]');
    });

    test('Add chord line works on the phone sheet too', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Old home\nroad');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 2, active: true }));
        await page.locator(`${SHEET} .chm-addline`).tap();
        await page.locator(`${SHEET} .chm-cell[data-chord="G"]`).tap();
        await page.locator(`${SHEET} .chm-cell[data-chord="C"]`).tap();
        expect(await leadText(page)).toBe('Old home\n[G]   [C]\nroad');
    });
});

// ---------------------------------------------------------------------------------------------
// Long-press anywhere on the chart starts the glide; the glide follows what is DRAWN (visual rows).
// ---------------------------------------------------------------------------------------------
const WRAPPED = 'Amazing grace how sweet the sound that saved a wretch like me and all my kin';

test.describe('long-press on the chart glides the cursor (touch)', () => {
    test('a long press on empty chart jumps the cursor to the finger, then a slow glide moves it stop by stop', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        const how = (await syllableCentres(page, 'Amazing')).find((s) => s.text.startsWith('how'));
        const y0 = await page.evaluate(() => window.scrollY);
        let heldAt = null;
        await touchDrag(page, { x: how.x, y: how.y }, along(4, 5), {
            holdMs: 450,
            onHeld: async () => { heldAt = await boxPos(page); },
        });
        expect(heldAt).toBe(how.seam);                          // jumped to the finger (a tap's hit-test) before moving
        const end = await boxPos(page);
        expect(end).toBeGreaterThan(how.seam);                  // and glided
        expect(await boxStopKind(page)).not.toBeNull();         // slow too: it lands on a STOP, never on a letter
        expect(await page.evaluate(() => window.scrollY)).toBe(y0);   // the page did not scroll under the finger
        expect(await leadText(page)).toBe('Amazing grace how sweet');
    });

    test('after any slow glide the cursor is a stop (never mid-syllable, never a non-gap space)', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Many long years since I left my old home  now');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Many long');
        const first = (await syllableCentres(page, 'Many long'))[0];
        for (const [start, deltas] of [[first, along(4, 5)], [first, along(9, 3)], [first, along(14, 6)], [first, along(20, 4)], [first, along(30, 2)]]) {
            await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
            await scrollLineToTop(page, 'Many long');
            const s = (await syllableCentres(page, 'Many long'))[0];
            await touchDrag(page, { x: s.x + 1, y: s.y }, deltas, { holdMs: 450, stepMs: 45 });
            const kind = await boxStopKind(page);
            expect(kind, JSON.stringify(await boxState(page))).not.toBeNull();
            if (kind === 'syllable') await expect(page.locator(`${CM} .cl-box-text`)).toHaveCount(1);
            if (kind === 'gap') await expect(page.locator(`${CM} .cl-slot-gap .cl-slot-text`)).toHaveCount(1);
            expect(await leadText(page)).toBe('Many long years since I left my old home  now');
        }
        void first;
    });

    test('a long press ON a chord carries it without selecting it first; a quick swipe on it scrolls instead', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace how sweet');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        const glyph = page.locator(`${CM} .cl-chord-glyph`).first();
        await touchDrag(page, await centreOf(glyph), along(10, 6), { holdMs: 450 });
        const text = await leadText(page);
        expect(text.match(/\[G\]/g)).toHaveLength(1);
        expect(text.replace('[G]', '')).toBe('Amazing grace how sweet');
        expect(text.indexOf('[G]')).toBeGreaterThan('Amazing '.length + 1);
        await expect(page.locator(`${SHEET} .chm-move`)).toHaveAttribute('aria-pressed', 'false');   // let go on lift
    });

    test('moving before the hold fires leaves the cursor alone (the page may scroll)', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        const p0 = await boxPos(page);
        const how = (await syllableCentres(page, 'Amazing')).find((s) => s.text.startsWith('how'));
        await touchDrag(page, { x: how.x, y: how.y }, [[0, -20], [0, -20]], { stepMs: 10 });
        expect(await boxPos(page)).toBe(p0);
    });

    test('on a WRAPPED line a downward glide goes from its first visual row to its second', async ({ page }) => {
        await openEditor(page);
        await setLead(page, `${WRAPPED}\nnext line`);
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        const rows = await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            const v = editor.view;
            const tops = new Set();
            const line = v.state.doc.line(1);
            for (let p = line.from; p < line.to; p += 2) tops.add(Math.round(v.coordsAtPos(p, 1).top / 4));
            return tops.size;
        });
        expect(rows).toBeGreaterThanOrEqual(2);                  // the fixture really wraps at 390px
        const start = (await syllableCentres(page, 'Amazing'))[1];
        const top0 = await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; return editor.view.coordsAtPos(editor.getBox().pos, 1).top; });
        await touchDrag(page, { x: start.x, y: start.y }, Array.from({ length: 6 }, () => [0, 7]), { holdMs: 450 });
        const after = await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; const b = editor.getBox(); return { top: editor.view.coordsAtPos(b.pos, 1).top, line: editor.view.state.doc.lineAt(b.pos).number }; });
        expect(after.line).toBe(1);                              // still the same LOGICAL line...
        expect(after.top).toBeGreaterThan(top0 + 10);            // ...on its second drawn row
    });

    test('after any glide the cursor never stands just before an existing chord (no empty slot beside it)', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Over the [A]hill and [D]far away\nsing [G]a song for [C]me');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Over');
        const first = (await syllableCentres(page, 'Over'))[0];
        for (const deltas of [along(12, 4), along(6, -6), Array.from({ length: 6 }, () => [3, 7]), along(8, 9)]) {
            const cur = await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; const c = editor.view.coordsAtPos(editor.getBox().pos, 1); return { x: c.left + 2, y: (c.top + c.bottom) / 2 }; });
            await touchDrag(page, cur ?? first, deltas, { holdMs: 450 });
            const s = await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; const b = editor.getBox(); return { after: b.after || 0, rest: editor.getText().slice(b.pos) }; });
            if (!s.after) expect(s.rest.startsWith('[')).toBe(false);
            // an empty slot is drawn only where there is no chord
            const slots = await page.locator(`${CM} .cl-slot-pill`).count();
            const boxedChord = await page.locator(`${CM} .cl-box-chord`).count();
            expect(slots + boxedChord).toBeLessThanOrEqual(1);
        }
    });
});

// The chart glide is 1:1 with the finger, a lift commits what was shown, and a loupe sits above the thumb.
const OLD_HOME = 'Many long years since I left my old home';
/** CDP touch: press at `start`, hold, jump through `points` (absolute), `stepMs` apart, run `before`, wait `liftAfterMs`, lift. */
async function fingerGlide(page, start, points, { holdMs = 450, stepMs = 15, liftAfterMs = 0, before } = {}) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await send('touchStart', [{ x: start.x, y: start.y, id: 1 }]);
    await page.waitForTimeout(holdMs);
    for (const p of points) {
        await send('touchMove', [{ x: p.x, y: p.y ?? start.y, id: 1 }]);
        await page.waitForTimeout(p.wait ?? stepMs);
    }
    if (before) await before();
    if (liftAfterMs) await page.waitForTimeout(liftAfterMs);
    await send('touchEnd', []);
    await cdp.detach();
}
test.describe('chart glide: 1:1 with the finger, settle on lift, loupe', () => {
    async function setup(page) {
        await openEditor(page);
        await setLead(page, `${OLD_HOME}\nsecond line here`);
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Many long');
        return (await syllableCentres(page, 'Many long'));
    }
    test('fast big jumps end on the stop under the finger (no drift from speed)', async ({ page }) => {
        const syl = await setup(page);
        const a = syl[0];
        const target = syl[syl.length - 1];
        const n = 4;
        const pts = Array.from({ length: n }, (_, i) => ({ x: a.x + ((target.x - a.x) * (i + 1)) / n }));
        // go out and back, fast, then stop on a middle syllable
        const mid = syl[Math.floor(syl.length / 2)];
        // a stop is where its syllable STARTS (drawn x): stop on it
        const midLeft = await page.evaluate((pos) => document.querySelector('#editor-lead').__lead.editor.view.coordsAtPos(pos, 1).left + 2, mid.seam);
        await fingerGlide(page, { x: a.x, y: a.y }, [...pts, { x: a.x }, ...pts, { x: midLeft, wait: 150 }], { stepMs: 15 });
        expect(await boxPos(page)).toBe(mid.seam);
    });
    test('the loupe shows above the finger, agrees with the chart, and is gone after the lift', async ({ page }) => {
        const syl = await setup(page);
        await expect(page.locator('.le-loupe')).toBeHidden();
        const a = syl[0];
        const t = syl[4];
        let seen = null;
        await fingerGlide(page, { x: a.x, y: a.y }, [{ x: (a.x + t.x) / 2 }, { x: t.x, wait: 250 }], {
            before: async () => {
                seen = await page.evaluate((fy) => {
                    const l = document.querySelector('.le-loupe');
                    const r = l.getBoundingClientRect();
                    const boxSel = '.cl-box-chord .cl-chord-glyph, .cl-slot-pill, .cl-box-text';
                    const inL = l.querySelector(boxSel);
                    const inC = document.querySelector(`#editor-lead .cm-content ${boxSel.split(', ').join(', #editor-lead .cm-content ')}`);
                    // the cursor is DRAWN in the bubble (the marker CSS reaches the clone), in the chart's own font
                    const lText = l.querySelector('.cl-box-text');
                    const lPill = l.querySelector('.cl-slot-pill');
                    return { hidden: l.classList.contains('hidden'), bottom: r.bottom, fy, aria: l.getAttribute('aria-hidden'), pe: getComputedStyle(l).pointerEvents,
                        loupeText: inL?.textContent, chartText: inC?.textContent, hasBox: !!inL,
                        outline: lText ? getComputedStyle(lText).outlineStyle : null,
                        pill: lPill ? { border: getComputedStyle(lPill).borderStyle, w: lPill.getBoundingClientRect().width } : null,
                        font: getComputedStyle(l.querySelector('.le-loupe-cl')).fontFamily,
                        chartFont: getComputedStyle(document.querySelector('#editor-lead .cm-content')).fontFamily };
                }, t.y);
            },
        });
        expect(seen.hidden).toBe(false);
        expect(seen.bottom).toBeLessThan(seen.fy);
        expect(seen.aria).toBe('true');
        expect(seen.pe).toBe('none');
        expect(seen.hasBox).toBe(true);
        expect(seen.loupeText).toBe(seen.chartText);
        expect(seen.outline).toBe('solid');
        if (seen.pill) { expect(seen.pill.border).toBe('dashed'); expect(seen.pill.w).toBeGreaterThan(10); }
        expect(seen.font).toBe(seen.chartFont);
        await expect(page.locator('.le-loupe')).toBeHidden();
    });
    test('the page never scrolls under a finger gliding 1:1, even over the picker (it scrolls once, on the lift)', async ({ page }) => {
        const syl = await setup(page);
        const a = syl[1];
        const pickTop = await page.evaluate(() => document.querySelector('.chm-body').getBoundingClientRect().top);
        const before = await page.evaluate(() => window.scrollY);
        const down = [];
        for (let y = a.y; y < pickTop + 120; y += 12) down.push({ x: a.x + 10, y });
        const wiggle = Array.from({ length: 6 }, (_, i) => ({ x: a.x + 10 + (i % 2), y: pickTop + 110, wait: 30 }));
        let during = null;
        await fingerGlide(page, { x: a.x, y: a.y }, [...down, ...wiggle], {
            stepMs: 30,
            before: async () => {
                during = await page.evaluate(() => {
                    const lead = document.querySelector('#editor-lead').__lead;
                    const c = lead.editor.view.coordsAtPos(lead.editor.getBox().pos, 1);
                    return { scrollY: window.scrollY, cursorTop: c.top };
                });
            },
        });
        expect(during.scrollY).toBe(before);
        // the cursor stayed on text you can see (clamped to the visible chart), not on a line hidden under the picker
        expect(during.cursorTop).toBeLessThan(pickTop);
    });
    test('settle: a stop reached < 80ms before the lift is not committed', async ({ page }) => {
        const syl = await setup(page);
        const a = syl[2];
        const b = syl[4];
        const cdp = await page.context().newCDPSession(page);
        const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
        await send('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
        await page.waitForTimeout(450);
        await send('touchMove', [{ x: a.x + 1, y: a.y, id: 1 }]);
        await page.waitForTimeout(200);
        await send('touchMove', [{ x: b.x, y: a.y, id: 1 }]);
        await page.waitForTimeout(25);
        await send('touchEnd', []);
        await cdp.detach();
        expect(await boxPos(page)).toBe(a.seam);
    });
});

// WebKit (iOS) mis-lays out an ABSOLUTE CodeMirror widget-buffer image mid-word after A+ / A-: with the cursor mid-word the
// segment grew a third row (D / some / body). Reproduced only in WebKit, which the mobile project does not run, so this
// guards the cause in any engine: only the buffer BEFORE a segment's chord is out of the flow (the phantom-row fix), every
// other buffer stays inline, and the line's segments are one height.
test.describe('no staircase inside a word (WebKit, A+ then a cursor mid-word)', () => {
    test('the cursor mid-word after A+ leaves every segment of the line the same height', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Well the girl ran [C#7]off with [D]somebody [A]else');
        await setMode(page, 'chords');
        await page.locator('#editor-font-up').click();
        const body = await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.view.state.doc.toString().indexOf('body'));
        await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), body);
        const r = await page.evaluate(() => {
            const l = [...document.querySelectorAll('#editor-lead .cm-line')].find((x) => x.textContent.includes('girl ran'));
            const bufs = [...l.querySelectorAll('.cl-segment .cm-widgetBuffer')];
            const absolute = (b) => getComputedStyle(b).position === 'absolute';
            return { heights: [...l.querySelectorAll('.cl-segment')].map((sg) => Math.round(sg.getBoundingClientRect().height)),
                midAbsolute: bufs.filter((b) => b.previousElementSibling && absolute(b)).length,
                firstAbsolute: bufs.filter((b) => !b.previousElementSibling).every(absolute),
                mid: bufs.filter((b) => b.previousElementSibling).length, slot: !!l.querySelector('.cl-box-text') };
        });
        expect(r.slot).toBe(true);
        expect(r.mid).toBeGreaterThan(0);          // the cursor's slot really put buffers mid-word
        expect(r.midAbsolute).toBe(0);
        expect(r.firstAbsolute).toBe(true);
        expect(new Set(r.heights).size).toBe(1);
    });
});

// The slot after the words must measure the same whether the cursor is on it or not: its widget is zero-height, and the
// stop used to take its ROW from it (14px low, a row of its own), so a finger past the last word picked the word, the
// widget went, the slot won again: a flicker at the frame rate (194 flips in 212 jittered moves), and a second tap right
// of the last word landed on the word.
test.describe('the end of a line: the slot after the words is steady, and highlighted like a syllable', () => {
    async function setupEnd(page) {
        await openEditor(page);
        await setLead(page, 'short line here\nnext line');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'short line');
        return lineEndPoint(page, 'short line');
    }
    test('a second tap right of the last word stays in the slot', async ({ page }) => {
        const end = await setupEnd(page);
        const x = end.x + 40;
        await page.touchscreen.tap(x, end.y);
        expect(await boxState(page)).toMatchObject({ after: 1 });
        await page.touchscreen.tap(x, end.y);
        expect(await boxState(page)).toMatchObject({ after: 1 });
    });
    test('a finger held past the last word, jittering by 1px, never flips between the word and the slot', async ({ page }) => {
        const end = await setupEnd(page);
        const cdp = await page.context().newCDPSession(page);
        const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
        const x = end.x + 40;
        await send('touchStart', [{ x, y: end.y, id: 1 }]);
        await page.waitForTimeout(450);
        const seen = [];
        for (let i = 0; i < 24; i++) {
            await send('touchMove', [{ x: x + (i % 2), y: end.y + (i % 3) - 1, id: 1 }]);
            await page.waitForTimeout(20);
            const b = await boxState(page);
            seen.push(`${b.pos}${b.after ? 'a' : ''}`);
        }
        await send('touchEnd', []);
        await cdp.detach();
        expect(new Set(seen).size, seen.join(' ')).toBe(1);
        expect(await boxState(page)).toMatchObject({ after: 1 });
    });
    test('the slot is outlined on the lyric row too, and drawing it changes nothing in the layout', async ({ page }) => {
        const end = await setupEnd(page);
        const lineBox = () => page.evaluate(() => { const l = [...document.querySelectorAll('#editor-lead .cm-line')].find((x) => x.textContent.includes('short line')); const r = l.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), segs: [...l.querySelectorAll('.cl-segment')].map((sg) => Math.round(sg.getBoundingClientRect().width)) }; });
        const before = await lineBox();
        await page.touchscreen.tap(end.x + 40, end.y);
        expect(await boxState(page)).toMatchObject({ after: 1 });
        const box = await page.evaluate(() => {
            const t = document.querySelector('#editor-lead .cl-slot-after .cl-slot-text');
            if (!t) return null;
            const r = t.getBoundingClientRect();
            const words = [...document.querySelectorAll('#editor-lead .cm-line')].find((x) => x.textContent.includes('short line'));
            const range = document.createRange(); range.selectNodeContents(words); const text = [...range.getClientRects()].filter((q) => q.height > 10).pop();
            return { outline: getComputedStyle(t).outlineStyle, w: r.width, h: r.height, top: r.top, bottom: r.bottom, textTop: text.top, textBottom: text.bottom, left: r.left };
        });
        expect(box).not.toBeNull();
        expect(box.outline).toBe('solid');
        expect(box.w).toBeGreaterThan(10);
        expect(box.left).toBeGreaterThanOrEqual(end.x);                    // after the last word
        expect(box.top).toBeLessThan(box.textBottom);                       // on the lyric row (overlaps it)
        expect(box.bottom).toBeGreaterThan(box.textTop);
        expect(await lineBox()).toEqual(before);                            // no width, no wrap, no height
    });
});

test.describe('the docked parts keep their height', () => {
    test('magnifier and picker (and the arrow buttons) are identical with an empty box, a plain chord and an extended chord', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace [Am7]how sweet\nsecond line');
        await setMode(page, 'chords');
        const measure = async (pos) => {
            await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), pos);
            await page.waitForTimeout(150);
            return page.evaluate(() => {
                const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; };
                return { picker: r('.chm-body'), up: r('.chm-up'), down: r('.chm-down'), strip: r('.chm-strip') };
            });
        };
        const text = await leadText(page);
        const empty = await measure(2);
        const plain = await measure(text.indexOf('[G]') + 3);
        const ext = await measure(text.indexOf('[Am7]') + 5);
        expect(plain).toEqual(empty);
        expect(ext).toEqual(empty);
    });

    test('the picker rows and the magnifier keep their height and place across cursor states', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace [Am7]how sweet\nsecond line');
        await setMode(page, 'chords');
        const measure = async (pos) => {
            await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), pos);
            await page.waitForTimeout(150);
            return page.evaluate(() => {
                const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; };
                return { row1: r('.chm-row1'), row2: r('.chm-row2'), picker: r('.chm-body'), strip: r('.chm-strip'), stripView: r('.chm-strip-view') };
            });
        };
        const text = await leadText(page);
        const empty = await measure(2);                                    // no Move / Remove
        const plain = await measure(text.indexOf('[G]') + 3);             // Move / Remove, a short function line
        const ext = await measure(text.indexOf('[Am7]') + 5);             // Move / Remove, a longer function line
        expect(plain).toEqual(empty);
        expect(ext).toEqual(empty);
    });
});

test.describe('the ⋯ second row of extensions', () => {
    for (const width of [390, 360, 320]) {
        test(`at ${width}px every cell fits, the second row opens below, 11 writes D11`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await openEditor(page);
            await setLead(page, 'Amazing [D]grace how sweet\nsecond line');
            await setMode(page, 'chords');
            await page.locator(`${CM} .cl-chord-glyph`).first().tap();
            await page.waitForTimeout(150);
            const inside = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((b) => {
                const r = b.getBoundingClientRect();
                return { id: b.dataset.id, ok: r.left >= 0 && r.right <= window.innerWidth && r.width > 0 };
            }), sel);
            const main = await inside('.chm-decos:not(.chm-decos2) .chm-deco');
            expect(main.map((c) => c.id)).toEqual(['7', 'maj7', '6', 'sus4', 'sus2', 'add9', '9', 'extra']);
            expect(main.filter((c) => !c.ok)).toEqual([]);
            const overflow = await page.evaluate(() => { const d = document.querySelector('.chm-decos'); return d.scrollWidth - d.clientWidth; });
            expect(overflow).toBeLessThanOrEqual(0);
            const height = () => page.evaluate(() => Math.round(document.querySelector('.chm-body').getBoundingClientRect().height));
            const closedH = await height();
            await page.locator('.chm-extra').tap();
            await page.waitForTimeout(150);
            const second = await inside('.chm-decos2 .chm-deco');
            expect(second.map((c) => c.id)).toEqual(['69', '11', '13', 'dim', 'm7b5', 'aug', 'bass']);
            expect(second.filter((c) => !c.ok)).toEqual([]);
            const sec = await page.evaluate(() => ({ w: document.querySelector('.chm-decos2').scrollWidth - document.querySelector('.chm-decos2').clientWidth }));
            expect(sec.w).toBeLessThanOrEqual(0);
            expect(await page.locator('.chm-extra').getAttribute('aria-expanded')).toBe('true');
            const openH = await height();
            expect(openH).toBeGreaterThan(closedH);
            expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--chm-picker-h'))).toBe(`${openH}px`);
            await page.locator('.chm-decos2 [data-id="11"]').tap();
            expect(await leadText(page)).toContain('[D11]');
            await page.locator('.chm-extra').tap();
            await page.waitForTimeout(150);
            expect(await height()).toBe(closedH);
            await expect(page.locator('.chm-decos2')).toHaveCount(0);
        });
    }

    test('Dm + sus2 writes Dsus2 and tapping sus2 again gives Dm back', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [Dm]grace how sweet');
        await setMode(page, 'chords');
            await page.locator(`${CM} .cl-chord-glyph`).first().tap();
        await page.waitForTimeout(150);
        await page.locator('.chm-deco[data-id="sus2"]').tap();
        expect(await leadText(page)).toContain('[Dsus2]');
        await page.locator('.chm-deco[data-id="sus2"]').tap();
        expect(await leadText(page)).toContain('[Dm]');
    });
});

test.describe('the picker carries the mode switch and undo / redo', () => {
    test('the picker switch and the header switch drive the same mode and stay in sync', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace how sweet');
        await setMode(page, 'chords');
        const pick = (m) => page.locator(`${SHEET} [data-picker-mode="${m}"]`);
        await expect(pick('chords')).toHaveAttribute('aria-pressed', 'true');
        await pick('chordpro').tap();
        await expect(page.locator('#editor-mode-chordpro')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(SHEET)).toBeHidden();
        await setMode(page, 'chords');                                     // the header switch brings the picker back, with Chords on
        await expect(pick('chords')).toHaveAttribute('aria-pressed', 'true');
        await expect(pick('lyrics')).toHaveAttribute('aria-pressed', 'false');
        await pick('lyrics').tap();
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#editor-mode-chords')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator(SHEET)).toBeHidden();
    });

    test('undo / redo in the picker undo a placed chord and share the toolbar disabled states', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        const undo = page.locator(`${SHEET} .chm-undo`);
        const redo = page.locator(`${SHEET} .chm-redo`);
        const same = async () => {
            expect(await undo.isDisabled()).toBe(await page.locator('#editor-undo').isDisabled());
            expect(await redo.isDisabled()).toBe(await page.locator('#editor-redo').isDisabled());
        };
        await same();
        const before = await leadText(page);
        await page.locator(`${SHEET} [data-chord="G"]`).first().tap();
        expect(await leadText(page)).toContain('[G]');
        await expect(undo).toBeEnabled();
        await same();
        await undo.tap();
        expect(await leadText(page)).toBe(before);
        await expect(redo).toBeEnabled();
        await same();
        await redo.tap();
        expect(await leadText(page)).toContain('[G]');
    });

    test('Move and Remove appear in row 2 when the cursor is on a chord, not otherwise', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace how sweet');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 2, active: true }));
        await expect(page.locator(`${SHEET} .chm-row2 .chm-move`)).toHaveCount(0);
        await page.locator(`${CM} .cl-chord-glyph`).first().tap();
        await expect(page.locator(`${SHEET} .chm-row2 .chm-move`)).toBeVisible();
        await expect(page.locator(`${SHEET} .chm-row2 .chm-remove`)).toBeVisible();
        await page.locator(`${SHEET} .chm-row2 .chm-remove`).tap();
        expect(await leadText(page)).not.toContain('[G]');
    });

    // The "Removed 1 chord — Undo" toast sat at bottom: 2rem, on top of the docked picker's chords, and took the taps:
    // you had to wait 5s before placing the next chord.
    test('removing a chord: the undo toast stands above the picker, and the picker takes the next tap', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace how sweet');
        await setMode(page, 'chords');
        await page.locator(`${CM} .cl-chord-glyph`).first().tap();
        await page.locator(`${SHEET} .chm-row2 .chm-remove`).tap();
        const toast = page.locator('.le-toast');
        await expect(toast).toContainText('Removed 1 chord');
        const g = await page.evaluate(() => ({
            toast: document.querySelector('.le-toast').getBoundingClientRect().bottom,
            picker: document.querySelector('.chm-body').getBoundingClientRect().top,
        }));
        expect(g.toast).toBeLessThanOrEqual(g.picker);
        await page.locator(`${SHEET} .chm-row2 .chm-remove`).waitFor({ state: 'detached' });
        const cell = page.locator(`${SHEET} .chm-inkey[data-chord]`).first();
        const chord = await cell.getAttribute('data-chord');
        await cell.tap();
        expect(await leadText(page)).toContain(`[${chord}]`);
        await expect(toast).toBeVisible();   // still showing: the tap went past it
    });
});

test.describe('the section label menu on a phone', () => {
    // The menu (~265px) did not fit below a label in the middle of a short screen (a phone with Safari's bars or the
    // keyboard up), so it flipped above, clamped to the top of the WINDOW: under the top band, which hid the section
    // types and covered the label. Scrolling with a finger closed it, so its options could not be reached.
    for (const [where, frac] of [['in the middle of', 0.5], ['low on', 0.85]]) {
        test(`a label ${where} a short screen: the page scrolls it up, the menu opens below it, all of it on screen`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 560 });
            await openEditor(page);
            const verses = Array.from({ length: 8 }, (_, i) => `{start_of_verse: Verse ${i + 1}}\nLine one of verse ${i + 1}\nLine two\n{end_of_verse}`);
            await setLead(page, verses.join('\n\n'));
            await setMode(page, 'lyrics');
            const label = page.locator('#editor-lead .section-label', { hasText: 'Verse 3' });
            await label.evaluate((el, f) => window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * f), frac);
            await label.tap();
            const menu = page.locator('.le-labelmenu');
            await expect(menu).toBeVisible();
            const g = await label.evaluate((el) => {
                const m = document.querySelector('.le-labelmenu');
                const r = m.getBoundingClientRect();
                const band = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottomband-h')) || 0;
                return {
                    top: r.top, bottom: r.bottom, labelBottom: el.getBoundingClientRect().bottom,
                    topband: document.querySelector('.app-topbar').getBoundingClientRect().bottom,
                    vh: window.innerHeight - band, fits: m.scrollHeight <= m.clientHeight + 1,
                };
            });
            expect(g.top).toBeGreaterThanOrEqual(g.topband);      // not under the top band
            expect(g.top).toBeGreaterThanOrEqual(g.labelBottom);  // the label it belongs to stays in view
            expect(g.bottom).toBeLessThanOrEqual(g.vh);
            expect(g.fits).toBe(true);
            await expect(menu.getByRole('menuitem', { name: 'Delete section' })).toBeInViewport();
            await menu.getByRole('menuitem', { name: 'Duplicate' }).tap();
            expect(await leadText(page)).toMatch(/Line one of verse 3[\s\S]*Line one of verse 3/);
        });
    }
    test('opened with the keyboard up, the menu grows to its full height when the keyboard goes away', async ({ page }) => {
        // iPhone, 2026-10-28: tapping a label while typing, the keyboard closes AFTER the menu was measured, so the menu
        // kept the small space that was above the keyboard ("Remove label" cut in half, "Delete section" out of sight)
        await openEditor(page);
        const verses = Array.from({ length: 8 }, (_, i) => `{start_of_verse: Verse ${i + 1}}\nLine one of verse ${i + 1}\nLine two\n{end_of_verse}`);
        await setLead(page, verses.join('\n\n'));
        await setMode(page, 'lyrics');
        await page.setViewportSize({ width: 390, height: 330 });           // the screen with the keyboard up
        const label = page.locator('#editor-lead .section-label', { hasText: 'Verse 3' });
        await label.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 120));
        await label.tap();
        const menu = page.locator('.le-labelmenu');
        await expect(menu).toBeVisible();
        const squeezed = await menu.evaluate((m) => m.scrollHeight > m.clientHeight + 1);
        expect(squeezed).toBe(true);                                       // it did not fit while the keyboard was up
        await page.setViewportSize({ width: 390, height: 844 });           // the keyboard goes away
        await expect.poll(() => menu.evaluate((m) => m.scrollHeight <= m.clientHeight + 1)).toBe(true);
        await expect(menu.getByRole('menuitem', { name: 'Delete section' })).toBeInViewport();
    });
});


test.describe('the magnifier sits fully below the top band', () => {
    test('its top equals the top band bottom, on opening and after a mode round trip', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace how sweet');
        const check = async () => {
            const g = await page.evaluate(() => ({
                band: Math.round(document.querySelector('.app-topbar').getBoundingClientRect().bottom),
                strip: Math.round(document.querySelector('.chm-strip').getBoundingClientRect().top),
                h: Math.round(document.querySelector('.chm-strip').getBoundingClientRect().height),
            }));
            expect(g.strip).toBe(g.band);
            return g;
        };
        await setMode(page, 'chords');
        await check();
        await setMode(page, 'lyrics');
        await setMode(page, 'chords');
        const g = await check();
        // compact: the first split build was ~1.7x with 8px padding (about 118px tall on this profile)
        expect(g.h).toBeLessThanOrEqual(96);
        for (const sel of ['.chm-prev', '.chm-next', '.chm-up', '.chm-down']) {
            const b = await page.locator(`${SHEET} ${sel}`).boundingBox();
            expect(b.width, sel).toBeGreaterThanOrEqual(40);
            expect(b.height, sel).toBeGreaterThanOrEqual(40);
        }
    });
});

/** The cursor's lyric line must sit between the docked magnifier and the docked picker. */
async function lineInGap(page) {
    return page.evaluate(() => {
        const { editor } = document.querySelector('#editor-lead').__lead;
        const c = editor.view.coordsAtPos(editor.getBox().pos);
        const strip = document.querySelector('.chm-strip').getBoundingClientRect();
        const body = document.querySelector('.chm-body').getBoundingClientRect();
        return { top: c.top, bottom: c.bottom, gapTop: strip.bottom, gapBottom: body.top, ok: c.top >= strip.bottom - 1 && c.bottom <= body.top + 1 };
    });
}

test.describe('the cursor line stays between the magnifier and the picker', () => {
    const LONG = Array.from({ length: 24 }, (_, i) => `Line number ${i + 1} of the song`).join('\n');
    test('after a tap, the arrows (down to the end, back up to the start) and a glide', async ({ page }) => {
        await openEditor(page);
        await setLead(page, LONG);
        await setMode(page, 'chords');
        expect((await lineInGap(page)).ok).toBe(true);                               // opening
        await scrollLineToTop(page, 'Line number 9 ');
        const s = (await syllableCentres(page, 'Line number 9 ')).find(Boolean);
        await page.touchscreen.tap(s.x, s.y);
        expect((await lineInGap(page)).ok).toBe(true);
        for (let i = 0; i < 26; i++) {
            await page.locator(`${SHEET} .chm-down`).tap();
            await page.waitForTimeout(30);
            const g = await lineInGap(page);
            expect(g.ok, `going down, step ${i}: ${JSON.stringify(g)}`).toBe(true);
        }
        for (let i = 0; i < 26; i++) {
            await page.locator(`${SHEET} .chm-up`).tap();
            await page.waitForTimeout(30);
            const g = await lineInGap(page);
            expect(g.ok, `going up, step ${i}: ${JSON.stringify(g)}`).toBe(true);
        }
        // the first and last lines can reach the gap too (the chart is padded by both parts)
        // a glide from the magnifier, downward
        const v = await centreOf(page.locator(`${SHEET} .chm-strip-view`));
        await touchDrag(page, v, [[0, 6], [0, 6], [0, 6]], { holdMs: 0 });
        expect((await lineInGap(page)).ok).toBe(true);
    });

    test('the last line scrolls into the gap, and the chart is padded by both parts', async ({ page }) => {
        await openEditor(page);
        await setLead(page, LONG);
        await setMode(page, 'chords');
        const pad = await page.evaluate(() => {
            const cs = getComputedStyle(document.querySelector('#editor-lead'));
            return { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom),
                strip: document.querySelector('.chm-strip').getBoundingClientRect().height, picker: document.querySelector('.chm-body').getBoundingClientRect().height };
        });
        expect(pad.top).toBeGreaterThanOrEqual(pad.strip);
        expect(pad.bottom).toBeGreaterThanOrEqual(pad.picker);
        await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; editor.setBox({ pos: editor.getText().length, active: true }); });
        await page.locator(`${SHEET} .chm-prev`).tap();
        expect((await lineInGap(page)).ok).toBe(true);
    });

    test('holding the magnifier (the arrows) is a trackpad too', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        const start = await boxPos(page);
        const arrow = await centreOf(page.locator(`${SHEET} .chm-next`));
        await touchDrag(page, arrow, along(6, 12), { holdMs: 450, onHeld: async () => { await expect(page.locator(SHEET)).toHaveClass(/is-trackpad/); } });
        expect(await boxPos(page)).toBeGreaterThan(start);
        await expect(page.locator(SHEET)).not.toHaveClass(/is-trackpad/);
    });
});

test.describe('a gesture can never get stuck and swallow later taps', () => {
    const synth = (page, type, x, y, id = 77) => page.evaluate(({ type, x, y, id }) => {
        const target = type === 'pointerdown' ? document.elementFromPoint(x, y) : window;
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
    }, { type, x, y, id });
    async function tapAfter(page) {
        const how = (await syllableCentres(page, 'Amazing')).find((s) => s.text.startsWith('how'));
        await page.touchscreen.tap(how.x, how.y);
        expect(await boxPos(page)).toBe(how.seam);
        await expect(page.locator(SHEET)).not.toHaveClass(/is-trackpad/);
    }
    test('a hold on the sheet that ends in pointercancel', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        const sp = await centreOf(page.locator(`${SHEET} .chm-row2 .chm-sp`));
        await synth(page, 'pointerdown', sp.x, sp.y);
        await expect(page.locator(SHEET)).toHaveClass(/is-trackpad/);
        await synth(page, 'pointercancel', sp.x, sp.y);
        await expect(page.locator(SHEET)).not.toHaveClass(/is-trackpad/);
        await tapAfter(page);
    });
    test('a hold on the sheet when the box closes (mode switch)', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        const sp = await centreOf(page.locator(`${SHEET} .chm-row2 .chm-sp`));
        await synth(page, 'pointerdown', sp.x, sp.y);
        await expect(page.locator(SHEET)).toHaveClass(/is-trackpad/);
        await page.evaluate(() => document.querySelector('#editor-mode-lyrics').click());
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        await tapAfter(page);
    });
    test('a long press on the chart whose pointerup never arrives, then a new press', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Amazing');
        const s = (await syllableCentres(page, 'Amazing'))[0];
        await synth(page, 'pointerdown', s.x, s.y, 41);
        await page.waitForTimeout(450);
        await tapAfter(page);                                     // a fresh pointer force-ends the stale one
    });
});

test.describe('holding Backspace in Lyrics mode', () => {
    test('never eats the metadata or the section directives', async ({ page }) => {
        await openEditor(page);
        const doc = '{meta: title Old Home}\n{start_of_verse: Verse 1}\nAmazing grace\nhow sweet\n{end_of_verse}';
        await setLead(page, doc);
        await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            editor.view.focus();
            const t = editor.getText();
            editor.view.dispatch({ selection: { anchor: t.indexOf('Amazing') } });
        });
        for (let i = 0; i < 40; i++) await page.keyboard.press('Backspace');
        expect(await leadText(page)).toBe(doc);
        await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            const t = editor.getText();
            editor.view.dispatch({ selection: { anchor: t.indexOf('sweet') + 5 } });
        });
        for (let i = 0; i < 40; i++) await page.keyboard.press('Delete');
        expect(await leadText(page)).toBe(doc);
    });
});

// ---------------------------------------------------------------------------------------------
// Where the cursor stops (plan: "Where the cursor stops"): syllables, the gap between words, the slots
// after the words. Never a letter; never a non-gap space.
// ---------------------------------------------------------------------------------------------
test.describe('where the cursor stops (phone)', () => {
    test('a gap stop is boxed like the slot after the words, and D there is written `years[D] since`', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Many long years since home');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Many long');
        const text0 = await leadText(page);
        await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), text0.indexOf('years'));
        await page.locator(`${SHEET} .chm-next`).tap();                  // years -> the gap after it
        expect(await boxStopKind(page)).toBe('gap');
        expect((await boxState(page)).pos).toBe(text0.indexOf('years') + 5);
        await expect(page.locator(`${CM} .cl-slot-gap .cl-slot-text`)).toHaveCount(1);
        await expect(page.locator(`${CM} .cl-slot-gap .cl-slot-text`)).toBeVisible();
        await expect(page.locator(`${CM} .cl-slot-gap .cl-slot-pill`)).toBeVisible();
        await expect(page.locator(`${CM} .cl-box-text`)).toHaveCount(0);
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).tap();
        expect(await leadText(page)).toBe('Many long years[D] since home');
        expect(await boxStopKind(page)).toBe('gap');                     // the cursor stays on the gap, now holding D
        await expect(page.locator(`${CM} .cl-slot-gap .cl-slot-text`)).toHaveCount(1);
        await expect(page.locator(`${CM} .cl-slot-gap .cl-slot-pill`)).toHaveCount(0);   // D's own glyph is boxed instead
    });

    test('a gap is boxed like the slot after the words, and a tap near it lands on it', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Many long years since home');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Many long');
        const text0 = await leadText(page);
        const gapPos = text0.indexOf('years') + 5;
        const boxOf = (sel) => page.evaluate((q) => {
            const t = document.querySelector(q);
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { outline: getComputedStyle(t).outlineStyle, h: Math.round(r.height), w: r.width, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
        }, sel);
        await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), gapPos);
        const gap = await boxOf('#editor-lead .cl-slot-gap .cl-slot-text');
        await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, after: 1, active: true }), text0.length);
        const slot = await boxOf('#editor-lead .cl-slot-after .cl-slot-text');
        expect(gap).not.toBeNull();
        expect(gap.outline).toBe(slot.outline);
        expect(gap.h).toBe(slot.h);                                       // the same box on the lyric row
        expect(gap.w).toBeGreaterThan(6);
        // a tap a few px either side of the space (on the end of "years" / the start of "since") still means the gap
        for (const dx of [-6, 0, 6]) {
            await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
            await page.touchscreen.tap(gap.cx + dx, gap.cy);
            expect(await boxState(page), `dx ${dx}`).toMatchObject({ pos: gapPos });
        }
    });

    test('the magnifier strip mirrors the gap box', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Many long years since home');
        await setMode(page, 'chords');
        const text0 = await leadText(page);
        await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), text0.indexOf('years'));
        await page.locator(`${SHEET} .chm-next`).tap();
        await expect(page.locator('.chm-strip-view .cl-slot-gap .cl-slot-text')).toHaveCount(1);
        await expect(page.locator('.chm-strip-view .cl-box-text')).toHaveCount(0);
    });

    test('▶ walks syllable, gap, next word ... then the slots after the words', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace\nsecond');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
        const kinds = await stepKinds(page, () => page.locator(`${SHEET} .chm-next`).tap());
        // A|maz|ing  gap  grace (silent e: one syllable)  slot
        expect(kinds).toEqual(['syllable', 'syllable', 'gap', 'syllable', 'after']);
        expect(await leadText(page)).toBe('Amazing grace\nsecond');
    });

    test('D, A, E7 in the slots after the words are evenly spaced, in the editor and in the book', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Old home');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'Old home');
        const end = await lineEndPoint(page, 'Old home');
        await page.touchscreen.tap(end.farX, end.y);
        for (const c of ['D', 'A', 'E']) await page.locator(`${SHEET} .chm-cell[data-chord="${c}"]`).tap();
        await page.locator(`${CM} .cl-chord-glyph`).filter({ hasText: 'E' }).tap();
        await page.locator(`${SHEET} .chm-deco[data-id="7"]`).tap();
        expect(await leadText(page)).toBe('Old home  [D]   [A]   [E7]');
        const editor = await segmentRects(page, `${CM} .cl-line`, 0);
        await setMode(page, 'chordpro');
        await page.locator('[data-lead-pane="preview"]').tap();
        const book = await segmentRects(page, '#editor-lead .le-preview-body .cl-line', 0);
        expect(editor.length).toBe(4);
        expect(book.length).toBe(4);
        editor.forEach((r, k) => {
            expect(Math.abs(r.x - book[k].x), `segment ${k} x: editor ${JSON.stringify(editor)} book ${JSON.stringify(book)}`).toBeLessThanOrEqual(1);
            expect(Math.abs(r.w - book[k].w), `segment ${k} width`).toBeLessThanOrEqual(1);
        });
    });

    test('↵ Chord line, then G C D7 G: an evenly spaced chords-only line below', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Old home\nroad');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 2, active: true }));
        const enter = page.locator(`${SHEET} .chm-enter`);
        await expect(enter).toHaveText('↵ Chord line');
        await expect(enter).toHaveAttribute('aria-label', /chord line/i);
        await expect(page.locator(`${SHEET} .chm-addline`)).toHaveCount(1);
        await enter.tap();
        expect(await boxState(page)).toMatchObject({ newLine: true });
        for (const c of ['G', 'C']) await page.locator(`${SHEET} .chm-cell[data-chord="${c}"]`).tap();
        await page.locator(`${SHEET} .chm-more`).tap();
        await page.locator(`${SHEET} .chm-free input`).fill('D7');
        await page.locator(`${SHEET} .chm-free .chm-go`).tap();
        await page.locator(`${SHEET} .chm-cell[data-chord="G"]`).tap();
        expect(await leadText(page)).toBe('Old home\n[G]   [C]   [D7]    [G]\nroad');
    });

    test('↵ Chord line left empty leaves nothing behind', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Old home\nroad');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 2, active: true }));
        await page.locator(`${SHEET} .chm-enter`).tap();
        await page.locator(`${SHEET} .chm-down`).tap();
        expect(await leadText(page)).toBe('Old home\nroad');
    });
});

test.describe('the magnifier never hides behind the top band (root fix)', () => {
    test('entering Chords while the band is slid away, then restored, and after scrolling', async ({ page }) => {
        await openEditor(page);
        await setLead(page, Array.from({ length: 30 }, (_, i) => `Line number ${i + 1} of the song`).join('\n'));
        await page.evaluate(() => document.body.classList.add('chrome-hidden'));
        await page.locator('#editor-mode-chords').tap();
        await expect(page.locator(SHEET)).toBeVisible();
        await page.evaluate(() => document.body.classList.remove('chrome-hidden'));
        const check = async (label) => {
            await page.waitForFunction(() => {
                const t = document.querySelector('.app-topbar');
                return t.getAnimations().length === 0;
            });
            const g = await page.evaluate(() => {
                const band = document.querySelector('.app-topbar').getBoundingClientRect().bottom;
                const r = document.querySelector('.chm-strip').getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + 20, r.top + 4);
                return { band, top: r.top, covered: !hit?.closest('.chm-strip') };
            });
            expect(g.top, label).toBeGreaterThanOrEqual(g.band - 0.5);
            expect(g.covered, label).toBe(false);
        };
        await check('after restoring');
        await page.evaluate(() => window.scrollTo(0, 400));
        await page.waitForTimeout(300);
        await check('after scrolling');
    });
});

// ---------------------------------------------------------------------------------------------
// The magnifier is OFF by default; the arrows, undo / redo and the magnifier toggle are ONE nav row
// of the bottom picker; A- / A+ in the editor toolbar step the song page's own font size.
// (This describe starts from a clean device: the file-level beforeEach skips it.)
test.describe('magnifier default and nav row', () => {
    const bandBottom = (page) => page.evaluate(() => Math.round(document.querySelector('.app-topbar').getBoundingClientRect().bottom));

    test('off by default: no top bar is rendered and the chart has no top padding for it', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await setMode(page, 'chords');
        await expect(page.locator(SHEET)).toBeVisible();
        await expect(page.locator('.chm-strip')).toHaveCount(0);
        const m = await page.evaluate(() => ({
            h: getComputedStyle(document.documentElement).getPropertyValue('--chm-strip-h').trim(),
            pad: getComputedStyle(document.querySelector('#editor-lead')).paddingTop,
            band: Math.round(document.querySelector('.app-topbar').getBoundingClientRect().bottom),
            lead: Math.round(document.querySelector('#editor-lead').getBoundingClientRect().top),
        }));
        expect(m.h).toBe('0px');
        expect(m.pad).toBe('0px');
        expect(await page.evaluate(() => localStorage.getItem('bgb-chord-magnifier'))).toBeNull();
        // the nav row is there, with the toggle unpressed
        await expect(page.locator(`${SHEET} .chm-mag`)).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator(`${SHEET} .chm-mag`)).toHaveAttribute('aria-label', 'Magnifier');
    });

    test('toggling it on shows the bar fully below the band, and the setting survives a reload', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await setMode(page, 'chords');
        await page.locator(`${SHEET} .chm-mag`).tap();
        await expect(page.locator('.chm-strip')).toHaveCount(1);
        await expect(page.locator(`${SHEET} .chm-mag`)).toHaveAttribute('aria-pressed', 'true');
        const r = await page.evaluate(() => {
            const s = document.querySelector('.chm-strip').getBoundingClientRect();
            return { top: Math.round(s.top), h: Math.round(s.height), band: Math.round(document.querySelector('.app-topbar').getBoundingClientRect().bottom),
                cssH: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chm-strip-h'), 10) };
        });
        expect(r.top).toBeGreaterThanOrEqual(r.band);
        expect(r.h).toBeGreaterThan(40);
        expect(Math.abs(r.cssH - r.h)).toBeLessThanOrEqual(1);
        await page.reload();
        await leadReady(page);
        await setMode(page, 'chords');
        await expect(page.locator('.chm-strip')).toHaveCount(1);
        await page.locator(`${SHEET} .chm-mag`).tap();                    // and back off
        await expect(page.locator('.chm-strip')).toHaveCount(0);
        await page.reload();
        await leadReady(page);
        await setMode(page, 'chords');
        await expect(page.locator('.chm-strip')).toHaveCount(0);
    });

    test('the nav row arrows move the cursor, and its undo undoes a placed chord', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing grace how sweet\nsecond line here');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
        const nav = page.locator(`${SHEET} .chm-row3`);
        for (const sel of ['.chm-prev', '.chm-up', '.chm-down', '.chm-next', '.chm-undo', '.chm-redo', '.chm-mag']) {
            const b = await nav.locator(sel).boundingBox();
            expect(b.width, sel).toBeGreaterThanOrEqual(40);
            expect(b.height, sel).toBeGreaterThanOrEqual(40);
        }
        const p0 = await boxPos(page);
        await nav.locator('.chm-next').tap();
        const p1 = await boxPos(page);
        expect(p1).toBeGreaterThan(p0);
        await nav.locator('.chm-prev').tap();
        expect(await boxPos(page)).toBe(p0);
        await nav.locator('.chm-down').tap();
        expect(await boxPos(page)).toBeGreaterThan(23);                    // the second line
        await nav.locator('.chm-up').tap();
        expect(await boxPos(page)).toBeLessThan(23);
        const before = await leadText(page);
        await page.locator(`${SHEET} [data-chord="G"]`).first().tap();
        expect(await leadText(page)).toContain('[G]');
        await nav.locator('.chm-undo').tap();
        expect(await leadText(page)).toBe(before);
        // no arrows anywhere else
        await expect(page.locator(`${SHEET} .chm-next`)).toHaveCount(1);
    });

    test('with the magnifier on, hold-to-trackpad still works on the picker and the arrows are not drawn twice', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('bgb-chord-magnifier', '1'));
        await openEditor(page);
        await setLead(page, 'Amazing river how sweet');
        await setMode(page, 'chords');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
        await expect(page.locator(`${SHEET} .chm-prev, ${SHEET} .chm-next, ${SHEET} .chm-up, ${SHEET} .chm-down`)).toHaveCount(4);
        await expect(page.locator('.chm-strip .chm-step')).toHaveCount(0);
        const sheet = page.locator(SHEET);
        const spacer = await centreOf(sheet.locator('.chm-row2 .chm-sp'));
        await touchDrag(page, spacer, along(10, 6), { holdMs: 450, onHeld: async () => { await expect(sheet).toHaveClass(/is-trackpad/); } });
        expect(await boxPos(page)).toBeGreaterThanOrEqual(4);
    });

    test('every row keeps a fixed height across cursor states', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'Amazing [G]grace [Am7]how sweet\nsecond line');
        await setMode(page, 'chords');
        const measure = async (pos) => {
            await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), pos);
            await page.waitForTimeout(150);
            return page.evaluate(() => {
                const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; };
                return { row1: r('.chm-row1'), row2: r('.chm-row2'), row3: r('.chm-row3'), decos: r('.chm-decos'), picker: r('.chm-body') };
            });
        };
        const text = await leadText(page);
        const empty = await measure(2);
        const plain = await measure(text.indexOf('[G]') + 3);
        const ext = await measure(text.indexOf('[Am7]') + 5);
        expect(plain).toEqual(empty);
        expect(ext).toEqual(empty);
        expect(empty.row3[1]).toBe(40);
        expect(empty.row1[1]).toBe(40);
        expect(empty.row2[1]).toBe(40);
    });

    test('A+ enlarges the chart, a tap still lands on the right syllable, and the song page shows the same size', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await setMode(page, 'chords');
        const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#editor-lead .cm-content')).fontSize));
        const s0 = await size();
        const lineH0 = await page.evaluate(() => document.querySelector('#editor-lead .cm-line.cl-line').getBoundingClientRect().height);
        await page.locator('#editor-font-up').tap();
        await page.locator('#editor-font-up').tap();
        const s1 = await size();
        expect(s1).toBeGreaterThan(s0);
        expect(await page.evaluate(() => document.querySelector('#editor-lead .cm-line.cl-line').getBoundingClientRect().height)).toBeGreaterThan(lineH0);
        // a tap lands on the syllable it is on, at the new size
        const needle = 'In the hollow';
        await scrollLineToTop(page, needle);
        await page.waitForTimeout(200);
        let ok = 0, n = 0;
        for (const c of await syllableCentres(page, needle)) {
            const s = await tapSyllable(page, needle, c);
            n++;
            if ((await boxPos(page)) === s.seam) ok++;
            await scrollLineToTop(page, needle);
            await page.waitForTimeout(100);
        }
        expect(n).toBeGreaterThan(3);
        expect(ok).toBeGreaterThanOrEqual(n - 1);
        // the SAME setting the song page uses
        const level = await page.evaluate(() => JSON.parse(localStorage.getItem('songbook-view-prefs')).fontSizeLevel);
        expect(level).toBeGreaterThan(0);
        await page.locator('#editor-font-down').tap();
        expect(await size()).toBeLessThan(s1);
        await page.locator('#editor-font-up').tap();
        expect(await size()).toBeCloseTo(s1, 1);
        await page.goto('/#work/old-home-place');
        const book = page.locator('.song-body:visible:not(.cm-content)').first();
        await expect(book).toBeVisible({ timeout: 15000 });
        const em = await book.evaluate((e) => e.style.fontSize);
        const lvl = await page.evaluate(() => JSON.parse(localStorage.getItem('songbook-view-prefs')).fontSizeLevel);
        expect(lvl).toBe(level);
        expect(parseFloat(em)).toBeGreaterThan(1.1);   // level 2 = 1.25em
    });
});

test.describe('narrow phones: the docked picker header fits', () => {
    for (const width of [320, 360]) {
        test(`at ${width}px no button or select inside the picker leaves the viewport`, async ({ page }) => {
            await page.setViewportSize({ width, height: 700 });
            await openEditor(page);
            await setLead(page, 'Amazing [G]grace how sweet');
            await setMode(page, 'chords');
            await expect(page.locator(SHEET)).toBeVisible();
            const out = await page.evaluate(() => {
                const w = document.documentElement.clientWidth;
                const bad = [];
                for (const el of document.querySelectorAll('.chm-body button, .chm-body select')) {
                    const r = el.getBoundingClientRect();
                    if (!r.width) continue;
                    if (r.left < -0.5 || r.right > w + 0.5) bad.push(`${el.className || el.tagName} ${Math.round(r.left)}..${Math.round(r.right)} of ${w}`);
                }
                const h = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height);
                return { bad, rows: [h('.chm-row1'), h('.chm-row3'), h('.chm-mag'), h('.chm-modeswitch button')] };
            });
            expect(out.bad).toEqual([]);
            expect(out.rows.slice(0, 3)).toEqual([40, 40, 40]);
        });
    }
});

test.describe('the cursor pill does not cover the next chord', () => {
    test('after a short syllable the visible chord still takes the tap', async ({ page }) => {
        await openEditor(page);
        await setLead(page, 'I [Dm]fell in love');
        await setMode(page, 'chords');
        await scrollLineToTop(page, 'fell');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));   // the cursor on "I"
        await expect(page.locator(`${CM} .cl-slot-pill`)).toBeVisible();
        const glyph = page.locator(`${CM} .cl-chord-glyph`).first();
        const c = await centreOf(glyph);
        const hit = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return !!el && !!el.closest('.cl-chord-glyph');
        }, c);
        expect(hit).toBe(true);
        await page.touchscreen.tap(c.x, c.y);
        await expect(page.locator(`${SHEET} .chm-remove`)).toBeVisible();
        await expect(page.locator(`${CM} .cl-box-chord`)).toHaveCount(1);
    });
});
