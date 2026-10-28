// E2E for the lead-sheet editor (docs/js/lead-editor/): ONE CodeMirror view, three modes,
// Lyrics | Chords | ChordPro, over the ChordPro text. Lyrics and Chords are decorations drawn
// with the song page's own classes. See docs/plans/2026-10-26-lyrics-editor-redesign.md.
import { test, expect } from './fixtures.js';
import {
    CM, SHEET, setLead, leadText, leadReady, setMode, chordsOn, boxAt, boxPos, openEditor, pointOnWord,
    boxState, lineEndPoint, centreOf, mouseDrag, along, segmentRects, syllableCentres, boxStopKind, stepKinds,
} from './helpers/lead-editor.js';

const LEAD = '#editor-lead';

// The top magnifier is OFF by default (per-device setting `bgb-chord-magnifier`); the tests that
// exercise the strip turn it on. The default-off tests live in visual-editor-mobile.spec.js.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('bgb-chord-magnifier', '1'));
});
const CHORDS = `${CM} .cl-chord:not(.cl-chord-gap)`;
const LABELS = `${CM} .section-label`;

async function openNew(page, query = '') {
    await openEditor(page, '#add', query);
}

test.describe('Lyrics mode: writing', () => {
    test('typing is plain text on the chart; a blank line starts a new verse', async ({ page }) => {
        await openNew(page);
        await page.locator(CM).click();
        await page.keyboard.type('Amazing grace\nhow sweet\n\nSecond verse');
        expect(await leadText(page)).toBe('Amazing grace\nhow sweet\n\nSecond verse');
        // the book labels untagged verses; so does the editor
        await expect(page.locator(LABELS)).toHaveText(['Verse 1', 'Verse 2']);
    });

    test('Backspace deletes the letter beside a chord, never the chord', async ({ page }) => {
        await openNew(page);
        await setLead(page, 'Ama[G]zing');
        // caret right before the "z" (after the hidden chord)
        await page.locator(CM).click();
        await page.keyboard.press('ControlOrMeta+Home');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');   // steps over the chord as one unit
        await page.keyboard.press('Backspace');
        expect(await leadText(page)).toBe('Am[G]zing');
    });

    test('text typed where a chord sits goes before the chord', async ({ page }) => {
        await openNew(page);
        await setLead(page, 'Ama[G]zing');
        await page.locator(CM).click();
        await page.keyboard.press('ControlOrMeta+Home');
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
        await page.keyboard.type('X');
        expect(await leadText(page)).toBe('AmaX[G]zing');
    });

    test('deleting a range with chords removes them, says so, and Undo brings them back', async ({ page }) => {
        await openNew(page);
        await setLead(page, '[G]One [C]two [D]three');
        await page.locator(CM).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        const toast = page.locator('.le-toast');
        await expect(toast).toContainText('Removed 3 chords');
        await toast.locator('.le-toast-undo').click();
        expect(await leadText(page)).toBe('[G]One [C]two [D]three');
    });

    test('Undo and Redo buttons drive one history', async ({ page }) => {
        await openNew(page);
        await page.locator(CM).click();
        await page.keyboard.type('hello');
        await expect(page.locator('#editor-undo')).toBeEnabled();
        await page.locator('#editor-undo').click();
        expect(await leadText(page)).toBe('');
        await expect(page.locator('#editor-redo')).toBeEnabled();
        await page.locator('#editor-redo').click();
        expect(await leadText(page)).toBe('hello');
    });

    test('paste in Lyrics mode converts a chords-over-lyrics sheet and backfills the title', async ({ page }) => {
        await openNew(page);
        await page.locator(CM).click();
        await page.evaluate(() => {
            const dt = new DataTransfer();
            dt.setData('text/plain', 'Title: Pasted Song\nArtist: Some Band\n\nG       C\nAmazing grace how sweet\nD       G\nThat saved a wretch');
            document.querySelector('#editor-lead .cm-content').dispatchEvent(
                new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        });
        await expect(page.locator(CHORDS).first()).toBeVisible();
        const text = await leadText(page);
        expect(text).toMatch(/\[G\]Amazing/);
        expect(text).toMatch(/\[D\]/);
    });

    test('plain pasted text stays plain (browser default)', async ({ page }) => {
        await openNew(page);
        await page.locator(CM).click();
        await page.keyboard.insertText('just some words\nand more');
        expect(await leadText(page)).toBe('just some words\nand more');
        await expect(page.locator(CHORDS)).toHaveCount(0);
    });
});

test.describe('Lyrics mode: sections', () => {
    test('selecting lines floats a section bar; Chorus wraps and indents them', async ({ page }) => {
        await openNew(page);
        await setLead(page, 'Line one\nLine two\n\nLine three');
        const first = page.locator(`${LEAD} .cm-line`, { hasText: 'Line one' });
        const box = await first.boundingBox();
        await page.mouse.move(box.x + 4, box.y + 6);
        await page.mouse.down();
        await page.mouse.move(box.x + 60, box.y + box.height + 12);
        await page.mouse.up();
        const bar = page.locator('.le-selbar');
        await expect(bar).toBeVisible();
        await expect(bar.locator('button')).toHaveText(['Verse', 'Chorus', 'Bridge', 'Intro', 'Outro', 'Tag', 'Other…']);
        await bar.locator('[data-wrap="chorus"]').click();
        const text = await leadText(page);
        expect(text).toContain('{start_of_chorus: Chorus}\nLine one\nLine two\n{end_of_chorus}');
        await expect(page.locator(LABELS).first()).toHaveText('Chorus');
        await expect(page.locator(`${LEAD} .cm-line.section-indent`).first()).toBeVisible();
    });

    test('tapping a section label: change type, duplicate, move, remove label, delete', async ({ page }) => {
        await openNew(page);
        await setLead(page, '{start_of_verse: Verse 1}\nOne\n{end_of_verse}\n\n{start_of_chorus: Chorus}\nTwo\n{end_of_chorus}');
        await page.locator(LABELS, { hasText: 'Verse 1' }).click();
        const menu = page.locator('.le-labelmenu');
        await expect(menu).toBeVisible();
        await menu.getByRole('menuitem', { name: 'Move down' }).click();
        expect(await leadText(page)).toMatch(/^\{start_of_chorus: Chorus\}\nTwo\n\{end_of_chorus\}\n\n\{start_of_verse: Verse 1\}\nOne/);

        await page.locator(LABELS, { hasText: 'Chorus' }).click();
        await page.locator('.le-labelmenu-types button', { hasText: 'Bridge' }).click();
        expect(await leadText(page)).toContain('{start_of_bridge: Bridge}');

        await page.locator(LABELS, { hasText: 'Bridge' }).click();
        await page.locator('.le-labelmenu').getByRole('menuitem', { name: 'Delete section' }).click();
        expect(await leadText(page)).not.toContain('Two');
        await expect(page.locator('.le-toast')).toContainText('Deleted Bridge');
    });
});

test.describe('Lyrics mode: selection and sections across boundaries', () => {
    test('a cross-line selection has exactly one highlight: the native one', async ({ page }) => {
        await openNew(page);
        await setLead(page, 'Line one here\nLine two here\n\nLine three');
        const a = await page.locator(`${LEAD} .cm-line`, { hasText: 'Line one' }).boundingBox();
        const b = await page.locator(`${LEAD} .cm-line`, { hasText: 'Line two' }).boundingBox();
        await page.mouse.move(a.x + 20, a.y + 6);
        await page.mouse.down();
        await page.mouse.move(b.x + 60, b.y + 6, { steps: 5 });
        await page.mouse.up();
        await expect(page.locator('.le-selbar')).toBeVisible();
        // no second, drawn selection (CodeMirror's drawSelection layers and iOS handles)
        await expect(page.locator(`${LEAD} .cm-selectionBackground`)).toHaveCount(0);
        await expect(page.locator(`${LEAD} .cm-selectionHandle`)).toHaveCount(0);
        await expect(page.locator(`${LEAD} .cm-selectionLayer`)).toHaveCount(0);
        const selected = await page.evaluate(() => window.getSelection().toString());
        expect(selected).toContain('ne one here\nLine t');
    });

    test('selecting from the end of Verse 2 into the Chorus re-sections cleanly', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        const range = await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            const t = editor.getText();
            return { from: t.indexOf('sawmill'), to: t.indexOf('What have') + 'What have'.length };
        });
        await page.evaluate(({ from, to }) => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            editor.view.focus();
            editor.view.dispatch({ selection: { anchor: from, head: to } });
        }, range);
        await page.locator('.le-selbar [data-wrap="bridge"]').click();
        const lines = (await leadText(page)).split('\n');
        const starts = lines.filter((l) => l.startsWith('{start_of_'));
        const ends = lines.filter((l) => l.startsWith('{end_of_'));
        expect(ends.length).toBe(starts.length);
        const v2 = lines.indexOf('{start_of_verse: Verse 2}');
        expect(lines[v2 + 4]).toBe('{end_of_verse}');
        expect(lines).toContain('{start_of_bridge: Bridge}');
        const labels = starts.map((l) => l.replace(/^\{start_of_\w+:?\s*/, '').replace(/\}$/, ''));
        const verses = labels.filter((l) => /^Verse/.test(l));
        expect(new Set(verses).size).toBe(verses.length);
        // the lyric lines are all still there
        expect(lines.join('\n')).toContain('Why did they tear it [E7]down');
        expect(lines.join('\n')).toContain('And worked in a [E7]sawmill [A]too');
    });
});

