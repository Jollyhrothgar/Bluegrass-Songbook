// E2E tests for the OTF editor — written against the CURRENT design:
// modal-less entry (NORMAL handles nav + notes), grid = the one working
// increment (ruler/arrows/click snap), duration = entered note length,
// drag-select + clipboard + repeats, and the create-a-tab flow.
//
// No audio assertions here: WebAudioFont's CDN is blocked in the
// sandbox; playback is verified by ear on a real machine.
import { test, expect } from '@playwright/test';

async function openDemo(page) {
    await page.goto('/editor-demo.html');
    await page.locator('.editor-renderer .stave-row').first().waitFor();
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
}

const statusM = (page) => page.locator('.editor-status-bar')
    .textContent().then(t => t.replace(/\s+/g, ' ').match(/M: (\d+) \| Beat: ([\d.]+)/));

test.describe('editor mount', () => {
    test('demo mounts: toolbar, NORMAL mode, staff, grid ruler', async ({ page }) => {
        await openDemo(page);
        await expect(page.locator('.otf-editor-toolbar')).toBeVisible();
        await expect(page.locator('.mode-indicator')).toContainText('NORMAL');
        expect(await page.locator('.string-label').count()).toBeGreaterThanOrEqual(5);
        expect(await page.locator('.editor-grid-overlay line').count()).toBeGreaterThan(10);
    });

    test('duration buttons are legible text and Rest exists', async ({ page }) => {
        await openDemo(page);
        const symbols = await page.locator('.duration-buttons .button-symbol')
            .allTextContents();
        expect(symbols).toEqual(['1', '1/2', '1/4', '1/8', '1/16', '1/32']);
        await expect(page.locator('.rest-button')).toBeVisible();
    });
});

test.describe('note entry', () => {
    test('digits insert IMMEDIATELY and auto-advance by duration', async ({ page }) => {
        await openDemo(page);
        await page.keyboard.press('5');
        // no buffer wait — the note is already there
        await expect(page.locator('.note-text').first()).toHaveText('5');
        const m = await statusM(page);
        expect(m[2]).toBe('1.2'); // advanced one eighth
    });

    test('quick two digits refine to one two-digit fret', async ({ page }) => {
        await openDemo(page);
        await page.keyboard.press('1');
        await page.keyboard.press('2');
        await expect(page.locator('.note-text').first()).toHaveText('12');
        expect(await page.locator('.note-text').count()).toBe(1);
    });

    test('Shift+digit stacks a chord tone without advancing', async ({ page }) => {
        await openDemo(page);
        await page.keyboard.press('5');
        await page.keyboard.press('ArrowLeft'); // back onto the note
        await page.keyboard.press('k');         // up a string
        await page.keyboard.press('Shift+Digit7');
        const texts = await page.locator('.note-text').allTextContents();
        expect(texts.sort()).toEqual(['5', '7']);
        const m = await statusM(page);
        expect(m[2]).toBe('1'); // did not advance
    });

    test('Delete removes the note under the cursor', async ({ page }) => {
        await openDemo(page);
        await page.keyboard.press('5');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Delete');
        expect(await page.locator('.note-text').count()).toBe(0);
    });

    test('undo restores exactly', async ({ page }) => {
        await openDemo(page);
        await page.keyboard.press('5');
        await page.keyboard.press('u');
        expect(await page.locator('.note-text').count()).toBe(0);
    });

    test('Rest button advances without entering a note', async ({ page }) => {
        await openDemo(page);
        await page.locator('.rest-button').click();
        const m = await statusM(page);
        expect(m[2]).toBe('1.2');
        expect(await page.locator('.note-text').count()).toBe(0);
    });
});

test.describe('grid model (one working increment)', () => {
    test('arrows step by the grid; duration→grid coupling is refine-only', async ({ page }) => {
        await openDemo(page);
        // default grid 1/8: one arrow = an eighth
        await page.keyboard.press('ArrowRight');
        let m = await statusM(page);
        expect(m[2]).toBe('1.2');
        // finer duration REFINES the grid (s = 1/16)
        await page.keyboard.press('s');
        await page.keyboard.press('ArrowRight');
        m = await statusM(page);
        expect(m[2]).toBe('1.3'); // 240 + 120
        // coarser duration does NOT coarsen the grid (refine-only)
        await page.keyboard.press('q');
        await page.keyboard.press('ArrowRight');
        m = await statusM(page);
        expect(m[2]).toBe('2'); // 360 + 120 = 480, still sixteenth steps
    });

    test('grid choice changes the ruler density', async ({ page }) => {
        await openDemo(page);
        const coarse = await page.locator('.editor-grid-overlay line').count();
        await page.locator('.grid-buttons button', { hasText: '1/32' }).click();
        await expect(async () => {
            const fine = await page.locator('.editor-grid-overlay line').count();
            expect(fine).toBeGreaterThan(coarse * 2);
        }).toPass();
    });
});

