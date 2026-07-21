// E2E tests for the two-pane song editor: raw ChordPro textarea (left) +
// live interactive preview (right). The textarea is THE document; every
// preview-side edit (chord-row taps, ghost typing, chip delete, in-preview
// lyric edits) writes serialized ChordPro back into it.
//
// Vertical position is the mode: the chord STRIP above each line places
// and edits chords; the lyric text below swaps to an input on click.
import { test, expect } from '@playwright/test';

const SONG = `{start_of_verse: Verse 1}
hello world friend
{end_of_verse}
`;

const SONG_WITH_CHORD = `{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}
`;

async function openNewSongEditor(page) {
    await page.goto('/#search');
    await page.waitForSelector('#search-input');
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
    await page.locator('#nav-add-song').click();
    // Add Song goes straight to the new-song editor (no picker modal)
    await expect(page.locator('#editor-panel')).toBeVisible();
}

// fill() fires an input event; the preview re-renders ~200ms later
async function setSong(page, text) {
    await page.locator('#editor-content').fill(text);
}

// The chord strip above the syllable whose text starts with `text` —
// chord placement happens on the chord ROW, not the lyric text.
function stripFor(page, text) {
    return page
        .locator('.ve-seg', { has: page.locator('.ve-syl', { hasText: text }) })
        .locator('.ve-strip')
        .first();
}

test.describe('Two-pane editor basics', () => {
    test('textarea and interactive preview are both visible; no tab UI', async ({ page }) => {
        await openNewSongEditor(page);
        await expect(page.locator('#editor-content')).toBeVisible();
        await expect(page.locator('#editor-preview-container')).toBeVisible();
        // empty state: guidance lives in the textarea placeholder + preview hint
        await expect(page.locator('.ve-preview-empty')).toBeVisible();
        expect(await page.locator('#editor-content').getAttribute('placeholder'))
            .toMatch(/Paste or type your song/);
        // the Visual|Raw toggle is gone — both panes always coexist
        await expect(page.locator('#editor-tab-raw')).toHaveCount(0);
        await expect(page.locator('#editor-tab-visual')).toHaveCount(0);
    });

    test('panes are labeled Raw / Visual editor with a shared sync note', async ({ page }) => {
        await openNewSongEditor(page);
        await expect(page.locator('.editor-pane-raw .editor-pane-title')).toHaveText('Raw');
        await expect(page.locator('.editor-pane-preview .editor-pane-title')).toHaveText('Visual editor');
        await expect(page.locator('.editor-sync-note')).toHaveText(/Edit from either side/);
        // the label row still hosts the make-verse mini-bar (one row, not two)
        await expect(page.locator('.editor-content-header #editor-selection-toolbar')).toHaveCount(1);
    });

    test('typing ChordPro in the textarea renders the live preview', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, SONG_WITH_CHORD);
        await expect(page.locator('.ve-section-label')).toHaveText('Verse 1');
        await expect(page.locator('.ve-chip')).toHaveText('G');
        const syls = page.locator('.ve-syl');
        await expect(syls.first()).toContainText('hel');
    });

    test('tap the chord row, pick a chord — it lands in the textarea', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, SONG);
        await expect(page.locator('.ve-syl').first()).toBeVisible();

        await page.locator('.ve-strip').first().click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();

        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toMatch(/\[[A-G][#b]?m?7?\]hello world friend/);
        expect(raw).toContain('{start_of_verse: Verse 1}');

        // toolbar undo takes it back out of the textarea
        await page.locator('#editor-undo').click();
        expect(await page.locator('#editor-content').inputValue()).not.toMatch(/\[[A-G]/);
    });

    test('picker picks insert immediately and consecutive picks refine', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, SONG);
        await page.locator('.ve-strip').first().click();
        await page.locator('.ve-palette-more').click();
        await expect(page.locator('.ve-picker')).toBeVisible();

        // first pick inserts and selects the new chip
        await page.locator('.ve-picker-quality', { hasText: /^Gm$/ }).click();
        await expect(page.locator('.ve-chip')).toHaveText('Gm');
        await expect(page.locator('.ve-chip')).toHaveClass(/ve-chip-selected/);

        // picker stays open with its root intact; the next pick refines
        await expect(page.locator('.ve-picker')).toBeVisible();
        await expect(page.locator('.ve-picker-root.selected')).toHaveText('G');
        await page.locator('.ve-picker-quality', { hasText: /^G7$/ }).click();
        await expect(page.locator('.ve-chip')).toHaveText('G7');
        await expect(page.locator('.ve-chip')).toHaveCount(1);

        // tapping another seam on the chord row moves on; the next pick
        // inserts there
        await stripFor(page, 'world').click();
        await page.locator('.ve-picker-quality', { hasText: /^Gm7$/ }).click();
        await expect(page.locator('.ve-chip')).toHaveCount(2);

        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('[G7]hello [Gm7]world friend');
        expect(raw).not.toContain('[Gm]hello');
    });

    test('editing an existing song renders its sections and chords', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await page.waitForTimeout(1000);
        await expect(page.locator('#song-view')).toBeVisible();
        const editBtn = page.locator('#edit-song-btn');
        if (await editBtn.isVisible()) {
            await editBtn.click();
            await expect(page.locator('#editor-panel')).toBeVisible();
            await expect(page.locator('.ve-psec').first()).toBeVisible();
            await expect(page.locator('.ve-chip').first()).toBeVisible();
            // and the raw text is right there beside it
            expect(await page.locator('#editor-content').inputValue()).toContain('[');
        }
    });

    test('progressive toolbar: transpose/key appear once the song has a chord', async ({ page }) => {
        await openNewSongEditor(page);
        await expect(page.locator('#editor-transpose-group')).toBeHidden();
        await setSong(page, SONG);
        await expect(page.locator('.ve-syl').first()).toBeVisible();
        await expect(page.locator('#editor-transpose-group')).toBeHidden();

        await page.locator('.ve-strip').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('#editor-transpose-group')).toBeVisible();
        await expect(page.locator('#editor-key-select')).toBeVisible();
    });

    test('metadata directives ride through preview edits untouched', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, '{meta: title Keep Me}\n{meta: x_source e2e}\n\n' + SONG);
        await stripFor(page, 'world').click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('{meta: title Keep Me}');
        expect(raw).toContain('{meta: x_source e2e}');
    });
});