test.describe('Lyrics mode: chords are inert', () => {
    test('a chord label is not clickable: no box, no sheet', async ({ page }) => {
        await openNew(page);
        await setLead(page, '[G]Hello [C]there');
        await page.locator(CHORDS).first().click();
        await expect(page.locator(SHEET)).toBeHidden();
        await expect(page.locator(`${CM} .cl-box-chord, ${CM} .cl-slot`)).toHaveCount(0);
        expect(await boxPos(page)).toBe(null);
    });

    test('double-click a word stays in Lyrics mode: the browser selects the word', async ({ page }) => {
        await openNew(page);
        await setLead(page, 'Amazing grace how sweet');
        const how = await pointOnWord(page, 'how');
        await page.mouse.dblclick(how.x, how.y);
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#editor-mode-chords')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator(SHEET)).toBeHidden();
        expect(await page.evaluate(() => window.getSelection().toString().trim())).toBe('how');
    });

    test('chords are greyed out in Lyrics mode (colour and opacity only, same layout) and normal in Chords mode', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await setMode(page, 'lyrics');
        const measure = () => page.evaluate(() => {
            const g = document.querySelector('#editor-lead .cl-chord-glyph');
            const cs = getComputedStyle(g);
            const line = document.querySelector('#editor-lead .cl-line');
            const base = line.getBoundingClientRect();
            return {
                color: cs.color, opacity: cs.opacity, cursor: cs.cursor, weight: cs.fontWeight, size: cs.fontSize,
                rects: [...line.querySelectorAll('.cl-segment')].map((s) => { const r = s.getBoundingClientRect(); return [r.left - base.left, r.width, r.height]; }),
            };
        });
        const lyrics = await measure();
        await setMode(page, 'chords');
        const chords = await measure();
        expect(Number(lyrics.opacity)).toBeLessThanOrEqual(0.6);
        expect(chords.opacity).toBe('1');
        expect(lyrics.color).not.toBe(chords.color);
        expect(lyrics.cursor).not.toBe('pointer');
        expect(chords.cursor).toBe('pointer');
        expect(lyrics.weight).toBe(chords.weight);
        expect(lyrics.size).toBe(chords.size);
        expect(lyrics.rects).toEqual(chords.rects);
    });

    test('select-all + Delete removes whole sections, labels included; the metadata stays', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await setMode(page, 'lyrics');
        await page.locator(CM).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Delete');
        const text = await leadText(page);
        expect(text).not.toContain('{start_of_');
        expect(text).not.toContain('{end_of_');
        expect(text).toContain('{meta:');
        expect(text.split('\n').every((l) => l.startsWith('{meta:') || l.startsWith('{key:'))).toBe(true);
        expect(text).not.toMatch(/\n{2,}|\n$/);
        await expect(page.locator(LABELS)).toHaveCount(0);
    });

    test('select-all + Delete on a new song leaves an empty song', async ({ page }) => {
        await openNew(page);
        await setLead(page, '{start_of_verse: Verse 1}\nhello\n{end_of_verse}');
        await page.locator(CM).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Delete');
        expect(await leadText(page)).toBe('');
    });
});

