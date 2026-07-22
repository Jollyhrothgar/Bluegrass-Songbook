// E2E tests for ABC Notation rendering and playback.
//
// The full ABC controls (tempo, size, play) live in the SONG view — a work
// with abc_content renders notation there by default. A bare #work/{id} URL
// intentionally shows the work dashboard (part cards); its Fiddle card
// expands ABC inline with a play button only (covered by the last test).
import { test, expect } from '@playwright/test';

const ABC_SONG_URL = '/#song/abbey-reel-the';

// Navigate to the fiddle tune and wait for ABCJS to render the sheet music
async function gotoAbcSong(page) {
    await page.goto(ABC_SONG_URL);
    // Generous timeout: cold app boot parses the ~50MB index before routing,
    // which can be slow when all Playwright workers boot at once
    await page.locator('#abc-notation svg').first().waitFor({ timeout: 30000 });
}

test.describe('ABC Notation Display', () => {
    test('song with ABC notation renders sheet music', async ({ page }) => {
        await gotoAbcSong(page);

        await expect(page.locator('#song-view')).toBeVisible();
        await expect(page.locator('#abc-notation svg').first()).toBeVisible();
    });

    test('ABC notation shows playback controls', async ({ page }) => {
        await gotoAbcSong(page);

        const playBtn = page.locator('#abc-play-btn');
        await expect(playBtn).toBeVisible();
        const btnText = await playBtn.textContent();
        expect(btnText?.includes('▶') || btnText?.includes('Play')).toBeTruthy();
    });

    test('ABC tempo controls are visible', async ({ page }) => {
        await gotoAbcSong(page);

        // Tempo is a read-only label between −/+ buttons in the quick controls
        await expect(page.locator('#abc-speed-decrease')).toBeVisible();
        await expect(page.locator('#abc-tempo-label')).toBeVisible();
        await expect(page.locator('#abc-speed-increase')).toBeVisible();

        const tempoValue = parseInt(await page.locator('#abc-tempo-label').textContent(), 10);
        expect(tempoValue).toBeGreaterThanOrEqual(60);
        expect(tempoValue).toBeLessThanOrEqual(240);
    });
});

test.describe('ABC Tempo Controls', () => {
    test('increasing tempo updates display', async ({ page }) => {
        await gotoAbcSong(page);

        const tempoLabel = page.locator('#abc-tempo-label');
        const initialTempo = parseInt(await tempoLabel.textContent(), 10);

        await page.locator('#abc-speed-increase').click();
        await expect(tempoLabel).toHaveText(String(initialTempo + 10));
    });

    test('decreasing tempo updates display', async ({ page }) => {
        await gotoAbcSong(page);

        const tempoLabel = page.locator('#abc-tempo-label');
        const initialTempo = parseInt(await tempoLabel.textContent(), 10);

        await page.locator('#abc-speed-decrease').click();
        await expect(tempoLabel).toHaveText(String(initialTempo - 10));
    });

    test('tempo has minimum limit of 60', async ({ page }) => {
        await gotoAbcSong(page);

        const tempoLabel = page.locator('#abc-tempo-label');
        const decreaseBtn = page.locator('#abc-speed-decrease');

        // Click down (10 BPM per click) until the floor disables the button
        for (let i = 0; i < 25 && !(await decreaseBtn.isDisabled()); i++) {
            await decreaseBtn.click();
        }

        await expect(tempoLabel).toHaveText('60');
        await expect(decreaseBtn).toBeDisabled();
        await expect(page.locator('#abc-speed-increase')).toBeEnabled();
    });

    test('tempo has maximum limit of 240', async ({ page }) => {
        await gotoAbcSong(page);

        const tempoLabel = page.locator('#abc-tempo-label');
        const increaseBtn = page.locator('#abc-speed-increase');

        for (let i = 0; i < 25 && !(await increaseBtn.isDisabled()); i++) {
            await increaseBtn.click();
        }

        await expect(tempoLabel).toHaveText('240');
        await expect(increaseBtn).toBeDisabled();
        await expect(page.locator('#abc-speed-decrease')).toBeEnabled();
    });
});

test.describe('ABC Playback', () => {
    test('play button starts playback', async ({ page }) => {
        await gotoAbcSong(page);

        const playBtn = page.locator('#abc-play-btn');
        await expect(playBtn).toBeVisible();

        await playBtn.click();
        await page.waitForTimeout(500);

        // Loading (⏳, soundfont fetch in flight) or playing (■). The synth
        // pulls a remote soundfont, so allow the loading state to linger.
        const btnText = (await playBtn.textContent())?.trim() || '';
        expect(['■', '⏳', 'Stop']).toContain(btnText);
    });

    test('clicking play again stops playback', async ({ page }) => {
        await gotoAbcSong(page);

        const playBtn = page.locator('#abc-play-btn');
        await playBtn.click();
        await page.waitForTimeout(1000);

        // If playback started (button shows stop), click again to stop
        const btnTextAfterPlay = await playBtn.textContent();
        if (btnTextAfterPlay?.includes('■')) {
            await playBtn.click();
            await page.waitForTimeout(500);

            const btnTextAfterStop = await playBtn.textContent();
            expect(btnTextAfterStop).toContain('▶');
        }
    });
});

test.describe('ABC on Work Dashboard', () => {
    test('work dashboard expands Fiddle part with inline ABC and play button', async ({ page }) => {
        // Bare #work/ URL shows the dashboard with part cards
        await page.goto('/#work/abbey-reel-the');
        const fiddleCard = page.locator('.work-part-card').filter({ hasText: /fiddle/i }).first();
        await fiddleCard.waitFor({ timeout: 15000 });
        await fiddleCard.click();

        // Inline expansion renders ABC with a play button
        await expect(page.locator('#work-abc-notation svg').first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#abc-play-btn')).toBeVisible();
    });
});
