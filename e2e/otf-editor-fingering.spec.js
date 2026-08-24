// E2E for FINGERING — both hands.
//
// The corpus carries two per-note marks the TEF importer decodes out of
// one base-6 byte (`sources/banjo-hangout/src/tef_parser/otf.py`): the
// picking hand as a letter (T I M R P) and the fretting hand as a digit
// (0..4, drawn circled). Until now the editor could set three of the
// five letters, could not set a digit at all, and could not clear
// either — so a tab imported with fingering could be opened, edited and
// saved with marks nobody could fix.
//
// The property under test is the round trip a human sees: press the key,
// the RENDERER draws the mark; clear it, the mark goes; undo, it is back.
// Nothing here reads the document — `.finger-text` / `.lh-finger-text`
// are what a person looking at the stave actually sees.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const TAB_DIR = path.join(import.meta.dirname, '..', 'docs', 'data', 'tabs');

/**
 * A published tab that carries BOTH hands' fingering. Resolved by
 * content, never by name: these files are build output (tier 4) and the
 * pending-tab filenames carry a hash, so a hard-coded name rots.
 */
function tabWithFingerings() {
    for (const file of fs.readdirSync(TAB_DIR).filter(f => f.endsWith('.otf.json')).sort()) {
        const raw = fs.readFileSync(path.join(TAB_DIR, file), 'utf8');
        if (raw.includes('"finger"') && raw.includes('"lh"')) return `data/tabs/${file}`;
    }
    return null;
}

/**
 * The NOTE-ENTRY panel specifically. All four popovers share the
 * `.otf-note-popover` chrome class (they are deliberate siblings), so the
 * fret pad — which only note entry has — is what picks this one out.
 */
const noteEntryPanel = (page) => page.locator('.otf-note-popover')
    .filter({ has: page.locator('.fret-pad') });

async function openDemo(page) {
    await page.goto('/editor-demo.html');
    await page.locator('.editor-renderer .stave-row').first().waitFor();
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
}

/** Put one note down and park the cursor back on it. */
async function noteUnderCursor(page, fret = '5') {
    await page.keyboard.press(fret);
    await expect(page.locator('.note-text').first()).toHaveText(fret);
    await page.keyboard.press('ArrowLeft');   // auto-advance moved on
}

const fingerLetters = (page) => page.locator('.finger-text').allTextContents();
const lhDigits = (page) => page.locator('.lh-finger-text').allTextContents();
const status = (page) => page.locator('.editor-status-bar').textContent()
    .then(t => t.replace(/\s+/g, ' '));

test.describe('fingering — the keyboard path', () => {
    test('A then r draws R; 3 draws a circled 3; c clears both; undo restores',
        async ({ page }) => {
            await openDemo(page);
            await noteUnderCursor(page);

            // ANNOTATION mode is where the per-note marks live
            await page.keyboard.press('Shift+A');
            await expect(page.locator('.mode-indicator')).toContainText('ANNOTATION');

            // Picking hand: `r` is the ring finger — one of the two
            // letters the editor could not write before.
            await page.keyboard.press('r');
            await expect.poll(() => fingerLetters(page)).toEqual(['R']);

            // Fretting hand: a bare digit in ANNOTATION is `lh`, and the
            // renderer draws it circled under the pluck letter.
            await page.keyboard.press('3');
            await expect.poll(() => lhDigits(page)).toEqual(['3']);
            expect(await page.locator('.lh-finger-circle').count()).toBe(1);

            // …and the status bar says what is set, both hands
            expect(await status(page)).toContain('Fing: R · lh 3');

            // `c` clears the FINGERING (both hands) in one step
            await page.keyboard.press('c');
            await expect.poll(() => fingerLetters(page)).toEqual([]);
            await expect.poll(() => lhDigits(page)).toEqual([]);
            expect(await status(page)).toContain('Fing: —');

            // …and one undo brings both marks back
            await page.keyboard.press('Control+z');
            await expect.poll(() => fingerLetters(page)).toEqual(['R']);
            await expect.poll(() => lhDigits(page)).toEqual(['3']);
        });

    test('the picking letters are a toggle: the same key again clears it',
        async ({ page }) => {
            await openDemo(page);
            await noteUnderCursor(page);
            await page.keyboard.press('Shift+A');

            await page.keyboard.press('t');
            await expect.poll(() => fingerLetters(page)).toEqual(['T']);
            await page.keyboard.press('t');
            await expect.poll(() => fingerLetters(page)).toEqual([]);

            // Shift+P is the pinky — `p` in this mode is the pull-off
            await page.keyboard.press('Shift+P');
            await expect.poll(() => fingerLetters(page)).toEqual(['P']);
            await page.keyboard.press('p');
            await expect.poll(() => fingerLetters(page)).toEqual(['P']);
            expect(await status(page)).toContain('Fing: P');
        });

    test('TablEdit’s Alt+digit reaches the fretting hand from NORMAL',
        async ({ page }) => {
            await openDemo(page);
            await noteUnderCursor(page);

            // Still NORMAL: a bare digit here would be a FRET
            await expect(page.locator('.mode-indicator')).toContainText('NORMAL');
            await page.keyboard.press('Alt+Digit2');
            await expect.poll(() => lhDigits(page)).toEqual(['2']);
            await expect.poll(() => page.locator('.note-text').allTextContents())
                .toEqual(['5']);              // the fret did not move

            await page.keyboard.press('Alt+Backspace');
            await expect.poll(() => lhDigits(page)).toEqual([]);
        });
});