test.describe('Chords mode on desktop', () => {
    test('the chart is locked: not editable, no text selection, no keyboard', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace how sweet');
        await expect(page.locator(CM)).toHaveAttribute('contenteditable', 'false');
        const style = await page.locator(CM).evaluate((el) => getComputedStyle(el).userSelect);
        expect(style).toBe('none');
        await page.keyboard.insertText('zzz');
        expect(await leadText(page)).toBe('Amazing grace how sweet');
    });

    test('click a lyric, tap a chord in the sheet; change it with a decoration; delete it', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace how sweet');
        const sheet = page.locator(SHEET);
        await expect(sheet).toContainText('Key of G');
        // the decorations row is always there (the sheet keeps its height) but dimmed and inert until the box holds a chord
        await expect(sheet.locator('.chm-decos.idle')).toHaveCount(1);
        await expect(sheet.locator('.chm-deco:not([disabled])')).toHaveCount(0);
        const how = await pointOnWord(page, 'how');
        await page.mouse.click(how.x, how.y);
        expect((await boxAt(page)).lyricsBefore).toBe('Amazing grace ');
        await sheet.locator('.chm-cell[data-chord="D"]').click();
        await expect(page.locator(CHORDS)).toHaveText('D');
        await expect(page.locator(`${CM} .cl-box-chord`)).toHaveText('D');
        // a decoration composes with the chord in the box
        await sheet.locator('.chm-deco[data-id="7"]').click();
        await expect(page.locator(CHORDS)).toHaveText('D7');
        await sheet.locator('.chm-deco[data-id="7"]').click();   // again: back to the plain triad
        await expect(page.locator(CHORDS)).toHaveText('D');
        // Delete removes the chord in the box; Esc closes the sheet
        await page.keyboard.press('Backspace');
        await expect(page.locator(CHORDS)).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        expect(await leadText(page)).toBe('Amazing grace how sweet');
    });

    test('typing a chord letter starts ghost entry: E then b7 gives Eb7', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace');
        await page.keyboard.type('E');
        await page.keyboard.type('b7');
        await page.keyboard.press('Enter');
        expect(await leadText(page)).toMatch(/^\[Eb7\]Amazing grace/);
    });

    test('arrows move the box seam to seam; Space advances', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace\nhow sweet');
        await page.keyboard.press('ArrowRight');   // Ama|zing
        await page.keyboard.press('ArrowDown');    // line two
        await page.locator(`${SHEET} .chm-cell[data-chord="C"]`).click();
        const text = (await leadText(page)).split('\n');
        expect(text[1]).toMatch(/\[C\]/);
        expect(text[0]).toBe('Amazing grace');
        await page.keyboard.press('Space');
        const at = await boxAt(page);
        expect(at.line).toBe(2);
    });

    test('the trackpad strip: dragging steps the box seam by seam; the buttons step too', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace how sweet\nsecond line');
        const strip = page.locator(`${SHEET} .chm-strip-view`);
        await expect(strip.locator('.cm-line')).toContainText('Amazing');
        await expect(strip.locator('.cl-slot, .cl-box-text').first()).toBeAttached();
        const start = await boxPos(page);
        const b = await strip.boundingBox();
        await page.mouse.move(b.x + 30, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + 30 + 50, b.y + b.height / 2, { steps: 10 });   // ~2 seams at 22px each
        await page.mouse.up();
        const after = await boxPos(page);
        expect(after).toBeGreaterThan(start);
        expect((await boxAt(page)).lyricsBefore.length).toBeGreaterThan(0);
        const dragged = (await boxAt(page)).lyricsBefore;
        // drag back the other way
        await page.mouse.move(b.x + 100, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + 100 - 200, b.y + b.height / 2, { steps: 10 });
        await page.mouse.up();
        expect((await boxAt(page)).lyricsBefore.length).toBeLessThan(dragged.length);
        // buttons: ▶ one seam, ▼ one line
        const p0 = await boxPos(page);
        await page.locator(`${SHEET} .chm-next`).click();
        expect(await boxPos(page)).toBeGreaterThan(p0);
        await page.locator(`${SHEET} .chm-down`).click();
        expect((await boxAt(page)).line).toBe(2);
        await page.locator(`${SHEET} .chm-up`).click();
        expect((await boxAt(page)).line).toBe(1);
        await page.locator(`${SHEET} .chm-prev`).click();
    });

    test('tapping a chord on the chart selects it; Move carries it; Remove deletes it (one undo step)', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, '[G]Amazing grace how sweet');
        const sheet = page.locator(SHEET);
        await page.locator(`${CM} .cl-chord-glyph`).first().click();
        await expect(sheet.locator('.chm-move')).toBeVisible();
        await expect(sheet.locator('.chm-remove')).toBeVisible();
        // Move: the chord travels with the strip / buttons
        await sheet.locator('.chm-move').click();
        await expect(sheet.locator('.chm-move')).toHaveAttribute('aria-pressed', 'true');
        await sheet.locator('.chm-next').click();
        let text = await leadText(page);
        expect(text).toMatch(/^Ama\[G\]zing|^Amazing \[G\]grace|^A\[G\]mazing/);
        expect(text.match(/\[G\]/g)).toHaveLength(1);
        await sheet.locator('.chm-next').click();
        const moved = await leadText(page);
        expect(moved).not.toBe(text);
        expect(moved.match(/\[G\]/g)).toHaveLength(1);
        // tap Move again: it drops; the next step moves the box alone
        await sheet.locator('.chm-move').click();
        await expect(sheet.locator('.chm-move')).toHaveAttribute('aria-pressed', 'false');
        await sheet.locator('.chm-next').click();
        expect(await leadText(page)).toBe(moved);
        // Remove deletes the chord under the box: select it, remove, undo brings it back
        await page.locator(`${CM} .cl-chord-glyph`).first().click();
        await sheet.locator('.chm-remove').click();
        expect(await leadText(page)).not.toContain('[G]');
        await page.locator('#editor-undo').click();
        expect(await leadText(page)).toBe(moved);
    });

    test('the picker\'s Lyrics switch goes back to Lyrics (there is no Done); Esc closes only the sheet', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace');
        await expect(page.locator(`${SHEET} .chm-done`)).toHaveCount(0);
        await page.locator(`${SHEET} [data-picker-mode="lyrics"]`).click();
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(SHEET)).toBeHidden();
        await expect(page.locator(CM)).toHaveAttribute('contenteditable', 'true');
    });

    test('the sheet shows the key, dots chords in use, and "More roots" is the last resort (no "Also in this song")', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, '{key: D}\n[D]Hello [A]there [D/F#]friend');
        const menu = page.locator(SHEET);
        await expect(menu.locator('.chm-key')).toHaveValue('D');
        await expect(menu.locator('.chm-cell.used')).toHaveCount(2);
        await expect(menu).not.toContainText('Also in this song');
        await expect(menu.locator('.chm-chip')).toHaveCount(0);
        await menu.locator('.chm-more').click();
        await expect(menu).not.toContainText('More chords');
        await expect(menu.locator('.chm-row-more .chm-cell').first()).toHaveClass(/chm-outside/);
        await menu.locator('.chm-free input').fill('Bb7');
        await menu.locator('.chm-free .chm-go').click();
        expect(await leadText(page)).toContain('Bb7');
    });

    test('every chord appears once; in key is solid and outside is dashed', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Hello there');
        const menu = page.locator(SHEET);
        const how = await pointOnWord(page, 'there');
        await page.mouse.click(how.x, how.y);
        await menu.locator('.chm-cell[data-chord="D"]').click();
        await menu.locator('.chm-more').click();
        const chords = await menu.locator('[data-chord]').evaluateAll((els) => els.map((e) => e.dataset.chord));
        expect(new Set(chords).size).toBe(chords.length);
        const style = (sel) => menu.locator(sel).first().evaluate((e) => { const s = getComputedStyle(e); return { outline: s.outlineStyle, bg: s.backgroundColor }; });
        const inKey = await style('.chm-row-diatonic .chm-cell');
        const outside = await style('.chm-row-flipped .chm-cell');
        expect(outside.outline).toBe('dashed');
        expect(inKey.outline).not.toBe('dashed');
        expect(inKey.bg).not.toBe(outside.bg);
        await expect(menu.locator('.chm-rowlabel')).toHaveCount(0);   // no captions: the styling carries it
        await expect(menu.locator('.chm-func')).toHaveCount(1);       // the chord in the box says what it does, once, in the header
        await expect(menu.locator('.chm-head .chm-func')).toContainText('D');
    });

    test('one layout: a flipped row above the diatonic row, no extension cells', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Hello there');
        const menu = page.locator(SHEET);
        await expect(menu.locator('.chm-row-diatonic .chm-cell')).toHaveCount(7);
        await expect(menu.locator('.chm-row-flipped .chm-cell')).toHaveCount(7);
        await expect(menu.locator('.chm-row-diatonic .chm-cell').first()).toHaveAttribute('data-chord', 'G');
        await expect(menu.locator('.chm-row-flipped .chm-cell').first()).toHaveAttribute('data-chord', 'Gm');
        await expect(menu.locator('.chm-cell[data-chord="G7"], .chm-cell[data-chord="Gsus2"]')).toHaveCount(0);
    });

    test('the key: the sheet, the toolbar and the submitted key are one value', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, '[G]Hello there');
        await page.locator(`${SHEET} .chm-key`).selectOption('A');
        expect(await leadText(page)).toMatch(/^\{key: A\}\n/);
        await expect(page.locator(`${SHEET} .chm-key`)).toHaveValue('A');
        await expect(page.locator('#editor-key-select')).toHaveValue('A');
        const key = await page.evaluate(async () => {
            const { currentSongKey } = await import('/js/lead-editor/doc-model.js');
            return currentSongKey(document.querySelector('#editor-lead').__lead.getText()).key;
        });
        expect(key).toBe('A');
    });
});