test.describe('Keyboard interactions', () => {
    async function placeReadyLine(page) {
        await openNewSongEditor(page);
        await setSong(page, SONG);
        await expect(page.locator('.ve-syl').first()).toBeVisible();
    }

    test('ghost entry: select a chord-row seam, type Eb7, chord commits after idle', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-strip').first().click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        // pauses shorter than the idle-commit debounce: stays one ghost
        await page.keyboard.type('Eb7', { delay: 150 });
        await expect(page.locator('.ve-ghost-chip')).toHaveText('Eb7');
        // typing does NOT open the picker or focus the custom input
        await expect(page.locator('.ve-picker')).toBeHidden();
        // after the idle delay the ghost becomes a real chip — in both panes
        await expect(page.locator('.ve-chip').first()).toHaveText('Eb7');
        await expect(page.locator('.ve-ghost-chip')).toHaveCount(0);
        expect(await page.locator('#editor-content').inputValue()).toContain('[Eb7]hello');
    });

    test('Space spams across syllables, then typed chord + Space commits and advances', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-strip').first().click();     // seam at "hel"
        await page.keyboard.press('Space');                   // → "lo"
        await page.keyboard.press('Space');                   // → "world"
        await page.keyboard.type('C');
        await page.keyboard.press('Space');                   // commit C, → "friend"
        await expect(page.locator('.ve-chip')).toHaveText('C');
        await expect(page.locator('.ve-syl-selected')).toHaveText(/friend/);
        expect(await page.locator('#editor-content').inputValue()).toContain('[C]world');
    });

    test('hovering a chip reveals an × that removes the chord from the text', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-strip').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);
        await page.locator('.ve-chip-wrap').hover();
        await expect(page.locator('.ve-chip-x')).toBeVisible();
        await page.locator('.ve-chip-x').click();
        await expect(page.locator('.ve-chip')).toHaveCount(0);
        expect(await page.locator('#editor-content').inputValue()).not.toMatch(/\[[A-G]/);
    });

    test('Cmd/Ctrl+Z undoes a chord placement', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-strip').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);
        await page.keyboard.press('ControlOrMeta+z');
        await expect(page.locator('.ve-chip')).toHaveCount(0);
    });

    test('clicking a chip then pressing Delete removes the chord', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-strip').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);

        await page.locator('.ve-chip').first().click();
        await page.keyboard.press('Delete');
        await expect(page.locator('.ve-chip')).toHaveCount(0);
        await expect(page.locator('.ve-palette')).toBeHidden();
    });

    test('clicking a chip then the ✕ Remove button removes the chord', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-strip').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);

        await page.locator('.ve-chip').first().click();
        await expect(page.locator('.ve-palette-delete')).toBeVisible();
        await page.locator('.ve-palette-delete').click();
        await expect(page.locator('.ve-chip')).toHaveCount(0);
    });

    test('typing in the textarea never triggers ghost entry', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-strip').first().click();     // selection alive
        await page.locator('#editor-content').click();
        await page.keyboard.type('G', { delay: 50 });
        await expect(page.locator('.ve-ghost-chip')).toHaveCount(0);
        expect(await page.locator('#editor-content').inputValue()).toContain('G');
    });
});

