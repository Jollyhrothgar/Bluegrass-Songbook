// E2E tests for works with tablature on the unified song page.
// The tab dock (G19c) is in the fixed bottom band (#app-bottomband): ▶ · Tempo ·
// View ▾ · Display. Size, Play in, Layout, Feel, Practice and Tracks are in the
// Display sheet; multi-part works reach their parts through View ▾.
import { test, expect } from './fixtures.js';
import { openDock, closeSheet } from './helpers.js';

test.describe('WorkView - Tablature', () => {
    test('opens work with tablature via legacy #song URL', async ({ page }) => {
        // #song/{id} redirects to the song's own path
        await page.goto('/#song/foggy-mountain-breakdown');

        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveURL(/\/songs\/foggy-mountain-breakdown\/$/);
        await expect(page.locator('.song-title')).toContainText(/foggy mountain/i);
    });

    test('legacy slug redirects and part deep link renders tablature', async ({ page }) => {
        // Legacy slug on purpose: cripple-creek-1 was merged into
        // cripple-creek (docs/data/redirects.json); /banjo selects the part.
        await page.goto('/#work/cripple-creek-1/banjo');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        await expect(page.locator('.tablature-container').first()).toBeVisible();
        await expect(page).toHaveURL(/\/#work\/cripple-creek\/banjo$/);
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

        await openDock(page, 'display');   // Practice is in the Display sheet
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

        // Play in is a capo for playback; the dock has no Key of its own
        await expect(page.locator('#app-bottomband #dock-key-btn, #app-bottomband .tab-key-pill')).toHaveCount(0);
        const sheet = await openDock(page, 'display');
        const grid = sheet.locator('#tab-play-in');
        await expect(grid).toBeVisible();
        await grid.locator('.pill-key-btn', { hasText: /^A$/ }).click();

        await expect(sheet.locator('.tab-capo-indicator')).toContainText(/Capo/);
        await expect(sheet.locator('.tab-capo-indicator')).toContainText(/Frets on the page stay as written/);
        await expect(grid.locator('.pill-key-btn.active')).toHaveText('A');
    });
});

test.describe('WorkView - a 2/2 tab', () => {
    // A service worker's fetches skip page routes, and this route must hold
    test.use({ serviceWorkers: 'block' });

    test('counts its BPM in half notes', async ({ page }) => {
        // A frozen 2/2 document stands in for the song's tab: the file's tempo
        // is quarter-note BPM, the band's number is the half-note pulse.
        await page.route('**/data/tabs/foggy-mountain-breakdown-mandolin*', route => route.fulfill({
            json: {
                otf_version: '1.2',
                metadata: { title: 'Cut time', time_signature: '2/2', tempo: 200 },
                timing: { ticks_per_beat: 480 },
                tracks: [{ id: 'banjo', instrument: '5-string-banjo', tuning: ['D4', 'B3', 'G3', 'D3', 'G4'] }],
                notation: { banjo: [{ measure: 1, events: [{ tick: 0, notes: [{ s: 1, f: 0, dur: 240 }] }] }] },
            },
        }));
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        await expect(page.locator('.tab-tempo-display')).toHaveText('100');
        await expect(page.locator('.tab-feel-group')).toHaveCount(0);
    });
});

test.describe('WorkView - View sheet (parts)', () => {
    // lonesome-road-blues-1 has a chordful lead sheet and a banjo tab
    // → View ▾ lists both (many multi-part works have ABC-only lead sheets,
    // which render notation instead of a .song-body)
    const MULTI_PART_URL = '/#work/lonesome-road-blues-1';

    test('View ▾ shows when a work has multiple parts, and lists them', async ({ page }) => {
        await page.goto(MULTI_PART_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.song-body')).toBeVisible();
        await expect(page.locator('#part-tabs')).toHaveCount(0);   // the part tabs are gone

        const sheet = await openDock(page, 'view');
        // The lead sheet is the one on screen
        await expect(sheet.locator('.dock-row.on')).toHaveCount(1);
        await expect(sheet.locator('.dock-row.on')).toContainText(/Lyrics|Chords|Notation/);
        await expect(sheet.locator('.dock-sheet-heading', { hasText: 'Tabs' })).toBeVisible();
        await expect(sheet.locator('[data-part]').first()).toBeVisible();
    });

    test('picking a tab switches content and updates the URL; the tab band can come back', async ({ page }) => {
        await page.goto(MULTI_PART_URL);
        await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });

        const sheet = await openDock(page, 'view');
        const tab = sheet.locator('[data-part]').first();
        const partId = await tab.getAttribute('data-part');
        await tab.click();

        // Tablature renders, the URL carries the part id
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        expect(page.url()).toContain(`#work/lonesome-road-blues-1/${partId}`);

        // The tab dock has its own View ▾, which reaches the lyrics again
        await expect(page.locator('#app-bottomband .tab-view-btn')).toBeVisible();
        await page.locator('#app-bottomband .tab-view-btn').click();
        await page.locator('#song-view-sheet [data-view="lyrics"]').click();
        await expect(page.locator('.song-body')).toBeVisible();
        await expect(page.locator('#dock-key-btn')).toBeVisible();
        await expect(page.locator('#app-bottomband .tab-controls')).toHaveCount(0);
    });

    test('part deep link selects that part directly', async ({ page }) => {
        await page.goto(`${MULTI_PART_URL}/banjo`);
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const sheet = await openDock(page, 'view');
        await expect(sheet.locator('[data-part].on')).toContainText(/banjo/i);
    });
});