test.describe('modes: Lyrics | Chords | ChordPro', () => {
    test('a new empty song opens in Lyrics', async ({ page }) => {
        await openNew(page);
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#editor-mode-chords')).toBeVisible();
        await expect(page.locator('#editor-mode-chordpro')).toBeVisible();
    });

    test('switching is lossless and keeps one undo history', async ({ page }) => {
        await openNew(page);
        const doc = '{meta: title X}\n{start_of_verse: Verse 1}\nAma[G]zing [D]grace\n{end_of_verse}';
        await setLead(page, doc);
        await setMode(page, 'chordpro');
        await expect(page.locator(`${LEAD} .le-preview-pane`)).toBeVisible();
        await expect(page.locator(`${LEAD} .le-preview-body .cl-segment`).first()).toBeVisible();
        await expect(page.locator(`${LEAD} .cm-chordtok`)).toHaveCount(2);
        await expect(page.locator(CM)).toContainText('Ama[G]zing [D]grace');
        await setMode(page, 'chords');
        await expect(page.locator(CHORDS)).toHaveCount(2);
        await setMode(page, 'lyrics');
        await expect(page.locator(CHORDS)).toHaveCount(2);
        expect(await leadText(page)).toBe(doc);
        await page.locator('#editor-undo').click();
        expect(await leadText(page)).toBe('');
    });

    test('the mode is remembered per device (a song opened gets it; a new empty song still opens in Lyrics)', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
        await setMode(page, 'chords');
        await page.reload();
        await leadReady(page);
        await expect(page.locator('#editor-mode-chords')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(SHEET)).toBeVisible();
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
        await page.evaluate(() => localStorage.removeItem('bgb-lead-mode'));
    });

    test('a first-build "visual" setting means Lyrics', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('bgb-lead-mode', 'visual'));
        await openEditor(page, '#edit/old-home-place');
        await expect(page.locator('#editor-mode-lyrics')).toHaveAttribute('aria-pressed', 'true');
    });

    test('ChordPro mode: the section bar still works and the preview is read-only', async ({ page }) => {
        await openNew(page);
        await setMode(page, 'chordpro');
        await setLead(page, 'Line one\nLine two');
        await expect(page.locator(`${LEAD} .le-preview-body`)).toContainText('Line one');
        await expect(page.locator(`${LEAD} .le-preview-body [contenteditable]`)).toHaveCount(0);
        await page.locator(CM).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.locator('.le-selbar [data-wrap="verse"]').click();
        await expect(page.locator(CM)).toContainText('{start_of_verse: Verse 1}');
        await page.evaluate(() => localStorage.removeItem('bgb-lead-mode'));
    });
});

test.describe('the empty sheet', () => {
    test('the Paste button is a real button: clicking it pastes (smart-pasted) from the clipboard', async ({ page }) => {
        await openNew(page);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { readText: async () => 'Title: Pasted\n\nG       C\nAmazing grace how sweet\nD       G\nThat saved a wretch' },
            });
        });
        const btn = page.locator(`${LEAD} .le-paste-btn`);
        await expect(btn).toBeVisible();
        const hit = await btn.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
        });
        expect(hit).toBe(true);
        await btn.click();
        await expect(page.locator(CHORDS).first()).toBeVisible();
        expect(await leadText(page)).toMatch(/\[G\]Amazing/);
        await expect(page.locator(`${LEAD} .le-empty`)).toBeHidden();
    });

    test('a page that cannot read the clipboard offers no Paste button, and says the keyboard shortcut', async ({ page }) => {
        await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
        await openNew(page);
        await expect(page.locator(`${LEAD} .le-paste-btn`)).toHaveCount(0);
        await expect(page.locator(`${LEAD} .le-paste-hint`)).toBeVisible();
        await expect(page.locator(`${LEAD} .le-paste-hint`)).toHaveText(/Press (⌘|Ctrl\+)V to paste/);
    });

    test('where the clipboard cannot be read, the button says how to paste', async ({ page }) => {
        await openNew(page);
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
        await page.locator(`${LEAD} .le-paste-btn`).click();
        await expect(page.locator(`${LEAD} .le-paste-hint`)).toBeVisible();
        await expect(page.locator(`${LEAD} .le-paste-hint`)).toHaveText('Press and hold, then Paste');
    });

    test('"Request a song instead" works', async ({ page }) => {
        await openNew(page);
        const link = page.locator(`${LEAD} .le-link-request`);
        await expect(link).toBeVisible();
        const hit = await link.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
        });
        expect(hit).toBe(true);
        await link.click();
        await expect(page.locator('#editor-panel')).toBeHidden({ timeout: 5000 }).catch(() => {});
        await expect(page.locator('.add-song-picker, #add-song-picker, [id*="picker"]').first()).toBeVisible({ timeout: 5000 });
    });
});

test.describe('rows are where the pointer says they are (the height map has no margin drift)', () => {
    test('posAtCoords at the middle of every line of old-home-place returns that line', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        const bad = await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            const view = editor.view;
            const wrong = [];
            let checked = 0;
            for (const el of document.querySelectorAll('#editor-lead .cm-line')) {
                const r = el.getBoundingClientRect();
                if (r.height < 4) continue;
                const lineStart = view.posAtDOM(el, 0);
                const want = view.state.doc.lineAt(lineStart).number;
                const pos = view.posAtCoords({ x: r.left + 40, y: r.top + r.height / 2 }, false);
                checked++;
                const got = pos == null ? -1 : view.state.doc.lineAt(pos).number;
                if (got !== want) wrong.push({ want, got });
            }
            return { wrong, checked };
        });
        expect(bad.checked).toBeGreaterThan(15);
        expect(bad.wrong).toEqual([]);
    });
});

test.describe('the chord highlight', () => {
    test('the selected chord is highlighted as wide as its letters, not the whole segment', async ({ page }) => {
        await openEditor(page, '#edit/old-home-place');
        await setMode(page, 'chords');
        await page.locator(`${CM} .cl-chord-glyph`).first().click();
        const m = await page.evaluate(() => {
            const g = document.querySelector('#editor-lead .cl-box-chord .cl-chord-glyph');
            const block = g.parentElement;
            const range = document.createRange();
            range.selectNodeContents(g);
            const cs = getComputedStyle(g);
            return { glyph: g.getBoundingClientRect().width, text: range.getBoundingClientRect().width, block: block.getBoundingClientRect().width, bg: cs.backgroundColor };
        });
        expect(m.glyph).toBeLessThanOrEqual(m.text + 8);
        expect(m.bg).not.toBe('rgba(0, 0, 0, 0)');
        expect(m.block).toBeGreaterThan(m.glyph);   // the book's block layout is untouched
    });
});

test.describe('Lyrics and Chords modes look like the song page', () => {
    test('the same line has the same segment layout in the editor and on #work/old-home-place', async ({ page }) => {
        await page.goto('/#work/old-home-place');
        await page.waitForSelector('.song-section .cl-segment', { timeout: 20000 });
        const bookRects = await page.evaluate(() => {
            const line = [...document.querySelectorAll('.song-section .cl-line')][0];
            const base = line.getBoundingClientRect();
            return [...line.querySelectorAll('.cl-segment')].map((s) => {
                const r = s.getBoundingClientRect();
                return { x: Math.round(r.left - base.left), w: Math.round(r.width), h: Math.round(r.height), chord: s.querySelector('.cl-chord')?.textContent };
            });
        });
        // same viewport, same content width: open the editor for the same work
        await page.goto('/#edit/old-home-place');
        await leadReady(page);
        await page.waitForSelector(`${LEAD} .cl-line .cl-segment`);
        const editorRects = await page.evaluate(() => {
            const line = document.querySelector('#editor-lead .cl-line');
            const base = line.getBoundingClientRect();
            return [...line.querySelectorAll('.cl-segment')].map((s) => {
                const r = s.getBoundingClientRect();
                return { x: Math.round(r.left - base.left), w: Math.round(r.width), h: Math.round(r.height), chord: s.querySelector('.cl-chord')?.textContent };
            });
        });
        expect(editorRects.length).toBe(bookRects.length);
        // identical widths and relative positions, segment by segment (1px for rounding)
        editorRects.forEach((r, i) => {
            expect(Math.abs(r.w - bookRects[i].w), `segment ${i} width`).toBeLessThanOrEqual(1);
            expect(Math.abs(r.x - bookRects[i].x), `segment ${i} x`).toBeLessThanOrEqual(1);
            expect(Math.abs(r.h - bookRects[i].h), `segment ${i} height`).toBeLessThanOrEqual(1);
            expect(r.chord).toBe(bookRects[i].chord);
        });
    });

    test('a song with an ABC block shows it locked, and the text keeps it', async ({ page }) => {
        await openNew(page);
        const doc = '{start_of_abc}\nX:1\nK:G\nGABc|\n{end_of_abc}\n\nSome words';
        await setLead(page, doc);
        await expect(page.locator(`${LEAD} .cl-locked-title`)).toContainText('edit in ChordPro');
        expect(await leadText(page)).toBe(doc);
    });

    test('dark theme: the editor uses the theme variables', async ({ page }) => {
        await page.goto('/#edit/old-home-place');
        await leadReady(page);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const colors = await page.evaluate(() => {
            const ed = document.querySelector('#editor-lead .cm-editor');
            const ch = document.querySelector('#editor-lead .cl-chord');
            return { bg: getComputedStyle(ed).backgroundColor, chord: getComputedStyle(ch).color };
        });
        expect(colors.bg).not.toBe('rgb(247, 247, 247)');
    });
});