test.describe('Smart paste into the textarea', () => {
    const CHORD_SHEET = `G              C        G
Way down upon the Swanee River
D7                 G
Far, far away

G                C       G
All up and down the whole creation
D7                G
Sadly I roam`;

    // The raw paste handler reads textarea.value on a setTimeout(0) after
    // the paste event, so setting the value + dispatching paste matches the
    // real flow (Playwright can't put multi-line text on the clipboard
    // cross-browser reliably).
    async function pasteIntoTextarea(page, text) {
        await page.locator('#editor-content').evaluate((el, t) => {
            el.focus();
            el.value = t;
            el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
            // a real paste also fires input, which drives the preview refresh
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, text);
    }

    test('chords-over-lyrics paste converts to ChordPro and builds the preview', async ({ page }) => {
        await openNewSongEditor(page);
        await pasteIntoTextarea(page, CHORD_SHEET);

        // converted in place
        await expect
            .poll(async () => page.locator('#editor-content').inputValue())
            .toContain('[G]Way down upon');

        // preview shows two implicit verses with chips
        await expect(page.locator('.ve-psec')).toHaveCount(2);
        await expect(page.locator('.ve-section-label').nth(0)).toHaveText('Verse 1');
        await expect(page.locator('.ve-section-label').nth(1)).toHaveText('Verse 2');
        await expect(page.locator('.ve-chip', { hasText: 'D7' }).first()).toBeVisible();
        await expect(page.locator('.ve-syl').first()).toContainText('Way');
    });

    test('pasted full ChordPro keeps metadata and renders sections', async ({ page }) => {
        await openNewSongEditor(page);
        await pasteIntoTextarea(page,
            '{meta: title Pasted Song}\n{key: D}\n\n[D]hello [G]there friend');

        await expect(page.locator('.ve-psec')).toHaveCount(1);
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('{meta: title Pasted Song}');
        expect(raw).toContain('{key: D}');
        // palette follows the pasted key directive
        await page.locator('.ve-strip').first().click();
        await expect(page.locator('.ve-palette-diatonic .ve-chip-btn').first()).toHaveText('D');
    });
});


test.describe('Chord row hover + in-preview lyric editing', () => {
    const CHORDED = `{start_of_verse: Verse 1}
[G]hello world friend
{end_of_verse}
`;

    async function openSong(page, text) {
        await openNewSongEditor(page);
        await setSong(page, text);
        await expect(page.locator('.ve-syl').first()).toBeVisible();
    }

    const lyricInput = (page) => page.locator('.ve-lyric-input');

    // The ghost caret's center must sit on the target syllable's left
    // edge (the seam it will commit to), same visual row, within 2px.
    async function ghostAlignment(page) {
        return page.evaluate(() => {
            const slot = document.querySelector('.ve-slot-ghost');
            if (!slot) return null;
            const line = slot.closest('.ve-line');
            const target = line.querySelector(`.ve-syl[data-start="${slot.dataset.pos}"]`);
            const sr = slot.getBoundingClientRect();
            const tr = target.getBoundingClientRect();
            return {
                pos: slot.dataset.pos,
                dx: (sr.left + sr.width / 2) - tr.left,
                sameRow: Math.abs(sr.bottom - tr.top) < 30
            };
        });
    }

    test('hovering the chord row shows a ghost caret on the nearest seam', async ({ page }) => {
        await openSong(page, SONG);
        const strip = stripFor(page, 'world');
        const box = await strip.boundingBox();

        // near the left edge: the caret sits on this token's own seam,
        // centered on "world"'s left edge
        await page.mouse.move(box.x + 2, box.y + box.height / 2);
        const slot = page.locator('.ve-slot-ghost');
        await expect(slot).toBeVisible();
        let a = await ghostAlignment(page);
        expect(a.pos).toBe('6');                            // "world" start
        expect(Math.abs(a.dx)).toBeLessThanOrEqual(2);
        expect(a.sameRow).toBe(true);

        // near the right edge: snapped to the NEXT seam ("friend"),
        // centered on "friend"'s left edge
        await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
        a = await ghostAlignment(page);
        expect(a.pos).toBe('12');
        expect(Math.abs(a.dx)).toBeLessThanOrEqual(2);
        expect(a.sameRow).toBe(true);

        // leaving the strip hides the slot
        await page.mouse.move(box.x + box.width / 2, box.y + box.height + 40);
        await expect(page.locator('.ve-slot-ghost')).toHaveCount(0);
    });

    test('ghost caret stays aligned across a wrapped line', async ({ page }) => {
        const words = Array.from({ length: 24 }, () => 'wonderful mountain morning');
        await openSong(page, `{start_of_verse: Verse 1}\n${words.join(' ')}\n{end_of_verse}\n`);

        // find the last seg on the first visual row (the wrap boundary)
        const boundary = await page.evaluate(() => {
            const segs = [...document.querySelectorAll(
                '.ve-line .ve-seg:not(.ve-seg-end)')];
            const firstTop = Math.round(segs[0].getBoundingClientRect().top);
            const i = segs.findIndex(
                s => Math.round(s.getBoundingClientRect().top) !== firstTop);
            if (i < 1) return null;
            const r = segs[i - 1].querySelector('.ve-strip').getBoundingClientRect();
            return { x: r.right - 2, y: r.top + r.height / 2 };
        });
        expect(boundary).not.toBeNull();   // the line must actually wrap

        // right half of the boundary seg targets the first syllable of the
        // NEXT visual row: the caret must render there, not at the row end
        await page.mouse.move(boundary.x, boundary.y);
        await expect(page.locator('.ve-slot-ghost')).toBeVisible();
        const a = await ghostAlignment(page);
        expect(Math.abs(a.dx)).toBeLessThanOrEqual(2);
        expect(a.sameRow).toBe(true);
    });

    test('hover and selection are the same caret: translucent ghost becomes solid', async ({ page }) => {
        await openSong(page, SONG);
        const strip = stripFor(page, 'world');
        const box = await strip.boundingBox();

        await page.mouse.move(box.x + 2, box.y + box.height / 2);
        await expect(page.locator('.ve-slot-ghost')).toBeVisible();
        const ghost = await page.evaluate(() => {
            const g = document.querySelector('.ve-slot-ghost');
            const r = g.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height,
                     opacity: parseFloat(getComputedStyle(g).opacity) };
        });
        expect(ghost.opacity).toBeLessThan(1);      // translucent ghost
        expect(ghost.width).toBeLessThanOrEqual(4); // thin caret, not a box

        // click the same spot: same shape, same place, solid
        await page.mouse.click(box.x + 2, box.y + box.height / 2);
        await expect(page.locator('.ve-slot-selected')).toBeVisible();
        await expect(page.locator('.ve-slot-ghost')).toHaveCount(0);
        const sel = await page.evaluate(() => {
            const el = document.querySelector('.ve-slot-selected');
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height,
                     opacity: parseFloat(getComputedStyle(el).opacity) };
        });
        expect(sel.opacity).toBe(1);
        expect(Math.abs(sel.left - ghost.left)).toBeLessThanOrEqual(2);
        expect(Math.abs(sel.top - ghost.top)).toBeLessThanOrEqual(2);
        expect(Math.abs(sel.width - ghost.width)).toBeLessThanOrEqual(1);  // same shape
        expect(Math.abs(sel.height - ghost.height)).toBeLessThanOrEqual(1);

        // the syllable beneath is a subtle secondary cue, not a heavy
        // outline (the slot in the strip is the primary indicator)
        const syl = await page.evaluate(() => {
            const el = document.querySelector('.ve-syl-selected');
            const cs = getComputedStyle(el);
            return { outline: cs.outlineStyle, shadow: cs.boxShadow };
        });
        expect(syl.outline).toBe('none');
        expect(syl.shadow).toContain('inset');
    });

    test('hover and selection carets on adjacent short words stay distinct', async ({ page }) => {
        // The screenshot scenario: seam selected at "big", seam hovered at
        // "a" right beside it. The old fixed-width slot boxes were wider
        // than "a " and overlapped into visual mush; carets mark points,
        // so each must sit on its own seam with clear air between them.
        await openSong(page, '{start_of_verse: Verse 1}\ncome ride on a big blue train\n{end_of_verse}\n');

        const bigStrip = stripFor(page, 'big');
        let box = await bigStrip.boundingBox();
        await page.mouse.click(box.x + 2, box.y + box.height / 2);   // select seam at "big"
        await expect(page.locator('.ve-slot-selected')).toBeVisible();

        const aStrip = stripFor(page, /^a\s*$/);
        box = await aStrip.boundingBox();
        await page.mouse.move(box.x + 2, box.y + box.height / 2);    // hover seam at "a"
        await expect(page.locator('.ve-slot-ghost')).toBeVisible();

        const g = await page.evaluate(() => {
            const m = (sel) => {
                const el = document.querySelector(sel);
                const r = el.getBoundingClientRect();
                const target = el.closest('.ve-line')
                    .querySelector(`.ve-syl[data-start="${el.dataset.pos}"]`);
                return { center: r.left + r.width / 2, left: r.left, right: r.right,
                         seam: target.getBoundingClientRect().left };
            };
            return { ghost: m('.ve-slot-ghost'), sel: m('.ve-slot-selected') };
        });
        // each caret centered on its own seam...
        expect(Math.abs(g.ghost.center - g.ghost.seam)).toBeLessThanOrEqual(2);
        expect(Math.abs(g.sel.center - g.sel.seam)).toBeLessThanOrEqual(2);
        // ...with clear air between them (the old boxes overlapped here)
        expect(g.sel.left - g.ghost.right).toBeGreaterThanOrEqual(4);
    });

    test('no hover caret inside the dead zone around the selected seam', async ({ page }) => {
        // "imagine" tokenizes as i·ma·gi·ne, so the "i" and "ma" seams sit
        // only a one-letter glyph apart. With "ma" selected, hovering the
        // "i" seam would put a second caret nearly on top of the selected
        // one — the ~0.5em dead zone suppresses it.
        await openSong(page, '{start_of_verse: Verse 1}\nwe imagine home\n{end_of_verse}\n');

        const maStrip = stripFor(page, 'ma');
        let box = await maStrip.boundingBox();
        await page.mouse.click(box.x + 2, box.y + box.height / 2);   // select seam at "ma"
        await expect(page.locator('.ve-slot-selected')).toBeVisible();

        const iStrip = stripFor(page, /^i$/);
        box = await iStrip.boundingBox();
        await page.mouse.move(box.x + 1, box.y + box.height / 2);    // hover seam at "i"
        await page.waitForTimeout(100);
        await expect(page.locator('.ve-slot-ghost')).toHaveCount(0); // dead zone
        await expect(page.locator('.ve-slot-selected')).toHaveCount(1);

        // a seam outside the dead zone still gets its hover caret
        const homeStrip = stripFor(page, 'ho');
        box = await homeStrip.boundingBox();
        await page.mouse.move(box.x + 2, box.y + box.height / 2);
        await expect(page.locator('.ve-slot-ghost')).toBeVisible();
    });

    test('hovering an occupied seam highlights the chip; the end seam highlights the + slot', async ({ page }) => {
        await openSong(page, '{start_of_verse: Verse 1}\nhello [C]world friend\n{end_of_verse}\n');

        // right half of the "lo " strip snaps to the C-chip seam ("world"):
        // the chip is the indicator — no ghost slot beside it
        const helloStrip = stripFor(page, 'lo');
        let box = await helloStrip.boundingBox();
        await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
        await expect(page.locator('.ve-chip-hover')).toHaveText('C');
        await expect(page.locator('.ve-slot-ghost')).toHaveCount(0);

        // right half of the last token snaps to the end seam: the existing
        // "+" end slot is the indicator
        const friendStrip = stripFor(page, 'friend');
        box = await friendStrip.boundingBox();
        await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
        await expect(page.locator('.ve-end-slot-hover')).toHaveCount(1);
        await expect(page.locator('.ve-slot-ghost')).toHaveCount(0);
        await expect(page.locator('.ve-chip-hover')).toHaveCount(0);
    });

    test('caret indicator has usable contrast in both themes', async ({ page }) => {
        await openSong(page, SONG);
        await stripFor(page, 'world').click();
        await expect(page.locator('.ve-slot-selected')).toBeVisible();

        for (const theme of ['dark', 'light']) {
            const c = await page.evaluate((t) => {
                document.documentElement.setAttribute('data-theme', t);
                const slot = document.querySelector('.ve-slot-selected');
                const parse = (str) => (str.match(/[\d.]+/g) || []).map(Number);
                const lum = (rgb) => {
                    const [r, g, b] = rgb.slice(0, 3).map((v) => {
                        v /= 255;
                        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
                    });
                    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
                };
                let el = slot.parentElement;
                let bg = [255, 255, 255];
                while (el) {
                    const v = parse(getComputedStyle(el).backgroundColor);
                    if (v.length >= 3 && (v.length < 4 || v[3] > 0)) { bg = v; break; }
                    el = el.parentElement;
                }
                const bar = getComputedStyle(slot).backgroundColor;
                const l1 = lum(parse(bar));
                const l2 = lum(bg);
                return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
            }, theme);
            expect(c, `${theme} theme caret contrast`).toBeGreaterThanOrEqual(3);
        }
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    });

    test('clicking a lyric swaps the line for an input with the caret at the click', async ({ page }) => {
        await openSong(page, SONG);
        const world = page.locator('.ve-syl', { hasText: 'world' }).first();
        await world.click({ position: { x: 2, y: 8 } });   // left edge of "world"
        const inp = lyricInput(page);
        await expect(inp).toBeVisible();
        await expect(inp).toHaveValue('hello world friend');
        expect(await inp.evaluate(el => el.selectionStart)).toBe(6);
        // no chord selection, no palette — lyric editing is text territory
        await expect(page.locator('.ve-palette')).toBeHidden();
    });

    test('typing + blur commits; chords re-anchor around the edit (word-LCS)', async ({ page }) => {
        await openSong(page, CHORDED);
        const hel = page.locator('.ve-syl').first();       // "hel", starts at 0
        await hel.click({ position: { x: 2, y: 8 } });
        const inp = lyricInput(page);
        await expect(inp).toBeVisible();
        await page.keyboard.type('well ');
        await page.locator('#editor-content').click();     // click elsewhere = commit
        await expect(lyricInput(page)).toHaveCount(0);
        // the [G] stays glued to "hello" even though text was inserted before it
        expect(await page.locator('#editor-content').inputValue())
            .toContain('well [G]hello world friend');
        // one undo step takes the whole edit back
        await page.locator('#editor-undo').click();
        expect(await page.locator('#editor-content').inputValue())
            .toContain('[G]hello world friend');
    });

    test('Enter splits the line at the caret; Backspace at 0 merges it back', async ({ page }) => {
        await openSong(page, CHORDED);
        const world = page.locator('.ve-syl', { hasText: 'world' }).first();
        await world.click({ position: { x: 2, y: 8 } });   // caret at "world"
        await page.keyboard.press('Enter');

        // split landed in the textarea; editing continues on the new line
        expect(await page.locator('#editor-content').inputValue())
            .toMatch(/\[G\]hello \nworld friend/);
        const inp = lyricInput(page);
        await expect(inp).toHaveValue('world friend');
        expect(await inp.evaluate(el => el.selectionStart)).toBe(0);

        // Backspace at 0 merges back into the previous line, caret at the join
        await page.keyboard.press('Backspace');
        expect(await page.locator('#editor-content').inputValue())
            .toContain('[G]hello world friend');
        const merged = lyricInput(page);
        await expect(merged).toHaveValue('hello world friend');
        expect(await merged.evaluate(el => el.selectionStart)).toBe(6);
    });

    test('Escape reverts the line', async ({ page }) => {
        await openSong(page, CHORDED);
        const before = await page.locator('#editor-content').inputValue();
        await page.locator('.ve-syl', { hasText: 'world' }).first().click();
        await page.keyboard.type('scrambled');
        await page.keyboard.press('Escape');
        await expect(lyricInput(page)).toHaveCount(0);
        expect(await page.locator('#editor-content').inputValue()).toBe(before);
    });

    test('a rewrite that orphans a chord shows the dropped-chords toast; Undo restores', async ({ page }) => {
        await openSong(page, CHORDED);
        await page.locator('.ve-syl').first().click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('completely different words');
        await page.locator('#editor-content').click();

        expect(await page.locator('#editor-content').inputValue())
            .toContain('completely different words');
        const toast = page.locator('.ve-toast');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('1 chord dropped');
        await toast.locator('.ve-toast-undo').click();
        expect(await page.locator('#editor-content').inputValue())
            .toContain('[G]hello world friend');
    });

    test('typing chord letters in the lyric input never places chords', async ({ page }) => {
        await openSong(page, SONG);
        await page.locator('.ve-syl').first().click({ position: { x: 2, y: 8 } });
        await page.keyboard.type('G A B ');
        await expect(page.locator('.ve-ghost-chip')).toHaveCount(0);
        await page.locator('#editor-content').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('G A B hello world friend');
        expect(raw).not.toMatch(/\[[A-G]/);
    });

    test('selecting all text in a line and deleting removes the line', async ({ page }) => {
        await openSong(page,
            '{start_of_verse: Verse 1}\nfirst line here\nsecond line here\nthird line here\n{end_of_verse}\n');
        await page.locator('.ve-syl', { hasText: 'cond' }).first().click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.locator('#editor-content').click();     // blur = commit
        await expect(lyricInput(page)).toHaveCount(0);
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('first line here\nthird line here');
        expect(raw).not.toContain('second line here');
        // the preview reflects it too: two lyric lines remain
        await expect(page.locator('.ve-line')).toHaveCount(2);
    });

    test('emptying a chorded line drops its chords with an Undo toast', async ({ page }) => {
        await openSong(page,
            '{start_of_verse: Verse 1}\n[G]first line here\n[C]second line here\n{end_of_verse}\n');
        await page.locator('.ve-syl', { hasText: 'cond' }).first().click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('Backspace');
        await page.locator('#editor-content').click();

        expect(await page.locator('#editor-content').inputValue())
            .not.toContain('second line here');
        const toast = page.locator('.ve-toast');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('1 chord dropped');
        await toast.locator('.ve-toast-undo').click();
        expect(await page.locator('#editor-content').inputValue())
            .toContain('[C]second line here');
    });

    test('+ Add line starts a new line at the end of the section', async ({ page }) => {
        await openSong(page, SONG);
        await page.locator('.ve-add-line').click();
        const inp = lyricInput(page);
        await expect(inp).toHaveValue('');
        await page.keyboard.type('one more line');
        await page.locator('#editor-content').click();
        expect(await page.locator('#editor-content').inputValue())
            .toContain('hello world friend\none more line\n{end_of_verse}');
    });

    test('a chord-row tap mid-edit commits the lyric edit, then selects the seam', async ({ page }) => {
        await openSong(page,
            '{start_of_verse: Verse 1}\nhello world friend\nsinging all night\n{end_of_verse}\n');
        await page.locator('.ve-syl').first().click({ position: { x: 2, y: 8 } });
        await page.keyboard.type('oh ');
        // without blurring first, tap the chord row of the OTHER line
        await stripFor(page, 'night').click();
        await expect(lyricInput(page)).toHaveCount(0);
        expect(await page.locator('#editor-content').inputValue())
            .toContain('oh hello world friend');
        await expect(page.locator('.ve-syl-selected')).toBeVisible();
        await expect(page.locator('.ve-palette')).toBeVisible();
    });
});

