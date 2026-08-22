// Submitting a tab, end to end, against a mocked Supabase.
//
// These three paths — correct an existing take, publish a new one, be asked
// to sign in — are the whole point of the editor, and none of them had a
// test because all three end in a network call. `e2e/helpers/supabase-mock.js`
// answers that call, so the assertions can be about the ROW the app wrote and
// the words the reader is shown, not about a status code.
//
// The real supabase-js SDK still loads and still runs: only the far end is
// fake. Every test finishes with `sb.assertClean()`, which fails if anything
// reached a host the mock does not own.
import { test, expect } from '@playwright/test';
import { mockSupabase } from './helpers/supabase-mock.js';

/** A published banjo/mandolin take to correct. */
const TAB_WORK = '/#work/foggy-mountain-breakdown/mandolin';

const band = (page) => page.locator('#app-bottomband');

/** Read a tab and press ✏️ Edit. */
async function editPublishedTake(page) {
    await page.goto(TAB_WORK);
    await page.locator('.tablature-container').first().waitFor({ timeout: 20000 });
    await band(page).locator('.tab-edit-btn').click();
    await page.locator('.editor-renderer .stave-row').first()
        .waitFor({ timeout: 20000 });
}

/** Put a note in, so there is something to submit. */
async function typeANote(page, key = '7') {
    await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
    await page.keyboard.press(key);
    await expect(page.locator('.editor-renderer .note-text').first()).toBeVisible();
}

test.describe('submitting a correction', () => {
    test('edit → Submit correction → comment → Send lands a pending tab row',
        async ({ page }) => {
            const sb = await mockSupabase(page, {
                commit: { success: true, mode: 'update', workId: 'foggy-mountain-breakdown' },
            });

            await editPublishedTake(page);
            await typeANote(page);

            await band(page).locator('.tab-edit-submit').click();
            const panel = page.locator('.tab-edit-submit-panel');
            await expect(panel).toBeVisible();

            // The comment is REQUIRED for a correction — a fix says what it fixed.
            await panel.locator('.tab-edit-submit-send').click();
            await expect(panel.locator('.tab-edit-submit-status'))
                .toHaveText('Please describe your changes.');

            await panel.locator('.tab-edit-submit-comment').fill('Bar 1 was a 5, not a 7');
            await panel.locator('.tab-edit-submit-send').click();
            await expect(panel.locator('.tab-edit-submit-status'))
                .toContainText(/^Submitted — /, { timeout: 15000 });

            // What actually got written: a TABLATURE row against this work.
            const row = sb.row('pending_songs');
            expect(row.id).toMatch(/^tab:[a-z0-9-]*:[a-z0-9]{6,}$/);
            expect(row.part_type).toBe('tablature');
            expect(row.instrument).toBe('mandolin');
            expect(row.replaces_id).toBe('foggy-mountain-breakdown');
            expect(row.notes).toBe('Bar 1 was a 5, not a 7');
            expect(row.part_file).toBeTruthy();      // corrections name their take
            expect(JSON.parse(row.content).tracks.length).toBeGreaterThan(0);

            // …and the durable-write handshake happened too.
            expect(sb.calls()).toContain('POST /functions/v1/auto-commit-song');

            // Leaving the editor shows the take as pending, on the page it
            // was fixed on — the reader sees their own fix, badged.
            await band(page).locator('.tab-edit-done').click();
            await expect(page.locator('.arr-status'))
                .toContainText('Submitted — live now', { timeout: 15000 });
            await expect(page.locator('#arrangement-host'))
                .toContainText('just submitted');

            sb.assertClean();
        });

    test('a durable-write failure reads as “syncing”, never as a failure',
        async ({ page }) => {
            const sb = await mockSupabase(page);
            // The row lands; only step 2 (auto-commit-song) is refused. The
            // tab IS live at that point, and the reconciler owns the retry.
            await page.route('**/functions/v1/auto-commit-song',
                route => route.fulfill({ status: 500, contentType: 'application/json',
                    body: JSON.stringify({ error: 'nope' }) }));

            await editPublishedTake(page);
            await typeANote(page);
            await band(page).locator('.tab-edit-submit').click();
            const panel = page.locator('.tab-edit-submit-panel');
            await panel.locator('.tab-edit-submit-comment').fill('typo in bar 3');
            await panel.locator('.tab-edit-submit-send').click();

            await expect(panel.locator('.tab-edit-submit-status'))
                .toContainText('Saved and live', { timeout: 15000 });
            expect(sb.rows('pending_songs')).toHaveLength(1);
            sb.assertClean();
        });
});

test.describe('submitting a new tab', () => {
    // A brand-new take has nothing to describe, so Submit IS the submission:
    // there is no comment panel and no Send in this path (work-edit.js,
    // `commentRequired: false`). Asserting the product, not the wish.
    test('#new-tab → Submit tab → the page becomes the minted work',
        async ({ page }) => {
            const sb = await mockSupabase(page, {
                commit: { success: true, mode: 'create', workId: 'e2e-breakdown' },
            });

            await page.goto('/index.html#new-tab?title=E2E%20Breakdown&instrument=banjo');
            await page.locator('.editor-renderer .stave-row').first()
                .waitFor({ timeout: 20000 });
            await typeANote(page, '5');

            const submit = band(page).locator('.tab-edit-submit');
            await expect(submit).toHaveText('🚀 Submit tab');
            await expect(page.locator('.tab-edit-submit-panel')).toHaveCount(0);

            // The server's slug wins, and the provisional page becomes it.
            // (Asserting the URL rather than the button's "Submitted —" line:
            // landSubmittedTake tears the session down a tick later, so that
            // line is real but not durable enough to poll for.)
            await Promise.all([
                page.waitForURL(/#work\/e2e-breakdown$/, { timeout: 20000 }),
                submit.click(),
            ]);
            await expect(page.locator('.arr-status'))
                .toContainText('Submitted — live now', { timeout: 15000 });
            await expect(page.locator('#arrangement-host'))
                .toContainText('just submitted');

            const row = sb.row('pending_songs');
            expect(row.part_type).toBe('tablature');
            expect(row.instrument).toBe('banjo');
            expect(row.title).toBe('E2E Breakdown');
            expect(row.replaces_id).toBeNull();      // a mint, not a target
            expect(row.notes).toBeNull();
            sb.assertClean();
        });
});

test.describe('submitting without an account', () => {
    test('Send hands the anonymous contributor to the sign-in gate',
        async ({ page }) => {
            const sb = await mockSupabase(page, { signedIn: false });

            await editPublishedTake(page);
            await typeANote(page);
            await band(page).locator('.tab-edit-submit').click();
            const panel = page.locator('.tab-edit-submit-panel');
            await panel.locator('.tab-edit-submit-comment').fill('anonymous fix');

            // requireLogin() fires signInWithOAuth, which NAVIGATES — the
            // mock serves the gate page in Google's place.
            await Promise.all([
                page.waitForURL(/\/auth\/v1\/authorize/, { timeout: 20000 }),
                panel.locator('.tab-edit-submit-send').click(),
            ]);
            await expect(page.locator('#e2e-oauth-gate')).toBeVisible();

            // Nothing was written on the way out.
            expect(sb.rows('pending_songs')).toEqual([]);
            sb.assertClean();
        });
});