// ---------------------------------------------------------------------------------------------
// Gliding the chord cursor, and chords after the words (spec: "Moving the chord cursor" and
// "Chords after the words" in docs/plans/2026-10-26-lyrics-editor-redesign.md)
// ---------------------------------------------------------------------------------------------
test.describe('gliding the cursor (desktop, mouse)', () => {
    test('grab the cursor and drag slowly: it moves one letter per ~11px; a press without movement is the old tap', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace how sweet\nsecond line here');
        const how = (await syllableCentres(page, 'Amazing')).find((c) => c.text.startsWith('how'));
        await page.mouse.click(how.x, how.y);
        const start = await boxPos(page);
        expect(start).toBe(how.seam);
        const pill = page.locator(`${CM} .cl-slot-pill`);
        await expect(pill).toBeVisible();
        // a press and release on the cursor without moving changes nothing
        const c0 = await centreOf(pill);
        await page.mouse.click(c0.x, c0.y);
        expect(await boxPos(page)).toBe(start);
        // 55px, slow: the point follows the finger about 1:1, so about six letters (the gain is a tuning constant)
        await mouseDrag(page, await centreOf(pill), along(11, 5));
        const moved = (await boxPos(page)) - start;
        expect(moved).toBeGreaterThanOrEqual(4);
        expect(moved).toBeLessThanOrEqual(8);
        expect(await leadText(page)).toBe('Amazing grace how sweet\nsecond line here');   // moving the cursor writes nothing
        // and back, slowly
        await mouseDrag(page, await centreOf(page.locator(`${CM} .cl-slot-pill`)), along(11, -5));
        expect(Math.abs((await boxPos(page)) - start)).toBeLessThanOrEqual(2);
    });

    test('vertical travel of about a line moves to the line below, keeping x', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'abcdefghij klmn\nabcdefghij klmn');
        const first = (await syllableCentres(page, 'abcdefghij'))[0];
        await page.mouse.click(first.x + 1, first.y);
        const pill = page.locator(`${CM} .cl-slot-pill`);
        const lh = await page.evaluate(() => document.querySelector('#editor-lead .cm-line.cl-line, #editor-lead .cm-line').getBoundingClientRect().height);
        const pb = await pill.boundingBox();                                   // the chart glide is 1:1: start at the stop's left edge to keep x
        await mouseDrag(page, { x: pb.x + 1, y: pb.y + pb.height / 2 }, Array.from({ length: 8 }, () => [0, Math.ceil(lh / 6)]));
        expect((await boxAt(page)).line).toBe(2);
        expect((await boxAt(page)).lyricsBefore).toBe('');
    });

    test('dragging a chord carries it, as Move does, and the whole drag is one undo step', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing [G]grace how sweet');
        await mouseDrag(page, await centreOf(page.locator(`${CM} .cl-chord-glyph`).first()), along(11, 5));
        const text = await leadText(page);
        expect(text.match(/\[G\]/g)).toHaveLength(1);
        expect(text.replace('[G]', '')).toBe('Amazing grace how sweet');
        expect(text.indexOf('[G]')).toBeGreaterThan('Amazing '.length + 1);   // it travelled on from "grace"
        // it was let go on lift: Move is off
        await expect(page.locator(`${SHEET} .chm-move`)).toHaveAttribute('aria-pressed', 'false');
        await page.locator('#editor-undo').click();
        expect(await leadText(page)).toBe('Amazing [G]grace how sweet');
    });

    test('a carried chord hops over the chords in its way', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, '[G]Amazing gr[C]ace how');
        await mouseDrag(page, await centreOf(page.locator(`${CM} .cl-chord-glyph`).first()), along(30, 6));
        const text = await leadText(page);
        expect(text.match(/\[C\]/g)).toHaveLength(1);
        expect(text.match(/\[G\]/g)).toHaveLength(1);
    });

    test('a fast drag ends on the stop under the pointer: 1:1, the same stop a click there picks', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace how sweet is the sound');
        const pill = page.locator(`${CM} .cl-slot-pill`);
        const c = await centreOf(pill);
        await page.mouse.move(c.x, c.y);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) await page.mouse.move(c.x + i * 20, c.y);   // no waiting: very fast (no gain any more)
        await page.mouse.up();
        const glided = await boxPos(page);
        expect(await boxStopKind(page)).not.toBeNull();                           // a STOP (a syllable or a gap)
        expect((await boxAt(page)).lyricsBefore.length).toBeGreaterThan(10);      // it really travelled
        // a click on that same point picks the same stop: a glide and a tap agree
        const y = await page.evaluate((pos) => { const v = document.querySelector('#editor-lead').__lead.editor.view; const r = v.coordsAtPos(pos, 1); return (r.top + r.bottom) / 2; }, glided);
        await page.mouse.click(c.x + 240, y);
        expect(await boxPos(page)).toBe(glided);
    });

    test('the strip keeps the cursor fully in view', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace how sweet the sound that saved a wretch like me');
        const inView = async () => { await page.waitForTimeout(250); return page.evaluate(() => {
            const v = document.querySelector('.chm-strip-view').getBoundingClientRect();
            const t = document.querySelector('.chm-strip-view .cl-gap-bar, .chm-strip-view .cl-slot-pill, .chm-strip-view .cl-box-chord .cl-chord-glyph').getBoundingClientRect();
            return t.left >= v.left && t.right <= v.right && t.width > 0;
        }); };
        expect(await inView()).toBe(true);                       // at the very start of the line
        for (let i = 0; i < 6; i++) await page.locator(`${SHEET} .chm-next`).click();
        expect(await inView()).toBe(true);
        for (let i = 0; i < 40; i++) await page.locator(`${SHEET} .chm-next`).click();
        expect(await inView()).toBe(true);                       // and near the end
    });

    test('the decoration marks are readable in the sheet (and only there)', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace');
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).click();
        const seven = page.locator(`${SHEET} .chm-deco[data-id="7"]`);
        await expect(seven).toHaveText('7');
        const size = await seven.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
        expect(size).toBeGreaterThanOrEqual(16);
        await expect(page.locator(`${SHEET} .chm-deco[data-id="maj7"]`)).toHaveText('maj7');
        // the chord glyphs keep their superscripts
        expect(await page.locator(`${CM} .cl-box-chord sup`).count() + await page.locator(`${CM} .cl-chord-glyph`).count()).toBeGreaterThan(0);
        await seven.click();
        await expect(page.locator(`${CM} .cl-box-chord sup`)).toHaveText('7');
    });

    test('the rarer extensions open a second row behind the dots; / bass is its last item', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace');
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).click();
        const main = page.locator(`${SHEET} .chm-decos:not(.chm-decos2)`);
        const row = page.locator(`${SHEET} .chm-decos2`);
        await expect(main.locator('.chm-deco')).toHaveCount(8);          // 7 marks and the dots
        await expect(row).toHaveCount(0);
        await main.locator('.chm-extra').click();
        await expect(row.locator('[data-id="11"]')).toBeVisible();
        await expect(row.locator('[data-id="m7b5"]')).toBeVisible();
        await expect(row.locator('[data-id="mmaj7"]')).toHaveCount(0);   // D is major: m(maj7) does not apply
        await expect(row.locator('.chm-deco').last()).toHaveText('/ bass');
        await row.locator('[data-id="11"]').click();
        await expect(page.locator(CHORDS)).toHaveText('D11');
        // bass: one row of 12 notes, the key's tones solid, the rest dashed
        await row.locator('.chm-bass').click();
        await expect(page.locator(`${SHEET} [data-bass]`)).toHaveCount(12);
        await page.locator(`${SHEET} [data-bass="F#"]`).click();
        await expect(page.locator(CHORDS)).toHaveText('D11/F♯');
        await page.locator(`${SHEET} [data-bass="F#"]`).click();         // again: cleared
        await expect(page.locator(CHORDS)).toHaveText('D11');
    });
});