test.describe('selection, clipboard, phrases', () => {
    async function enterPhrase(page) {
        for (const k of ['5', '7', '5']) await page.keyboard.press(k);
    }

    test('drag selects (highlight) and toolbar copy/paste moves the phrase', async ({ page }) => {
        await openDemo(page);
        await enterPhrase(page);
        const svg = page.locator('.editor-renderer .stave-row svg').first();
        const box = await svg.boundingBox();
        await page.mouse.move(box.x + 40, box.y + 45);
        await page.mouse.down();
        await page.mouse.move(box.x + 200, box.y + 45, { steps: 5 });
        await page.mouse.up();
        await expect(page.locator('.editor-selection-rect').first()).toBeVisible();
        await expect(page.locator('.mode-indicator')).toContainText('VISUAL');

        await page.locator('.copy-button').click();
        await page.keyboard.press('Escape');
        // place cursor in measure 3 and paste
        await page.keyboard.press('Enter'); // next measure
        await page.keyboard.press('Enter');
        await page.locator('.paste-button').click();
        await expect(async () => {
            expect(await page.locator('.note-text').count()).toBeGreaterThanOrEqual(6);
        }).toPass();
    });

    test('right-click menu acts on the phrase (repeat measures)', async ({ page }) => {
        await openDemo(page);
        await enterPhrase(page);
        const svg = page.locator('.editor-renderer .stave-row svg').first();
        const box = await svg.boundingBox();
        await page.mouse.move(box.x + 40, box.y + 45);
        await page.mouse.down();
        await page.mouse.move(box.x + 260, box.y + 45, { steps: 5 });
        await page.mouse.up();

        await page.mouse.click(box.x + 150, box.y + 45, { button: 'right' });
        await expect(page.locator('.otf-context-menu')).toBeVisible();
        await page.locator('.context-repeat').click();
        // repeat signs render as barline dots (circles)
        await expect(async () => {
            expect(await page.locator('.editor-renderer circle').count())
                .toBeGreaterThanOrEqual(4);
        }).toPass();
        // and undo removes the repeat again
        await page.keyboard.press('u');
        await expect(async () => {
            expect(await page.locator('.editor-renderer circle').count()).toBe(0);
        }).toPass();
    });
});

test.describe('create-a-tab flow', () => {
    test('form builds a multi-track editor with a track switcher', async ({ page }) => {
        await page.goto('/create.html');
        await page.fill('#f-title', 'E2E Breakdown');
        await page.locator('#f-instruments input[value="6-string-guitar"]').check();
        await page.locator('#create-form button[type=submit]').click();

        await page.locator('.editor-renderer .stave-row').first().waitFor();
        await expect(page.locator('#editor-title')).toHaveText('E2E Breakdown');
        await expect(page.locator('.track-select')).toBeVisible();

        await page.locator('.track-select').selectOption('guitar');
        await expect(async () => {
            const labels = await page.locator('.stave-row').first()
                .locator('.string-label').count();
            expect(labels).toBe(6);
        }).toPass();
    });

    test('drafts survive a reload (Resume)', async ({ page }) => {
        await page.goto('/create.html');
        await page.fill('#f-title', 'Draft Tune');
        await page.locator('#create-form button[type=submit]').click();
        await page.locator('.editor-renderer .stave-row').first().waitFor();
        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('7'); // triggers onChange → draft save

        await page.reload();
        await expect(page.locator('#draft-banner')).toBeVisible();
        await page.locator('#draft-resume').click();
        await page.locator('.editor-renderer .stave-row').first().waitFor();
        await expect(page.locator('#editor-title')).toHaveText('Draft Tune');
        await expect(page.locator('.note-text').first()).toHaveText('7');
    });
});