test.describe('Two-pane editor on mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('stacked layout: core placement flow works at phone size', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await page.locator('#hamburger-btn').click();
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        await setSong(page, '{start_of_verse: Verse 1}\nmountain morning light\n{end_of_verse}\n');
        const strip = page.locator('.ve-strip').first();
        await strip.scrollIntoViewIfNeeded();
        await strip.click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();
        expect(await page.locator('#editor-content').inputValue()).toMatch(/\[[A-G]/);
    });

    test('stacked layout: tapping lyrics opens the line input at phone size', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await page.locator('#hamburger-btn').click();
        await page.locator('#nav-add-song').click();
        await expect(page.locator('#editor-panel')).toBeVisible();

        await setSong(page, '{start_of_verse: Verse 1}\nmountain morning light\n{end_of_verse}\n');
        const syl = page.locator('.ve-syl').first();
        await syl.scrollIntoViewIfNeeded();
        await syl.click();
        const inp = page.locator('.ve-lyric-input');
        await expect(inp).toBeVisible();
        await expect(inp).toHaveValue('mountain morning light');
        await page.keyboard.type('misty ');
        await page.locator('#editor-content').click();
        expect(await page.locator('#editor-content').inputValue()).toContain('misty');
    });
});

test.describe('Popover palette on desktop', () => {
    // default viewport (1440x900) is the wide side-by-side layout: the
    // palette floats as a popover anchored to the selection instead of
    // docking at the bottom of the preview pane
    const LONG_SONG = '{start_of_verse: Verse 1}\n' + Array.from(
        { length: 30 }, (_, i) => `line number ${i + 1} of the song`).join('\n') + '\n{end_of_verse}\n';

    async function openLongSong(page) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openNewSongEditor(page);
        await setSong(page, LONG_SONG);
        await expect(page.locator('.ve-line')).toHaveCount(30);
    }

    test('tapping the chord row opens the palette as a popover below the line', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, SONG);
        const syl = page.locator('.ve-syl').first();
        await page.locator('.ve-strip').first().click();
        const pal = page.locator('.ve-palette');
        await expect(pal).toBeVisible();
        await expect(pal).toHaveClass(/ve-palette-popover/);

        const palBox = await pal.boundingBox();
        const sylBox = await syl.boundingBox();
        // width capped so the Strum Machine picker fits without dominating
        expect(palBox.width).toBeLessThanOrEqual(420);
        // anchored below the target, fully inside the viewport
        expect(palBox.y).toBeGreaterThanOrEqual(sylBox.y + sylBox.height);
        expect(palBox.y + palBox.height).toBeLessThanOrEqual(900);

        // picking from the popover works exactly like the dock
        await pal.locator('.ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();
    });

    test('palette is visible in the viewport after selecting a low syllable', async ({ page }) => {
        await openLongSong(page);
        const low = page.locator('.ve-line').nth(28).locator('.ve-syl').first();
        await low.scrollIntoViewIfNeeded();
        await page.locator('.ve-line').nth(28).locator('.ve-strip').first().click();

        const pal = page.locator('.ve-palette');
        await expect(pal).toBeVisible();
        await expect.poll(async () => {
            const box = await pal.boundingBox();
            return box && box.y >= 0 && box.y + box.height <= 900;
        }).toBe(true);
        // and it never covers the syllable it is anchored to
        const palBox = await pal.boundingBox();
        const sylBox = await low.boundingBox();
        const overlaps = palBox.y < sylBox.y + sylBox.height &&
            palBox.y + palBox.height > sylBox.y;
        expect(overlaps).toBe(false);
    });

    test('the popover follows its anchor when the preview pane scrolls', async ({ page }) => {
        await openLongSong(page);
        const syl = page.locator('.ve-line').nth(10).locator('.ve-syl').first();
        await syl.scrollIntoViewIfNeeded();
        await page.locator('.ve-line').nth(10).locator('.ve-strip').first().click();
        const pal = page.locator('.ve-palette');
        await expect(pal).toHaveClass(/ve-palette-popover/);

        const gap = async () => {
            const p = await pal.boundingBox();
            const t = await syl.boundingBox();
            return Math.round(p.y - t.y);
        };
        const before = await gap();
        await page.locator('.editor-pane-preview').evaluate(el => el.scrollBy(0, 80));
        await expect.poll(gap).toBe(before);
    });

    test('More… picker expands inside the popover and stays usable', async ({ page }) => {
        await openLongSong(page);
        const low = page.locator('.ve-line').nth(28).locator('.ve-syl').first();
        await low.scrollIntoViewIfNeeded();
        await page.locator('.ve-line').nth(28).locator('.ve-strip').first().click();
        await page.locator('.ve-palette-more').click();
        await expect(page.locator('.ve-picker')).toBeVisible();

        const pal = page.locator('.ve-palette');
        await expect.poll(async () => {
            const box = await pal.boundingBox();
            return box && box.y >= 0 && box.y + box.height <= 900;
        }).toBe(true);
        // the picker inside the popover still places chords
        await page.locator('.ve-picker-quality', { hasText: /^Gm$/ }).click();
        await expect(page.locator('.ve-chip', { hasText: 'Gm' })).toBeVisible();
    });
});