test.describe('WorkView - Tablature Playback', () => {
    test('play button toggles to pause state', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        const playBtn = page.locator('.tab-play-btn');
        const stopBtn = page.locator('.tab-stop-btn');

        await expect(playBtn).toHaveText('▶');
        await expect(stopBtn).toBeDisabled();
        await expect(stopBtn).toBeHidden();       // Stop shows once playback has started

        await playBtn.click();

        await expect(playBtn).toHaveText('⏸');
        await expect(stopBtn).toBeEnabled();
        await expect(stopBtn).toBeVisible();
    });

    test('stop button resets to initial state', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });

        await page.locator('.tab-play-btn').click();
        await expect(page.locator('.tab-stop-btn')).toBeEnabled();

        await page.locator('.tab-stop-btn').click();

        await expect(page.locator('.tab-play-btn')).toHaveText('▶');
        await expect(page.locator('.tab-stop-btn')).toBeDisabled();
        await expect(page.locator('.tab-stop-btn')).toBeHidden();
    });
});

test.describe('WorkView - the tab dock is the same on every width', () => {
    // The wide (desktop) project, with only the CONTAINER narrowed: the dock has
    // one layout, so a narrow band keeps it (the old ⚙ collapse is the tab
    // EDITOR's band now; otf-editor-mobile.spec.js).
    const pinBandWidth = (page, px) => page.addStyleTag({
        content: `#app-bottomband { right: auto !important; width: ${px}px !important; }`,
    });

    test('a 480px band keeps ▶ · Tempo · View · Display on one row, with no ⚙', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await pinBandWidth(page, 480);

        const controls = page.locator('#app-bottomband .tab-controls');
        await expect(controls).not.toHaveClass(/is-narrow-band/);
        await expect(page.locator('.tab-more-btn')).toHaveCount(0);
        for (const sel of ['.tab-play-btn', '.tab-tempo-display', '#dock-view-btn', '#dock-display-btn']) {
            await expect(controls.locator(sel), sel).toBeVisible();
        }
        const tops = await controls.evaluate(el => [...el.children]
            .filter(k => k.getBoundingClientRect().width > 0 && !k.classList.contains('tab-position'))
            .map(k => { const r = k.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);   // one row
    });

    test('Display holds Size, Play in, Feel and Practice, and puts them back on close', async ({ page }) => {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        const sheet = await openDock(page, 'display');
        for (const sel of ['#tab-size', '#tab-play-in', '.tab-feel-group', '.tab-loop-toggle', '.tab-metronome-toggle', '.tab-countin-toggle', '#pill-autohide']) {
            await expect(sheet.locator(sel), sel).toBeVisible();
        }
        await closeSheet(page);
        // the controls went back to the band's store, still there, still wired
        await expect(page.locator('#app-bottomband .tab-display-store .tab-metronome-checkbox')).toHaveCount(1);
        await openDock(page, 'display');
        await page.locator('.tab-metronome-toggle').click();
        await expect(page.locator('.tab-metronome-checkbox')).toBeChecked();
    });
});

// Lead sheet controls (Key/Display/Info pills) are covered in song-view.spec.js