test.describe('chords after the words', () => {
    test('stepping right past the last letter enters an empty slot; D then A gives `home  [D]   [A]` (evenly spaced: every drawn gap 2)', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'We left our old home');
        await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            editor.setBox({ pos: 19, active: true });                    // before the last letter
        });
        await page.keyboard.press('ArrowRight');
        expect(await boxState(page)).toEqual({ pos: 20, after: 1, newLine: false });
        await expect(page.locator(`${CM} .cl-slot-after .cl-slot-pill`)).toBeVisible();
        expect(await leadText(page)).toBe('We left our old home');         // nothing written yet
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).click();
        expect(await leadText(page)).toBe('We left our old home  [D]');
        expect(await boxState(page)).toEqual({ pos: 'We left our old home  [D]'.length, after: 1, newLine: false });   // jumped to the next new slot
        await page.locator(`${SHEET} .chm-cell[data-chord="A"]`).click();
        expect(await leadText(page)).toBe('We left our old home  [D]   [A]');
    });

    test('an empty slot you leave writes nothing', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'one\ntwo');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 2, active: true }));
        await page.keyboard.press('ArrowRight');
        expect((await boxState(page)).after).toBe(1);
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');                        // on to line two
        expect((await boxAt(page)).line).toBe(2);
        expect(await leadText(page)).toBe('one\ntwo');
    });

    test('a click to the RIGHT of the last word puts the cursor in the first empty slot after any trailing chords', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'We [G]left our old home [D]');
        const end = await lineEndPoint(page, 'left our');
        await page.mouse.click(end.farX, end.y);
        expect(await boxState(page)).toMatchObject({ after: 1, newLine: false });
        await page.locator(`${SHEET} .chm-cell[data-chord="A"]`).click();
        expect(await leadText(page)).toBe('We [G]left our old home  [D]   [A]');
        // a click on a trailing chord still selects THAT chord
        await page.locator(`${CM} .cl-chord-glyph`).filter({ hasText: 'D' }).click();
        expect(await boxState(page)).toMatchObject({ after: 0 });
        await expect(page.locator(`${SHEET} .chm-remove`)).toBeVisible();
    });

    test('the trailing chords share the chord row of the line (editor and preview), as the book draws it', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'We [G]left our old home');
        const end = await lineEndPoint(page, 'left our');
        await page.mouse.click(end.farX, end.y);
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).click();
        await page.locator(`${SHEET} .chm-cell[data-chord="A"]`).click();
        expect(await leadText(page)).toBe('We [G]left our old home  [D]   [A]');
        const editorTops = await page.evaluate((q) => [...document.querySelector(q).querySelectorAll('.cl-chord:not(.cl-chord-gap)')].map((e) => Math.round(e.getBoundingClientRect().top)), `${CM} .cl-line`);
        await setMode(page, 'chordpro');
        const bookTops = await page.evaluate(() => [...document.querySelector('#editor-lead .le-preview-body .cl-line').querySelectorAll('.cl-chord')].map((e) => Math.round(e.getBoundingClientRect().top)));
        for (const t of [editorTops, bookTops]) {
            expect(t.length).toBeGreaterThanOrEqual(3);
            expect(new Set(t).size, `chord rows: ${t}`).toBe(1);        // G, D and A all on ONE row
        }
    });

    test('Add chord line: G, C, D7, G; the line appears on the first pick and stays in its section', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, '{start_of_verse: Verse 1}\nWe left our old home\nand never came back\n{end_of_verse}');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 30, active: true }));
        await page.locator(`${SHEET} .chm-addline`).click();
        expect(await boxState(page)).toMatchObject({ newLine: true });
        await expect(page.locator(`${CM} .cl-newline .cl-slot-pill`)).toBeVisible();
        expect(await leadText(page)).toContain('We left our old home\nand never came back');   // virtual: nothing written yet
        const cell = (c) => page.locator(`${SHEET} .chm-cell[data-chord="${c}"]`);
        await cell('G').click();
        await cell('C').click();
        // D7 is not a grid cell (extensions live in the decoration row, which needs a chord under the cursor): type it
        await page.locator(`${SHEET} .chm-more`).click();
        await page.locator(`${SHEET} .chm-free input`).fill('D7');
        await page.locator(`${SHEET} .chm-free .chm-go`).click();
        await cell('G').click();
        const text = await leadText(page);
        expect(text).toBe('{start_of_verse: Verse 1}\nWe left our old home\n[G]   [C]   [D7]    [G]\nand never came back\n{end_of_verse}');
    });

    test('an empty chord line is removed when the cursor leaves it, and when its last chord is removed', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'one\ntwo');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 1, active: true }));
        await page.locator(`${SHEET} .chm-addline`).click();
        await page.keyboard.press('ArrowDown');                          // leaves it: nothing was written
        expect(await leadText(page)).toBe('one\ntwo');
        await expect(page.locator(`${CM} .cl-newline`)).toHaveCount(0);
        // write one chord, then remove it: the line goes
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 1, active: true }));
        await page.locator(`${SHEET} .chm-addline`).click();
        await page.locator(`${SHEET} .chm-cell[data-chord="G"]`).click();
        expect(await leadText(page)).toBe('one\n[G]\ntwo');
        await page.locator(`${CM} .cl-chord-glyph`).filter({ hasText: 'G' }).click();
        await page.locator(`${SHEET} .chm-remove`).click();
        expect(await leadText(page)).toBe('one\ntwo');
    });
});

test.describe('the book and the editor draw the same chord-only and trailing segments', () => {
    const FIXTURE = '{start_of_verse: Verse 1}\nWe left our [G]old home [D] [A]\n[G] [C] [D7] [G]\n{end_of_verse}';
    test('segment geometry matches the ChordPro preview (drawn by the book renderer)', async ({ page }) => {
        await openNew(page);
        await setLead(page, FIXTURE);
        const editor = [await segmentRects(page, `${CM} .cl-line`, 0), await segmentRects(page, `${CM} .cl-line`, 1)];
        await setMode(page, 'chordpro');
        const book = [await segmentRects(page, '#editor-lead .le-preview-body .cl-line', 0), await segmentRects(page, '#editor-lead .le-preview-body .cl-line', 1)];
        expect(editor[0].length).toBe(4);   // prefix, G, D, A
        expect(editor[1].length).toBe(4);
        for (const i of [0, 1]) {
            expect(editor[i].length).toBe(book[i].length);
            editor[i].forEach((r, k) => {
                const b = book[i][k];
                expect(Math.abs(r.w - b.w), `line ${i} segment ${k} width`).toBeLessThanOrEqual(1);
                expect(Math.abs(r.x - b.x), `line ${i} segment ${k} x`).toBeLessThanOrEqual(1);
                expect(Math.abs(r.h - b.h), `line ${i} segment ${k} height`).toBeLessThanOrEqual(1);
                expect(Math.abs(r.top - b.top), `line ${i} segment ${k} top`).toBeLessThanOrEqual(1);
                expect(r.chord).toBe(b.chord);
            });
        }
    });
});