test.describe('Palette auto-scroll', () => {
    // mobile-ish viewport: the docked palette (fixed at 390px) plus the open
    // picker covers most of the screen — the worst occlusion case
    test.use({ viewport: { width: 390, height: 700 } });

    const LONG_SONG = '{start_of_verse: Verse 1}\n' + Array.from(
        { length: 30 }, (_, i) => `line number ${i + 1} of the song`).join('\n') + '\n{end_of_verse}\n';

    async function openLongSong(page) {
        // reduced motion → instant scrolling, so measurements are stable
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openNewSongEditor(page);
        await setSong(page, LONG_SONG);
        await expect(page.locator('.ve-line')).toHaveCount(30);
    }

    const measure = (page) => page.evaluate(() => {
        const sel = document.querySelector('.ve-syl-selected, .ve-chip-selected');
        const pal = document.querySelector('.ve-palette');
        return {
            scrollY: window.scrollY,
            selBottom: sel ? sel.getBoundingClientRect().bottom : null,
            selTop: sel ? sel.getBoundingClientRect().top : null,
            palTop: pal.getBoundingClientRect().top
        };
    });

    test('expanding More… scrolls a low selection clear of the picker', async ({ page }) => {
        await openLongSong(page);

        const lowStrip = page.locator('.ve-line').nth(25).locator('.ve-strip').first();
        await lowStrip.scrollIntoViewIfNeeded();
        await lowStrip.click();
        await expect(page.locator('.ve-palette')).toBeVisible();

        await page.locator('.ve-palette-more').click();
        await expect(page.locator('.ve-picker')).toBeVisible();
        await expect.poll(async () => {
            const m = await measure(page);
            return m.selBottom < m.palTop;
        }).toBe(true);
        const m = await measure(page);
        expect(m.palTop - m.selBottom).toBeGreaterThanOrEqual(8);
        expect(m.selTop).toBeGreaterThan(0);
    });

    test('consecutive picks on the same line do not move the page', async ({ page }) => {
        await openLongSong(page);

        const lowStrip = page.locator('.ve-line').nth(25).locator('.ve-strip').first();
        await lowStrip.scrollIntoViewIfNeeded();
        await lowStrip.click();
        await page.locator('.ve-palette-more').click();

        await expect.poll(async () => {
            const m = await measure(page);
            return m.selBottom < m.palTop;
        }).toBe(true);
        const before = await measure(page);

        await page.locator('.ve-palette-diatonic .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip-selected')).toBeVisible();
        const afterFirst = await measure(page);
        expect(Math.abs(afterFirst.scrollY - before.scrollY)).toBeLessThanOrEqual(2);

        await page.locator('.ve-palette-diatonic .ve-chip-btn').nth(1).click();
        const afterSecond = await measure(page);
        expect(Math.abs(afterSecond.scrollY - before.scrollY)).toBeLessThanOrEqual(2);

        expect(afterSecond.selBottom).toBeLessThan(afterSecond.palTop);
    });

    test('even the last line can scroll clear of the open picker', async ({ page }) => {
        await openLongSong(page);

        const lastStrip = page.locator('.ve-line').nth(29).locator('.ve-strip').first();
        await lastStrip.scrollIntoViewIfNeeded();
        await lastStrip.click();
        await page.locator('.ve-palette-more').click();

        await expect.poll(async () => {
            const m = await measure(page);
            return m.selBottom < m.palTop;
        }).toBe(true);
    });
});

