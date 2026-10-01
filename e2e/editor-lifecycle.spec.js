// E2E: the lead-sheet editor's place in the app's navigation (A7) and its
// survival across a sign-in redirect (A5).
//
// A7 — opening the editor from a song page used to bypass the view state
// machine, so app state still said "song page"; a later navigation to another
// song was then a no-op for the state and the editor stayed on screen.
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock.js';

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

// ---------------------------------------------------------------------------
// A5 — sign-in at Submit used to lose the work.
//
// Submit → requireLogin → signInWithGoogle is a FULL-PAGE redirect whose return
// address is origin + pathname, so the #add / #edit/{id} / tab route was
// dropped and the lead-sheet editor (which has no draft store) came back empty.
//
// The old e2e stubbed signInWithGoogle with a no-op, so the page never left and
// the bug was invisible. These tests use the real SDK against a mock whose
// OAuth endpoint COMPLETES the hand-off: the browser really navigates away and
// comes back with `#access_token=…` in the URL, the way Google + Supabase do.
// ---------------------------------------------------------------------------

const band = (page) => page.locator('#app-bottomband');

test.describe('A5: sign-in at Submit keeps the work (lead sheet)', () => {
    test('new song: Submit → Google → back in #add with the text, ready to submit', async ({ page }) => {
        const sb = await mockSupabase(page, { signedIn: false, oauthReturn: true });
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });

        await page.locator('#metadata-summary').click();
        await page.locator('#editor-title').fill('Round Trip Blues');
        await page.locator('#editor-artist').fill('E2E Band');
        await page.locator('#editor-content').fill('[G]Out to Google and [C]back again\n[D]with every word [G]kept');

        // Signed out: Submit leaves the page for the OAuth hand-off, which
        // bounces straight back with the session in the URL fragment.
        await Promise.all([
            page.waitForURL(/#access_token=/, { timeout: 20000 }),
            page.locator('#editor-submit').click(),
        ]);

        // The route is restored (the fragment Supabase used is gone from it)…
        await expect(page).toHaveURL(/#add$/, { timeout: 20000 });
        await expect(page.locator('#editor-panel')).toBeVisible();
        // …with everything that was typed…
        await expect(page.locator('#editor-content')).toHaveValue(
            '[G]Out to Google and [C]back again\n[D]with every word [G]kept');
        await expect(page.locator('#editor-title')).toHaveValue('Round Trip Blues');
        await expect(page.locator('#editor-artist')).toHaveValue('E2E Band');
        // …and it says so, without submitting on the user's behalf.
        await expect(page.locator('#editor-status')).toContainText('Signed in — ready to submit');
        expect(sb.rows('pending_songs')).toEqual([]);

        // The session is real: pressing Submit now lands the row.
        await page.locator('#editor-submit').click();
        await expect.poll(() => sb.rows('pending_songs').length, { timeout: 20000 }).toBe(1);
        const row = sb.row('pending_songs');
        expect(row.title).toBe('Round Trip Blues');
        expect(row.content).toContain('with every word');
        // The return record was used up.
        expect(await page.evaluate(() => localStorage.getItem('bgb-auth-return'))).toBeNull();
    });

    test('editing a song: the route and the edits come back', async ({ page }) => {
        const sb = await mockSupabase(page, { signedIn: false, oauthReturn: true });
        await page.goto(`/#edit/${SONG_A}`);
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);

        const box = page.locator('#editor-content');
        const edited = `${await box.inputValue()}\n[G]A line added before sign-in`;
        await box.fill(edited);

        await Promise.all([
            page.waitForURL(/#access_token=/, { timeout: 20000 }),
            page.locator('#editor-submit').click(),
        ]);

        await expect(page).toHaveURL(new RegExp(`#edit/${SONG_A}$`), { timeout: 20000 });
        await expect(page.locator('#editor-panel')).toBeVisible();
        await expect(page.locator('#editor-title')).toHaveValue(/Cheat/i);
        // the textarea holds the USER's text, not the published song re-fetched
        await expect(page.locator('#editor-content')).toHaveValue(edited);
        await expect(page.locator('#editor-status')).toContainText('Signed in — ready to submit');
        expect(sb.rows('pending_songs')).toEqual([]);
    });

    test('consent refused at Google: the draft still comes back', async ({ page }) => {
        const sb = await mockSupabase(page, { signedIn: false });
        // Registered after the mock, so it wins: Google sends the user back with an error
        await page.route('**/auth/v1/authorize*', (route) => {
            const url = new URL(route.request().url());
            const back = url.searchParams.get('redirect_to');
            return route.fulfill({
                status: 302,
                headers: { location: `${back}#error=access_denied&error_description=The+user+denied+access` },
                body: '',
            });
        });
        await page.goto('/#add');
        await expect(page.locator('#editor-panel')).toBeVisible({ timeout: 15000 });
        await page.locator('#metadata-summary').click();
        await page.locator('#editor-title').fill('Declined');
        await page.locator('#editor-content').fill('[G]Words I would hate to lose');

        await Promise.all([
            page.waitForURL(/#error=access_denied/, { timeout: 20000 }),
            page.locator('#editor-submit').click(),
        ]);

        await expect(page).toHaveURL(/#add$/, { timeout: 20000 });
        await expect(page.locator('#editor-content')).toHaveValue('[G]Words I would hate to lose');
        await expect(page.locator('#editor-title')).toHaveValue('Declined');
        await expect(page.locator('#editor-status')).toContainText(/Sign-in did not finish/);
        expect(sb.rows('pending_songs')).toEqual([]);
    });

    test('a stale return record is ignored (no hijacking a later visit)', async ({ page }) => {
        await mockSupabase(page, { signedIn: false });
        await page.addInitScript(() => {
            try {
                localStorage.setItem('bgb-auth-return', JSON.stringify({
                    v: 1, at: Date.now() - 3 * 3600 * 1000, hash: '#add', kind: 'lead-sheet',
                    state: { title: 'Ancient', artist: '', writer: '', content: '[G]old' },
                }));
            } catch { /* storage unavailable */ }
        });
        await page.goto('/#search');
        await expect(page.locator('#search-input')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('bgb-auth-return'))).toBeNull();
        await expect(page.locator('#editor-panel')).toBeHidden();
    });
});

test.describe('A5: sign-in at Submit keeps the work (tab editor)', () => {
    async function editPublishedTake(page) {
        await page.goto('/#work/foggy-mountain-breakdown/mandolin');
        await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
        await band(page).locator('.tab-edit-btn').click();
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
    }
    async function typeANote(page, key = '7') {
        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press(key);
        await expect(page.locator('.editor-renderer .note-text').first()).toBeVisible();
    }

    test('correction: back in the editor on the same take, with the note', async ({ page }) => {
        const sb = await mockSupabase(page, { signedIn: false, oauthReturn: true });
        await editPublishedTake(page);
        await typeANote(page);

        await band(page).locator('.tab-edit-submit').click();
        const panel = page.locator('.tab-edit-submit-panel');
        await panel.locator('.tab-edit-submit-comment').fill('fixed bar 1');
        // No waiting for the 1s autosave: Send must flush the draft itself.
        await Promise.all([
            page.waitForURL(/#access_token=/, { timeout: 20000 }),
            panel.locator('.tab-edit-submit-send').click(),
        ]);

        await expect(page).toHaveURL(
            /#work\/foggy-mountain-breakdown\/edit\/[^?]+\?draft=d-/, { timeout: 20000 });
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        // the note typed before sign-in is in the editor (from the draft)
        await expect(page.locator('.editor-renderer .note-text').first()).toBeVisible();
        expect(sb.rows('pending_songs')).toEqual([]);
        await expect(page.locator('.auth-toast').first())
            .toContainText('Signed in — ready to submit');
    });

    test('new tab: #new-tab comes back with the notes, not an empty take', async ({ page }) => {
        const sb = await mockSupabase(page, { signedIn: false, oauthReturn: true });
        await page.goto('/index.html#new-tab?title=E2E%20Breakdown&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await typeANote(page, '5');

        await Promise.all([
            page.waitForURL(/#access_token=/, { timeout: 20000 }),
            band(page).locator('.tab-edit-submit').click(),
        ]);

        await expect(page).toHaveURL(/#new-tab\?draft=d-/, { timeout: 20000 });
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await expect(page.locator('.editor-renderer .note-text').first()).toBeVisible();
        expect(sb.rows('pending_songs')).toEqual([]);
    });
});
