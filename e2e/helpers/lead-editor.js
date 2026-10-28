// Helpers for the lead-sheet editor (CodeMirror, js/lead-editor/). The
// document is the ChordPro text; these read and write it through the editor
// itself, so the tests exercise what a person can do. Three modes:
// Lyrics | Chords | ChordPro.
import { expect } from '@playwright/test';

export const CM = '#editor-lead .cm-content';
export const SHEET = '.chm-menu';

/** Wait for the editor to be mounted and typeable. */
export async function leadReady(page) {
    await expect(page.locator(CM)).toBeVisible({ timeout: 15000 });
}

/** Open `#add` (or `route`) and wait for the editor. */
export async function openEditor(page, route = '#add', query = '') {
    await page.goto(`/${query}${route}`);
    await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
    await leadReady(page);
}

/** Choose a mode with the switch: 'lyrics' | 'chords' | 'chordpro'. */
export async function setMode(page, mode) {
    await page.locator(`#editor-mode-${mode}`).click();
    await expect(page.locator(`#editor-mode-${mode}`)).toHaveAttribute('aria-pressed', 'true');
}

/** Replace the whole document with `text` (Lyrics mode: select all, then insert: one input). */
export async function setLead(page, text) {
    await leadReady(page);
    if (await page.locator('#editor-mode-chords').getAttribute('aria-pressed') === 'true') await setMode(page, 'lyrics');
    await page.locator(CM).click();
    await page.keyboard.press('ControlOrMeta+a');
    if (text === '') await page.keyboard.press('Delete');
    else await page.keyboard.insertText(text);
}

/** Type `text` as a new last line (Lyrics mode): what a person does to an existing song. (Select-all + replace keeps only the metadata lines; the old sections go.) */
export async function appendLead(page, text) {
    await leadReady(page);
    if (await page.locator('#editor-mode-chords').getAttribute('aria-pressed') === 'true') await setMode(page, 'lyrics');
    await page.locator(CM).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(`\n${text}`);
}

/** The ChordPro text, through the editor's own text adapter (what submit, copy and download read). */
export async function leadText(page) {
    return page.evaluate(() => document.querySelector('#editor-lead').__lead.getText());
}

/** The chord box's document position (null when none). */
export async function boxPos(page) {
    return page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.getBox()?.pos ?? null);
}

/** The line text + offset the box sits at: stable across chord insertions. */
export async function boxAt(page) {
    return page.evaluate(() => {
        const { editor } = document.querySelector('#editor-lead').__lead;
        const box = editor.getBox();
        if (!box) return null;
        const line = editor.view.state.doc.lineAt(box.pos);
        const before = line.text.slice(0, box.pos - line.from).replace(/\[[^\]]*\]/g, '');
        return { line: line.number, lyricsBefore: before };
    });
}

/** Open `text` as a new song in Chords mode with the box on its first syllable. */
export async function chordsOn(page, text) {
    await setLead(page, text);
    await setMode(page, 'chords');
    await expect(page.locator(SHEET)).toBeVisible();
}

/** The centre of every syllable of the lyric line `lineIndex` (0 = first lyric line): [{seam, x, y}]. */
export async function syllableCentres(page, lineText) {
    return page.evaluate((needle) => {
        const { editor } = document.querySelector('#editor-lead').__lead;
        const view = editor.view;
        const doc = view.state.doc;
        let line = null;
        for (let n = 1; n <= doc.lines; n++) if (doc.line(n).text.includes(needle)) { line = doc.line(n); break; }
        if (!line) return [];
        const seams = editor.seams(line.from);
        const out = [];
        for (let i = 0; i + 1 < seams.length; i++) {
            const a = view.coordsAtPos(seams[i], 1);
            // the syllable ends where its text ends: the character before the next seam, not the next seam's chord
            const next = seams[i + 1];
            const text = doc.sliceString(seams[i], next).replace(/\[[^\]]*\]/g, '');
            const lyricsEnd = seams[i] + (doc.sliceString(seams[i], next).length - (doc.sliceString(seams[i], next).match(/(\[[^\]]*\])+$/)?.[0].length || 0));
            const b = view.coordsAtPos(Math.max(seams[i] + 1, lyricsEnd), -1);
            if (!a || !b || !text.trim()) continue;
            if (Math.abs(a.top - b.top) > 3) continue;   // a syllable that wraps: skip
            out.push({ seam: seams[i], x: (a.left + b.right) / 2, y: (a.top + a.bottom) / 2, top: a.top, h: a.bottom - a.top, text });
        }
        return out;
    }, lineText);
}

/** The viewport point at the middle of the first occurrence of `word` in the chart. */
export async function pointOnWord(page, word) {
    return page.evaluate((w) => {
        const { editor } = document.querySelector('#editor-lead').__lead;
        const view = editor.view;
        const text = view.state.doc.toString();
        // the word in the lyrics: allow chord tokens between its letters
        const re = new RegExp(w.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:\\[[^\\]]*\\])*'));
        const m = re.exec(text);
        if (!m) return null;
        const lyricsStart = m.index + (/^(\[[^\]]*\])*/.exec(text.slice(m.index))[0].length);
        const a = view.coordsAtPos(lyricsStart, 1);
        const b = view.coordsAtPos(m.index + m[0].length, -1);
        return { x: (a.left + b.right) / 2, y: (a.top + a.bottom) / 2 };
    }, word);
}