test.describe('Section drag reorder on the preview', () => {
    const TWO_SECTIONS = `{start_of_verse: Verse 1}
first section words
{end_of_verse}

{start_of_chorus: Chorus}
second section words
{end_of_chorus}
`;

    async function setupTwoSections(page) {
        await openNewSongEditor(page);
        await setSong(page, TWO_SECTIONS);
        await expect(page.locator('.ve-psec')).toHaveCount(2);
    }

    async function startHandleDrag(page) {
        const handle = page.locator('.ve-psec').nth(0).locator('.ve-drag-handle');
        const hb = await handle.boundingBox();
        const target = await page.locator('.ve-psec').nth(1).boundingBox();
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        // drag past the second section's midpoint, in steps like a real drag
        await page.mouse.move(hb.x + hb.width / 2, target.y + target.height - 5, { steps: 8 });
    }

    test('dragging section 0 below section 1 reorders the song', async ({ page }) => {
        await setupTwoSections(page);
        await startHandleDrag(page);

        // mid-drag: lifted section + drop indicator are visible
        await expect(page.locator('.ve-psec-dragging')).toHaveCount(1);
        await expect(page.locator('.ve-drop-indicator')).toBeVisible();
        await page.mouse.up();

        // sections swapped in the preview
        await expect(page.locator('.ve-section-label').nth(0)).toHaveText('Chorus');
        await expect(page.locator('.ve-section-label').nth(1)).toHaveText('Verse 1');
        await expect(page.locator('.ve-psec-dragging')).toHaveCount(0);
        await expect(page.locator('.ve-drop-indicator')).toHaveCount(0);

        // serialized order flipped in the textarea (the document)
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw.indexOf('{start_of_chorus')).toBeLessThan(raw.indexOf('{start_of_verse'));
        expect(raw.indexOf('second section words')).toBeLessThan(raw.indexOf('first section words'));

        // one undo step restores the original order
        await page.locator('#editor-undo').click();
        const undone = await page.locator('#editor-content').inputValue();
        expect(undone.indexOf('{start_of_verse')).toBeLessThan(undone.indexOf('{start_of_chorus'));
    });

    test('Escape aborts the drag and keeps the original order', async ({ page }) => {
        await setupTwoSections(page);
        await startHandleDrag(page);
        await expect(page.locator('.ve-psec-dragging')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect(page.locator('.ve-psec-dragging')).toHaveCount(0);
        await expect(page.locator('.ve-drop-indicator')).toHaveCount(0);
        await page.mouse.up();

        await expect(page.locator('.ve-section-label').nth(0)).toHaveText('Verse 1');
        await expect(page.locator('.ve-section-label').nth(1)).toHaveText('Chorus');
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw.indexOf('{start_of_verse')).toBeLessThan(raw.indexOf('{start_of_chorus'));
    });
});