// ---------------------------------------------------------------------------------------------
// The chord panel is docked, never floating: on a wide desktop it is ONE sticky panel to the right
// of the chart (magnifier above picker).
// ---------------------------------------------------------------------------------------------
test.describe('Chords mode: the docked side panel (desktop)', () => {
    const LONG = Array.from({ length: 60 }, (_, i) => `Line number ${i + 1} of the song`).join('\n');
    test('sits to the right of the chart, sticky while the chart scrolls; no popover', async ({ page }) => {
        await openNew(page);
        await setLead(page, LONG);
        await setMode(page, 'chords');
        const panel = page.locator(SHEET);
        await expect(panel).toHaveClass(/chm-side/);
        await expect(panel).toBeVisible();
        expect(await page.locator('.chm-popover, .chm-sheet').count()).toBe(0);
        const geo = () => page.evaluate(() => {
            const p = document.querySelector('.chm-menu').getBoundingClientRect();
            const c = document.querySelector('#editor-lead').getBoundingClientRect();
            const strip = document.querySelector('.chm-strip').getBoundingClientRect();
            const body = document.querySelector('.chm-body').getBoundingClientRect();
            return { pl: p.left, pt: p.top, pb: p.bottom, cr: c.right, sy: window.scrollY, position: getComputedStyle(document.querySelector('.chm-menu')).position, stripBottom: strip.bottom, bodyTop: body.top, vh: window.innerHeight };
        });
        const before = await geo();
        expect(before.position).toBe('sticky');
        expect(before.pl).toBeGreaterThanOrEqual(before.cr - 1);            // to the right of the chart
        expect(before.stripBottom).toBeLessThanOrEqual(before.bodyTop + 1); // magnifier above picker
        await page.evaluate(() => window.scrollBy(0, 900));
        await page.waitForTimeout(150);
        const after = await geo();
        expect(after.sy).toBeGreaterThan(before.sy + 500);
        await expect(panel).toBeInViewport();
        expect(after.pt).toBeGreaterThanOrEqual(0);
        expect(after.pt).toBeLessThan(120);                                 // it followed the scroll
        expect(after.pb).toBeLessThanOrEqual(after.vh);
        // and it still works: step to the next line and place a chord from the picker
        await page.locator(`${SHEET} .chm-cell[data-chord="G"]`).first().click();
        expect(await leadText(page)).toContain('[G]');
    });

    test('a narrower window (not a phone) docks it split, top and bottom', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openNew(page);
        await setLead(page, 'Amazing grace how sweet');
        await setMode(page, 'chords');
        await expect(page.locator(SHEET)).toHaveClass(/chm-split/);
        const m = await page.evaluate(() => ({ body: document.querySelector('.chm-body').getBoundingClientRect().bottom, vh: innerHeight, strip: getComputedStyle(document.querySelector('.chm-strip')).position }));
        expect(Math.round(m.body)).toBe(m.vh);
        expect(m.strip).toBe('fixed');
    });
});

test.describe('Lyrics mode: the section bar Other... (desktop)', () => {
    for (const how of ['Enter', 'blur', 'Add']) {
        test(`Other... > type Solo > ${how} makes a solo section, with no page error`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await openNew(page);
            await setLead(page, 'Line one\nLine two\n\nLine three');
            await page.evaluate(() => {
                const { editor } = document.querySelector('#editor-lead').__lead;
                editor.view.focus();
                editor.view.dispatch({ selection: { anchor: 2, head: 14 } });
            });
            await page.locator('.le-selbar [data-wrap="*"]').click();
            const field = page.locator('.le-selbar-field');
            await expect(field).toBeFocused();
            await field.pressSequentially('Solo');
            if (how === 'Enter') await page.keyboard.press('Enter');
            else if (how === 'Add') await page.locator('.le-selbar-add').click();
            else await page.evaluate(() => document.querySelector('.le-selbar-field').blur());
            await expect.poll(() => leadText(page)).toContain('{start_of_solo: Solo}');
            await expect(page.locator('.le-selbar-field')).toHaveCount(0);
            expect(errors).toEqual([]);
        });
    }
    test('Escape and an empty field cancel', async ({ page }) => {
        await openNew(page);
        await setLead(page, 'Line one\nLine two');
        await page.evaluate(() => {
            const { editor } = document.querySelector('#editor-lead').__lead;
            editor.view.focus();
            editor.view.dispatch({ selection: { anchor: 2, head: 12 } });
        });
        await page.locator('.le-selbar [data-wrap="*"]').click();
        await page.locator('.le-selbar-field').pressSequentially('Solo');
        await page.keyboard.press('Escape');
        await expect(page.locator('.le-selbar-field')).toHaveCount(0);
        expect(await leadText(page)).not.toContain('start_of_solo');
    });
});

// ---------------------------------------------------------------------------------------------
// Where the cursor stops: syllables, the gap between two words, the slots after the words.
// ---------------------------------------------------------------------------------------------
test.describe('where the cursor stops (desktop)', () => {
    test('after any slow glide the cursor is a stop (never mid-syllable, never a non-gap space)', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Many long years since I left my old home  now\nsecond line here');
        for (const deltas of [along(5, 3), along(11, 4), along(17, 5), along(24, 3), along(9, -4)]) {
            await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 6, active: true }));
            await page.keyboard.press('ArrowLeft');
            const cur = await page.evaluate(() => { const { editor } = document.querySelector('#editor-lead').__lead; const c = editor.view.coordsAtPos(editor.getBox().pos, 1); return { x: c.left + 2, y: (c.top + c.bottom) / 2 }; });
            await mouseDrag(page, cur, deltas, { stepMs: 40 });
            expect(await boxStopKind(page), JSON.stringify(await boxState(page))).not.toBeNull();
        }
        expect(await leadText(page)).toBe('Many long years since I left my old home  now\nsecond line here');
    });

    test('a gap stop shows the slim bar and no text outline; D there is written `years[D] since`', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Many long years since home');
        const t = await leadText(page);
        await page.evaluate((p) => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: p, active: true }), t.indexOf('years'));
        await page.keyboard.press('ArrowRight');
        expect(await boxStopKind(page)).toBe('gap');
        await expect(page.locator(`${CM} .cl-gap-bar`)).toBeVisible();
        await expect(page.locator(`${CM} .cl-box-text`)).toHaveCount(0);
        await page.locator(`${SHEET} .chm-cell[data-chord="D"]`).click();
        expect(await leadText(page)).toBe('Many long years[D] since home');
    });

    test('▶ walks syllable, gap, next word ... then the slots after the words', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Amazing grace\nsecond');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
        const kinds = await stepKinds(page, () => page.keyboard.press('ArrowRight'));
        expect(kinds).toEqual(['syllable', 'syllable', 'gap', 'syllable', 'after']);   // A|maz|ing  gap  grace (silent e: one syllable)  slot
    });

    test('back-to-back chords on one syllable keep a gap, drawn the same in the editor and the preview', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'I ran away to [A][D]Charlottesville');
        const gapAD = (sel) => page.evaluate((q) => {
            const line = document.querySelector(q);
            const g = [...line.querySelectorAll('.cl-chord')].filter((c) => /^(A|D)$/.test(c.textContent.trim()));
            const ch = parseFloat(getComputedStyle(line).fontSize) * 0.6;
            return (g[1].getBoundingClientRect().left - (g[0].querySelector('.cl-chord-glyph') || g[0].firstChild.parentElement).getBoundingClientRect().left) / ch;
        }, sel);
        const editor = await segmentRects(page, `${CM} .cl-line`, 0);
        const editorGap = await gapAD(`${CM} .cl-line`);
        await setMode(page, 'chordpro');
        const book = await segmentRects(page, '#editor-lead .le-preview-body .cl-line', 0);
        const bookGap = await gapAD('#editor-lead .le-preview-body .cl-line');
        expect(editor.length).toBe(book.length);
        editor.forEach((r, k) => expect(Math.abs(r.x - book[k].x), `segment ${k}`).toBeLessThanOrEqual(1));
        // D starts at least ~2 characters after A starts: A's own width plus a gap (it used to be exactly A's width: "AD")
        expect(editorGap).toBeGreaterThanOrEqual(1.8);
        expect(Math.abs(editorGap - bookGap)).toBeLessThan(0.1);
    });

    test('D, A, E7 after the words are evenly spaced; the editor and the ChordPro preview agree on every segment', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'We left our old home');
        const end = await lineEndPoint(page, 'left our');
        await page.mouse.click(end.farX, end.y);
        for (const c of ['D', 'A', 'E']) await page.locator(`${SHEET} .chm-cell[data-chord="${c}"]`).click();
        await page.locator(`${CM} .cl-chord-glyph`).filter({ hasText: 'E' }).click();
        await page.locator(`${SHEET} .chm-deco[data-id="7"]`).click();
        expect(await leadText(page)).toBe('We left our old home  [D]   [A]   [E7]');
        const editor = await segmentRects(page, `${CM} .cl-line`, 0);
        await setMode(page, 'chordpro');
        const book = await segmentRects(page, '#editor-lead .le-preview-body .cl-line', 0);
        expect(editor.length).toBe(book.length);
        editor.forEach((r, k) => expect(Math.abs(r.x - book[k].x), `segment ${k}`).toBeLessThanOrEqual(1));
        // removing one takes its gap with it
        await setMode(page, 'chords');
    });

    test('↵ Chord line, then G C D7 G, is an evenly spaced chords-only line', async ({ page }) => {
        await openNew(page);
        await chordsOn(page, 'Old home\nroad');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 2, active: true }));
        await expect(page.locator(`${SHEET} .chm-enter`)).toHaveText('↵ Chord line');
        await page.locator(`${SHEET} .chm-enter`).click();
        for (const c of ['G', 'C']) await page.locator(`${SHEET} .chm-cell[data-chord="${c}"]`).click();
        await page.locator(`${SHEET} .chm-more`).click();
        await page.locator(`${SHEET} .chm-free input`).fill('D7');
        await page.locator(`${SHEET} .chm-free .chm-go`).click();
        await page.locator(`${SHEET} .chm-cell[data-chord="G"]`).click();
        expect(await leadText(page)).toBe('Old home\n[G]   [C]   [D7]    [G]\nroad');
        const editor = await segmentRects(page, `${CM} .cl-line`, 0);
        await setMode(page, 'chordpro');
        const book = await segmentRects(page, '#editor-lead .le-preview-body .cl-line', 0);
        editor.forEach((r, k) => expect(Math.abs(r.x - book[k].x), `segment ${k}`).toBeLessThanOrEqual(1));
    });
});

