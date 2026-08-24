// `#drafts` — the autosave bucket, and the only surface that works with the
// network off.
//
// The property under test is the round trip: type into a take, walk away,
// find it in the list, open it back on the route it was written on, with the
// note still in it. Nothing here mocks anything — drafts are IndexedDB and
// nothing else, which is the point of them.
import { test, expect } from '@playwright/test';

const band = (page) => page.locator('#app-bottomband');

/** Start a take, type a note, and let the ~1s trailing-edge autosave fire. */
async function startADraft(page, { title = 'Draft Tune', fret = '7' } = {}) {
    await page.goto(`/index.html#new-tab?title=${encodeURIComponent(title)}`);
    await page.locator('.editor-renderer .stave-row').first()
        .waitFor({ timeout: 20000 });
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
    await page.keyboard.press(fret);
    await expect(page.locator('.editor-renderer .note-text').first()).toHaveText(fret);

    // The bucket write is a ~1s TRAILING edge, and navigating away destroys
    // the session silently (no flush — only ✓ Done / Cancel flush). So the
    // debounce has to be allowed to fire while we are still on the page;
    // there is no event to wait for and nothing to poll that isn't this.
    await page.waitForTimeout(2500);
}

async function gotoDrafts(page) {
    await page.goto('/index.html#drafts');
    await expect(page.locator('.drafts-view')).toBeVisible({ timeout: 20000 });
}

test.describe('the drafts list', () => {
    test('a typed take shows up, reopens with its note, and can be deleted',
        async ({ page }) => {
            const dialogs = [];
            page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });

            await startADraft(page, { title: 'Draft Tune', fret: '7' });
            await gotoDrafts(page);

            const row = page.locator('.draft-row').first();
            await expect(row).toBeVisible({ timeout: 20000 });
            await expect(row.locator('.draft-row-title')).toHaveText('Draft Tune');
            await expect(row.locator('.draft-row-meta')).toContainText('new song');

            // Open goes back to the route the draft was written on, carrying
            // its id — a hash cannot carry a document, so this is the handoff.
            await row.locator('.draft-open').click();
            await page.waitForURL(/#new-tab\?draft=/, { timeout: 20000 });
            await page.locator('.editor-renderer .stave-row').first()
                .waitFor({ timeout: 20000 });
            await expect(page.locator('.editor-renderer .note-text').first())
                .toHaveText('7');
            await expect(band(page).locator('.tab-edit-submit')).toBeVisible();

            // Delete asks INLINE — a native confirm would be undrivable here
            // and unstyled everywhere.
            await gotoDrafts(page);
            await page.locator('.draft-row').first().locator('.draft-delete').click();
            const ask = page.locator('.draft-confirm');
            await expect(ask).toBeVisible();
            await expect(ask).toContainText('Delete this draft?');
            expect(dialogs).toEqual([]);

            // "Keep" leaves it exactly where it was…
            await ask.locator('.draft-confirm-no').click();
            await expect(ask).toHaveCount(0);
            await expect(page.locator('.draft-row')).toHaveCount(1);

            // …and "Delete" takes it away for good.
            await page.locator('.draft-delete').first().click();
            await page.locator('.draft-confirm-yes').click();
            await expect(page.locator('.draft-row')).toHaveCount(0);
            await expect(page.locator('.drafts-view')).toContainText('No drafts yet');
            expect(dialogs).toEqual([]);

            await page.reload();
            await expect(page.locator('.drafts-view'))
                .toContainText('No drafts yet', { timeout: 20000 });
        });

    test('an empty bucket says so, without pretending it failed', async ({ page }) => {
        await gotoDrafts(page);
        await expect(page.locator('.drafts-view')).toContainText('No drafts yet');
        await expect(page.locator('.drafts-view'))
            .toContainText('it saves itself here as you type');
    });
});
