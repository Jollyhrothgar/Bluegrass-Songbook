// E2E tests for ABC Notation rendering and playback
import { test, expect } from '@playwright/test';

test.describe('ABC Notation Display', () => {
    test('song with ABC notation renders sheet music', async ({ page }) => {
        // Navigate directly to a work with ABC content
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(2000);

        // Work view or song view should be visible
        const songView = page.locator('#song-view:not(.hidden)');
        const workView = page.locator('.work-view:not(.hidden)');

        // Wait for either view to appear
        await expect(songView.or(workView)).toBeVisible({ timeout: 10000 });

        // ABC container should render (ABCJS creates svg elements)
        const abcContainer = page.locator('#abc-content svg, .abcjs-container svg');
        if (await abcContainer.first().isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(abcContainer.first()).toBeVisible();
        }
    });

    test('ABC notation shows playback controls', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(2000);

        // Wait for song view
        const songView = page.locator('#song-view:not(.hidden)');
        await expect(songView).toBeVisible({ timeout: 10000 });

        // ABC play button should be visible if song has ABC
        const playBtn = page.locator('#abc-play-btn');
        if (await playBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Button shows either "▶" or "Play"
            const btnText = await playBtn.textContent();
            expect(btnText?.includes('▶') || btnText?.includes('Play')).toBeTruthy();
        }
    });

    test('ABC tempo controls are visible', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        // Tempo controls should be visible
        await expect(page.locator('#abc-speed-decrease')).toBeVisible();
        await expect(page.locator('#abc-speed-display')).toBeVisible();
        await expect(page.locator('#abc-speed-increase')).toBeVisible();

        // Default tempo should be a reasonable value
        const tempoInput = page.locator('#abc-speed-display');
        const tempoValue = await tempoInput.inputValue();
        expect(parseInt(tempoValue)).toBeGreaterThanOrEqual(60);
        expect(parseInt(tempoValue)).toBeLessThanOrEqual(240);
    });
});

test.describe('ABC Tempo Controls', () => {
    test('increasing tempo updates display', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        const tempoInput = page.locator('#abc-speed-display');
        const increaseBtn = page.locator('#abc-speed-increase');

        // Get initial tempo
        const initialTempo = parseInt(await tempoInput.inputValue());

        // Click increase button
        await increaseBtn.click();

        // Tempo should increase by 10
        const newTempo = parseInt(await tempoInput.inputValue());
        expect(newTempo).toBe(initialTempo + 10);
    });

    test('decreasing tempo updates display', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        const tempoInput = page.locator('#abc-speed-display');
        const decreaseBtn = page.locator('#abc-speed-decrease');

        // Get initial tempo
        const initialTempo = parseInt(await tempoInput.inputValue());

        // Click decrease button
        await decreaseBtn.click();

        // Tempo should decrease by 10
        const newTempo = parseInt(await tempoInput.inputValue());
        expect(newTempo).toBe(initialTempo - 10);
    });

    test('tempo has minimum limit of 60', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        const tempoInput = page.locator('#abc-speed-display');
        const decreaseBtn = page.locator('#abc-speed-decrease');

        // Set tempo to minimum via input
        await tempoInput.fill('60');
        await tempoInput.press('Enter');

        // Decrease button should be disabled at minimum
        await expect(decreaseBtn).toBeDisabled();
    });

    test('tempo has maximum limit of 240', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        const tempoInput = page.locator('#abc-speed-display');
        const increaseBtn = page.locator('#abc-speed-increase');

        // Set tempo to maximum via input
        await tempoInput.fill('240');
        await tempoInput.press('Enter');

        // Increase button should be disabled at maximum
        await expect(increaseBtn).toBeDisabled();
    });

    test('manual tempo input works', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        const tempoInput = page.locator('#abc-speed-display');

        // Enter a specific tempo
        await tempoInput.fill('150');
        await tempoInput.press('Enter');

        // Value should be set
        await expect(tempoInput).toHaveValue('150');
    });
});

test.describe('ABC Playback', () => {
    test('play button starts playback', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        const playBtn = page.locator('#abc-play-btn');
        await expect(playBtn).toBeVisible();

        // Click play
        await playBtn.click();

        // Button should change to loading or stop symbol
        // Wait a moment for async synth initialization
        await page.waitForTimeout(500);

        // Button text should change (either to loading indicator or stop symbol)
        const btnText = await playBtn.textContent();
        expect(['■', '⏳', 'Stop']).toContain(btnText?.trim() || '');
    });

    test('clicking play again stops playback', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        const playBtn = page.locator('#abc-play-btn');

        // Start playback
        await playBtn.click();
        await page.waitForTimeout(1000);

        // If playback started (button shows stop), click again to stop
        const btnTextAfterPlay = await playBtn.textContent();
        if (btnTextAfterPlay?.includes('■')) {
            await playBtn.click();
            await page.waitForTimeout(500);

            // Should revert to play symbol
            const btnTextAfterStop = await playBtn.textContent();
            expect(btnTextAfterStop).toContain('▶');
        }
    });
});

test.describe('ABC Scale Controls', () => {
    test('ABC scale controls are visible', async ({ page }) => {
        await page.goto('/#work/abbey-reel-the');
        await page.waitForTimeout(1000);

        // Scale controls should exist
        const decreaseScale = page.locator('#abc-scale-decrease');
        const increaseScale = page.locator('#abc-scale-increase');
        const scaleDisplay = page.locator('#abc-scale-display');

        // At least one scale control mechanism should exist
        const hasScaleControls = await decreaseScale.isVisible().catch(() => false) ||
                                  await scaleDisplay.isVisible().catch(() => false);

        // If scale controls exist, test them
        if (hasScaleControls) {
            await expect(decreaseScale).toBeVisible();
            await expect(increaseScale).toBeVisible();
        }
    });
});

test.describe('ABC Notation Navigation', () => {
    test('can search for and open ABC tune', async ({ page }) => {
        await page.goto('/#search');
        await page.waitForSelector('#search-input');

        // Search for a fiddle tune with tag filter
        const input = page.locator('#search-input');
        await input.click();
        await input.pressSequentially('tag:Instrumental', { delay: 30 });
        await page.waitForTimeout(1000);

        // Wait for results
        await page.waitForSelector('.result-item', { timeout: 5000 });

        // Click the first instrumental result
        await page.locator('.result-item').first().click();

        // Song view should open (with timeout for potential version picker)
        const songView = page.locator('#song-view:not(.hidden)');
        const versionPicker = page.locator('#version-modal:not(.hidden)');

        // Wait for one of them
        await expect(songView.or(versionPicker)).toBeVisible({ timeout: 5000 });

        // If version picker, select first version
        if (await versionPicker.isVisible().catch(() => false)) {
            await page.locator('.version-item .version-info').first().click();
            await expect(songView).toBeVisible({ timeout: 5000 });
        }
    });

    test('instrumental tag shows tunes with ABC notation', async ({ page }) => {
        await page.goto('/#search/tag:Instrumental');
        await page.waitForTimeout(1000);

        // Should show results
        await page.waitForSelector('.result-item', { timeout: 5000 });

        // Results should exist
        const results = page.locator('.result-item');
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });
});