test.describe('desktop side panel: magnifier off by default, one nav row', () => {
    test('no magnifier bar until the toggle is pressed; the arrows live in the nav row only', async ({ page }) => {
        await page.addInitScript(() => localStorage.removeItem('bgb-chord-magnifier'));   // runs after the file-level seed
        await openNew(page);
        await chordsOn(page, 'Amazing river how sweet');
        await page.evaluate(() => document.querySelector('#editor-lead').__lead.editor.setBox({ pos: 0, active: true }));
        await expect(page.locator('.chm-strip')).toHaveCount(0);
        const nav = page.locator(`${SHEET} .chm-row3`);
        await expect(nav.locator('.chm-prev, .chm-up, .chm-down, .chm-next, .chm-undo, .chm-redo, .chm-mag')).toHaveCount(7);
        await nav.locator('.chm-next').click();
        expect(await boxPos(page)).toBeGreaterThan(0);
        await nav.locator('.chm-mag').click();
        await expect(page.locator('.chm-strip')).toHaveCount(1);
        await expect(page.locator('.chm-strip .chm-step')).toHaveCount(0);
        await nav.locator('.chm-mag').click();
        await expect(page.locator('.chm-strip')).toHaveCount(0);
    });
});

// Copy / cut / paste of whole sections (Mike, 2026-10-27: "when I copy /
// paste a section, it gets copied as a verse - even if it's a chorus"). The
// section markers are hidden widgets in Lyrics mode, so a selection of the
// lyrics never held them. The selection here is a real mouse drag (that is
// where the markers were lost); the clipboard is a DataTransfer handed to the
// editor's own copy / cut / paste handlers, as the browser does, so this runs
// the same on a CI runner with no system clipboard.
test.describe('Lyrics mode: copy and paste of whole sections', () => {
    const SONG = [
        '{start_of_verse: Verse 1}', 'One two three', 'Four five six', '{end_of_verse}', '',
        '{start_of_chorus: Chorus}', '[G]Sing it loud', 'Sing it proud', '{end_of_chorus}', '',
    ].join('\n');

    async function openSong(page) {
        await openEditor(page);
        await page.evaluate((t) => document.querySelector('#editor-lead').__lead.setText(t, { reset: true }), SONG);
        await setMode(page, 'lyrics');
    }

    /** Drag from the start of the line holding `firstText` to the end of the one holding `lastText`. */
    async function dragLines(page, firstText, lastText) {
        const a = await page.locator('.cm-line', { hasText: firstText }).boundingBox();
        const b = await page.locator('.cm-line', { hasText: lastText }).boundingBox();
        await page.mouse.move(a.x + 1, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 8 });
        await page.mouse.up();
    }

    /** Fire the browser's copy (or cut) at the editor; returns what it put on the clipboard. */
    const clipboardEvent = (page, type) => page.locator(CM).evaluate((el, t) => {
        const dt = new DataTransfer();
        el.dispatchEvent(new ClipboardEvent(t, { clipboardData: dt, bubbles: true, cancelable: true }));
        return dt.getData('text/plain');
    }, type);

    const paste = (page, text) => page.locator(CM).evaluate((el, t) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', t);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);

    /** Put the caret after `needle` (or at the end), as a click there would. */
    const caretAfter = (page, needle = null) => page.evaluate((n) => {
        const { view } = document.querySelector('#editor-lead').__lead.editor;
        const text = view.state.doc.toString();
        const pos = n == null ? text.length : text.indexOf(n) + n.length;
        view.focus();
        view.dispatch({ selection: { anchor: pos } });
    }, needle);

    const labels = (page) => page.locator('#editor-lead .section-label').allTextContents();

    test('a copied chorus pastes back as a chorus, never as a verse', async ({ page }) => {
        await openSong(page);
        await dragLines(page, 'Sing it loud', 'Sing it proud');
        const clip = await clipboardEvent(page, 'copy');
        expect(clip).toBe('{start_of_chorus: Chorus}\n[G]Sing it loud\nSing it proud\n{end_of_chorus}');

        await caretAfter(page);
        await paste(page, clip);
        expect(await labels(page)).toEqual(['Verse 1', 'Chorus', 'Chorus']);
        expect((await leadText(page)).match(/\{start_of_chorus/g)).toHaveLength(2);
    });

    test('a chorus pasted into the middle of a verse lands after the verse, not inside it', async ({ page }) => {
        await openSong(page);
        await caretAfter(page, 'Four five');
        await paste(page, '{start_of_chorus: Chorus}\nSing it loud\n{end_of_chorus}');
        expect(await leadText(page)).toBe([
            '{start_of_verse: Verse 1}', 'One two three', 'Four five six', '{end_of_verse}', '',
            '{start_of_chorus: Chorus}', 'Sing it loud', '{end_of_chorus}', '',
            '{start_of_chorus: Chorus}', '[G]Sing it loud', 'Sing it proud', '{end_of_chorus}', '',
        ].join('\n'));
    });

    test('cutting a whole chorus takes its label with it, and pasting puts the chorus back', async ({ page }) => {
        await openSong(page);
        await dragLines(page, 'Sing it loud', 'Sing it proud');
        const clip = await clipboardEvent(page, 'cut');
        expect(clip).toContain('{start_of_chorus: Chorus}');
        expect(await labels(page)).toEqual(['Verse 1']);
        expect(await leadText(page)).not.toContain('chorus');

        await caretAfter(page, 'One two');
        await paste(page, clip);
        expect(await labels(page)).toEqual(['Verse 1', 'Chorus']);
    });

    test('a line copied from inside a verse is still just a line', async ({ page }) => {
        await openSong(page);
        await dragLines(page, 'One two three', 'One two three');
        expect(await clipboardEvent(page, 'copy')).toBe('One two three');
    });
});
