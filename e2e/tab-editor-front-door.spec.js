// The tab editor's front door (G15c): /tab-editor/, Open while signed out,
// "My tabs". Everything here runs signed out (the default for e2e/fixtures.js)
// because the point is that nothing before Submit needs an account.
//
// /tab-editor/ is a generated page (scripts/lib/build_song_pages.py); the
// server falls back to 404.html (the same app) when it isn't built, and the
// app routes the path either way, so these pass on both. The pytest covers
// the generated page itself.
import { test, expect } from './fixtures.js';
import { mockSupabase } from './helpers/supabase-mock.js';
import { gotoSearch, navClick } from './helpers.js';
import {
    tef, notes, gotoFrontDoor, chooseFile, expectEditorWithNotes,
    clickFileItem, clickOverflow,
} from './helpers/front-door.js';
import { registerFrontDoorFlows } from './helpers/front-door-flows.js';

registerFrontDoorFlows(test, expect);

test.describe('the front door, desktop', () => {
    test('/tab-editor/ stays /tab-editor/ and shows the three actions', async ({ page }) => {
        await gotoFrontDoor(page);
        expect(new URL(page.url()).pathname).toBe('/tab-editor/');
        await expect(page.locator('.tab-home h1')).toHaveText('Free tab editor for TablEdit (.tef) files');
        await expect(page.locator('.tab-open-file')).toBeVisible();
        await expect(page.locator('.tab-home-new')).toBeVisible();
        await expect(page.locator('.tab-home-mytabs')).toContainText('No tabs yet.');
        await expect(page.locator('.tab-home-privacy')).toHaveText(
            'Your tabs stay on this device. Nothing is uploaded unless you submit it to the book.');
        await expect(page.locator('.tab-home-example a')).toHaveAttribute(
            'href', '/#work/foggy-mountain-breakdown/banjo-tab');
    });

    test('/tab-editor (no slash) is routed too, and not rewritten to /', async ({ page }) => {
        await page.goto('/tab-editor');
        await expect(page.locator('.tab-home')).toBeVisible({ timeout: 20000 });
        expect(new URL(page.url()).pathname).toMatch(/^\/tab-editor\/?$/);
    });

    test('a file dragged over the page outlines the Open card', async ({ page }) => {
        await gotoFrontDoor(page);
        await page.evaluate(() => {
            const dt = new DataTransfer();
            dt.items.add(new File(['x'], 'a.tef'));
            document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        });
        await expect(page.locator('body')).toHaveClass(/file-dragover/);
        const outline = await page.locator('.tab-home-open')
            .evaluate(el => getComputedStyle(el).outlineStyle);
        expect(outline).toBe('dashed');
    });

    test('leaving to another view gives the URL back to the root', async ({ page }) => {
        await gotoFrontDoor(page);
        await page.locator('.tab-home-all a').click();
        await expect(page.locator('.drafts-view h1')).toHaveText('My tabs');
        await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).hash)
            .toBe('/#drafts');
    });

    test('⋯ ▸ Tab editor opens the front door without a reload, and Back works', async ({ page }) => {
        await gotoSearch(page);
        await page.evaluate(() => { window.__noReload = true; });
        await clickOverflow(page, 'Tab editor');
        await expect(page.locator('.tab-home')).toBeVisible({ timeout: 20000 });
        expect(new URL(page.url()).pathname).toBe('/tab-editor/');
        expect(await page.evaluate(() => window.__noReload)).toBe(true);

        await page.goBack();
        await expect(page.locator('#search-input')).toBeVisible();
        expect(new URL(page.url()).pathname).toBe('/');
        expect(await page.evaluate(() => window.__noReload)).toBe(true);

        await page.goForward();
        await expect(page.locator('.tab-home')).toBeVisible();
    });

    test('⋯ menu says My tabs, not Drafts, and it opens the list', async ({ page }) => {
        await gotoSearch(page);
        await page.locator('#topbar-overflow-btn').click();
        const menu = page.locator('#topbar-overflow-menu');
        await expect(menu).toContainText('My tabs');
        await expect(menu).toContainText('Tab editor');
        await expect(menu).not.toContainText('Drafts');
        await menu.locator('.pill-popover-item', { hasText: 'My tabs' }).click();
        await expect(page.locator('.drafts-view h1')).toHaveText('My tabs');
        await expect(page.locator('.drafts-view .tab-open-file')).toBeVisible();
        await expect(page.locator('.drafts-view')).toContainText('No tabs yet.');
    });

    test('My tabs (empty) has the same Open a tab file… button', async ({ page }) => {
        await page.goto('/#drafts');
        await expect(page.locator('.drafts-view')).toBeVisible({ timeout: 20000 });
        await chooseFile(page, page.locator('.drafts-view .tab-open-file'), tef.file);
        await page.waitForURL(/#new-tab\?draft=/, { timeout: 20000 });
        await expectEditorWithNotes(page);
    });

    test('File ▸ Open… during an edit keeps the first document as a draft', async ({ page }) => {
        await gotoFrontDoor(page);
        await page.locator('.tab-home-title').fill('First Tune');
        await page.locator('.tab-home-new button[type=submit]').click();
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('7');
        await expect(notes(page).first()).toHaveText('7');

        // No waiting for the autosave's 1s trailing edge: Open… must flush it.
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            clickFileItem(page, 'Open…'),
        ]);
        await chooser.setFiles(tef.file);

        await page.waitForURL(/#new-tab\?draft=.*&file=1/, { timeout: 20000 });
        await expect(page.locator('#new-tab-title')).toHaveValue(tef.title, { timeout: 20000 });

        await page.goto('/#drafts');
        const titles = page.locator('.draft-row-title');
        await expect(titles).toHaveCount(2, { timeout: 20000 });
        await expect(titles.filter({ hasText: 'First Tune' })).toHaveCount(1);
        await expect(titles.filter({ hasText: tef.title })).toHaveCount(1);
    });
});

test.describe('no sign-in before editing', () => {
    test('Add Song ▸ Tablature opens the editor signed out; Submit asks to sign in and the draft survives', async ({ page }) => {
        const sb = await mockSupabase(page, { signedIn: false, oauthReturn: true });
        await gotoSearch(page);
        await navClick(page, 'add');
        await page.locator('.picker-card[data-type="tablature"]').click();
        await page.locator('#picker-tab-new').click();

        // The editor, with no sign-in in the way.
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await page.locator('.editor-canvas-container').click({ position: { x: 100, y: 60 } });
        await page.keyboard.press('5');
        await expect(notes(page).first()).toBeVisible();
        await page.locator('#new-tab-title').fill('Signed Out Tune');
        expect(sb.rows('pending_songs')).toEqual([]);

        // Submit is where the gate is, and the work rides through Google sign-in.
        await Promise.all([
            page.waitForURL(/#access_token=/, { timeout: 20000 }),
            page.locator('#app-bottomband .tab-edit-submit').click(),
        ]);
        await expect(page).toHaveURL(/#new-tab\?draft=d-/, { timeout: 20000 });
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await expect(notes(page).first()).toBeVisible();
        expect(sb.rows('pending_songs')).toEqual([]);
    });

    test('📂 Import .tef… on a new take on a song needs no sign-in either', async ({ page }) => {
        // importTefAsNewTake used to gate on requireLogin('add a tab').
        await page.goto('/#new-tab?title=Empty%20Take&instrument=banjo');
        await page.locator('.editor-renderer .stave-row').first().waitFor({ timeout: 20000 });
        await chooseFile(page, page.locator('#app-bottomband .tab-edit-import'), tef.file);
        await expectEditorWithNotes(page);
    });
});

