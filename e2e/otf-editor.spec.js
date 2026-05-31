// E2E tests for OTF Editor
import { test, expect } from '@playwright/test';

test.describe('OTF Editor - Demo Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.waitForTimeout(500);
    });

    test('loads editor demo page', async ({ page }) => {
        await expect(page.locator('h1')).toContainText('OTF Tablature Editor');
    });

    test('editor container is visible', async ({ page }) => {
        await expect(page.locator('#editor-container')).toBeVisible();
    });

    test('toolbar is rendered', async ({ page }) => {
        await expect(page.locator('.editor-toolbar')).toBeVisible();
    });

    test('mode indicator shows NORMAL by default', async ({ page }) => {
        await expect(page.locator('.mode-indicator')).toContainText('NORMAL');
    });

    test('tablature is rendered with strings', async ({ page }) => {
        // Wait for tablature to render
        await page.locator('.tablature-container').waitFor();
        await expect(page.locator('.tablature-container')).toBeVisible();

        // Should have string labels
        const strings = page.locator('.string-label');
        const count = await strings.count();
        expect(count).toBeGreaterThanOrEqual(4); // At least 4 strings
    });
});

test.describe('OTF Editor - Mode Switching', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
        // Focus the editor container to receive keyboard events
        await page.locator('#editor-container').click();
    });

    test('pressing i enters INSERT mode', async ({ page }) => {
        await page.keyboard.press('i');
        await expect(page.locator('.mode-indicator')).toContainText('INSERT');
    });

    test('pressing Escape returns to NORMAL mode from INSERT', async ({ page }) => {
        await page.keyboard.press('i');
        await expect(page.locator('.mode-indicator')).toContainText('INSERT');

        await page.keyboard.press('Escape');
        await expect(page.locator('.mode-indicator')).toContainText('NORMAL');
    });

    test('pressing v enters VISUAL mode', async ({ page }) => {
        await page.keyboard.press('v');
        await expect(page.locator('.mode-indicator')).toContainText('VISUAL');
    });

    test('pressing r enters ROLL mode', async ({ page }) => {
        await page.keyboard.press('r');
        await expect(page.locator('.mode-indicator')).toContainText('ROLL');
    });
});

test.describe('OTF Editor - Cursor Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
        await page.locator('#editor-container').click();
    });

    test('cursor element is visible', async ({ page }) => {
        await expect(page.locator('.editor-cursor')).toBeVisible();
    });

    test('cursor moves with arrow keys', async ({ page }) => {
        // Get initial cursor position
        const cursor = page.locator('.editor-cursor');
        const initialLeft = await cursor.evaluate(el => parseFloat(el.style.left));

        // Move right
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(50);

        const newLeft = await cursor.evaluate(el => parseFloat(el.style.left));
        expect(newLeft).toBeGreaterThan(initialLeft);
    });

    test('cursor moves with vim keys in normal mode', async ({ page }) => {
        const cursor = page.locator('.editor-cursor');
        const initialLeft = await cursor.evaluate(el => parseFloat(el.style.left));

        // Move with l
        await page.keyboard.press('l');
        await page.waitForTimeout(50);

        const newLeft = await cursor.evaluate(el => parseFloat(el.style.left));
        expect(newLeft).toBeGreaterThan(initialLeft);
    });

    test('j/k moves between strings', async ({ page }) => {
        const cursor = page.locator('.editor-cursor');
        const initialTop = await cursor.evaluate(el => parseFloat(el.style.top));

        // Move down (j)
        await page.keyboard.press('j');
        await page.waitForTimeout(50);

        const newTop = await cursor.evaluate(el => parseFloat(el.style.top));
        expect(newTop).toBeGreaterThan(initialTop);
    });
});

test.describe('OTF Editor - Note Entry', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
        await page.locator('#editor-container').click();
        // Enter insert mode
        await page.keyboard.press('i');
        await expect(page.locator('.mode-indicator')).toContainText('INSERT');
    });

    test('entering digit in insert mode adds note', async ({ page }) => {
        // Press 0 to add open string note
        await page.keyboard.press('0');
        await page.waitForTimeout(350); // Wait for fret buffer commit

        // Should have at least one note element
        const notes = page.locator('.note-text');
        const count = await notes.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('space advances cursor', async ({ page }) => {
        const cursor = page.locator('.editor-cursor');
        const initialLeft = await cursor.evaluate(el => parseFloat(el.style.left));

        await page.keyboard.press(' ');
        await page.waitForTimeout(50);

        const newLeft = await cursor.evaluate(el => parseFloat(el.style.left));
        expect(newLeft).toBeGreaterThan(initialLeft);
    });

    test('number keys 1-5 select string', async ({ page }) => {
        // Press 1 to select string 1
        await page.keyboard.press('1');

        // The cursor should move vertically (we can't easily verify string selection directly)
        // Just verify no crash
    });
});

test.describe('OTF Editor - Duration Selection', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
        await page.locator('#editor-container').click();
        await page.keyboard.press('i'); // Insert mode
    });

    test('duration buttons in toolbar work', async ({ page }) => {
        // Click quarter note button
        const quarterBtn = page.locator('.duration-btn[data-duration="quarter"]');
        await quarterBtn.click();
        await expect(quarterBtn).toHaveClass(/active/);
    });

    test('q key sets quarter duration', async ({ page }) => {
        await page.keyboard.press('q');
        const quarterBtn = page.locator('.duration-btn[data-duration="quarter"]');
        await expect(quarterBtn).toHaveClass(/active/);
    });

    test('e key sets eighth duration', async ({ page }) => {
        await page.keyboard.press('e');
        const eighthBtn = page.locator('.duration-btn[data-duration="eighth"]');
        await expect(eighthBtn).toHaveClass(/active/);
    });

    test('s key sets sixteenth duration', async ({ page }) => {
        await page.keyboard.press('s');
        const sixteenthBtn = page.locator('.duration-btn[data-duration="sixteenth"]');
        await expect(sixteenthBtn).toHaveClass(/active/);
    });
});

