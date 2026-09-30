// E2E: the lead-sheet editor's place in the app's navigation (A7) and its
// survival across a sign-in redirect (A5).
//
// A7 — opening the editor from a song page used to bypass the view state
// machine, so app state still said "song page"; a later navigation to another
// song was then a no-op for the state and the editor stayed on screen.
import { test, expect } from '@playwright/test';

const SONG_A = 'your-cheating-heart';
const SONG_B = 'cold-cold-heart';

async function openSongThenEditor(page, id = SONG_A) {
    await page.goto(`/#work/${id}`);
    await expect(page.locator('#song-view')).toBeVisible({ timeout: 15000 });
    await page.locator('#edit-song-btn').click();
    await expect(page.locator('#editor-panel')).toBeVisible();
    await expect(page.locator('#editor-title')).not.toHaveValue('');
}

test.describe('A7: editor and navigation', () => {
    test('navigating to another song by hash hides the editor and shows that song', async ({ page }) => {
        await openSongThenEditor(page, SONG_A);
        await expect(page.locator('#song-view')).toBeHidden();
        await expect(page.locator('#landing-page')).toBeHidden();

        await page.evaluate((id) => { window.location.hash = `#work/${id}`; }, SONG_B);

        await expect(page.locator('#editor-panel')).toBeHidden();
        await expect(page.locator('#song-view')).toBeVisible();
        await expect(page.locator('#song-content')).toContainText(/Cold,? Cold Heart/i);
    });

    test('Back from the editor returns to the song page and hides the editor', async ({ page }) => {
        await openSongThenEditor(page, SONG_A);
        await expect(page).toHaveURL(new RegExp(`#edit/${SONG_A}$`));

        await page.goBack();

        await expect(page.locator('#editor-panel')).toBeHidden();
        await expect(page.locator('#song-view')).toBeVisible();
        await expect(page.locator('#song-content')).toContainText(/Cheatin|Cheating/i);
    });

    test('a hash change to another song after Back-and-forward still hides the editor', async ({ page }) => {
        await openSongThenEditor(page, SONG_A);
        await page.goBack();
        await expect(page.locator('#song-view')).toBeVisible();
        await page.goForward();
        await expect(page.locator('#editor-panel')).toBeVisible();

        await page.evaluate((id) => { window.location.hash = `#work/${id}`; }, SONG_B);
        await expect(page.locator('#editor-panel')).toBeHidden();
        await expect(page.locator('#song-content')).toContainText(/Cold,? Cold Heart/i);
    });

    test('opening the editor from a song page shows the Add-Song top band state', async ({ page }) => {
        await openSongThenEditor(page, SONG_A);
        // the view state machine ran: the top band now reads "Add Song"
        await expect(page.locator('.topbar-nav-link[data-nav="add"]')).toHaveClass(/active/);
    });
});

test.describe('A7: leaving the editor with unsaved edits', () => {
    // An in-page prompt, never window.confirm (it is not in the DOM, so no
    // test could drive it and it cannot be themed).
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.dismiss();
            throw new Error(`a native ${dialog.type()} dialog opened: ${dialog.message()}`);
        });
    });

    async function editSomething(page, text = '[G]Extra line I typed') {
        await openSongThenEditor(page, SONG_A);
        const box = page.locator('#editor-content');
        const before = await box.inputValue();
        await box.fill(`${before}\n${text}`);
        return `${before}\n${text}`;
    }

    test('an untouched editor leaves without asking', async ({ page }) => {
        await openSongThenEditor(page, SONG_A);
        await page.evaluate((id) => { window.location.hash = `#work/${id}`; }, SONG_B);
        await expect(page.locator('#editor-panel')).toBeHidden();
        await expect(page.locator('#editor-leave-modal')).toHaveCount(0);
    });

    test('hash navigation with edits asks; Keep editing returns with the text intact', async ({ page }) => {
        const edited = await editSomething(page);

        await page.evaluate((id) => { window.location.hash = `#work/${id}`; }, SONG_B);
        await expect(page.locator('#editor-leave-modal')).toBeVisible();
        await expect(page.locator('#editor-leave-modal')).toContainText(/Discard your changes/);

        await page.locator('#editor-leave-modal [data-choice="keep"]').click();

        await expect(page.locator('#editor-leave-modal')).toHaveCount(0);
        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#editor-content')).toHaveValue(edited);
        await expect(page).toHaveURL(new RegExp(`#edit/${SONG_A}$`));
        // and it is still an edit of the same song, not a fresh "Add Song"
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);
    });

    test('Back with edits asks; Discard lands on the song page', async ({ page }) => {
        await editSomething(page);

        await page.goBack();
        await expect(page.locator('#editor-leave-modal')).toBeVisible();

        await page.locator('#editor-leave-modal [data-choice="discard"]').click();

        await expect(page.locator('#editor-leave-modal')).toHaveCount(0);
        await expect(page.locator('#editor-panel')).toBeHidden();
        await expect(page.locator('#song-view')).toBeVisible();
    });

    test('Escape means keep editing', async ({ page }) => {
        await editSomething(page);
        await page.locator('#topbar-brand').click();
        await expect(page.locator('#editor-leave-modal')).toBeVisible();

        await page.keyboard.press('Escape');

        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#landing-page')).toBeHidden();
    });

    test('a new-song draft asks too, and Leave keeps the draft in this tab', async ({ page }) => {
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await page.locator('#editor-content').fill('[G]A draft I care about');

        await page.locator('#topbar-brand').click();
        await expect(page.locator('#editor-leave-modal')).toContainText(/Leave without submitting/);
        await page.locator('#editor-leave-modal [data-choice="discard"]').click();
        await expect(page.locator('#landing-page')).toBeVisible();

        await page.locator('.topbar-nav-link[data-nav="add"]').click();
        await page.locator('.picker-card[data-type="chordpro"]').click();
        await expect(page.locator('#editor-content')).toHaveValue('[G]A draft I care about');
    });
});
