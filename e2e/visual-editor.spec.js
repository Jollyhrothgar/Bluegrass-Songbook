// E2E tests for the visual song editor (tap-to-place chords, sections, tabs)
import { test, expect } from '@playwright/test';

async function openNewSongEditor(page) {
    await page.goto('/#search');
    await page.waitForSelector('#search-input');
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
    await page.locator('#nav-add-song').click();
    // Add Song goes straight to the new-song editor (no picker modal)
    await expect(page.locator('#editor-panel')).toBeVisible();
}

test.describe('Visual editor basics', () => {
    test('visual is the default; the quiet ChordPro link toggles raw and back', async ({ page }) => {
        await openNewSongEditor(page);
        await expect(page.locator('#editor-tab-visual')).toHaveClass(/active/);
        await expect(page.locator('#visual-editor-container')).toBeVisible();
        await expect(page.locator('#editor-raw-main')).toBeHidden();
        // only the "switch to raw" affordance is offered in visual mode
        await expect(page.locator('#editor-tab-raw')).toBeVisible();
        await expect(page.locator('#editor-tab-raw')).toContainText('ChordPro');
        await expect(page.locator('#editor-tab-visual')).toBeHidden();

        await page.locator('#editor-tab-raw').click();
        await expect(page.locator('#editor-raw-main')).toBeVisible();
        await expect(page.locator('#visual-editor-container')).toBeHidden();
        // and the way back is offered in raw mode
        await expect(page.locator('#editor-tab-visual')).toBeVisible();
        await expect(page.locator('#editor-tab-raw')).toBeHidden();

        await page.locator('#editor-tab-visual').click();
        await expect(page.locator('#visual-editor-container')).toBeVisible();
        await expect(page.locator('#editor-raw-main')).toBeHidden();
    });

    test('add section, type lyrics, place a chord, verify raw output', async ({ page }) => {
        await openNewSongEditor(page);

        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await expect(page.locator('.ve-card')).toHaveCount(1);

        // new section opens in lyrics mode
        await page.locator('.ve-lyrics-input').fill('hello world friend');
        await page.locator('.ve-mode-chords').click();

        // tap a syllable, pick a chord from the palette
        await page.locator('.ve-syl').first().click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();

        // raw tab shows the bracket
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toMatch(/\[[A-G][#b]?m?7?\]hello world friend/);
        expect(raw).toContain('{start_of_verse: Verse 1}');
    });

    test('picker picks insert immediately and consecutive picks refine', async ({ page }) => {
        await openNewSongEditor(page);
        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await page.locator('.ve-lyrics-input').fill('hello world friend');
        await page.locator('.ve-mode-chords').click();

        // select the first syllable and open the full picker
        await page.locator('.ve-syl').first().click();
        await page.locator('.ve-palette-more').click();
        await expect(page.locator('.ve-picker')).toBeVisible();

        // first pick inserts and selects the new chip
        await page.locator('.ve-picker-quality', { hasText: /^Gm$/ }).click();
        await expect(page.locator('.ve-chip')).toHaveText('Gm');
        await expect(page.locator('.ve-chip')).toHaveClass(/ve-chip-selected/);

        // picker stays open with its root intact; the next pick refines
        // the same chord (no silent no-op, no stacking)
        await expect(page.locator('.ve-picker')).toBeVisible();
        await expect(page.locator('.ve-picker-root.selected')).toHaveText('G');
        await page.locator('.ve-picker-quality', { hasText: /^G7$/ }).click();
        await expect(page.locator('.ve-chip')).toHaveText('G7');
        await expect(page.locator('.ve-chip')).toHaveCount(1);

        // tapping another syllable moves on; the next pick inserts there
        // (scroll it into the band between sticky toolbar and docked palette)
        const world = page.locator('.ve-syl', { hasText: 'world' }).first();
        await world.evaluate(el => { el.scrollIntoView(); window.scrollBy(0, -150); });
        await world.click();
        await page.locator('.ve-picker-quality', { hasText: /^Gm7$/ }).click();
        await expect(page.locator('.ve-chip')).toHaveCount(2);

        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('[G7]hello [Gm7]world friend');
        expect(raw).not.toContain('[Gm]hello');
    });

    test('editing an existing song shows its sections and chords', async ({ page }) => {
        await page.goto('/#work/your-cheating-heart');
        await page.waitForTimeout(1000);
        await expect(page.locator('#song-view')).toBeVisible();
        const editBtn = page.locator('#edit-song-btn');
        if (await editBtn.isVisible()) {
            await editBtn.click();
            await expect(page.locator('#editor-panel')).toBeVisible();
            await expect(page.locator('.ve-card').first()).toBeVisible();
            await expect(page.locator('.ve-chip').first()).toBeVisible();
        }
    });

    test('round-trip: raw edits appear in visual after tab switch', async ({ page }) => {
        await openNewSongEditor(page);
        await page.locator('#editor-tab-raw').click();
        await page.locator('#editor-content').fill(
            '{start_of_verse: Verse 1}\n[G]row your boat\n{end_of_verse}\n');
        await page.locator('#editor-tab-visual').click();
        await expect(page.locator('.ve-card-label')).toHaveText('Verse 1');
        await expect(page.locator('.ve-chip')).toHaveText('G');
    });

    test('section menu changes type', async ({ page }) => {
        await openNewSongEditor(page);
        await page.locator('#editor-tab-raw').click();
        await page.locator('#editor-content').fill(
            '{start_of_verse: Verse 1}\n[G]sing along now\n{end_of_verse}\n');
        await page.locator('#editor-tab-visual').click();
        await page.locator('.ve-card-menu-btn').click();
        await page.locator('[data-action="type-chorus"]').click();
        await expect(page.locator('.ve-card-label')).toHaveText('Chorus');
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('{start_of_chorus: Chorus}');
    });
});

test.describe('Keyboard interactions', () => {
    async function placeReadyLine(page) {
        await openNewSongEditor(page);
        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await page.locator('.ve-lyrics-input').fill('hello world friend');
        await page.locator('.ve-mode-chords').click();
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
        // after the idle delay the ghost becomes a real chip
        await expect(page.locator('.ve-chip').first()).toHaveText('Eb7');
        await expect(page.locator('.ve-ghost-chip')).toHaveCount(0);
        await page.locator('#editor-tab-raw').click();
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
        await page.locator('#editor-tab-raw').click();
        expect(await page.locator('#editor-content').inputValue()).toContain('[C]world');
    });

    test('hovering a chip reveals an × that removes the chord', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-syl').first().click();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip')).toHaveCount(1);
        await page.locator('.ve-chip-wrap').hover();
        await expect(page.locator('.ve-chip-x')).toBeVisible();
        await page.locator('.ve-chip-x').click();
        await expect(page.locator('.ve-chip')).toHaveCount(0);
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
});

test.describe('Visual editor on mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('core placement flow works at phone size', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');
        await page.locator('#hamburger-btn').click();
        await page.locator('#nav-add-song').click();
        // Add Song goes straight to the new-song editor (no picker modal)
        await expect(page.locator('#editor-panel')).toBeVisible();

        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await page.locator('.ve-lyrics-input').fill('mountain morning light');
        await page.locator('.ve-mode-chords').click();
        await page.locator('.ve-syl').first().click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.locator('.ve-palette .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip').first()).toBeVisible();
    });
});

