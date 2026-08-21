// Automatic duration, end to end — TablEdit's manual, driven by keys.
//
// The rule under test (note_menu.shtml, "Automatic duration"): a note
// with something after it in the measure lasts until that thing; the
// measure's LAST note takes **the same value as the interval before
// it**; only a note with nothing before it fills the bar. What the last
// note no longer covers is silence, and the renderer draws it as rests.
//
// The document is read through the editor's debug handle
// (`.otf-editor.__otfEditor.state.facade`) rather than inferred from
// pixels, so a failure names the wrong tick, not a wrong screenshot.
import { test, expect } from '@playwright/test';

async function openDemo(page) {
    await page.goto('/editor-demo.html');
    await page.locator('.editor-renderer .stave-row').first().waitFor();
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
    await page.keyboard.press('Control+Home');   // measure 1, tick 0
}

/** [[tick, [dur, ...]], ...] for one measure of the edited track. */
const measure = (page, n = 1) => page.evaluate((num) => {
    const facade = document.querySelector('.otf-editor').__otfEditor.state.facade;
    const m = facade.getMeasure(num);
    return (m?.events || []).map(e => [e.tick, e.notes.map(x => x.dur)]);
}, n);

test.describe('automatic duration — the manual, by keyboard', () => {
    test('type at beat 1, step an eighth, type: TWO EIGHTHS', async ({ page }) => {
        await openDemo(page);
        await page.keyboard.press('=');            // automatic duration

        // "if you enter a note at the very first position in a measure
        //  ... it will automatically be displayed as a whole note"
        await page.keyboard.press('5');
        await expect.poll(() => measure(page)).toEqual([[0, [1920]]]);

        // Auto-advance has already moved the cursor one grid slot — the
        // manual's "move the cursor an 1/8th note further on". Typing
        // there makes the first note an eighth AND "assigns the same
        // value to the second note".
        await page.keyboard.press('3');
        await expect.poll(() => measure(page)).toEqual([
            [0, [240]],
            [240, [240]],
        ]);
    });

    test('the LENGTH row dashes the prediction for the next slot', async ({ page }) => {
        await openDemo(page);
        await page.keyboard.press('=');
        const whole = page.locator('.duration-buttons .toolbar-button[data-duration="1920"]');
        const eighth = page.locator('.duration-buttons .toolbar-button[data-duration="240"]');

        // empty bar → the rule would give a whole note
        await expect(whole).toHaveClass(/predicts-next/);

        await page.keyboard.press('5');
        await page.keyboard.press('3');
        // the cursor sits an eighth past the last note, so the preceding
        // interval — an eighth — is what a note here would get
        await expect(eighth).toHaveClass(/predicts-next/);
        await expect(whole).not.toHaveClass(/predicts-next/);

        // choosing a duration replaces the prediction with a choice
        await page.keyboard.press('q');   // quarter, TablEdit preset
        await expect(page.locator('.duration-buttons .predicts-next')).toHaveCount(0);
    });

    test('the silence the last note no longer covers is drawn as rests',
        async ({ page }) => {
            await openDemo(page);
            await page.keyboard.press('=');
            await page.keyboard.press('5');
            await page.keyboard.press('3');
            await expect.poll(() => measure(page)).toEqual([
                [0, [240]],
                [240, [240]],
            ]);

            // 1440 ticks left in the bar → a half rest then a quarter
            // rest. Bravura comes from a CDN the sandbox may block, and
            // without the music font the renderer draws no rests at all
            // — which is not what this test is about.
            const ready = await page.evaluate(
                () => document.fonts.check('28px Bravura'));
            test.skip(!ready, 'Bravura (CDN) unavailable in this sandbox');
            await expect(page.locator('.editor-renderer .rest-glyph'))
                .toHaveCount(2);
        });

    test('deleting the second note re-extends the first to the whole bar',
        async ({ page }) => {
            await openDemo(page);
            await page.keyboard.press('=');
            await page.keyboard.press('5');
            await page.keyboard.press('3');
            await page.keyboard.press('ArrowLeft');   // back onto the second
            await page.keyboard.press('Delete');
            await expect.poll(() => measure(page)).toEqual([[0, [1920]]]);
        });

    test('STEP and LENGTH are two captioned rows, with Rest on STEP',
        async ({ page }) => {
            await openDemo(page);
            await expect(page.locator('.toolbar-row.step-row .toolbar-label'))
                .toHaveText('Step');
            await expect(page.locator('.toolbar-row.length-row .toolbar-label'))
                .toHaveText('Length');
            await expect(page.locator('.toolbar-row.step-row .toolbar-caption'))
                .toHaveText('how far the cursor moves; what the ruler draws');
            await expect(page.locator('.toolbar-row.length-row .toolbar-caption'))
                .toHaveText('what a typed note gets');
            await expect(page.locator('.toolbar-row.step-row .rest-button'))
                .toBeVisible();
            await expect(page.locator('.toolbar-row.step-row .grid-buttons'))
                .toBeVisible();
            await expect(page.locator('.toolbar-row.length-row .duration-buttons'))
                .toBeVisible();
        });
});
