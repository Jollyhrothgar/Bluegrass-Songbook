// E2E tests for WorkView (works with tablature)
import { test, expect } from '@playwright/test';

/**
 * Helper to expand the Controls disclosure if it's collapsed
 */
async function expandControls(page) {
    // Controls toggle button has id="work-controls-toggle" or "qc-toggle"
    const controlsToggle = page.locator('#work-controls-toggle, #qc-toggle');
    const controlsContent = page.locator('#work-controls-content, #quick-controls-content');

    // Check if controls exist and are collapsed
    if (await controlsToggle.count() > 0) {
        // If content is hidden, click to expand
        const isHidden = await controlsContent.evaluate(el => el?.classList.contains('hidden'));
        if (isHidden) {
            await controlsToggle.click();
            // Wait for controls to become visible
            await page.waitForTimeout(200);
        }
    }
}

test.describe('WorkView - Tablature', () => {
    test('opens work with tablature via URL', async ({ page }) => {
        // Navigate directly to a work with tablature
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.waitForTimeout(1000);

        // Song view should be visible
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 10000 });

        // Should show the title
        await expect(page.locator('.work-title, .song-title')).toContainText(/foggy mountain/i);
    });

    test('displays tablature container for tab-only works', async ({ page }) => {
        await page.goto('/#work/angeline-the-baker');
        await page.locator('.tablature-container').waitFor();

        // Should have tablature container
        await expect(page.locator('.tablature-container')).toBeVisible();
    });

    test('tablature renders stave rows with notes', async ({ page }) => {
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.locator('.tablature-container').waitFor();

        // Should have at least one row of tab
        const staveRows = page.locator('.stave-row');
        const rowCount = await staveRows.count();
        expect(rowCount).toBeGreaterThanOrEqual(1);

        // Should have note elements
        const notes = page.locator('.note-text');
        const noteCount = await notes.count();
        expect(noteCount).toBeGreaterThanOrEqual(5);
    });

    test('work URL loads tablature directly', async ({ page }) => {
        // angeline-the-baker is a tab-only work
        await page.goto('/#work/angeline-the-baker');
        await page.locator('.tablature-container').waitFor();

        // Tablature should be visible
        await expect(page.locator('.tablature-container')).toBeVisible();

        // Expand controls to access playback controls
        await expandControls(page);
        await expect(page.locator('.tab-play-btn')).toBeVisible();
    });

    test('tablature controls are present', async ({ page }) => {
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.waitForTimeout(1000);

        // Expand controls disclosure
        await expandControls(page);

        // Should have play button
        const playBtn = page.locator('.tab-play-btn');
        await expect(playBtn).toBeVisible();

        // Should have tempo controls (display is now a span, not input)
        await expect(page.locator('.tab-tempo-display')).toBeVisible();
        await expect(page.locator('.tab-tempo-down')).toBeVisible();
        await expect(page.locator('.tab-tempo-up')).toBeVisible();
    });

    test('tempo controls adjust tempo value', async ({ page }) => {
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.waitForTimeout(1000);

        // Expand controls disclosure
        await expandControls(page);

        const tempoDisplay = page.locator('.tab-tempo-display');
        const tempoUp = page.locator('.tab-tempo-up');
        const tempoDown = page.locator('.tab-tempo-down');

        // Get initial tempo (now from text content, not input value)
        const initialTempo = await tempoDisplay.textContent();
        const initial = parseInt(initialTempo, 10);

        // Click tempo up
        await tempoUp.click();
        await expect(tempoDisplay).toHaveText(String(initial + 5));

        // Click tempo down twice
        await tempoDown.click();
        await tempoDown.click();
        await expect(tempoDisplay).toHaveText(String(initial - 5));
    });

    test('metronome toggle exists and is clickable', async ({ page }) => {
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.waitForTimeout(1000);

        // Expand controls disclosure
        await expandControls(page);

        // The checkbox may be hidden but the label/icon is visible
        const metronomeLabel = page.locator('.tab-metronome-toggle');
        const metronomeCheckbox = page.locator('.tab-metronome-checkbox');

        // Check the label/toggle is visible
        await expect(metronomeLabel).toBeVisible({ timeout: 10000 });

        // Toggle on by clicking the label
        await metronomeLabel.click();
        await expect(metronomeCheckbox).toBeChecked();

        // Toggle off
        await metronomeLabel.click();
        await expect(metronomeCheckbox).not.toBeChecked();
    });

    test('key selector shows capo indicator', async ({ page }) => {
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.waitForTimeout(1000);

        const keySelect = page.locator('.tab-key-select');
        if (await keySelect.isVisible()) {
            // Change to a different key
            await keySelect.selectOption('A');
            await page.waitForTimeout(100);

            // Capo indicator should update
            const capoIndicator = page.locator('.tab-capo-indicator');
            await expect(capoIndicator).toContainText(/Capo/);
        }
    });
});

test.describe('WorkView - Part Selector', () => {
    test('part selector shows when multiple parts exist', async ({ page }) => {
        // Find a work with multiple parts (lead sheet + tablature)
        // cripple-creek has both lead sheet and tablature
        await page.goto('/#song/cripple-creek');
        await page.waitForTimeout(1000);

        // If the work has multiple parts, selector should be visible
        const partSelector = page.locator('.part-selector');
        const partTabs = page.locator('.part-tab');

        // Check if selector exists (may have 0 or more parts)
        const count = await partTabs.count();
        if (count > 1) {
            await expect(partSelector).toBeVisible();
        }
    });

    test('clicking part tab switches content', async ({ page }) => {
        await page.goto('/#song/cripple-creek');
        await page.waitForTimeout(1000);

        const partTabs = page.locator('.part-tab');
        const count = await partTabs.count();

        if (count > 1) {
            // Click second part tab
            await partTabs.nth(1).click();
            await page.waitForTimeout(300);

            // URL should update with part
            expect(page.url()).toMatch(/#(work|song)\/cripple-creek\/parts\//);
        }
    });
});

test.describe('WorkView - Tablature Playback', () => {
    test('play button toggles to pause state', async ({ page }) => {
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.waitForTimeout(1000);

        // Expand controls disclosure
        await expandControls(page);

        const playBtn = page.locator('.tab-play-btn');
        const stopBtn = page.locator('.tab-stop-btn');

        // Initial state
        await expect(playBtn).toContainText('Play');
        await expect(stopBtn).toBeDisabled();

        // Click play - button state changes immediately
        await playBtn.click();

        await expect(playBtn).toContainText('Pause');
        await expect(stopBtn).toBeEnabled();
    });

    test('stop button resets to initial state', async ({ page }) => {
        await page.goto('/#song/foggy-mountain-breakdown');
        await page.waitForTimeout(1000);

        // Expand controls disclosure
        await expandControls(page);

        // Start playback
        await page.locator('.tab-play-btn').click();
        await expect(page.locator('.tab-stop-btn')).toBeEnabled();

        // Stop
        await page.locator('.tab-stop-btn').click();

        await expect(page.locator('.tab-play-btn')).toContainText('Play');
        await expect(page.locator('.tab-stop-btn')).toBeDisabled();
    });
});

// Lead sheet tests are covered in song-view.spec.js
// (key selector, transposition, Nashville mode, chord display modes)