test.describe('Palette auto-scroll', () => {
    // mobile-ish viewport: the docked palette (fixed at 390px) plus the open
    // picker covers most of the screen — the worst occlusion case
    test.use({ viewport: { width: 390, height: 700 } });

    const LONG_LYRICS = Array.from(
        { length: 30 }, (_, i) => `line number ${i + 1} of the song`).join('\n');

    async function openLongSongInChordsMode(page) {
        // reduced motion → instant scrolling, so measurements are stable
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openNewSongEditor(page);
        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await page.locator('.ve-lyrics-input').fill(LONG_LYRICS);
        await page.locator('.ve-mode-chords').click();
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
        await openLongSongInChordsMode(page);

        // select a syllable low on the page
        const lowSyl = page.locator('.ve-line').nth(25).locator('.ve-syl').first();
        await lowSyl.scrollIntoViewIfNeeded();
        await lowSyl.click();
        await expect(page.locator('.ve-palette')).toBeVisible();

        // the tall Strum Machine-style picker would occlude the line
        await page.locator('.ve-palette-more').click();
        await expect(page.locator('.ve-picker')).toBeVisible();
        await expect.poll(async () => {
            const m = await measure(page);
            return m.selBottom < m.palTop;
        }).toBe(true);
        // and it sits comfortably above the palette, not clipped at the top
        const m = await measure(page);
        expect(m.palTop - m.selBottom).toBeGreaterThanOrEqual(8);
        expect(m.selTop).toBeGreaterThan(0);
    });

    test('consecutive picks on the same line do not move the page', async ({ page }) => {
        await openLongSongInChordsMode(page);

        const lowSyl = page.locator('.ve-line').nth(25).locator('.ve-syl').first();
        await lowSyl.scrollIntoViewIfNeeded();
        await lowSyl.click();
        await page.locator('.ve-palette-more').click();

        // wait for the auto-scroll to settle, then pick twice on the same line
        await expect.poll(async () => {
            const m = await measure(page);
            return m.selBottom < m.palTop;
        }).toBe(true);
        const before = await measure(page);

        // pick a chord: selection becomes the placed chip — must not jump
        await page.locator('.ve-palette-diatonic .ve-chip-btn').first().click();
        await expect(page.locator('.ve-chip-selected')).toBeVisible();
        const afterFirst = await measure(page);
        expect(Math.abs(afterFirst.scrollY - before.scrollY)).toBeLessThanOrEqual(2);

        // refine the chord (consecutive pick) — still no jump
        await page.locator('.ve-palette-diatonic .ve-chip-btn').nth(1).click();
        const afterSecond = await measure(page);
        expect(Math.abs(afterSecond.scrollY - before.scrollY)).toBeLessThanOrEqual(2);

        // and the chip is still visible above the palette
        expect(afterSecond.selBottom).toBeLessThan(afterSecond.palTop);
    });

    test('even the last line can scroll clear of the open picker', async ({ page }) => {
        await openLongSongInChordsMode(page);

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

test.describe('Smart paste in Visual mode', () => {
    const CHORD_SHEET = `G              C        G
Way down upon the Swanee River
D7                 G
Far, far away

G                C       G
All up and down the whole creation
D7                G
Sadly I roam`;

    // Dispatch a synthetic paste carrying clipboard text (Playwright can't
    // put multi-line text on the real clipboard cross-browser reliably).
    async function pasteText(page, selector, text) {
        await page.locator(selector).first().evaluate((el, t) => {
            const dt = new DataTransfer();
            dt.setData('text/plain', t);
            el.focus();
            el.dispatchEvent(new ClipboardEvent('paste', {
                clipboardData: dt, bubbles: true, cancelable: true
            }));
        }, text);
    }

    test('chords-over-lyrics paste into a lyrics textarea splits cards and places chips', async ({ page }) => {
        await openNewSongEditor(page);
        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        await expect(page.locator('.ve-lyrics-input')).toBeVisible();

        await pasteText(page, '.ve-lyrics-input', CHORD_SHEET);

        // two cards, chords rendered as chips over the lyrics
        await expect(page.locator('.ve-card')).toHaveCount(2);
        await expect(page.locator('.ve-chip', { hasText: 'D7' }).first()).toBeVisible();
        await expect(page.locator('.ve-syl').first()).toContainText('Way');

        // one undo step restores the pre-paste state
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('[G]Way down upon');
        expect(raw).toContain('Sadly I roam');

        await page.locator('#editor-tab-visual').click();
        await page.locator('.ve-undo').click();
        await expect(page.locator('.ve-card')).toHaveCount(1);
    });

    test('plain-text paste is left to the textarea (no conversion)', async ({ page }) => {
        await openNewSongEditor(page);
        await page.locator('.ve-add-section').click();
        await page.locator('[data-add-type="verse"]').click();
        const ta = page.locator('.ve-lyrics-input');
        await expect(ta).toBeVisible();

        await ta.click();
        await page.keyboard.insertText('just plain words');
        await page.locator('.ve-mode-chords').click();
        await expect(page.locator('.ve-card')).toHaveCount(1);
        await expect(page.locator('.ve-chip')).toHaveCount(0);
        await expect(page.locator('.ve-syl').first()).toContainText('just');
    });

    test('empty editor accepts a whole-song paste and builds all cards', async ({ page }) => {
        await openNewSongEditor(page);
        await expect(page.locator('.ve-empty-paste')).toBeVisible();

        await pasteText(page, '.ve-empty-paste', CHORD_SHEET);

        await expect(page.locator('.ve-card')).toHaveCount(2);
        await expect(page.locator('.ve-chip', { hasText: 'D7' }).first()).toBeVisible();

        // mirrored into the raw textarea
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('[G]Way down upon');
    });

    test('typed multi-paragraph lyrics split into animated cards with an undo toast', async ({ page }) => {
        await openNewSongEditor(page);
        const box = page.locator('.ve-empty-paste');
        await expect(box).toBeVisible();

        await box.click();
        await page.keyboard.insertText(
            'first verse of my song\n\nsecond verse right here\n\nthird verse to finish');
        await box.blur();

        // cards animate in (entrance class present on the fresh render)
        await expect(page.locator('.ve-card')).toHaveCount(3);
        await expect(page.locator('.ve-card.ve-card-enter')).toHaveCount(3);

        // summary toast with a working Undo
        const toast = page.locator('.ve-toast');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('Split into 3 verses');
        await toast.locator('.ve-toast-undo').click();

        // back to the single friendly box
        await expect(page.locator('.ve-card')).toHaveCount(0);
        await expect(page.locator('.ve-empty-paste')).toBeVisible();
    });

    test('pasting full ChordPro into the empty editor keeps metadata', async ({ page }) => {
        await openNewSongEditor(page);
        await pasteText(page, '.ve-empty-paste',
            '{meta: title Pasted Song}\n{key: D}\n\n[D]hello [G]there friend');

        await expect(page.locator('.ve-card')).toHaveCount(1);
        await expect(page.locator('.ve-key-label')).toHaveText('Key: D');
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw).toContain('{meta: title Pasted Song}');
        expect(raw).toContain('{key: D}');
    });
});

test.describe('Drag-and-drop section reorder', () => {
    async function addSectionWithLyrics(page, type, lyrics) {
        await page.locator('.ve-add-section').click();
        await page.locator(`[data-add-type="${type}"]`).click();
        const card = page.locator('.ve-card').last();
        await card.locator('.ve-lyrics-input').fill(lyrics);
        await card.locator('.ve-mode-chords').click();
    }

    async function setupTwoSections(page) {
        await openNewSongEditor(page);
        await addSectionWithLyrics(page, 'verse', 'first section words');
        await addSectionWithLyrics(page, 'chorus', 'second section words');
        await expect(page.locator('.ve-card')).toHaveCount(2);
    }

    async function startHandleDrag(page) {
        const handle = page.locator('.ve-card').nth(0).locator('.ve-drag-handle');
        const hb = await handle.boundingBox();
        const target = await page.locator('.ve-card').nth(1).boundingBox();
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        // drag past the second card's midpoint, in steps like a real drag
        await page.mouse.move(hb.x + hb.width / 2, target.y + target.height - 5, { steps: 8 });
    }

    test('dragging card 0 below card 1 reorders the song', async ({ page }) => {
        await setupTwoSections(page);
        await startHandleDrag(page);

        // mid-drag: lifted card + drop indicator are visible
        await expect(page.locator('.ve-card-dragging')).toHaveCount(1);
        await expect(page.locator('.ve-drop-indicator')).toBeVisible();
        await page.mouse.up();

        // cards swapped in the UI
        await expect(page.locator('.ve-card-label').nth(0)).toHaveText('Chorus');
        await expect(page.locator('.ve-card-label').nth(1)).toHaveText('Verse 1');
        await expect(page.locator('.ve-card-dragging')).toHaveCount(0);
        await expect(page.locator('.ve-drop-indicator')).toHaveCount(0);

        // serialized order flipped in the raw textarea
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw.indexOf('{start_of_chorus')).toBeLessThan(raw.indexOf('{start_of_verse'));
        expect(raw.indexOf('second section words')).toBeLessThan(raw.indexOf('first section words'));
    });

    test('Escape aborts the drag and keeps the original order', async ({ page }) => {
        await setupTwoSections(page);
        await startHandleDrag(page);
        await expect(page.locator('.ve-card-dragging')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect(page.locator('.ve-card-dragging')).toHaveCount(0);
        await expect(page.locator('.ve-drop-indicator')).toHaveCount(0);
        await page.mouse.up();

        await expect(page.locator('.ve-card-label').nth(0)).toHaveText('Verse 1');
        await expect(page.locator('.ve-card-label').nth(1)).toHaveText('Chorus');
        await page.locator('#editor-tab-raw').click();
        const raw = await page.locator('#editor-content').inputValue();
        expect(raw.indexOf('{start_of_verse')).toBeLessThan(raw.indexOf('{start_of_chorus'));
    });
});