test.describe('Section header menu', () => {
    const TWO_SECTIONS = `{start_of_verse: Verse 1}
first section words
{end_of_verse}

{start_of_chorus: Chorus}
second section words
{end_of_chorus}
`;

    test('Delete removes the section; the toast Undo restores it', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, TWO_SECTIONS);
        await expect(page.locator('.ve-psec')).toHaveCount(2);

        await page.locator('.ve-psec').nth(1).locator('.ve-psec-menu-btn').click();
        await page.locator('.ve-psec').nth(1).locator('[data-action="delete"]').click();

        await expect(page.locator('.ve-psec')).toHaveCount(1);
        expect(await page.locator('#editor-content').inputValue())
            .not.toContain('second section words');

        const toast = page.locator('.ve-toast');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('Deleted Chorus');
        await toast.locator('.ve-toast-undo').click();

        await expect(page.locator('.ve-psec')).toHaveCount(2);
        expect(await page.locator('#editor-content').inputValue())
            .toContain('second section words');
    });

    test('Rename edits the label inline and lands in the directive', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, TWO_SECTIONS);
        await expect(page.locator('.ve-psec')).toHaveCount(2);

        await page.locator('.ve-psec').nth(0).locator('.ve-psec-menu-btn').click();
        await page.locator('.ve-psec').nth(0).locator('[data-action="rename"]').click();
        const input = page.locator('.ve-rename-input');
        await expect(input).toBeVisible();
        await input.fill('Opening Verse');
        await input.press('Enter');

        await expect(page.locator('.ve-section-label').nth(0)).toHaveText('Opening Verse');
        expect(await page.locator('#editor-content').inputValue())
            .toContain('{start_of_verse: Opening Verse}');
    });
});

