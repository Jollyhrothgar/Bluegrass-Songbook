// E2E tests for works with tablature on the unified song page.
// Tablature playback controls live in the fixed bottom band
// (#app-bottomband); multi-part works get a .part-tabs segmented control.
import { test, expect } from '@playwright/test';

test.describe('WorkView - Tablature', () => {
    test('opens work with tablature via legacy #song URL', async ({ page }) => {
        // #song/{id} redirects to the unified #work page
        await page.goto('/#song/foggy-mountain-breakdown');

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveURL(/#work\/foggy-mountain-breakdown/);
        await expect(page.locator('.song-title')).toContainText(/foggy mountain/i);
    });

    test('legacy slug redirects and part deep link renders tablature', async ({ page }) => {
        // Legacy slug on purpose: angeline-the-baker redirects to
        // angeline-baker (URL-stability promise); /banjo selects the part.
        await page.goto('/#work/angeline-the-baker/banjo');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        await expect(page.locator('.tablature-container').first()).toBeVisible();
        await expect(page).toHaveURL(/#work\/angeline-baker/);
    });

    test('tablature renders stave rows with notes', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const rowCount = await page.locator('.stave-row').count();
        expect(rowCount).toBeGreaterThanOrEqual(1);

        const noteCount = await page.locator('.note-text').count();
        expect(noteCount).toBeGreaterThanOrEqual(5);
    });

    test('playback controls live in the bottom band', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const band = page.locator('#app-bottomband');
        await expect(band).toBeVisible();
        await expect(band.locator('.tab-play-btn')).toBeVisible();
        await expect(band.locator('.tab-tempo-display')).toBeVisible();
        await expect(band.locator('.tab-tempo-down')).toBeVisible();
        await expect(band.locator('.tab-tempo-up')).toBeVisible();
    });

    test('tempo controls adjust tempo value', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const tempoDisplay = page.locator('.tab-tempo-display');
        const initial = parseInt(await tempoDisplay.textContent(), 10);

        await page.locator('.tab-tempo-up').click();
        await expect(tempoDisplay).toHaveText(String(initial + 5));

        await page.locator('.tab-tempo-down').click();
        await page.locator('.tab-tempo-down').click();
        await expect(tempoDisplay).toHaveText(String(initial - 5));
    });

    test('metronome toggle exists and is clickable', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const metronomeLabel = page.locator('.tab-metronome-toggle');
        const metronomeCheckbox = page.locator('.tab-metronome-checkbox');

        await expect(metronomeLabel).toBeVisible({ timeout: 10000 });

        await metronomeLabel.click();
        await expect(metronomeCheckbox).toBeChecked();

        await metronomeLabel.click();
        await expect(metronomeCheckbox).not.toBeChecked();
    });

    test('key selector shows capo indicator', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const keyPill = page.locator('.tab-key-pill');
        await expect(keyPill).toBeVisible();

        await keyPill.locator('.pill-btn').click();
        await keyPill.locator('.pill-key-btn', { hasText: /^A$/ }).click();
        await page.waitForTimeout(100);

        await expect(page.locator('.tab-capo-indicator')).toContainText(/Capo/);
    });
});

test.describe('WorkView - Part Tabs', () => {
    // lonesome-road-blues-1 has a chordful lead sheet and a banjo tab
    // → two part tabs (many multi-part works have ABC-only lead sheets,
    // which render notation instead of a .song-body)
    const MULTI_PART_URL = '/#work/lonesome-road-blues-1';

    test('segmented control shows when a work has multiple parts', async ({ page }) => {
        await page.goto(MULTI_PART_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const partTabs = page.locator('#part-tabs .part-tab');
        expect(await partTabs.count()).toBeGreaterThanOrEqual(2);
        // The default (lead sheet) tab is active
        await expect(page.locator('#part-tabs .part-tab.active')).toHaveCount(1);
        await expect(page.locator('.song-body')).toBeVisible();
    });

    test('clicking a part tab switches content and updates the URL', async ({ page }) => {
        await page.goto(MULTI_PART_URL);
        await expect(page.locator('#part-tabs .part-tab').nth(1)).toBeVisible({ timeout: 15000 });

        const secondTab = page.locator('#part-tabs .part-tab').nth(1);
        const partId = await secondTab.getAttribute('data-part-id');
        await secondTab.click();

        // Tab becomes active, tablature renders, URL carries the part id
        await expect(secondTab).toHaveClass(/active/);
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        expect(page.url()).toContain(`#work/lonesome-road-blues-1/${partId}`);

        // Switching back restores the lead sheet and tears down the band
        await page.locator('#part-tabs .part-tab').first().click();
        await expect(page.locator('.song-body')).toBeVisible();
        await expect(page.locator('#app-bottomband')).toBeHidden();
    });

    test('part deep link selects that part directly', async ({ page }) => {
        await page.goto(`${MULTI_PART_URL}/banjo`);
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        await expect(page.locator('#part-tabs .part-tab.active')).toContainText(/banjo/i);
    });
});

test.describe('WorkView - Tablature Playback', () => {
    test('play button toggles to pause state', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const playBtn = page.locator('.tab-play-btn');
        const stopBtn = page.locator('.tab-stop-btn');

        await expect(playBtn).toContainText('Play');
        await expect(stopBtn).toBeDisabled();

        await playBtn.click();

        await expect(playBtn).toContainText('Pause');
        await expect(stopBtn).toBeEnabled();
    });

    test('stop button resets to initial state', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        await page.locator('.tab-play-btn').click();
        await expect(page.locator('.tab-stop-btn')).toBeEnabled();

        await page.locator('.tab-stop-btn').click();

        await expect(page.locator('.tab-play-btn')).toContainText('Play');
        await expect(page.locator('.tab-stop-btn')).toBeDisabled();
    });
});

// Lead sheet controls (Key/Display/Info pills) are covered in song-view.spec.js