test.describe('fingering — the touch path', () => {
    test('double-clicking a note opens the panel with its fingering pre-selected',
        async ({ page }) => {
            await openDemo(page);
            await noteUnderCursor(page);
            await page.keyboard.press('Shift+A');
            await page.keyboard.press('m');
            await page.keyboard.press('4');
            await expect.poll(() => fingerLetters(page)).toEqual(['M']);

            await page.locator('.note-text').first().dblclick();
            const panel = noteEntryPanel(page);
            await expect(panel).toBeVisible();
            await expect(panel.locator('.popover-title')).toHaveText('Edit Note');
            await expect(panel.locator('.finger-button[data-finger="M"]'))
                .toHaveClass(/selected/);
            await expect(panel.locator('.lh-button[data-lh="4"]'))
                .toHaveClass(/selected/);

            // Change the picking hand without retyping the fret
            await panel.locator('.finger-button[data-finger="P"]').click();
            await panel.locator('.insert-btn').click();
            await expect.poll(() => fingerLetters(page)).toEqual(['P']);
            await expect.poll(() => lhDigits(page)).toEqual(['4']);
            await expect.poll(() => page.locator('.note-text').allTextContents())
                .toEqual(['5']);
        });

    test('the panel offers both hands, and each button is a toggle',
        async ({ page }) => {
            await openDemo(page);
            await page.locator('.editor-canvas-container')
                .dblclick({ position: { x: 100, y: 60 } });
            const panel = noteEntryPanel(page);
            await expect(panel).toBeVisible();
            await expect(panel.locator('.finger-button')).toHaveText(['T', 'I', 'M', 'R', 'P']);
            await expect(panel.locator('.lh-button')).toHaveText(['0', '1', '2', '3', '4']);

            const ring = panel.locator('.finger-button[data-finger="R"]');
            await ring.click();
            await expect(ring).toHaveClass(/selected/);
            await ring.click();
            await expect(ring).not.toHaveClass(/selected/);
        });
});

test.describe('fingering — a real imported tab', () => {
    const tab = tabWithFingerings();

    test('the marks the TEF importer wrote are drawn, and are editable', async ({ page }) => {
        test.skip(!tab, 'no published tab carries both hands’ fingering');
        await openDemo(page);
        const loaded = await page.evaluate(async (file) => {
            const res = await fetch(file);
            if (!res.ok) return { error: `HTTP ${res.status}` };
            window.editor.load(await res.json());
            return { ok: true };
        }, tab);
        expect(loaded.error).toBeUndefined();
        await page.locator('.editor-renderer .stave-row').first().waitFor();

        // The importer's own vocabulary, on the page
        const letters = await fingerLetters(page);
        expect(letters.length).toBeGreaterThan(0);
        expect(new Set(letters)).toEqual(new Set(letters.filter(
            l => ['T', 'I', 'M', 'R', 'P'].includes(l))));
        expect((await lhDigits(page)).length).toBeGreaterThan(0);

        // …and one of them can be changed by hand. `;` walks note to
        // note in ANNOTATION mode, and the status bar is what says
        // whether the note we are standing on carries a mark — the
        // stave's letters are not tied to the cursor.
        const before = letters.length;
        await page.locator('.note-text').first().click();
        await page.keyboard.press('Shift+A');
        await expect(page.locator('.mode-indicator')).toContainText('ANNOTATION');
        let landed = false;
        for (let i = 0; i < 200 && !landed; i++) {
            landed = /Fing: [TIMRP0-9]/.test(await status(page));
            if (!landed) await page.keyboard.press(';');
        }
        expect(landed, 'walked onto a note that carries fingering').toBe(true);

        await page.keyboard.press('c');
        await expect.poll(() => status(page).then(s => /Fing: —/.test(s))).toBe(true);
        await expect.poll(() => fingerLetters(page).then(l => l.length))
            .toBeLessThan(before);
        await page.keyboard.press('Control+z');
        await expect.poll(() => fingerLetters(page).then(l => l.length)).toBe(before);
    });
});
