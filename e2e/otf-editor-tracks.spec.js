// Instrument tracks on a real multi-track arrangement.
//
// `red-haired-boy`'s ensemble take carries six tracks, which makes it the
// only honest place to test the three track operations: choosing one,
// renaming it (the name IS the id — see otf-editor/CLAUDE.md), and moving it
// (position IS lead-ness). All three are toolbar/menu-only, so all three are
// exactly the kind of thing that goes untested until someone drives the UI.
//
// Where a claim is about the DOCUMENT rather than the UI, the assertion goes
// through ⬇ Download and reads the file: `tracks[]` order is not something
// the canvas shows.
import { test, expect } from '@playwright/test';

const WORK = '/#work/red-haired-boy/ensemble-tab';

const band = (page) => page.locator('#app-bottomband');
const trackButtons = (page) => page.locator('.track-buttons .track-button');

async function openEnsembleEditor(page) {
    await page.goto(WORK);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
    await band(page).locator('.tab-edit-btn').click();
    await page.locator('.editor-renderer .stave-row').first()
        .waitFor({ timeout: 20000 });
    await expect(trackButtons(page).first()).toBeVisible();
}

/** The track ids the toolbar is showing, in order. */
const trackNames = (page) => trackButtons(page).allTextContents();

/** The id of the track currently being edited. */
async function activeTrack(page) {
    const active = page.locator('.track-buttons .track-button.active');
    return (await active.count())
        ? (await active.first().textContent()).trim()
        : null;
}

/** Download the document and hand back the parsed JSON. */
async function downloadDoc(page) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        band(page).locator('.tab-edit-download').click(),
    ]);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    return JSON.parse(readFileSync(path, 'utf-8'));
}

test.describe('multi-track editing', () => {
    test('the ensemble take offers every track, and the toolbar switches', async ({ page }) => {
        await openEnsembleEditor(page);

        const names = await trackNames(page);
        expect(names.length).toBeGreaterThan(1);
        expect(new Set(names).size).toBe(names.length);   // ids are unique

        const first = await activeTrack(page);
        const other = names.find(n => n !== first);
        await trackButtons(page).filter({ hasText: other }).first().click();
        await expect(page.locator('.track-button.active')).toHaveText(other);
        expect(await activeTrack(page)).toBe(other);
    });

    test('Score ▸ Tracks switches too, and latches the current one', async ({ page }) => {
        await openEnsembleEditor(page);
        const names = await trackNames(page);
        const target = names[names.length - 1];

        await page.locator('.menu-trigger[data-menu="score"]').click();
        const popup = page.locator('.menu-popup');
        await expect(popup).toBeVisible();
        // Track entries latch, so they are menuitemRADIOs — `.menu-item` is
        // the selector that spans both kinds.
        await popup.locator('.menu-item').filter({ hasText: target }).first().click();

        await expect(page.locator('.track-button.active')).toHaveText(target);

        // Re-opening the menu shows the choice latched, not guessed.
        await page.locator('.menu-trigger[data-menu="score"]').click();
        const checked = popup.locator('.menu-item').filter({ hasText: target }).first();
        await expect(checked).toHaveAttribute('aria-checked', 'true');
    });

    test('rename goes through the popover, and undo puts the name back', async ({ page }) => {
        await openEnsembleEditor(page);
        const before = await trackNames(page);
        const original = await activeTrack(page);
        const renamed = 'lead break';

        await page.locator('.track-rename-button').click();
        const popover = page.locator('.otf-track-name-popover');
        await expect(popover).toBeVisible();
        const input = popover.locator('.track-name-input');
        await expect(input).toHaveValue(original);

        // A name another track already holds is refused INLINE — the facade
        // throws on it, and a thrown error is not an error message.
        const taken = before.find(n => n !== original);
        await input.fill(taken);
        await expect(popover.locator('.track-name-error')).toContainText(taken);
        await expect(popover.locator('.save-btn')).toBeDisabled();

        await input.fill(renamed);
        await expect(popover.locator('.save-btn')).toBeEnabled();
        await popover.locator('.save-btn').click();
        await expect(popover).toBeHidden();

        await expect(page.locator('.track-button.active')).toHaveText(renamed);
        expect(await trackNames(page)).toContain(renamed);

        // The notation moved with the name — a rename that loses the music
        // is rejected downstream by validate_otf.
        const doc = await downloadDoc(page);
        expect(Object.keys(doc.notation)).toContain(renamed);
        expect(doc.notation[renamed].length).toBeGreaterThan(0);
        expect(doc.tracks.map(t => t.id)).toContain(renamed);

        await page.locator('.editor-canvas-container').click({ position: { x: 60, y: 40 } });
        await page.keyboard.press('u');
        await expect(page.locator('.track-button.active')).toHaveText(original);
        expect(await trackNames(page)).toEqual(before);
    });

    test('moving a track earlier reorders tracks[] in the document', async ({ page }) => {
        await openEnsembleEditor(page);
        const before = await trackNames(page);

        // Pick the second track so "earlier" has somewhere to go.
        const mover = before[1];
        await trackButtons(page).filter({ hasText: mover }).first().click();
        await expect(page.locator('.track-button.active')).toHaveText(mover);

        await page.locator('.track-move-earlier-button').click();
        const after = await trackNames(page);
        expect(after[0]).toBe(mover);
        expect(after).toEqual([before[1], before[0], ...before.slice(2)]);

        // First place is the lead — so this really has to be the file's order.
        const doc = await downloadDoc(page);
        expect(doc.tracks.map(t => t.id)).toEqual(after);

        // At the head of the list there is nowhere earlier to go.
        await expect(page.locator('.track-move-earlier-button')).toBeDisabled();
    });
});
