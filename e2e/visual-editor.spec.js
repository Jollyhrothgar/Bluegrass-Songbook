// E2E tests for the two-pane song editor: raw ChordPro textarea (left) +
// live interactive preview (right). The textarea is THE document; every
// preview-side edit (tap-to-chord, ghost typing, chip delete) writes
// serialized ChordPro back into it.
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

    test('typing ChordPro in the textarea renders the live preview', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, SONG_WITH_CHORD);
        await expect(page.locator('.ve-section-label')).toHaveText('Verse 1');
        await expect(page.locator('.ve-chip')).toHaveText('G');
        const syls = page.locator('.ve-syl');
        await expect(syls.first()).toContainText('hel');
    });

    test('tap a syllable, pick a chord — it lands in the textarea', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, SONG);
        await expect(page.locator('.ve-syl').first()).toBeVisible();

        await page.locator('.ve-syl').first().click();
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
        await page.locator('.ve-syl').first().click();
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

        // tapping another syllable moves on; the next pick inserts there
        const world = page.locator('.ve-syl', { hasText: 'world' }).first();
        await world.click();
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

        await page.locator('.ve-syl').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('#editor-transpose-group')).toBeVisible();
        await expect(page.locator('#editor-key-select')).toBeVisible();
    });

    test('metadata directives ride through preview edits untouched', async ({ page }) => {
        await openNewSongEditor(page);
        await setSong(page, '{meta: title Keep Me}\n{meta: x_source e2e}\n\n' + SONG);
        await page.locator('.ve-syl', { hasText: 'world' }).first().click();
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

    test('ghost entry: select a syllable, type Eb7, chord commits after idle', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-syl').first().click();
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
        await page.locator('.ve-syl').first().click();       // "hel"
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
        await page.locator('.ve-syl').first().click();
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
        await page.locator('.ve-syl').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);
        await page.keyboard.press('ControlOrMeta+z');
        await expect(page.locator('.ve-chip')).toHaveCount(0);
    });

    test('clicking a chip then pressing Delete removes the chord', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-syl').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);

        await page.locator('.ve-chip').first().click();
        await page.keyboard.press('Delete');
        await expect(page.locator('.ve-chip')).toHaveCount(0);
        await expect(page.locator('.ve-palette')).toBeHidden();
    });

    test('clicking a chip then the ✕ Remove button removes the chord', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-syl').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);

        await page.locator('.ve-chip').first().click();
        await expect(page.locator('.ve-palette-delete')).toBeVisible();
        await page.locator('.ve-palette-delete').click();
        await expect(page.locator('.ve-chip')).toHaveCount(0);
    });

    test('typing in the textarea never triggers ghost entry', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-syl').first().click();       // selection alive
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
        await page.locator('.ve-syl').first().click();
        await expect(page.locator('.ve-palette-diatonic .ve-chip-btn').first()).toHaveText('D');
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
        const syl = page.locator('.ve-syl').first();
        await syl.scrollIntoViewIfNeeded();
        await syl.click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();
        expect(await page.locator('#editor-content').inputValue()).toMatch(/\[[A-G]/);
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

        const lowSyl = page.locator('.ve-line').nth(25).locator('.ve-syl').first();
        await lowSyl.scrollIntoViewIfNeeded();
        await lowSyl.click();
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

        const lowSyl = page.locator('.ve-line').nth(25).locator('.ve-syl').first();
        await lowSyl.scrollIntoViewIfNeeded();
        await lowSyl.click();
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

        const lastSyl = page.locator('.ve-line').nth(29).locator('.ve-syl').first();
        await lastSyl.scrollIntoViewIfNeeded();
        await lastSyl.click();
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

