// E2E tests for the visual song editor (tap-to-place chords, sections, tabs)
import { test, expect } from '@playwright/test';

async function openNewSongEditor(page) {
    await page.goto('/#search');
    await page.waitForSelector('#search-input');
    await page.locator('#hamburger-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
    await page.locator('#nav-add-song').click();
    // Add Song opens the picker; pick "Lyrics & Chords" to reach the editor
    await expect(page.locator('#add-song-picker')).toBeVisible();
    await page.locator('#add-song-picker .picker-card[data-type="chordpro"]').click();
    await expect(page.locator('#editor-panel')).toBeVisible();
}

test.describe('Visual editor basics', () => {
    test('visual tab is the default and raw tab toggles', async ({ page }) => {
        await openNewSongEditor(page);
        await expect(page.locator('#editor-tab-visual')).toHaveClass(/active/);
        await expect(page.locator('#visual-editor-container')).toBeVisible();
        await expect(page.locator('#editor-raw-main')).toBeHidden();

        await page.locator('#editor-tab-raw').click();
        await expect(page.locator('#editor-raw-main')).toBeVisible();
        await expect(page.locator('#visual-editor-container')).toBeHidden();
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

    test('typed chord entry: select a syllable, type Am, Enter places the chord', async ({ page }) => {
        await placeReadyLine(page);
        await page.locator('.ve-syl').first().click();
        await expect(page.locator('.ve-palette')).toBeVisible();
        await page.keyboard.type('Am');
        await expect(page.locator('.ve-palette-custom')).toHaveValue('Am');
        await page.keyboard.press('Enter');
        await expect(page.locator('.ve-chip').first()).toHaveText('Am');
        await page.locator('#editor-tab-raw').click();
        expect(await page.locator('#editor-content').inputValue()).toContain('[Am]hello');
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
        // Add Song opens the picker; pick "Lyrics & Chords" to reach the editor
        await expect(page.locator('#add-song-picker')).toBeVisible();
        await page.locator('#add-song-picker .picker-card[data-type="chordpro"]').click();
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