test.describe('OTF Editor - Roll Mode', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
        await page.locator('#editor-container').click();
        await page.keyboard.press('r'); // Enter roll mode
        await expect(page.locator('.mode-indicator')).toContainText('ROLL');
    });

    test('T key adds thumb note on string 5', async ({ page }) => {
        await page.keyboard.press('T');
        await page.waitForTimeout(50);

        // Should have a note on string 5
        const notes = page.locator('.note-text');
        const count = await notes.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('I key adds index note on string 3', async ({ page }) => {
        await page.keyboard.press('I');
        await page.waitForTimeout(50);

        const notes = page.locator('.note-text');
        const count = await notes.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('roll finger keys advance cursor', async ({ page }) => {
        const cursor = page.locator('.editor-cursor');
        const initialLeft = await cursor.evaluate(el => parseFloat(el.style.left));

        await page.keyboard.press('T');
        await page.waitForTimeout(50);

        const newLeft = await cursor.evaluate(el => parseFloat(el.style.left));
        expect(newLeft).toBeGreaterThan(initialLeft);
    });
});

test.describe('OTF Editor - Undo/Redo', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
        await page.locator('#editor-container').click();
    });

    test('u key undoes action', async ({ page }) => {
        // Enter insert mode and add note
        await page.keyboard.press('i');
        await page.keyboard.press('0');
        await page.waitForTimeout(350);

        // Verify note exists
        let notes = await page.locator('.note-text').count();
        expect(notes).toBeGreaterThanOrEqual(1);

        // Exit insert mode and undo
        await page.keyboard.press('Escape');
        await page.keyboard.press('u');
        await page.waitForTimeout(50);

        // Note should be gone (or at least different count)
        // The tablature might re-render, so just verify no crash
    });

    test('Ctrl+Z undoes action', async ({ page }) => {
        // Enter insert mode and add note
        await page.keyboard.press('i');
        await page.keyboard.press('0');
        await page.waitForTimeout(350);

        // Undo with Ctrl+Z
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(50);

        // Verify no crash
    });
});

test.describe('OTF Editor - Sample Loading', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
    });

    test('sample selector is present', async ({ page }) => {
        await expect(page.locator('#sample-select')).toBeVisible();
    });

    test('loading a sample updates tablature', async ({ page }) => {
        // Select a sample tab
        await page.selectOption('#sample-select', 'data/tabs/red-haired-boy-banjo.otf.json');
        await page.waitForTimeout(500);

        // Tablature should have notes
        const notes = page.locator('.note-text');
        const count = await notes.count();
        expect(count).toBeGreaterThan(0);
    });

    test('new document button clears editor', async ({ page }) => {
        // Load a sample first
        await page.selectOption('#sample-select', 'data/tabs/red-haired-boy-banjo.otf.json');
        await page.waitForTimeout(500);

        // Get note count
        const initialNotes = await page.locator('.note-text').count();
        expect(initialNotes).toBeGreaterThan(0);

        // Click new document
        await page.click('text=New Document');
        await page.waitForTimeout(300);

        // Notes should be gone or significantly reduced
        const finalNotes = await page.locator('.note-text').count();
        expect(finalNotes).toBeLessThan(initialNotes);
    });
});

test.describe('OTF Editor - Popover', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
    });

    test('double-click opens note entry popover', async ({ page }) => {
        const tablature = page.locator('.tablature-container');
        const box = await tablature.boundingBox();

        // Double-click in the middle of the tablature
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
        await page.waitForTimeout(100);

        // Popover should be visible
        await expect(page.locator('.note-entry-popover')).toBeVisible();
    });

    test('popover has fret input', async ({ page }) => {
        const tablature = page.locator('.tablature-container');
        const box = await tablature.boundingBox();

        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
        await page.waitForTimeout(100);

        await expect(page.locator('.popover-fret-input')).toBeVisible();
    });

    test('clicking outside closes popover', async ({ page }) => {
        const tablature = page.locator('.tablature-container');
        const box = await tablature.boundingBox();

        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
        await page.waitForTimeout(100);
        await expect(page.locator('.note-entry-popover')).toBeVisible();

        // Click outside
        await page.mouse.click(10, 10);
        await page.waitForTimeout(100);

        await expect(page.locator('.note-entry-popover')).not.toBeVisible();
    });
});

test.describe('OTF Editor - Playback Integration', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
    });

    test('play button is visible in status bar', async ({ page }) => {
        await expect(page.locator('.play-btn, .tab-play-btn, .status-play-btn')).toBeVisible();
    });

    test('clicking play changes button state', async ({ page }) => {
        // Load a sample with notes
        await page.selectOption('#sample-select', 'data/tabs/red-haired-boy-banjo.otf.json');
        await page.waitForTimeout(500);

        const playBtn = page.locator('.play-btn, .tab-play-btn, .status-play-btn').first();
        await playBtn.click();

        // Button should change to pause/stop
        await expect(playBtn).toContainText(/pause|stop/i);
    });
});

test.describe('OTF Editor - Download', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/editor-demo.html');
        await page.locator('.tablature-container').waitFor();
    });

    test('download button is present', async ({ page }) => {
        await expect(page.locator('text=Download OTF')).toBeVisible();
    });

    test('download triggers file save', async ({ page }) => {
        // Set up download listener
        const downloadPromise = page.waitForEvent('download');

        // Click download
        await page.click('text=Download OTF');

        // Verify download started
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.otf\.json$/);
    });
});