/** Scroll the lyric line holding `lineText` to just under the docked magnifier (the top of the visible gap). */
export async function scrollLineToTop(page, lineText) {
    await page.evaluate((needle) => {
        const el = [...document.querySelectorAll('#editor-lead .cm-line')].find((l) => l.textContent.includes(needle));
        const strip = document.querySelector('.chm-split .chm-strip:not(.hidden)');
        const top = (strip && strip.offsetParent !== undefined && getComputedStyle(strip).position === 'fixed' ? strip.getBoundingClientRect().bottom : 90) + 50;
        if (el) window.scrollBy(0, el.getBoundingClientRect().top - top);
    }, lineText);
}

/** The whole box state ({pos, active, after?, newLine?}), or null. */
export async function boxState(page) {
    return page.evaluate(() => {
        const b = document.querySelector('#editor-lead').__lead.editor.getBox();
        return b ? { pos: b.pos, after: b.after || 0, newLine: !!b.newLine } : null;
    });
}

/** Where the TEXT of the lyric line holding `needle` ends, in viewport px: { x, y } (y = the middle of the lyric row). */
export async function lineEndPoint(page, needle) {
    return page.evaluate((n) => {
        const { editor } = document.querySelector('#editor-lead').__lead;
        const view = editor.view;
        const doc = view.state.doc;
        for (let i = 1; i <= doc.lines; i++) {
            const line = doc.line(i);
            if (!line.text.includes(n)) continue;
            const c = view.coordsAtPos(line.to, -1);
            const el = view.domAtPos(line.from).node;
            const row = (el.nodeType === 1 ? el : el.parentElement).closest('.cm-line').getBoundingClientRect();
            // `farX`: empty space on the same row well to the right, clear of a desktop popover
            return { x: c.left, y: (c.top + c.bottom) / 2, farX: Math.min(row.right - 60, c.left + 700) };
        }
        return null;
    }, needle);
}

/** The centre of an element's box in viewport px. */
export async function centreOf(locator) {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * A one-finger drag with REAL touch events (CDP), on the mobile project: press at `start`, optionally wait
 * `holdMs`, call `onHeld`, then move by each [dx, dy] in `deltas`, `stepMs` apart (slow enough to be a
 * letter-by-letter drag), and lift.
 */
export async function touchDrag(page, start, deltas, { holdMs = 0, stepMs = 40, onHeld } = {}) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    let { x, y } = start;
    await send('touchStart', [{ x, y, id: 1 }]);
    if (holdMs) await page.waitForTimeout(holdMs);
    if (onHeld) await onHeld();
    for (const [dx, dy] of deltas) {
        x += dx; y += dy;
        await send('touchMove', [{ x, y, id: 1 }]);
        await page.waitForTimeout(stepMs);
    }
    await send('touchEnd', []);
    await cdp.detach();
}

/** Mouse drag in small slow steps (a fast drag is a seam / word drag by design). */
export async function mouseDrag(page, start, deltas, { stepMs = 30 } = {}) {
    let { x, y } = start;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const [dx, dy] of deltas) {
        x += dx; y += dy;
        await page.mouse.move(x, y);
        await page.waitForTimeout(stepMs);
    }
    await page.mouse.up();
}

/** [dx, dy] steps: `n` moves of `px` along x. */
export const along = (n, px) => Array.from({ length: n }, () => [px, 0]);

/** Segment geometry of a `.cl-line` (x, width, height relative to the line; the chord text of each segment). */
export function segmentRects(page, lineSelector, index) {
    return page.evaluate(({ sel, i }) => {
        const line = document.querySelectorAll(sel)[i];
        const base = line.getBoundingClientRect();
        return [...line.querySelectorAll('.cl-segment')].map((s) => {
            const r = s.getBoundingClientRect();
            const ch = s.querySelector('.cl-chord');
            return { x: Math.round(r.left - base.left), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top - base.top), chord: ch?.textContent.replace(/\s| /g, '') };
        });
    }, { sel: lineSelector, i: index });
}

/**
 * What kind of cursor stop the box stands on: 'syllable' | 'gap' | 'after', or null when it is NOT on a
 * stop (a bug: letters and non-gap spaces are never stops). A pending chord line reports 'newline'.
 */
export async function boxStopKind(page) {
    return page.evaluate(async () => {
        const { lineStops } = await import('/js/lead-editor/doc-model.js');
        const { editor } = document.querySelector('#editor-lead').__lead;
        const b = editor.getBox();
        if (!b) return null;
        if (b.newLine) return 'newline';
        const text = editor.getText();
        const ls = text.lastIndexOf('\n', b.pos - 1) + 1;
        return lineStops(text, ls).find((s) => s.pos === b.pos && !!s.after === !!b.after)?.kind ?? null;
    });
}

/** The kinds the ▶ arrow walks through on the cursor's line, from the box's current stop to the line's end: ['gap', 'syllable', ..., 'after']. */
export async function stepKinds(page, press, max = 30) {
    const out = [];
    const startLine = await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; return editor.view.state.doc.lineAt(editor.getBox().pos).number; });
    for (let i = 0; i < max; i++) {
        await press();
        const line = await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; return editor.view.state.doc.lineAt(editor.getBox().pos).number; });
        if (line !== startLine) break;
        out.push(await boxStopKind(page));
        if (out.at(-1) === 'after' && (await boxState(page)).after) break;
    }
    return out;
}

/** x offsets (rounded, relative to the first segment) of every .cl-segment of a line, for comparing editor and book spacing. */
export function segmentXs(page, lineSelector, index) {
    return page.evaluate(({ sel, i }) => {
        const line = document.querySelectorAll(sel)[i];
        const segs = [...line.querySelectorAll('.cl-segment')];
        const x0 = segs[0].getBoundingClientRect().left;
        return segs.map((s) => Math.round(s.getBoundingClientRect().left - x0));
    }, { sel: lineSelector, i: index });
}