test.describe('Make-verse/chorus from the textarea selection', () => {
    test('selecting lines shows the mini-bar; Make chorus wraps them', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, 'first line here\nsecond line here\nthird line here\n');
        await expect(page.locator('.ve-syl').first()).toBeVisible();

        // mini-bar hidden until a selection exists
        await expect(page.locator('#editor-selection-toolbar')).toBeHidden();

        await page.locator('#editor-content').evaluate((el) => {
            el.focus();
            const a = el.value.indexOf('second');
            el.setSelectionRange(a + 2, a + 8);   // partial-line selection
            el.dispatchEvent(new Event('select', { bubbles: true }));
        });
        await expect(page.locator('#editor-selection-toolbar')).toBeVisible();

        await page.locator('[data-wrap="chorus"]').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('{start_of_chorus: Chorus}\nsecond line here\n{end_of_chorus}');

        // preview reflects the new structure
        await expect(page.locator('.ve-section-label', { hasText: 'Chorus' })).toBeVisible();
        await expect(page.locator('.ve-psec-chorus')).toHaveCount(1);

        // one undo step takes the wrap back out
        await page.locator('#editor-undo').click();
        expect(await page.locator('#editor-content').inputValue())
            .not.toContain('{start_of_chorus');
    });

    test('wrapping across existing sections yields one clean section', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page,
            '{start_of_verse: Verse 1}\nline a\n{end_of_verse}\n\n' +
            '{start_of_chorus: Chorus}\nline b\n{end_of_chorus}\n');
        await expect(page.locator('.ve-psec')).toHaveCount(2);

        await page.locator('#editor-content').evaluate((el) => {
            el.focus();
            el.setSelectionRange(0, el.value.length);
            el.dispatchEvent(new Event('select', { bubbles: true }));
        });
        await expect(page.locator('#editor-selection-toolbar')).toBeVisible();
        await page.locator('[data-wrap="verse"]').click();

        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('{start_of_verse: Verse 1}\nline a\n\nline b\n{end_of_verse}');
        expect(raw).not.toContain('start_of_chorus');
        await expect(page.locator('.ve-psec')).toHaveCount(1);
    });
});
